import { fetchWatches } from "./builder";
import { bindBuilderPanel, builderPanelHtml } from "./builder-panel";
import {
  authFetch,
  markNotificationsForProposalRead,
  profilePath,
  updateNavUnreadBadge,
  type AuthUser,
} from "./auth";
import {
  CLAIM_FLOOR_SATS,
  WORKERS_API,
  escrowAddressMatchesNetwork,
  isFundableStatus,
} from "./config";
import { promptText } from "./confirm-modal";
import { proposalFromMarkdown } from "./github";
import { btnWithIcon } from "./icons";
import { addressBalanceSats } from "./mempool";
import { renderMarkdown } from "./markdown";
import {
  bindDonateModal,
  bindDonatePanel,
  updateProposalFundingBar,
  bindProposalCopyButtons,
  bindShareButtons,
  donateModalHtml,
  donateMobileCtaHtml,
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
  discussionClosedForStatus,
  funderCreditHtml,
} from "./proposal-engagement";
import { fetchReviewerMe } from "./reviewers";
import {
  applySeo,
  href,
  orgHref,
  projectsHref,
  proposalHref,
  proposalJsonLd,
  seoForRoute,
} from "./router";
import { escapeHtml, formatSats, linkifyText, proposalStablePath } from "./util";
import { recordProposalView } from "./views";

export type ProposalShell = (inner: string) => string;

function bindRefundAndBallot(root: ParentNode, match: Proposal): void {
  const api = WORKERS_API.replace(/\/$/, "");

  const loadRefundStatus = async () => {
    if (!match.id) return;
    const statusEl = root.querySelector<HTMLElement>("#refund-status");
    const bodyEl = root.querySelector<HTMLElement>("#refund-status-body");
    const listEl = root.querySelector<HTMLElement>("#refund-status-list");
    const formEl = root.querySelector<HTMLElement>("#refund-register-form");
    if (!statusEl || !bodyEl || !listEl) return;
    try {
      const res = await authFetch(
        `${api}/refunds/status/${encodeURIComponent(match.id)}`,
      );
      if (res.status === 401) {
        statusEl.hidden = false;
        bodyEl.textContent =
          "Sign in to see whether your contributions still need a refund address.";
        return;
      }
      if (!res.ok) return;
      const data = (await res.json()) as {
        linked: boolean;
        needs_address: number;
        registered: number;
        paid: number;
        addresses_frozen?: boolean;
        contributions: {
          txid: string;
          vout: number;
          swap_id?: string | null;
          rail?: string;
          amount_sats: number;
          status: string;
          refund_address?: string | null;
          refund_txid?: string | null;
        }[];
      };
      statusEl.hidden = false;
      if (!data.linked) {
        bodyEl.textContent =
          "No contribution linked to this account yet. Register with your funding txid and vout below.";
        listEl.innerHTML = "";
        if (formEl) formEl.hidden = false;
        return;
      }
      const parts = [
        data.needs_address ? `${data.needs_address} still need an address` : "",
        data.registered ? `${data.registered} registered` : "",
        data.paid ? `${data.paid} paid` : "",
      ].filter(Boolean);
      bodyEl.textContent = data.addresses_frozen
        ? `${parts.join(" · ")}. Addresses frozen for keyholder batch.`
        : `${parts.join(" · ")}.`;
      listEl.innerHTML = data.contributions
        .map((r) => {
          const identity =
            r.rail === "lightning" || r.swap_id
              ? `swap ${escapeHtml((r.swap_id || "").slice(0, 16))}${
                  r.swap_id && r.swap_id.length > 16 ? "…" : ""
                }`
              : `${escapeHtml(r.txid.slice(0, 12))}…:${r.vout}`;
          return `<li class="mono">${identity} · ${escapeHtml(r.status)}${
            r.refund_address
              ? ` · ${escapeHtml(r.refund_address.slice(0, 12))}…`
              : ""
          }</li>`;
        })
        .join("");
      if (formEl) {
        formEl.hidden = Boolean(
          data.addresses_frozen ||
            (data.needs_address === 0 && data.registered + data.paid > 0),
        );
      }
    } catch {
      /* ignore */
    }
  };
  void loadRefundStatus();

  const syncRefundRail = () => {
    const rail =
      (
        root.querySelector(
          'input[name="refund_rail"]:checked',
        ) as HTMLInputElement | null
      )?.value || "onchain";
    const onchain = root.querySelector<HTMLElement>("#refund-onchain-fields");
    const ln = root.querySelector<HTMLElement>("#refund-ln-fields");
    if (onchain) onchain.hidden = rail !== "onchain";
    if (ln) ln.hidden = rail !== "lightning";
  };
  root.querySelectorAll('input[name="refund_rail"]').forEach((el) => {
    el.addEventListener("change", syncRefundRail);
  });
  syncRefundRail();

  root.querySelector("#refund-submit")?.addEventListener("click", async () => {
    const msg = root.querySelector<HTMLElement>("#refund-msg");
    const rail =
      (
        root.querySelector(
          'input[name="refund_rail"]:checked',
        ) as HTMLInputElement | null
      )?.value || "onchain";
    const txid = (
      root.querySelector("#refund-txid") as HTMLInputElement | null
    )?.value.trim();
    const vout = Number(
      (root.querySelector("#refund-vout") as HTMLInputElement | null)?.value,
    );
    const swap_id = (
      root.querySelector("#refund-swap-id") as HTMLInputElement | null
    )?.value.trim();
    const refund_address = (
      root.querySelector("#refund-address") as HTMLInputElement | null
    )?.value.trim();
    const showRefundMsg = (text: string, cls = "") => {
      if (!msg) return;
      msg.hidden = false;
      msg.className = cls ? `muted ${cls}` : "muted";
      msg.textContent = text;
    };
    if (!match.id || !refund_address) {
      showRefundMsg("Enter a refund address.", "error");
      return;
    }
    if (rail === "onchain") {
      if (!txid) {
        showRefundMsg("Enter the funding txid (and vout).", "error");
        return;
      }
      if (!Number.isInteger(vout) || vout < 0) {
        showRefundMsg("Enter a valid vout (integer ≥ 0).", "error");
        return;
      }
    }
    if (rail === "lightning" && !swap_id) {
      showRefundMsg("Enter the Lightning swap id from your donate receipt.", "error");
      return;
    }
    const registerBody =
      rail === "lightning"
        ? { proposal_id: match.id, swap_id, refund_address }
        : { proposal_id: match.id, txid, vout, refund_address };
    const claimBody =
      rail === "lightning"
        ? { proposal_id: match.id, swap_id }
        : { proposal_id: match.id, txid, vout };
    try {
      const tryRegister = () =>
        authFetch(`${api}/refunds/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(registerBody),
        });
      let res = await tryRegister();
      let body = (await res.json()) as {
        error?: string;
        code?: string;
        package_error?: boolean;
        note?: string;
      };
      if (
        res.status === 409 &&
        (body.code === "link_required" || body.error === "link_required")
      ) {
        const claimRes = await authFetch(`${api}/contributions/claim`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(claimBody),
        });
        const claimBodyJson = (await claimRes.json().catch(() => ({}))) as {
          error?: string;
        };
        if (!claimRes.ok) {
          showRefundMsg(
            claimBodyJson.error ||
              "Could not link contribution — sign in and try again.",
            "error",
          );
          return;
        }
        res = await tryRegister();
        body = (await res.json()) as {
          error?: string;
          code?: string;
          package_error?: boolean;
          note?: string;
        };
      }
      if (res.ok || body.package_error) {
        showRefundMsg(
          body.package_error
            ? body.note ||
                "Address saved, but the keyholder package failed — try Register again."
            : "Refund address registered — track under Account → Funds.",
          body.package_error ? "error" : "",
        );
        void loadRefundStatus();
      } else {
        showRefundMsg(
          body.note || String(body.error || "failed"),
          "error",
        );
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
                  (await promptText({
                    title: "Redirect target",
                    body: "Proposal id to redirect escrow toward (ops/keyholders move funds manually).",
                    placeholder: "proposal-id",
                    confirmLabel: "Vote redirect",
                    validate: (v) =>
                      /^[a-zA-Z0-9._-]{2,80}$/.test(v)
                        ? null
                        : "Enter a valid proposal id.",
                  })) || undefined;
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
  preloaded: Proposal | null = null,
): Promise<void> {
  const app = document.querySelector<HTMLDivElement>("#app")!;
  app.innerHTML = shell(
    `<section class="wrap-wide detail proposal-page"><p class="loading">Loading…</p></section>`,
  );

  try {
    let match: Proposal;
    if (preloaded && preloaded.path === path) {
      match = preloaded;
    } else {
      const res = await fetch(
        `https://raw.githubusercontent.com/Plebly/proposals/main/${path}`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      match = proposalFromMarkdown(await res.text(), path);
    }
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
      ogType: "article",
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

    const byline = proposerBylineHtml(match.proposer, profilePath, {
      proposer_type: match.proposer_type,
      orgHref,
    });
    const listingReportHtml = listingReportControlHtml(
      String(match.status),
      match.path,
      match.id,
    );

    const escrowOk =
      Boolean(match.escrow_address) &&
      escrowAddressMatchesNetwork(String(match.escrow_address)) &&
      isFundableStatus(String(match.status));
    const wantsDonate =
      escrowOk &&
      (/(?:^|[?&])donate(?:=[^&]*)?(?:&|$)/.test(location.search) ||
        /(?:^|[?&])rail=lightning(?:&|$)/.test(location.search));
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
      match.proposer_type,
    );
    const status = String(match.status);

    app.innerHTML = shell(`
      <article class="wrap-wide detail proposal-page">
        <nav class="proposal-breadcrumbs" aria-label="Breadcrumb">
          <ol>
            <li><a href="${projectsHref()}">Projects</a></li>
            <li aria-current="page">${escapeHtml(match.title)}</li>
          </ol>
        </nav>
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
            ? proposalFundingBarHtml(
                balance,
                CLAIM_FLOOR_SATS,
                match.target_sats,
                match.milestones,
              )
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
            ${commentsHtml(match.id, Boolean(user), {
              discussionClosed: discussionClosedForStatus(status),
            })}
          </div>

          <aside class="proposal-sidebar">
            <div class="proposal-actions">
              ${builderPanelHtml({ ...match, balance_sats: balance }, balance, watching)}
              ${escrowOk ? `<div class="proposal-donate-slot">${donateTriggerHtml()}</div>` : ""}
              ${shareSlotHtml(match.title, match.path, match.id)}
            </div>
            ${deliverableChipHtml(match.deliverable_url)}
            ${status === "in_review" && match.id ? reviewPanelHtml(match.id) : ""}
            ${status === "rejected" && match.id ? rebuttalPanelHtml() : ""}
            ${status === "refunding" ? refundRegisterHtml(match.id) : ""}
            ${
              status === "abandoned_vote" ||
              (status === "underfunded" && (balance ?? 0) > 0)
                ? ballotPanelHtml(match.id)
                : ""
            }
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
        ${escrowOk ? donateMobileCtaHtml() : ""}
        ${escrowOk ? donateModalHtml(match, { signedIn: Boolean(user) }) : ""}
      </article>
    `);

    bindProposalCopyButtons(app);
    bindShareButtons(app);
    let reloadEngagement: (() => Promise<void>) | null = null;
    // Open Donate before claim/lightning network work so guests are not stuck waiting.
    if (escrowOk) {
      bindDonateModal(app, {
        open: wantsDonate,
        rail: wantsLnRail ? "lightning" : undefined,
      });
    }
    const donateReady = escrowOk
      ? bindDonatePanel(app, {
          address: String(match.escrow_address),
          proposalId: match.id,
          proposalPath: match.path,
          signedIn: Boolean(user),
          initialBalance: balance ?? 0,
          claimFloorSats: CLAIM_FLOOR_SATS,
          targetSats: match.target_sats,
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
          onBalanceUpdate: (next) => {
            updateProposalFundingBar(
              app,
              next,
              CLAIM_FLOOR_SATS,
              match.target_sats,
              match.milestones,
            );
            const needEl = app.querySelector(".builder-status.muted");
            if (
              needEl &&
              /more confirmed sats to reach the claim floor/i.test(
                needEl.textContent || "",
              )
            ) {
              const need = Math.max(0, CLAIM_FLOOR_SATS - next);
              needEl.textContent =
                need > 0
                  ? `Needs ${formatSats(need)} more confirmed sats to reach the claim floor.`
                  : "Claim floor met. Refresh if the claim button does not appear.";
            }
          },
        })
      : Promise.resolve();
    await Promise.all([
      bindBuilderPanel(app, {
        proposal: { ...match, balance_sats: balance },
        balance,
        user,
        watching,
      }),
      donateReady,
    ]);
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
        discussionClosed: discussionClosedForStatus(status),
      },
    );
    void hydrateAvatarSlots(app);
    if (user && (match.id || match.path)) {
      void markNotificationsForProposalRead({
        proposalId: match.id,
        proposalPath: match.path,
      })
        .then((remaining) => updateNavUnreadBadge(remaining))
        .catch(() => {
          /* non-blocking */
        });
    }
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
        ? userMatchesProposer(user, match.proposer, match.proposer_type)
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
        <a class="back-link" href="${projectsHref()}">← Projects</a>
        <div class="empty-state">
          <div class="empty-state-inner">
            <p class="empty-state-title">Could not load proposal</p>
            <p class="empty-state-body">${escapeHtml((e as Error).message)}</p>
            <p><a class="btn ghost" href="${projectsHref()}">Browse projects</a></p>
          </div>
        </div>
      </section>
    `);
  }
}
