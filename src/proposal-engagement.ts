import {
  authFetch,
  bindLoginHandlers,
  currentReturnPath,
  loginChoicesHtml,
} from "./auth";
import { WORKERS_API } from "./config";
import {
  bindCreditPreferenceGates,
  claimContribution,
  creditPreferenceFieldsHtml,
  readCreditPreferences,
  updateCreditPreferences,
} from "./funder-credit";
import { profileHref } from "./router";
import { escapeHtml, formatSats, linkifyText } from "./util";

type PublicContribution = {
  identity: string | null;
  anonymous: boolean;
  amount_sats?: number;
  rail?: string;
};

type MineContribution = {
  txid?: string;
  vout?: number;
  swap_id?: string;
  amount_sats: number;
  confirmed: boolean;
  public_credit: boolean;
  anonymous: boolean;
  show_amount: boolean;
};

type ProposalComment = {
  id: string;
  author: string;
  body: string;
  created_at: string;
};

const api = () => WORKERS_API.replace(/\/$/, "");

function creditPrefsHtml(): string {
  return `<div class="funder-credit-prefs" id="funder-credit-prefs">
    <h3 class="funder-credit-prefs-title">Your funder credit</h3>
    <p class="muted funder-credit-prefs-lede">Credit is linked from the Donate flow. Change display prefs here anytime.</p>
    <div id="funder-credit-mine" class="funder-credit-mine" aria-live="polite">
      <p class="muted">Loading your contributions…</p>
    </div>
    <form id="funder-credit-form" class="funder-credit-form">
      ${creditPreferenceFieldsHtml({ idPrefix: "credit" })}
      <button type="submit" class="btn" id="credit-save">Update display</button>
      <details class="funder-credit-advanced">
        <summary>Link an older donation</summary>
        <p class="muted funder-credit-advanced-lede">If Donate didn’t catch it, enter the on-chain outpoint after it confirms.</p>
        <div class="funder-credit-outpoint">
          <div class="funder-credit-field funder-credit-field-txid">
            <label class="donate-amount-label" for="credit-txid">Funding txid</label>
            <input id="credit-txid" class="donate-amount mono" type="text" maxlength="64" autocomplete="off" spellcheck="false" placeholder="64-char hex" />
          </div>
          <div class="funder-credit-field funder-credit-field-vout">
            <label class="donate-amount-label" for="credit-vout">Vout</label>
            <input id="credit-vout" class="donate-amount mono" type="number" min="0" value="0" />
          </div>
        </div>
      </details>
      <p class="builder-msg" id="credit-msg" hidden></p>
    </form>
  </div>`;
}

export function funderCreditHtml(
  proposalId: string | null,
  signedIn: boolean,
): string {
  if (!proposalId) return "";
  // Hidden until we know there are public funders (or a signed-in donor needs prefs).
  return `<section class="proposal-engagement" id="funder-credit" data-proposal-id="${escapeHtml(proposalId)}" hidden>
    <h2 class="proposal-block-title" id="funder-credit-title">Funders</h2>
    <div id="funder-credit-list" class="funder-credit-list" aria-live="polite"></div>
    ${signedIn ? creditPrefsHtml() : ""}
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

/** Pure HTML for the signed-in donor's linked rows (exported for tests). */
export function mineContributionsHtml(mine: MineContribution[]): string {
  if (!mine.length) {
    return `<p class="muted">No linked donations yet. Open Donate to pay and claim credit there.</p>`;
  }
  return `<ul class="proposal-engagement-list funder-credit-mine-list">${mine
    .map((entry) => {
      const ref = entry.swap_id
        ? `ln:${entry.swap_id.slice(0, 12)}…`
        : `${(entry.txid || "").slice(0, 12)}…:${entry.vout ?? 0}`;
      const prefs = [
        entry.anonymous || !entry.public_credit ? "anonymous" : "public",
        entry.show_amount ? "amount shown" : "amount hidden",
      ].join(" · ");
      return `<li><span class="mono">${escapeHtml(ref)}</span><span class="muted">${escapeHtml(formatSats(entry.amount_sats))} · ${escapeHtml(prefs)}</span></li>`;
    })
    .join("")}</ul>`;
}

function renderMine(el: HTMLElement, mine: MineContribution[]): void {
  el.innerHTML = mineContributionsHtml(mine);
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

  // Bind here too: engagement HTML is often injected after the global auth pass.
  bindLoginHandlers(onAuthed);
  bindCreditPreferenceGates(root, "credit");

  const funderList = root.querySelector<HTMLElement>("#funder-credit-list");
  const funderTitle = root.querySelector<HTMLElement>("#funder-credit-title");
  const commentList = root.querySelector<HTMLElement>("#proposal-comment-list");
  const mineEl = root.querySelector<HTMLElement>("#funder-credit-mine");
  const prefsEl = root.querySelector<HTMLElement>("#funder-credit-prefs");

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
    } else if (signedIn) {
      // Prefs only — no empty Funders card for guests.
      if (funder) funder.hidden = false;
      if (funderTitle) {
        funderTitle.hidden = false;
        funderTitle.textContent = "Your funder credit";
      }
      if (funderList) funderList.innerHTML = "";
    } else if (funder) {
      funder.hidden = true;
    }
  };

  const loadMine = async (): Promise<MineContribution[]> => {
    if (!signedIn || !mineEl) return [];
    const res = await authFetch(
      `${api()}/contributions/mine/${encodeURIComponent(proposalId)}`,
    );
    if (!res.ok) throw new Error("Could not load your contributions.");
    const data = (await res.json()) as { contributions?: MineContribution[] };
    const mine = data.contributions || [];
    renderMine(mineEl, mine);
    if (prefsEl) prefsEl.hidden = false;
    const first = mine[0];
    const publicBox = root.querySelector<HTMLInputElement>("#credit-public");
    const amountBox = root.querySelector<HTMLInputElement>("#credit-amount");
    if (first) {
      if (publicBox) publicBox.checked = first.public_credit && !first.anonymous;
      if (amountBox) amountBox.checked = first.show_amount;
    }
    return mine;
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
    await Promise.all([
      loadFunders().catch(() => {
        if (funder) funder.hidden = !signedIn;
        if (funderList && signedIn) {
          funderList.innerHTML = `<p class="muted">Could not load funder credit.</p>`;
        }
      }),
      loadMine().catch(() => {
        if (mineEl) mineEl.innerHTML = `<p class="muted">Could not load your contributions.</p>`;
      }),
    ]);
  };

  await Promise.all([
    reload(),
    loadComments().catch(() => {
      if (commentList) {
        commentList.innerHTML = `<p class="muted">Could not load comments. The API may still be deploying.</p>`;
      }
    }),
  ]);

  const form = root.querySelector<HTMLFormElement>("#funder-credit-form");
  const msg = root.querySelector<HTMLElement>("#credit-msg");
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const txid = root.querySelector<HTMLInputElement>("#credit-txid")?.value.trim() || "";
    const voutRaw = root.querySelector<HTMLInputElement>("#credit-vout")?.value || "0";
    const vout = Number(voutRaw);
    const prefs = {
      proposal_id: proposalId,
      ...readCreditPreferences(root, "credit"),
    };
    const saveBtn = root.querySelector<HTMLButtonElement>("#credit-save");
    if (saveBtn) saveBtn.disabled = true;
    try {
      const mine = await loadMine().catch(() => [] as MineContribution[]);
      if (txid) {
        await claimContribution({
          ...prefs,
          txid,
          vout: Number.isFinite(vout) ? vout : 0,
        });
      } else if (mine.length) {
        const first = mine[0]!;
        await updateCreditPreferences({
          ...prefs,
          ...(first.txid != null && first.vout != null
            ? { txid: first.txid, vout: first.vout }
            : {}),
          ...(first.swap_id ? { swap_id: first.swap_id } : {}),
        });
      } else {
        throw new Error("Open Donate to claim credit, or expand Link an older donation.");
      }
      if (msg) {
        msg.hidden = false;
        msg.textContent = "Credit preference saved.";
      }
      await reload();
    } catch (error) {
      if (msg) {
        msg.hidden = false;
        msg.textContent = (error as Error).message;
      }
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  });

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
