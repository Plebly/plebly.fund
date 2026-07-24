import { githubLoginUrl, submitProposal } from "./auth";
import { fetchClaimParams } from "./builder";
import { BITCOIN_NETWORK, SUBMISSION_FEE_SATS } from "./config";
import { btnWithBrandIcon } from "./icons";
import {
  clientCoverPrecheck,
  uploadProjectCover,
} from "./media";
import type { ShellContext } from "./profile-pages";
import { href } from "./router";
import { escapeHtml, formatSats } from "./util";

const PROPOSE_PATH = "/propose";

export async function renderPropose(ctx: ShellContext): Promise<void> {
  const app = document.querySelector<HTMLDivElement>("#app")!;
  if (!ctx.user) {
    app.innerHTML = ctx.shell(`
      <section class="wrap detail propose-page">
        <h1>Start a project</h1>
        <p class="lede">Sign in with GitHub to open a proposal pull request.</p>
        <a class="btn" href="${escapeHtml(githubLoginUrl(PROPOSE_PATH))}">${btnWithBrandIcon("github", "Log in with GitHub")}</a>
        <p class="hint form-alt-link"><a href="https://github.com/Plebly/proposals/blob/main/template/proposal.md" target="_blank" rel="noreferrer">Or open a PR manually</a></p>
      </section>
    `);
    return;
  }

  const feeLabel = formatSats(SUBMISSION_FEE_SATS);
  const networkLabel = BITCOIN_NETWORK === "signet" ? "signet" : "mainnet";
  let feeAddress: string | null = null;
  try {
    const params = await fetchClaimParams();
    feeAddress = params.fee_address;
  } catch {
    /* address optional until API configured */
  }

  const feeAddressHtml = feeAddress
    ? `<div class="fee-pay-block">
        <code class="donate-address mono" id="propose-fee-address" title="${escapeHtml(feeAddress)}">${escapeHtml(feeAddress)}</code>
        <div class="donate-actions donate-ln-create-row">
          <button type="button" class="btn" id="propose-fee-copy" data-copy="${escapeHtml(feeAddress)}">Copy address</button>
        </div>
        <span class="field-hint">Send exactly ${escapeHtml(feeLabel)} on ${escapeHtml(networkLabel)}, then paste the txid below.</span>
      </div>`
    : `<span class="field-hint">Pay exactly ${escapeHtml(feeLabel)} on ${escapeHtml(networkLabel)} to the published submission-fee address, then paste the txid below.</span>`;

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
          <div class="field cover-field">
            <span>Cover image <em class="optional">(optional)</em></span>
            <input type="file" id="propose-cover-input" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" />
            <div class="cover-preview" id="propose-cover-preview" hidden>
              <img id="propose-cover-img" alt="Cover preview" />
              <button type="button" class="btn ghost cover-clear" id="propose-cover-clear">Remove</button>
            </div>
            <span class="field-hint" id="propose-cover-hint">JPEG, PNG, or WebP · max 2 MiB</span>
          </div>
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
          <div class="field">
            <span>Submission fee</span>
            ${feeAddressHtml}
          </div>
          <label class="field">
            <span>Submission fee txid</span>
            <input name="submission_fee_txid" required pattern="[0-9a-fA-F]{64}" placeholder="64-character transaction id" class="mono" />
          </label>
        </fieldset>

        <div class="form-actions">
          <button type="submit" class="btn">Open proposal PR</button>
        </div>
        <p class="form-msg" id="propose-msg" hidden></p>
      </form>
    </section>
  `);

  const copyBtn = document.getElementById("propose-fee-copy");
  copyBtn?.addEventListener("click", async () => {
    const text = copyBtn.getAttribute("data-copy") || "";
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      copyBtn.textContent = "Copied";
      setTimeout(() => {
        copyBtn.textContent = "Copy address";
      }, 1500);
    } catch {
      /* ignore */
    }
  });

  const form = document.getElementById("propose-form") as HTMLFormElement;
  const msg = document.getElementById("propose-msg")!;
  const coverInput = document.getElementById(
    "propose-cover-input",
  ) as HTMLInputElement;
  const coverPreview = document.getElementById("propose-cover-preview")!;
  const coverImg = document.getElementById(
    "propose-cover-img",
  ) as HTMLImageElement;
  const coverHint = document.getElementById("propose-cover-hint")!;
  const coverClear = document.getElementById("propose-cover-clear");
  let coverUrl: string | null = null;
  let coverObjectUrl: string | null = null;

  const clearCover = () => {
    coverUrl = null;
    if (coverObjectUrl) {
      URL.revokeObjectURL(coverObjectUrl);
      coverObjectUrl = null;
    }
    coverImg.removeAttribute("src");
    coverPreview.hidden = true;
    coverInput.value = "";
    coverHint.textContent = "JPEG, PNG, or WebP · max 2 MiB";
    coverHint.classList.remove("error");
  };

  coverClear?.addEventListener("click", clearCover);

  coverInput.addEventListener("change", async () => {
    const file = coverInput.files?.[0];
    if (!file) {
      clearCover();
      return;
    }
    const pre = clientCoverPrecheck(file);
    if (pre) {
      clearCover();
      coverHint.textContent = pre;
      coverHint.classList.add("error");
      return;
    }

    if (coverObjectUrl) URL.revokeObjectURL(coverObjectUrl);
    coverObjectUrl = URL.createObjectURL(file);
    coverImg.src = coverObjectUrl;
    coverPreview.hidden = false;
    coverUrl = null;
    coverHint.classList.remove("error");
    coverHint.textContent = "Uploading…";

    try {
      const uploaded = await uploadProjectCover(file);
      coverUrl = uploaded.url;
      coverHint.textContent = "Cover ready";
    } catch (err) {
      const e = err as Error & { code?: string };
      if (e.code === "MEDIA_DISABLED") {
        clearCover();
        coverHint.textContent =
          "Cover uploads are not enabled yet — you can still submit without an image.";
        coverHint.classList.remove("error");
        return;
      }
      clearCover();
      coverHint.textContent = e.message;
      coverHint.classList.add("error");
    }
  });

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
        cover_image: coverUrl,
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
