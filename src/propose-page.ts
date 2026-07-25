import { githubLoginUrl, submitProposal } from "./auth";
import { fetchClaimParams } from "./builder";
import { BITCOIN_NETWORK, SUBMISSION_FEE_SATS } from "./config";
import { bindFeePay, feePayHtml } from "./fee-pay";
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
            <input type="file" id="propose-cover-input" class="cover-file-input" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" hidden />
            <div class="cover-picker" id="propose-cover-picker">
              <button type="button" class="cover-pick-btn" id="propose-cover-pick">
                <span class="cover-pick-label">Choose cover</span>
                <span class="cover-pick-meta">JPEG, PNG, or WebP · max 2 MiB · 16:9 works best</span>
              </button>
            </div>
            <div class="cover-preview" id="propose-cover-preview" hidden>
              <div class="cover-preview-frame">
                <img id="propose-cover-img" alt="" />
                <div class="cover-preview-status" id="propose-cover-status" hidden></div>
              </div>
              <div class="cover-preview-actions">
                <button type="button" class="btn ghost" id="propose-cover-replace">Replace</button>
                <button type="button" class="btn ghost" id="propose-cover-clear">Remove</button>
              </div>
            </div>
            <span class="field-hint" id="propose-cover-hint" hidden></span>
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
            ${feePayHtml({
              id: "propose-fee",
              amountSats: SUBMISSION_FEE_SATS,
              address: feeAddress,
              txidName: "submission_fee_txid",
              note: "Required to open a proposal PR. Exact amount on-chain.",
            })}
          </div>
        </fieldset>

        <div class="form-actions">
          <button type="submit" class="btn">Open proposal PR</button>
        </div>
        <p class="form-msg" id="propose-msg" hidden></p>
      </form>
    </section>
  `);

  const feePay = await bindFeePay(document, "propose-fee");

  const form = document.getElementById("propose-form") as HTMLFormElement;
  const msg = document.getElementById("propose-msg")!;
  const coverInput = document.getElementById(
    "propose-cover-input",
  ) as HTMLInputElement;
  const coverPicker = document.getElementById("propose-cover-picker")!;
  const coverPreview = document.getElementById("propose-cover-preview")!;
  const coverImg = document.getElementById(
    "propose-cover-img",
  ) as HTMLImageElement;
  const coverStatus = document.getElementById("propose-cover-status")!;
  const coverHint = document.getElementById("propose-cover-hint")!;
  const coverPick = document.getElementById("propose-cover-pick");
  const coverReplace = document.getElementById("propose-cover-replace");
  const coverClear = document.getElementById("propose-cover-clear");
  let coverUrl: string | null = null;
  let coverObjectUrl: string | null = null;
  let coverUploading = false;

  const setHint = (text: string, kind: "" | "error" | "ok" = "") => {
    if (!text) {
      coverHint.hidden = true;
      coverHint.textContent = "";
      coverHint.className = "field-hint";
      return;
    }
    coverHint.hidden = false;
    coverHint.textContent = text;
    coverHint.className =
      kind === "error"
        ? "field-hint error"
        : kind === "ok"
          ? "field-hint ok"
          : "field-hint";
  };

  const setPreviewStatus = (text: string, kind: "" | "busy" | "error" = "") => {
    if (!text) {
      coverStatus.hidden = true;
      coverStatus.textContent = "";
      coverStatus.className = "cover-preview-status";
      return;
    }
    coverStatus.hidden = false;
    coverStatus.textContent = text;
    coverStatus.className = `cover-preview-status${kind ? ` is-${kind}` : ""}`;
  };

  const showPicker = () => {
    coverPicker.hidden = false;
    coverPreview.hidden = true;
  };

  const showPreview = () => {
    coverPicker.hidden = true;
    coverPreview.hidden = false;
  };

  const clearCover = () => {
    coverUrl = null;
    coverUploading = false;
    if (coverObjectUrl) {
      URL.revokeObjectURL(coverObjectUrl);
      coverObjectUrl = null;
    }
    coverImg.removeAttribute("src");
    coverImg.alt = "";
    setPreviewStatus("");
    coverInput.value = "";
    showPicker();
    setHint("");
  };

  const openFilePicker = () => {
    if (coverUploading) return;
    coverInput.click();
  };

  coverPick?.addEventListener("click", openFilePicker);
  coverReplace?.addEventListener("click", openFilePicker);
  coverClear?.addEventListener("click", () => {
    if (coverUploading) return;
    clearCover();
  });

  coverPicker.addEventListener("dragover", (e) => {
    e.preventDefault();
    coverPicker.classList.add("is-dragover");
  });
  coverPicker.addEventListener("dragleave", () => {
    coverPicker.classList.remove("is-dragover");
  });
  coverPicker.addEventListener("drop", (e) => {
    e.preventDefault();
    coverPicker.classList.remove("is-dragover");
    if (coverUploading) return;
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    const dt = new DataTransfer();
    dt.items.add(file);
    coverInput.files = dt.files;
    coverInput.dispatchEvent(new Event("change"));
  });

  coverInput.addEventListener("change", async () => {
    const file = coverInput.files?.[0];
    if (!file) return;

    const pre = clientCoverPrecheck(file);
    if (pre) {
      clearCover();
      setHint(pre, "error");
      return;
    }

    if (coverObjectUrl) URL.revokeObjectURL(coverObjectUrl);
    coverObjectUrl = URL.createObjectURL(file);
    coverImg.src = coverObjectUrl;
    coverImg.alt = "Cover preview";
    coverUrl = null;
    coverUploading = true;
    showPreview();
    setHint("");
    setPreviewStatus("Uploading…", "busy");

    try {
      const uploaded = await uploadProjectCover(file);
      coverUrl = uploaded.url;
      coverUploading = false;
      setPreviewStatus("");
      setHint("Cover ready — it will be included when you open the PR.", "ok");
    } catch (err) {
      const e = err as Error & { code?: string };
      coverUploading = false;
      clearCover();
      if (e.code === "MEDIA_DISABLED") {
        setHint(
          "Cover uploads are not enabled yet — you can still submit without an image.",
        );
        return;
      }
      setHint(e.message, "error");
    }
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (coverUploading) {
      msg.hidden = false;
      msg.className = "form-msg error";
      msg.textContent = "Wait for the cover upload to finish, or remove it.";
      return;
    }
    const feeTxid = feePay?.getTxid() || "";
    if (!/^[0-9a-fA-F]{64}$/.test(feeTxid)) {
      feePay?.setStep("txid");
      msg.hidden = false;
      msg.className = "form-msg error";
      msg.textContent =
        "Paste the 64-character submission fee txid after you've sent the payment.";
      return;
    }
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
        submission_fee_txid: feeTxid,
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
