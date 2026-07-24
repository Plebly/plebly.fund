import { githubLoginUrl, submitProposal } from "./auth";
import { BITCOIN_NETWORK, SUBMISSION_FEE_SATS } from "./config";
import type { ShellContext } from "./profile-pages";
import { escapeHtml, formatSats } from "./util";

const PROPOSE_PATH = "#/propose";

export async function renderPropose(ctx: ShellContext): Promise<void> {
  const app = document.querySelector<HTMLDivElement>("#app")!;
  if (!ctx.user) {
    app.innerHTML = ctx.shell(`
      <section class="wrap detail propose-page">
        <h1>Start a project</h1>
        <p class="lede">Sign in to open a proposal pull request.</p>
        <a class="btn" href="${escapeHtml(githubLoginUrl(PROPOSE_PATH))}">Log in</a>
        <p class="hint" style="margin-top:1rem"><a href="https://github.com/Plebly/proposals/blob/main/template/proposal.md" target="_blank" rel="noreferrer">Or open a PR manually</a></p>
      </section>
    `);
    return;
  }

  const feeLabel = formatSats(SUBMISSION_FEE_SATS);
  const networkLabel = BITCOIN_NETWORK === "signet" ? "signet" : "mainnet";

  app.innerHTML = ctx.shell(`
    <section class="wrap detail propose-page">
      <h1>Start a project</h1>
      <p class="lede">Describe the work and pay the ${escapeHtml(feeLabel)} submission fee on ${escapeHtml(networkLabel)}.</p>

      <form id="propose-form" class="form-panel form-panel-wide">
        <fieldset class="form-block">
          <legend>Proposal</legend>
          <label class="field">
            <span>Title</span>
            <input name="title" required minlength="3" maxlength="200" placeholder="Short, specific name for the project" />
          </label>
          <label class="field">
            <span>Problem &amp; audience</span>
            <textarea name="problem" required minlength="40" rows="4" placeholder="What problem are you solving? Who benefits? Why is this good for Bitcoin?"></textarea>
          </label>
          <label class="field">
            <span>Plan &amp; deliverables</span>
            <textarea name="deliverable" required minlength="40" rows="5" placeholder="Concrete artifacts you will produce: code, docs, research, designs. Include license intent (FOSS)."></textarea>
          </label>
          <label class="field">
            <span>Verification</span>
            <textarea name="verification" required minlength="40" rows="4" placeholder="Steps a reviewer can follow to confirm completion — commands, URLs, acceptance criteria."></textarea>
            <span class="field-hint">Two independent reviewers should reach the same yes/no conclusion.</span>
          </label>
          <label class="field">
            <span>Out of scope</span>
            <textarea name="out_of_scope" required minlength="10" rows="3" placeholder="What this project explicitly does not include."></textarea>
          </label>
        </fieldset>

        <fieldset class="form-block">
          <legend>Funding</legend>
          <label class="field">
            <span>Target funding (optional)</span>
            <input name="target_sats" type="number" min="0" step="1" placeholder="e.g. 5000000" />
          </label>
          <label class="field">
            <span>Submission fee txid</span>
            <input name="submission_fee_txid" required pattern="[0-9a-fA-F]{64}" placeholder="64-character transaction id" class="mono" />
            <span class="field-hint">Pay ${escapeHtml(feeLabel)} (exact) on ${escapeHtml(networkLabel)} first, then paste the txid here.</span>
          </label>
        </fieldset>

        <div class="form-actions">
          <button type="submit" class="btn">Open proposal PR</button>
        </div>
        <p class="form-msg" id="propose-msg" hidden></p>
      </form>
    </section>
  `);

  const form = document.getElementById("propose-form") as HTMLFormElement;
  const msg = document.getElementById("propose-msg")!;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    msg.hidden = false;
    msg.className = "form-msg";
    msg.textContent = "Opening pull request…";
    const fd = new FormData(form);
    const targetRaw = fd.get("target_sats");
    try {
      const result = await submitProposal({
        title: String(fd.get("title") || ""),
        problem: String(fd.get("problem") || ""),
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
