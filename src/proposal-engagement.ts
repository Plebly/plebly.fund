import {
  authFetch,
  bindLoginHandlers,
  currentReturnPath,
  loginChoicesHtml,
  type AuthUser,
} from "./auth";
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

export function commentsHtml(proposalId: string | null, signedIn: boolean): string {
  if (!proposalId) return "";
  return `<section class="proposal-engagement" id="proposal-comments" data-proposal-id="${escapeHtml(proposalId)}">
    <h2 class="proposal-block-title">Comments</h2>
    <p id="proposal-discussion-link" class="proposal-discussion-link" hidden></p>
    <div id="proposal-comment-list"><p class="muted">Loading comments…</p></div>
    ${
      signedIn
        ? `<label class="comment-input-label" for="proposal-comment-input">Add a comment</label>
           <textarea id="proposal-comment-input" class="comment-input" rows="3" maxlength="2000" placeholder="Keep discussion constructive…"></textarea>
           <div class="comment-compose-actions">
             <button type="button" class="btn" id="proposal-comment-submit">Post comment</button>
             <p class="muted comment-compose-hint">Rate-limited · report abuse from any comment</p>
           </div>`
        : `<div class="proposal-engagement-empty">
             <p>Sign in to comment and join the discussion.</p>
             ${loginChoicesHtml(undefined, currentReturnPath())}
             <p class="builder-msg" id="comment-login-msg" hidden></p>
           </div>`
    }
    <p class="builder-msg" id="proposal-comment-msg" hidden></p>
  </section>`;
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

/** Pure HTML for the public funder chips (exported for tests). */
export function fundersListHtml(contributions: PublicContribution[]): string {
  if (!contributions.length) return "";
  return `<div class="funder-chips">${contributions
    .map((contribution) => {
      const name = contribution.identity || "Anonymous";
      const tip = escapeHtml(funderTooltip(contribution));
      const label = escapeHtml(name);
      const href = profileUrlForIdentity(contribution.identity);
      if (href) {
        return `<a class="funder-chip" href="${escapeHtml(href)}" title="${tip}">${label}</a>`;
      }
      return `<span class="funder-chip funder-chip-static" title="${tip}">${label}</span>`;
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
    return `<div class="proposal-engagement-empty"><p>No comments yet.</p><p class="muted">Start a constructive discussion about the work or its verification.</p></div>`;
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
      const body = comment.deleted
        ? `<p class="muted proposal-comment-deleted">Comment removed.</p>`
        : `<p>${linkifyText(comment.body)}</p>`;
      return `<article class="proposal-comment${comment.deleted ? " is-deleted" : ""}" data-comment-id="${escapeHtml(comment.id)}">
        ${commentAvatarHtml(comment)}
        <div class="proposal-comment-body">
          <header>
            ${commentNameHtml(comment)}
            ${when ? `<span class="proposal-comment-when"> · ${when}</span>` : ""}
          </header>
          ${body}
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
  ]);

  const commentMsg = root.querySelector<HTMLElement>("#proposal-comment-msg");
  const setMsg = (text: string) => {
    if (!commentMsg) return;
    commentMsg.hidden = !text;
    commentMsg.textContent = text;
  };

  const submit = root.querySelector<HTMLButtonElement>("#proposal-comment-submit");
  const input = root.querySelector<HTMLTextAreaElement>("#proposal-comment-input");
  submit?.addEventListener("click", async () => {
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
      setMsg("Comment posted.");
      await loadComments();
    } catch (error) {
      setMsg((error as Error).message);
    } finally {
      submit.disabled = false;
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
          result.comment_hidden
            ? "Report received — comment was auto-hidden."
            : "Report filed for reviewers. Thanks.",
        );
        await loadComments();
      } catch (error) {
        setMsg((error as Error).message);
      }
      return;
    }

    if (deleteId) {
      if (!window.confirm("Delete this comment?")) return;
      try {
        const res = await authFetch(
          `${api()}/comments/${encodeURIComponent(proposalId)}/${encodeURIComponent(deleteId)}`,
          { method: "DELETE" },
        );
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error(data.error || "Could not delete comment.");
        setMsg("Comment deleted.");
        await loadComments();
      } catch (error) {
        setMsg((error as Error).message);
      }
      return;
    }

    if (hideId) {
      if (!window.confirm("Hide this comment for everyone?")) return;
      try {
        const res = await authFetch(
          `${api()}/comments/${encodeURIComponent(proposalId)}/${encodeURIComponent(hideId)}/hide`,
          { method: "POST" },
        );
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error(data.error || "Could not hide comment.");
        setMsg("Comment hidden.");
        await loadComments();
      } catch (error) {
        setMsg((error as Error).message);
      }
    }
  });

  return reload;
}
