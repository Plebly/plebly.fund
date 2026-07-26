import {
  authFetch,
  bindLoginHandlers,
  currentReturnPath,
  loginChoicesHtml,
} from "./auth";
import { WORKERS_API } from "./config";
import { profileHref } from "./router";
import { escapeHtml, formatSats, linkifyText } from "./util";

type PublicContribution = {
  identity: string | null;
  anonymous: boolean;
  amount_sats?: number;
  rail?: string;
};

type ProposalComment = {
  id: string;
  author: string;
  body: string;
  created_at: string;
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
           <button type="button" class="btn" id="proposal-comment-submit">Post comment</button>`
        : `<div class="proposal-engagement-empty">
             <p>Sign in to comment and join the discussion.</p>
             ${loginChoicesHtml(undefined, currentReturnPath())}
             <p class="builder-msg" id="comment-login-msg" hidden></p>
           </div>`
    }
    <p class="builder-msg" id="proposal-comment-msg" hidden></p>
  </section>`;
}

function profileUrlForIdentity(identity: string | null): string | null {
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

function renderComments(el: HTMLElement, comments: ProposalComment[]): void {
  if (!comments.length) {
    el.innerHTML = `<div class="proposal-engagement-empty"><p>No comments yet.</p><p class="muted">Start a constructive discussion about the work or its verification.</p></div>`;
    return;
  }
  el.innerHTML = comments
    .map((comment) => {
      const date = new Date(comment.created_at);
      const when = Number.isNaN(date.getTime()) ? "" : ` · ${date.toLocaleDateString()}`;
      return `<article class="proposal-comment">
        <header><strong>${escapeHtml(comment.author)}</strong>${escapeHtml(when)}</header>
        <p>${linkifyText(comment.body)}</p>
      </article>`;
    })
    .join("");
}

export async function bindProposalEngagement(
  root: ParentNode,
  signedIn = false,
  onAuthed: () => void = () => undefined,
): Promise<() => Promise<void>> {
  const noop = async () => undefined;
  if (!WORKERS_API) return noop;
  const funder = root.querySelector<HTMLElement>("#funder-credit");
  const comments = root.querySelector<HTMLElement>("#proposal-comments");
  const proposalId = funder?.dataset.proposalId || comments?.dataset.proposalId;
  if (!proposalId) return noop;

  bindLoginHandlers(onAuthed);

  const funderList = root.querySelector<HTMLElement>("#funder-credit-list");
  const funderTitle = root.querySelector<HTMLElement>("#funder-credit-title");
  const commentList = root.querySelector<HTMLElement>("#proposal-comment-list");

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
    if (commentList) renderComments(commentList, data.comments || []);
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

  const submit = root.querySelector<HTMLButtonElement>("#proposal-comment-submit");
  const input = root.querySelector<HTMLTextAreaElement>("#proposal-comment-input");
  const commentMsg = root.querySelector<HTMLElement>("#proposal-comment-msg");
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
      if (commentMsg) {
        commentMsg.hidden = false;
        commentMsg.textContent = "Comment posted.";
      }
      await loadComments();
    } catch (error) {
      if (commentMsg) {
        commentMsg.hidden = false;
        commentMsg.textContent = (error as Error).message;
      }
    } finally {
      submit.disabled = false;
    }
  });

  return reload;
}
