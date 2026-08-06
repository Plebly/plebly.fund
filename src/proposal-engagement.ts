import {
  authFetch,
  bindLoginHandlers,
  currentReturnPath,
  loginChoicesHtml,
  type AuthUser,
} from "./auth";
import { contributorBadge, contributorBadgeLabel } from "./badges";
import { confirmAction } from "./confirm-modal";
import { WORKERS_API } from "./config";
import { fileModerationReport } from "./reports";
import { profileHref } from "./router";
import { escapeHtml, formatSats, linkifyText, timeAgoHtml } from "./util";

type PublicContribution = {
  identity: string | null;
  anonymous: boolean;
  amount_sats?: number;
  rail?: string;
};

export type ProposalComment = {
  id: string;
  author: string;
  body: string;
  created_at: string;
  user_id?: string;
  username?: string;
  avatar_url?: string;
  deleted?: boolean;
};

const api = () => WORKERS_API.replace(/\/$/, "");

/** Public funder list only — credit prefs live in the Donate wizard. */
export function funderCreditHtml(proposalId: string | null): string {
  if (!proposalId) return "";
  return `<section class="proposal-engagement" id="funder-credit" data-proposal-id="${escapeHtml(proposalId)}" hidden>
    <h2 class="proposal-block-title" id="funder-credit-title">Funders</h2>
    <div id="funder-credit-list" class="funder-credit-list" aria-live="polite"></div>
  </section>`;
}

export function discussionClosedForStatus(status: string | undefined): boolean {
  return [
    "completed",
    "declined",
    "declined_fundable",
    "underfunded",
    "refunding",
    "redirected",
  ].includes(String(status || ""));
}

function closedNoticeHtml(): string {
  return `<p class="muted engagement-closed-notice">Discussion closed — this project is finished. History stays readable.</p>`;
}

export function commentsHtml(
  proposalId: string | null,
  signedIn: boolean,
  opts: { discussionClosed?: boolean } = {},
): string {
  if (!proposalId) return "";
  const closed = Boolean(opts.discussionClosed);
  const publicCompose = closed
    ? closedNoticeHtml()
    : signedIn
      ? `<label class="sr-only" for="proposal-comment-input">Comment</label>
             <textarea id="proposal-comment-input" class="comment-input" rows="3" maxlength="2000" placeholder="Write a comment…"></textarea>
             <div class="comment-compose-actions">
               <button type="button" class="btn" id="proposal-comment-submit">Post comment</button>
             </div>`
      : `<div class="proposal-engagement-empty">
               <p>Sign in to comment.</p>
               ${loginChoicesHtml(undefined, currentReturnPath())}
               <p class="builder-msg" id="comment-login-msg" hidden></p>
             </div>`;
  const workboardCompose = closed
    ? closedNoticeHtml()
    : signedIn
      ? `<label class="sr-only" for="proposal-workboard-input">Workboard message</label>
             <textarea id="proposal-workboard-input" class="comment-input" rows="3" maxlength="2000" placeholder="Write to the claim team…"></textarea>
             <div class="comment-compose-actions">
               <button type="button" class="btn" id="proposal-workboard-submit">Post to workboard</button>
             </div>`
      : "";
  return `<section class="proposal-engagement" id="proposal-comments" data-proposal-id="${escapeHtml(proposalId)}"${
    closed ? ' data-discussion-closed="1"' : ""
  }>
    <h2 class="proposal-block-title">Discussion</h2>
    <div class="engagement-tabs" id="proposal-engagement-tabs" hidden role="tablist" aria-label="Discussion">
      <button type="button" class="engagement-tab is-active" role="tab" aria-selected="true" data-eng-tab="public" id="eng-tab-public">Public</button>
      <button type="button" class="engagement-tab" role="tab" aria-selected="false" data-eng-tab="workboard" id="eng-tab-workboard">Workboard</button>
    </div>
    <div id="proposal-public-pane" class="engagement-pane" data-eng-pane="public">
      <p id="proposal-discussion-link" class="proposal-discussion-link" hidden></p>
      <div id="proposal-comment-list"><p class="muted">Loading comments…</p></div>
      ${publicCompose}
      <p class="builder-msg" id="proposal-comment-msg" hidden></p>
    </div>
    <div id="proposal-workboard-pane" class="engagement-pane" data-eng-pane="workboard" hidden>
      <p class="muted engagement-workboard-hint">Only the proposer, claimer, and collaborators can see these posts.</p>
      <div id="proposal-workboard-list"><p class="muted">Loading…</p></div>
      ${workboardCompose}
      <p class="builder-msg" id="proposal-workboard-msg" hidden></p>
    </div>
  </section>`;
}

/** Pure workboard list (same chrome as comments; no public moderation actions). */
export function workboardListHtml(messages: ProposalComment[]): string {
  if (!messages.length) {
    return `<div class="proposal-engagement-empty"><p>No workboard posts yet. Coordinate here with the claim team.</p></div>`;
  }
  return `<div class="proposal-comment-list">${messages
    .map((comment) => {
      const when = timeAgoHtml(comment.created_at);
      return `<article class="proposal-comment" data-comment-id="${escapeHtml(comment.id)}">
        ${commentAvatarHtml(comment)}
        <div class="proposal-comment-body">
          <header>
            ${commentNameHtml(comment)}
            ${when ? `<span class="proposal-comment-when"> · ${when}</span>` : ""}
          </header>
          <p>${linkifyText(comment.body)}</p>
        </div>
      </article>`;
    })
    .join("")}</div>`;
}

export function profileUrlForIdentity(identity: string | null): string | null {
  if (!identity) return null;
  const raw = identity.trim();
  if (!raw || raw.toLowerCase() === "anonymous") return null;
  if (raw.startsWith("npub") || raw.includes("@")) return null;
  const handle = raw.replace(/^github:/i, "").replace(/^@/, "");
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(handle)) {
    return null;
  }
  return profileHref(handle);
}

function funderTooltip(contribution: PublicContribution): string {
  const bits = [
    contribution.identity || "Anonymous funder",
    contribution.anonymous ? "anonymous credit" : "public credit",
    typeof contribution.amount_sats === "number"
      ? formatSats(contribution.amount_sats)
      : "amount hidden",
    contribution.rail ? `${contribution.rail} rail` : "",
  ].filter(Boolean);
  return bits.join(" · ");
}

function badgeHtml(contribution: PublicContribution): string {
  const badge = contributorBadge(contribution.amount_sats);
  if (!badge) return "";
  const label = contributorBadgeLabel(badge);
  return `<span class="funder-badge funder-badge-${badge}" title="${escapeHtml(
    `${label} Contributor`,
  )}">${escapeHtml(label)}</span>`;
}

/** Pure HTML for the public funder chips (exported for tests). */
export function fundersListHtml(contributions: PublicContribution[]): string {
  if (!contributions.length) return "";
  return `<div class="funder-chips">${contributions
    .map((contribution) => {
      const name = contribution.identity || "Anonymous";
      const tip = escapeHtml(funderTooltip(contribution));
      const label = escapeHtml(name);
      const badge = badgeHtml(contribution);
      const href = profileUrlForIdentity(contribution.identity);
      if (href) {
        return `<a class="funder-chip" href="${escapeHtml(href)}" title="${tip}">${label}${badge}</a>`;
      }
      return `<span class="funder-chip funder-chip-static" title="${tip}">${label}${badge}</span>`;
    })
    .join("")}</div>`;
}

function renderFunders(el: HTMLElement, contributions: PublicContribution[]): void {
  el.innerHTML = fundersListHtml(contributions);
}

function commentAuthorLabel(comment: ProposalComment): string {
  return (comment.username || comment.author || "anonymous").trim();
}

function avatarHandleFromComment(comment: ProposalComment): string | null {
  const raw = (comment.username || comment.author || "").trim();
  if (!raw) return null;
  const handle = raw.replace(/^github:/i, "").replace(/^@/, "").toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/.test(handle)) return null;
  return handle;
}

function commentAvatarHtml(comment: ProposalComment): string {
  if (comment.avatar_url) {
    return `<img class="user-avatar proposal-comment-avatar" src="${escapeHtml(comment.avatar_url)}" alt="" width="32" height="32" loading="lazy" decoding="async" />`;
  }
  const handle = avatarHandleFromComment(comment);
  if (handle) {
    return `<span class="user-avatar-slot proposal-comment-avatar" data-avatar-user="${escapeHtml(handle)}" hidden></span>`;
  }
  return `<span class="user-avatar-fallback proposal-comment-avatar" aria-hidden="true"></span>`;
}

function commentNameHtml(comment: ProposalComment): string {
  const label = escapeHtml(commentAuthorLabel(comment));
  const href =
    profileUrlForIdentity(comment.username || null) ||
    profileUrlForIdentity(comment.author);
  if (href) {
    return `<a class="proposal-comment-author" href="${escapeHtml(href)}">${label}</a>`;
  }
  return `<strong class="proposal-comment-author">${label}</strong>`;
}

/** Pure comment list HTML (exported for tests). */
export function commentsListHtml(
  comments: ProposalComment[],
  opts: { userId?: string | null; canModerate?: boolean } = {},
): string {
  if (!comments.length) {
    return `<div class="proposal-engagement-empty"><p>No comments yet.</p></div>`;
  }
  return `<div class="proposal-comment-list">${comments
    .map((comment) => {
      const when = timeAgoHtml(comment.created_at);
      const own = Boolean(
        opts.userId && comment.user_id && opts.userId === comment.user_id,
      );
      const actions: string[] = [];
      if (!comment.deleted && opts.userId && !own) {
        actions.push(
          `<button type="button" class="btn ghost comment-action" data-comment-report="${escapeHtml(comment.id)}">Report</button>`,
        );
      }
      if (!comment.deleted && (own || opts.canModerate)) {
        actions.push(
          `<button type="button" class="btn ghost comment-action" data-comment-delete="${escapeHtml(comment.id)}">Delete</button>`,
        );
      }
      if (!comment.deleted && opts.canModerate && !own) {
        actions.push(
          `<button type="button" class="btn ghost comment-action" data-comment-hide="${escapeHtml(comment.id)}">Hide</button>`,
        );
      }
      if (comment.deleted) {
        return `<article class="proposal-comment is-deleted" data-comment-id="${escapeHtml(comment.id)}"><p class="proposal-comment-removed">${commentNameHtml(comment)}<span class="proposal-comment-removed-mark"> · removed</span>${when ? `<span class="proposal-comment-when"> · ${when}</span>` : ""}</p></article>`;
      }
      return `<article class="proposal-comment" data-comment-id="${escapeHtml(comment.id)}">
        ${commentAvatarHtml(comment)}
        <div class="proposal-comment-body">
          <header>
            ${commentNameHtml(comment)}
            ${when ? `<span class="proposal-comment-when"> · ${when}</span>` : ""}
          </header>
          <p>${linkifyText(comment.body)}</p>
          ${
            actions.length
              ? `<div class="proposal-comment-actions">${actions.join("")}</div>`
              : ""
          }
        </div>
      </article>`;
    })
    .join("")}</div>`;
}

function renderComments(
  el: HTMLElement,
  comments: ProposalComment[],
  opts: { userId?: string | null; canModerate?: boolean },
): void {
  el.innerHTML = commentsListHtml(comments, opts);
}

export async function bindProposalEngagement(
  root: ParentNode,
  signedIn = false,
  onAuthed: () => void = () => undefined,
  opts: {
    user?: AuthUser | null;
    canModerate?: boolean;
    proposalId?: string | null;
    discussionClosed?: boolean;
  } = {},
): Promise<() => Promise<void>> {
  const noop = async () => undefined;
  if (!WORKERS_API) return noop;
  const funder = root.querySelector<HTMLElement>("#funder-credit");
  const comments = root.querySelector<HTMLElement>("#proposal-comments");
  const proposalId =
    opts.proposalId ||
    funder?.dataset.proposalId ||
    comments?.dataset.proposalId;
  if (!proposalId) return noop;
  let discussionClosed =
    Boolean(opts.discussionClosed) ||
    comments?.dataset.discussionClosed === "1";

  bindLoginHandlers(onAuthed);

  const funderList = root.querySelector<HTMLElement>("#funder-credit-list");
  const funderTitle = root.querySelector<HTMLElement>("#funder-credit-title");
  const commentList = root.querySelector<HTMLElement>("#proposal-comment-list");
  const userId = opts.user?.id || null;
  const canModerate = Boolean(opts.canModerate);
  const { hydrateAvatarSlots } = await import("./profile-avatars");

  const loadFunders = async () => {
    const res = await fetch(`${api()}/contributions/${encodeURIComponent(proposalId)}`);
    if (!res.ok) throw new Error("Could not load funder credit.");
    const data = (await res.json()) as { contributions?: PublicContribution[] };
    const list = data.contributions || [];
    if (list.length) {
      if (funder) funder.hidden = false;
      if (funderTitle) {
        funderTitle.hidden = false;
        funderTitle.textContent = "Funders";
      }
      if (funderList) renderFunders(funderList, list);
    } else if (funder) {
      funder.hidden = true;
      if (funderList) funderList.innerHTML = "";
    }
  };

  const tabs = root.querySelector<HTMLElement>("#proposal-engagement-tabs");
  const publicPane = root.querySelector<HTMLElement>("#proposal-public-pane");
  const workboardPane = root.querySelector<HTMLElement>("#proposal-workboard-pane");
  const workboardList = root.querySelector<HTMLElement>("#proposal-workboard-list");
  const tabStorageKey = `plebly-eng-tab:${proposalId}`;

  const showEngTab = (tab: "public" | "workboard") => {
    tabs?.querySelectorAll<HTMLButtonElement>("[data-eng-tab]").forEach((btn) => {
      const on = btn.dataset.engTab === tab;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    if (publicPane) publicPane.hidden = tab !== "public";
    if (workboardPane) workboardPane.hidden = tab !== "workboard";
    try {
      sessionStorage.setItem(tabStorageKey, tab);
    } catch {
      /* ignore */
    }
  };

  const loadComments = async () => {
    const res = await fetch(`${api()}/comments/${encodeURIComponent(proposalId)}`);
    if (!res.ok) throw new Error("Could not load comments.");
    const data = (await res.json()) as {
      comments?: ProposalComment[];
      discussion_url?: string;
    };
    if (commentList) {
      renderComments(commentList, data.comments || [], { userId, canModerate });
      void hydrateAvatarSlots(commentList);
    }
    const discussion = root.querySelector<HTMLElement>("#proposal-discussion-link");
    if (discussion && data.discussion_url) {
      discussion.innerHTML = `<a href="${escapeHtml(data.discussion_url)}" target="_blank" rel="noreferrer">Discuss on GitHub →</a>`;
      discussion.hidden = false;
    }
  };

  const loadWorkboard = async (): Promise<boolean> => {
    if (!signedIn || !opts.user) {
      if (tabs) tabs.hidden = true;
      showEngTab("public");
      return false;
    }
    const metaRes = await authFetch(
      `${api()}/workboard/${encodeURIComponent(proposalId)}/meta`,
    );
    if (!metaRes.ok) {
      if (tabs) tabs.hidden = true;
      showEngTab("public");
      return false;
    }
    const meta = (await metaRes.json()) as {
      enabled?: boolean;
      is_participant?: boolean;
      can_post?: boolean;
      discussion_closed?: boolean;
    };
    if (meta.discussion_closed) discussionClosed = true;
    if (!meta.enabled || !meta.is_participant) {
      if (tabs) tabs.hidden = true;
      showEngTab("public");
      return false;
    }
    if (tabs) tabs.hidden = false;
    if (discussionClosed || meta.can_post === false) {
      const wbInput = root.querySelector<HTMLElement>("#proposal-workboard-input");
      const wbSubmit = root.querySelector<HTMLButtonElement>(
        "#proposal-workboard-submit",
      );
      if (wbInput) wbInput.hidden = true;
      if (wbSubmit?.parentElement) wbSubmit.parentElement.hidden = true;
      if (
        workboardPane &&
        !workboardPane.querySelector(".engagement-closed-notice")
      ) {
        workboardPane.insertAdjacentHTML(
          "beforeend",
          `<p class="muted engagement-closed-notice">Discussion closed — this project is finished. History stays readable.</p>`,
        );
      }
    }
    const listRes = await authFetch(
      `${api()}/workboard/${encodeURIComponent(proposalId)}`,
    );
    if (!listRes.ok) {
      // Stale / disabled mid-flight — hide tabs silently.
      if (tabs) tabs.hidden = true;
      showEngTab("public");
      return false;
    }
    const data = (await listRes.json()) as { messages?: ProposalComment[] };
    if (workboardList) {
      workboardList.innerHTML = workboardListHtml(data.messages || []);
      void hydrateAvatarSlots(workboardList);
    }
    let preferred: "public" | "workboard" = "public";
    try {
      const stored = sessionStorage.getItem(tabStorageKey);
      if (stored === "workboard" || stored === "public") preferred = stored;
    } catch {
      /* ignore */
    }
    showEngTab(preferred);
    return true;
  };

  const reload = async () => {
    await loadFunders().catch(() => {
      if (funder) funder.hidden = true;
      if (funderList) {
        funderList.innerHTML = `<p class="muted">Could not load funder credit.</p>`;
      }
    });
  };

  await Promise.all([
    reload(),
    loadComments().catch(() => {
      if (commentList) {
        commentList.innerHTML = `<p class="muted">Could not load comments. The API may still be deploying.</p>`;
      }
    }),
    loadWorkboard().catch(() => {
      if (tabs) tabs.hidden = true;
      showEngTab("public");
    }),
  ]);

  tabs?.querySelectorAll<HTMLButtonElement>("[data-eng-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.engTab === "workboard" ? "workboard" : "public";
      showEngTab(tab);
    });
  });

  const onWorkboardSettings = (ev: Event) => {
    if (!root.querySelector("#proposal-engagement-tabs")) {
      window.removeEventListener(
        "plebly:workboard-settings",
        onWorkboardSettings,
      );
      return;
    }
    const detail = (ev as CustomEvent<{ proposalId?: string }>).detail;
    if (detail?.proposalId && detail.proposalId !== proposalId) return;
    void loadWorkboard().catch(() => {
      if (tabs) tabs.hidden = true;
      showEngTab("public");
    });
  };
  window.addEventListener("plebly:workboard-settings", onWorkboardSettings);

  const commentMsg = root.querySelector<HTMLElement>("#proposal-comment-msg");
  const workboardMsg = root.querySelector<HTMLElement>("#proposal-workboard-msg");
  const setMsg = (el: HTMLElement | null, text: string) => {
    if (!el) return;
    el.hidden = !text;
    el.textContent = text;
  };

  const submit = root.querySelector<HTMLButtonElement>("#proposal-comment-submit");
  const input = root.querySelector<HTMLTextAreaElement>("#proposal-comment-input");
  submit?.addEventListener("click", async () => {
    if (discussionClosed) {
      setMsg(commentMsg, "Discussion closed — this project is finished.");
      return;
    }
    const body = input?.value.trim() || "";
    if (!body) return;
    submit.disabled = true;
    try {
      const res = await authFetch(`${api()}/comments/${encodeURIComponent(proposalId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Could not post comment.");
      if (input) input.value = "";
      setMsg(commentMsg, "Comment posted.");
      await loadComments();
    } catch (error) {
      setMsg(commentMsg, (error as Error).message);
    } finally {
      submit.disabled = false;
    }
  });

  const wbSubmit = root.querySelector<HTMLButtonElement>(
    "#proposal-workboard-submit",
  );
  const wbInput = root.querySelector<HTMLTextAreaElement>(
    "#proposal-workboard-input",
  );
  wbSubmit?.addEventListener("click", async () => {
    if (discussionClosed) {
      setMsg(workboardMsg, "Discussion closed — this project is finished.");
      return;
    }
    const body = wbInput?.value.trim() || "";
    if (!body) return;
    wbSubmit.disabled = true;
    try {
      const res = await authFetch(
        `${api()}/workboard/${encodeURIComponent(proposalId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body }),
        },
      );
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        if (res.status === 403 || res.status === 404) {
          if (tabs) tabs.hidden = true;
          showEngTab("public");
        }
        throw new Error(data.error || "Could not post to workboard.");
      }
      if (wbInput) wbInput.value = "";
      setMsg(workboardMsg, "Posted to workboard.");
      await loadWorkboard();
      showEngTab("workboard");
    } catch (error) {
      setMsg(workboardMsg, (error as Error).message);
    } finally {
      wbSubmit.disabled = false;
    }
  });

  commentList?.addEventListener("click", async (ev) => {
    const t = ev.target as Element | null;
    const reportId = t
      ?.closest<HTMLElement>("[data-comment-report]")
      ?.getAttribute("data-comment-report");
    const deleteId = t
      ?.closest<HTMLElement>("[data-comment-delete]")
      ?.getAttribute("data-comment-delete");
    const hideId = t
      ?.closest<HTMLElement>("[data-comment-hide]")
      ?.getAttribute("data-comment-hide");

    if (reportId) {
      const reason = window.prompt(
        "Why are you reporting this comment? (min 8 characters)",
        "spam or harassment",
      );
      if (!reason || reason.trim().length < 8) return;
      try {
        const result = await fileModerationReport({
          target_type: "comment",
          proposal_id: proposalId,
          comment_id: reportId,
          reason: reason.trim(),
        });
        setMsg(
          commentMsg,
          result.comment_hidden
            ? "Report received — comment was auto-hidden."
            : "Report filed for reviewers. Thanks.",
        );
        await loadComments();
      } catch (error) {
        setMsg(commentMsg, (error as Error).message);
      }
      return;
    }

    if (deleteId) {
      const ok = await confirmAction({
        title: "Delete comment",
        body: "Remove this comment from the discussion? This cannot be undone.",
        confirmLabel: "Delete",
        danger: true,
      });
      if (!ok) return;
      try {
        const res = await authFetch(
          `${api()}/comments/${encodeURIComponent(proposalId)}/${encodeURIComponent(deleteId)}`,
          { method: "DELETE" },
        );
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error(data.error || "Could not delete comment.");
        setMsg(commentMsg, "Comment deleted.");
        await loadComments();
      } catch (error) {
        setMsg(commentMsg, (error as Error).message);
      }
      return;
    }

    if (hideId) {
      const ok = await confirmAction({
        title: "Hide comment",
        body: "Hide this comment for everyone? Reviewers use this for clear abuse.",
        confirmLabel: "Hide",
        danger: true,
      });
      if (!ok) return;
      try {
        const res = await authFetch(
          `${api()}/comments/${encodeURIComponent(proposalId)}/${encodeURIComponent(hideId)}/hide`,
          { method: "POST" },
        );
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error(data.error || "Could not hide comment.");
        setMsg(commentMsg, "Comment hidden.");
        await loadComments();
      } catch (error) {
        setMsg(commentMsg, (error as Error).message);
      }
    }
  });

  return reload;
}
