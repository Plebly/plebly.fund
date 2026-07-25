import { fetchWatches } from "./builder";
import { bindBuilderPanel, builderPanelHtml } from "./builder-panel";
import { authFetch, profilePath, type AuthUser } from "./auth";
import { CLAIM_FLOOR_SATS, WORKERS_API } from "./config";
import { listListedProposals, proposalFromMarkdown } from "./github";
import { addressBalanceSats } from "./mempool";
import { renderMarkdown } from "./markdown";
import {
  bindDonateModal,
  bindDonatePanel,
  bindProposalCopyButtons,
  donateModalHtml,
  donateTriggerHtml,
  ballotPanelHtml,
  canEditProposal,
  deliverableChipHtml,
  metaChipsHtml,
  milestonesHtml,
  onChainPanelHtml,
  proposalContextHtml,
  proposalFundingBarHtml,
  proposalLifecycleBannersHtml,
  proposerBylineHtml,
  refundRegisterHtml,
  sectionBodyHtml,
  statusClass,
  statusLabel,
} from "./proposal-ui";
import {
  bindRebuttalPanel,
  bindReviewPanel,
  rebuttalPanelHtml,
  reviewPanelHtml,
} from "./review-panel";
import type { Proposal } from "./types";
import { safeHttpsImageUrl } from "./media";
import { applySeo, href, seoForRoute } from "./router";
import { escapeHtml } from "./util";

export type ProposalShell = (inner: string) => string;

function bindRefundAndBallot(root: ParentNode, match: Proposal): void {
  const api = WORKERS_API.replace(/\/$/, "");
  root.querySelector("#refund-submit")?.addEventListener("click", async () => {
    const msg = root.querySelector<HTMLElement>("#refund-msg");
    const txid = (
      root.querySelector("#refund-txid") as HTMLInputElement | null
    )?.value.trim();
    const vout = Number(
      (root.querySelector("#refund-vout") as HTMLInputElement | null)?.value,
    );
    const refund_address = (
      root.querySelector("#refund-address") as HTMLInputElement | null
    )?.value.trim();
    if (!match.id || !txid || !refund_address) return;
    try {
      const res = await authFetch(`${api}/refunds/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proposal_id: match.id,
          txid,
          vout,
          refund_address,
        }),
      });
      const body = await res.json();
      if (msg) {
        msg.hidden = false;
        msg.textContent = res.ok
          ? "Refund address registered."
          : String(body.error || "failed");
      }
    } catch (e) {
      if (msg) {
        msg.hidden = false;
        msg.textContent = (e as Error).message;
      }
    }
  });

  const panel = root.querySelector<HTMLElement>("#ballot-panel");
  if (!panel || !match.id) return;
  const statusEl = panel.querySelector<HTMLElement>("#ballot-status");
  const actions = panel.querySelector<HTMLElement>("#ballot-actions");
  const bmsg = panel.querySelector<HTMLElement>("#ballot-msg");
  void (async () => {
    try {
      const res = await fetch(
        `${api}/ballots/proposal/${encodeURIComponent(match.id!)}`,
      );
      const data = (await res.json()) as {
        ballot?: { id: string; vote_count: number; closes_at: string } | null;
      };
      if (!data.ballot) {
        if (statusEl) statusEl.textContent = "No open ballot.";
        return;
      }
      if (statusEl) {
        statusEl.textContent = `${data.ballot.vote_count} vote(s) · closes ${new Date(data.ballot.closes_at).toLocaleDateString()}`;
      }
      if (actions) {
        actions.hidden = false;
        actions.querySelectorAll<HTMLButtonElement>("[data-ballot-opt]").forEach(
          (btn) => {
            btn.addEventListener("click", async () => {
              let option = btn.dataset.ballotOpt || "";
              let redirect_target: string | undefined;
              if (option === "redirect") {
                redirect_target =
                  window.prompt("Redirect target proposal id") || undefined;
                if (!redirect_target) return;
              }
              const voteRes = await authFetch(
                `${api}/ballots/${encodeURIComponent(data.ballot!.id)}/vote`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ option, redirect_target }),
                },
              );
              const voteBody = await voteRes.json();
              if (bmsg) {
                bmsg.hidden = false;
                bmsg.textContent = voteRes.ok
                  ? "Vote recorded."
                  : String(voteBody.error || "vote failed");
              }
            });
          },
        );
      }
    } catch {
      if (statusEl) statusEl.textContent = "Could not load ballot.";
    }
  })();
}

function stripLeadingTitle(markdown: string): string {
  return markdown.replace(/^#\s+.+\n+/, "").trim();
}

function proposalSectionsHtml(markdown: string): string {
  const md = stripLeadingTitle(markdown);
  const chunks = md.split(/^##\s+/m).filter((c) => c.trim());

  if (chunks.length === 0) {
    return `<section class="proposal-section"><div class="prose-rich">${renderMarkdown(md)}</div></section>`;
  }

  return chunks
    .map((chunk) => {
      const nl = chunk.indexOf("\n");
      const title = (nl === -1 ? chunk : chunk.slice(0, nl)).trim();
      const body = (nl === -1 ? "" : chunk.slice(nl + 1)).trim();
      const id = title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const sectionClass =
        id === "verification"
          ? "proposal-section proposal-section-verify"
          : id === "out-of-scope"
            ? "proposal-section proposal-section-muted"
            : "proposal-section";
      return `<section class="${sectionClass}" id="${escapeHtml(id)}">
        <h2 class="proposal-section-title">${escapeHtml(title)}</h2>
        ${sectionBodyHtml(title, body, renderMarkdown)}
      </section>`;
    })
    .join("");
}

export async function renderProposalPage(
  path: string,
  shell: ProposalShell,
  user: AuthUser | null = null,
): Promise<void> {
  const app = document.querySelector<HTMLDivElement>("#app")!;
  app.innerHTML = shell(
    `<section class="wrap-wide detail proposal-page"><p class="loading">Loading…</p></section>`,
  );

  try {
    const res = await fetch(
      `https://raw.githubusercontent.com/Plebly/proposals/main/${path}`,
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.text();
    const proposals = await listListedProposals();
    const listed = proposals.find((p) => p.path === path);
    const match: Proposal = listed || proposalFromMarkdown(raw, path);
    const coverUrl = safeHttpsImageUrl(match.cover_image);
    applySeo({
      ...seoForRoute(
        { name: "proposal", id: match.path || path },
        {
          title: match.title,
          description:
            match.body
              ?.replace(/^#+\s+.+$/gm, "")
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 160) || undefined,
        },
      ),
      ...(coverUrl ? { image: coverUrl } : {}),
    });
    const bodyMd = match.body;
    const sectionsHtml = proposalSectionsHtml(bodyMd);

    let balance: number | undefined;
    if (match.escrow_address) {
      try {
        balance = await addressBalanceSats(match.escrow_address);
      } catch {
        /* ignore */
      }
    }

    const byline = proposerBylineHtml(match.proposer, profilePath);

    const wantsDonate =
      /(?:^|[?&])donate(?:=[^&]*)?(?:&|$)/.test(location.search) ||
      /(?:^|[?&])rail=lightning(?:&|$)/.test(location.search);
    const wantsLnRail =
      /(?:^|[?&])(?:rail=lightning|donate=ln)(?:&|$)/.test(location.search);
    const watches = user
      ? await fetchWatches().catch(() => [])
      : [];
    const watching = watches.some(
      (w) =>
        w.proposal_path === match.path ||
        w.proposal_id === match.id ||
        w.proposal_id === path.split("/").pop()?.replace(/\.md$/, ""),
    );

    const coverHtml = coverUrl
      ? `<div class="proposal-cover"><img src="${escapeHtml(coverUrl)}" alt="" decoding="async" /></div>`
      : "";

    if (match.id && WORKERS_API) {
      try {
        const stallRes = await fetch(
          `${WORKERS_API.replace(/\/$/, "")}/escrow/stall/${encodeURIComponent(match.id)}`,
        );
        if (stallRes.ok) {
          const stall = (await stallRes.json()) as {
            blocked?: boolean;
            reason?: string;
          };
          if (stall.blocked && stall.reason) {
            match.release_blocked_reason = stall.reason;
          }
        }
      } catch {
        /* ignore */
      }
    }

    const banners = proposalLifecycleBannersHtml(match, balance);

    const canEdit = canEditProposal(
      user,
      match.proposer,
      String(match.status),
    );
    const status = String(match.status);

    app.innerHTML = shell(`
      <section class="wrap-wide detail proposal-page">
        <a class="back-link" href="${href("/")}">← Projects</a>
        ${coverHtml}

        <header class="proposal-hero">
          <div class="proposal-hero-top">
            <h1>${escapeHtml(match.title)}</h1>
            <span class="pill pill-status ${statusClass(status)}">${escapeHtml(statusLabel(status))}</span>
          </div>
          <div class="proposal-hero-meta">
            ${byline}
            ${metaChipsHtml(match)}
            ${
              canEdit
                ? `<a class="proposal-edit-link" href="${href("/propose", `?edit=${encodeURIComponent(match.path)}`)}">Edit</a>`
                : ""
            }
          </div>
        </header>

        ${
          match.escrow_address
            ? proposalFundingBarHtml(balance, CLAIM_FLOOR_SATS, match.target_sats)
            : ""
        }

        ${banners ? `<div class="proposal-banners">${banners}</div>` : ""}

        <div class="proposal-layout">
          <div class="proposal-main">
            <div class="proposal-sections">${sectionsHtml}</div>
            ${milestonesHtml(match.milestones)}
            ${proposalContextHtml(match.depends_on || [], match.related_work || [])}
          </div>

          <aside class="proposal-sidebar">
            <div class="proposal-actions">
              ${builderPanelHtml({ ...match, balance_sats: balance }, balance, watching)}
              ${match.escrow_address ? `<div class="proposal-donate-slot">${donateTriggerHtml()}</div>` : ""}
            </div>
            ${deliverableChipHtml(match.deliverable_url)}
            ${status === "in_review" && match.id ? reviewPanelHtml(match.id) : ""}
            ${status === "rejected" && match.id ? rebuttalPanelHtml() : ""}
            ${status === "refunding" ? refundRegisterHtml(match.id) : ""}
            ${status === "abandoned_vote" ? ballotPanelHtml(match.id) : ""}
            ${onChainPanelHtml(match)}
          </aside>
        </div>
        ${match.escrow_address ? donateModalHtml(match) : ""}
      </section>
    `);

    bindProposalCopyButtons(app);
    await bindBuilderPanel(app, {
      proposal: { ...match, balance_sats: balance },
      balance,
      user,
      watching,
    });
    if (match.escrow_address) {
      await bindDonatePanel(app, {
        address: match.escrow_address,
        proposalId: match.id,
        proposalPath: match.path,
      });
      bindDonateModal(app, {
        open: wantsDonate,
        rail: wantsLnRail ? "lightning" : undefined,
      });
    }
    bindRefundAndBallot(app, match);
    if (String(match.status) === "in_review" && match.id) {
      await bindReviewPanel(app, { proposalId: match.id, user });
    }
    if (String(match.status) === "rejected" && match.id) {
      const isFulfiller = Boolean(
        user &&
          match.claimer &&
          (match.claimer === user.username ||
            match.claimer === user.github ||
            match.claimer === user.x ||
            match.claimer === user.id),
      );
      await bindRebuttalPanel(app, {
        proposalId: match.id,
        proposalPath: match.path,
        user,
        isFulfiller,
      });
    }
  } catch (e) {
    app.innerHTML = shell(`
      <section class="wrap-wide detail proposal-page">
        <a class="back-link" href="${href("/")}">← Projects</a>
        <div class="empty-state">
          <div class="empty-state-inner">
            <p class="empty-state-title">Could not load proposal</p>
            <p class="empty-state-body">${escapeHtml((e as Error).message)}</p>
            <p><a class="btn ghost" href="${href("/")}">Browse projects</a></p>
          </div>
        </div>
      </section>
    `);
  }
}
