import { fetchWatches } from "./builder";
import { bindBuilderPanel, builderPanelHtml } from "./builder-panel";
import { authFetch, profilePath, type AuthUser } from "./auth";
import { CLAIM_FLOOR_SATS, WORKERS_API } from "./config";
import { listListedProposals, proposalFromMarkdown } from "./github";
import { btnWithIcon } from "./icons";
import { addressBalanceSats } from "./mempool";
import { renderMarkdown } from "./markdown";
import {
  bindDonateModal,
  bindDonatePanel,
  bindProposalCopyButtons,
  bindShareButtons,
  donateModalHtml,
  donateTriggerHtml,
  shareSlotHtml,
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
  statusPillHtml,
  userMatchesProposer,
} from "./proposal-ui";
import {
  bindListingReportControl,
  listingReportControlHtml,
} from "./report-panel";
import {
  bindRebuttalPanel,
  bindReviewPanel,
  rebuttalPanelHtml,
  reviewPanelHtml,
} from "./review-panel";
import type { Proposal } from "./types";
import { safeHttpsImageUrl } from "./media";
import { hydrateAvatarSlots } from "./profile-avatars";
import {
  bindProposalEngagement,
  commentsHtml,
  funderCreditHtml,
} from "./proposal-engagement";
import { fetchReviewerMe } from "./reviewers";
import {
  applySeo,
  href,
  proposalHref,
  proposalJsonLd,
  seoForRoute,
} from "./router";
import { escapeHtml, linkifyText, proposalStablePath } from "./util";
import { recordProposalView } from "./views";

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

function proposalSeoDescription(proposal: Proposal): string | undefined {
  const sections = ["Problem", "Deliverable"]
    .map((heading) =>
      new RegExp(
        `^##\\s+${heading}\\s*\\n([\\s\\S]*)`,
        "im",
      )
        .exec(proposal.body)?.[1]
        .split(/^##\s+/m)[0],
    )
    .filter((section): section is string => Boolean(section))
    .map((section) => section.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const source = sections.join(" ") || proposal.body;
  return source
    .replace(/^#+\s+.+$/gm, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160) || undefined;
}

export async function renderProposalPage(
  path: string,
  shell: ProposalShell,
  user: AuthUser | null = null,
  onAuthed: () => void = () => undefined,
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
    if (match.id) {
      const canonical = new URL(proposalHref(match.path, match.id), location.origin);
      if (location.pathname !== canonical.pathname) {
        history.replaceState(history.state, "", `${canonical.pathname}${location.search}${location.hash}`);
      }
    }
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

    const seoDescription =
      proposalSeoDescription(match) ||
      "Fund open Bitcoin work with publicly verifiable on-chain escrow.";
    const seoPath = match.id
      ? proposalStablePath(match.id)
      : `/proposal/${match.path.replace(/^proposals\//, "").replace(/\.md$/, "")}`;
    applySeo({
      ...seoForRoute(
        { name: "proposal", id: match.path || path },
        {
          title: match.title,
          description: seoDescription,
          path: match.id ? proposalStablePath(match.id) : undefined,
        },
      ),
      ...(coverUrl ? { image: coverUrl } : {}),
      jsonLd: proposalJsonLd({
        id: match.id,
        title: match.title,
        description: seoDescription,
        path: seoPath,
        status: String(match.status),
        target_sats: match.target_sats,
        balance_sats: balance ?? match.balance_sats,
        cover_image: coverUrl,
      }),
    });

    const byline = proposerBylineHtml(match.proposer, profilePath);
    const listingReportHtml = listingReportControlHtml(
      String(match.status),
      match.path,
      match.id,
    );

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
            ${statusPillHtml(status)}
          </div>
          <div class="proposal-hero-meta">
            ${byline}
            ${metaChipsHtml(match)}
            ${match.id ? `<span class="proposal-view-count" id="proposal-view-count" aria-live="polite">Views: -</span>` : ""}
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
            ${
              match.parent_initiative
                ? `<section class="proposal-context" aria-labelledby="commons-heading">
                    <h2 id="commons-heading" class="proposal-block-title">Commons</h2>
                    <p class="proposal-block-lede">Parent initiative</p>
                    <p>${linkifyText(match.parent_initiative)}</p>
                  </section>`
                : ""
            }
            ${proposalContextHtml(match.depends_on || [], match.related_work || [])}
            ${funderCreditHtml(match.id)}
            ${commentsHtml(match.id, Boolean(user))}
          </div>

          <aside class="proposal-sidebar">
            <div class="proposal-actions">
              ${builderPanelHtml({ ...match, balance_sats: balance }, balance, watching)}
              ${match.escrow_address ? `<div class="proposal-donate-slot">${donateTriggerHtml()}</div>` : ""}
              ${shareSlotHtml(match.title, match.path, match.id)}
            </div>
            ${deliverableChipHtml(match.deliverable_url)}
            ${status === "in_review" && match.id ? reviewPanelHtml(match.id) : ""}
            ${status === "rejected" && match.id ? rebuttalPanelHtml() : ""}
            ${status === "refunding" ? refundRegisterHtml(match.id) : ""}
            ${status === "abandoned_vote" ? ballotPanelHtml(match.id) : ""}
            ${
              canEdit || listingReportHtml
                ? `<div class="proposal-sidebar-actions">
                    ${
                      canEdit
                        ? `<a class="btn ghost proposal-sidebar-btn" href="${href("/propose", `?edit=${encodeURIComponent(match.path)}`)}">${btnWithIcon("pen-to-square", "Edit project")}</a>`
                        : ""
                    }
                    ${listingReportHtml}
                  </div>`
                : ""
            }
            ${onChainPanelHtml(match)}
          </aside>
        </div>
        ${match.escrow_address ? donateModalHtml(match, { signedIn: Boolean(user) }) : ""}
      </section>
    `);

    bindProposalCopyButtons(app);
    bindShareButtons(app);
    await bindBuilderPanel(app, {
      proposal: { ...match, balance_sats: balance },
      balance,
      user,
      watching,
    });
    let reloadEngagement: (() => Promise<void>) | null = null;
    if (match.escrow_address) {
      await bindDonatePanel(app, {
        address: match.escrow_address,
        proposalId: match.id,
        proposalPath: match.path,
        signedIn: Boolean(user),
        creditPrefs: user?.funder_credit
          ? {
              public_credit: user.funder_credit.public_credit !== false,
              anonymous: user.funder_credit.public_credit === false,
              show_amount: Boolean(user.funder_credit.show_amount),
            }
          : null,
        onAuthed,
        onCreditLinked: () => {
          void reloadEngagement?.();
        },
      });
      bindDonateModal(app, {
        open: wantsDonate,
        rail: wantsLnRail ? "lightning" : undefined,
      });
    }
    bindRefundAndBallot(app, match);
    const reviewerMe = user
      ? await fetchReviewerMe().catch(() => null)
      : null;
    await bindListingReportControl(app, {
      proposalId: match.id,
      proposalPath: match.path,
      status,
      user,
      reviewerMe,
      onAuthed,
    });
    reloadEngagement = await bindProposalEngagement(
      app,
      Boolean(user),
      onAuthed,
      {
        user,
        canModerate: Boolean(reviewerMe?.active),
        proposalId: match.id,
      },
    );
    void hydrateAvatarSlots(app);
    if (match.id) {
      void recordProposalView(match.id).then((count) => {
        const el = app.querySelector("#proposal-view-count");
        if (el && count != null) el.textContent = `Views: ${count.toLocaleString()}`;
      });
    }
    if (String(match.status) === "in_review" && match.id) {
      await bindReviewPanel(app, { proposalId: match.id, user });
    }
    if (String(match.status) === "rejected" && match.id) {
      const isDirect =
        String(match.proposal_type || "bounty").toLowerCase() === "direct";
      const isFulfiller = isDirect
        ? userMatchesProposer(user, match.proposer)
        : Boolean(
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
