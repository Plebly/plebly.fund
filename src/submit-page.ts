import { githubLoginUrl, submitProposal } from "./auth";
import type { ShellContext } from "./profile-pages";
import { escapeHtml } from "./util";

export async function renderSubmit(ctx: ShellContext): Promise<void> {
  const app = document.querySelector<HTMLDivElement>("#app")!;
  if (!ctx.user) {
    app.innerHTML = ctx.shell(`
      <section class="wrap detail">
        <h1>Submit</h1>
        <p class="lede">Sign in to open a proposal pull request.</p>
        <a class="btn" href="${escapeHtml(githubLoginUrl("#/submit"))}">Log in</a>
        <p class="hint" style="margin-top:1rem"><a href="https://github.com/Plebly/proposals/blob/main/template/proposal.md" target="_blank" rel="noreferrer">Or open a PR manually</a></p>
      </section>
    `);
    return;
  }

  app.innerHTML = ctx.shell(`
    <section class="wrap detail">
      <h1>Submit</h1>
      <p class="lede">Opens a PR on <a href="https://github.com/Plebly/proposals" target="_blank" rel="noreferrer">Plebly/proposals</a>. Include your submission-fee txid after paying on-chain.</p>
      <form id="submit-form" class="form-panel">
        <label class="field">
          <span>Title</span>
          <input name="title" required minlength="3" maxlength="200" />
        </label>
        <label class="field">
          <span>Deliverable</span>
          <textarea name="deliverable" required minlength="20" rows="5"></textarea>
        </label>
        <label class="field">
          <span>Verification</span>
          <textarea name="verification" required minlength="20" rows="4"></textarea>
        </label>
        <label class="field">
          <span>Out of scope</span>
          <textarea name="out_of_scope" required minlength="3" rows="3"></textarea>
        </label>
        <label class="field">
          <span>Submission fee txid (64 hex)</span>
          <input name="submission_fee_txid" required pattern="[0-9a-fA-F]{64}" placeholder="0000000000000000000000000000000000000000000000000000000000000000" class="mono" />
        </label>
        <label class="field">
          <span>Target sats (optional)</span>
          <input name="target_sats" type="number" min="0" step="1" />
        </label>
        <div class="form-actions">
          <button type="submit" class="btn">Submit</button>
        </div>
        <p class="form-msg" id="submit-msg" hidden></p>
      </form>
    </section>
  `);

  const form = document.getElementById("submit-form") as HTMLFormElement;
  const msg = document.getElementById("submit-msg")!;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    msg.hidden = false;
    msg.className = "form-msg";
    msg.textContent = "Submitting…";
    const fd = new FormData(form);
    const targetRaw = fd.get("target_sats");
    try {
      const result = await submitProposal({
        title: String(fd.get("title") || ""),
        deliverable: String(fd.get("deliverable") || ""),
        verification: String(fd.get("verification") || ""),
        out_of_scope: String(fd.get("out_of_scope") || ""),
        submission_fee_txid: String(fd.get("submission_fee_txid") || ""),
        target_sats:
          targetRaw && String(targetRaw).length ? Number(targetRaw) : null,
      });
      msg.className = "form-msg success";
      msg.innerHTML = result.pr_url
        ? `PR opened: <a href="${escapeHtml(result.pr_url)}" target="_blank" rel="noreferrer">${escapeHtml(result.pr_url)}</a>`
        : "Proposal submitted.";
    } catch (err) {
      msg.className = "form-msg error";
      msg.textContent = (err as Error).message;
    }
  });
}
