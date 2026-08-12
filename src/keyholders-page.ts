import { authFetch, type AuthUser } from "./auth";
import { WORKERS_API } from "./config";
import { confirmAction } from "./confirm-modal";
import { href, projectsHref } from "./router";
import { escapeHtml, formatSats } from "./util";

export type KeyholdersShell = (inner: string) => string;

type DisburseItem = {
  id: string;
  kind: string;
  state: string;
  proposal_id: string;
  outputs: { address: string; amount_sats: number; label?: string }[];
  settle_txid?: string;
  settle_proposed_by?: string;
  psbts?: { sha256: string; uploader: string; created_at: string; kind?: string }[];
  addresses_frozen?: boolean;
  ln_destination?: string;
  ln_amount_sats?: number;
  period?: string;
  monthly_accruing?: boolean;
  line_items?: { proposal_id: string; payout_sats: number; escrow_address?: string }[];
  partials?: { keyholder_id: string; fingerprint: string }[];
  psbt_status?: string;
  required_threshold?: number;
};

type KeyholderMe = {
  user_id: string;
  github: string;
  fingerprint?: string | null;
  xpub?: string | null;
  auth_address?: string | null;
  status: string;
  verified_at?: string | null;
  keys_stale?: boolean;
};

const api = () => WORKERS_API.replace(/\/$/, "");

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export async function renderKeyholders(
  shell: KeyholdersShell,
  user: AuthUser | null,
): Promise<void> {
  const app = document.querySelector<HTMLDivElement>("#app")!;
  if (!user) {
    app.innerHTML = shell(`
      <section class="wrap-wide detail">
        <h1>Keyholders</h1>
        <p class="lede">Sign in to open the keyholder console.</p>
        <p><a class="btn" href="${href("/account")}">Account</a></p>
        <p class="muted"><a href="${href("/reviewers")}?tab=keyholders">Apply</a> · <a href="${href("/docs/keyholder-responsibilities.md")}">Responsibilities</a></p>
      </section>
    `);
    return;
  }

  const meRes = await authFetch(`${api()}/keyholders/me`);
  const meBody = meRes.ok
    ? ((await meRes.json()) as {
        keyholder: KeyholderMe | null;
        earnings_sats?: number;
      })
    : { keyholder: null, earnings_sats: 0 };
  const kh = meBody.keyholder;
  const earnings = meBody.earnings_sats || 0;
  if (!kh || (kh.status !== "active" && kh.status !== "invited" && kh.status !== "pending_attest")) {
    app.innerHTML = shell(`
      <section class="wrap-wide detail">
        <h1>Keyholders</h1>
        <p class="lede">Active keyholders only.</p>
        <p><a href="${href("/reviewers")}?tab=keyholders">Apply</a> · <a href="${href("/docs/keyholder-responsibilities.md")}">Responsibilities</a> · <a href="${projectsHref()}">Projects</a></p>
      </section>
    `);
    return;
  }

  app.innerHTML = shell(`
    <section class="wrap-wide detail keyholders-page">
      <header class="declined-head">
        <p class="eyebrow"><a href="${projectsHref()}">Projects</a> · Ops</p>
        <h1>Keyholders</h1>
        <p class="lede">Sparrow cosigns for escrow releases and refunds.</p>
        ${
          kh.status === "active"
            ? `<p class="kh-earnings">Accrued: <strong>${formatSats(earnings)}</strong></p>`
            : ""
        }
        <p class="muted"><a href="${href("/docs/keyholder-responsibilities.md")}">Responsibilities</a></p>
        <p class="muted" id="kh-health"></p>
        ${
          kh.keys_stale
            ? `<div class="lifecycle-banner lifecycle-warn" role="status"><span class="lifecycle-k">Keys older than 1 year</span><p>Re-confirm fingerprint + xpub below (or re-submit) and ask peers to co-attest if material changed. Signing still happens only in Sparrow.</p></div>`
            : ""
        }
      </header>
      ${
        kh.status === "active"
          ? `<div class="form-panel">
              <h2 class="proposal-block-title">Signing session</h2>
              <ol class="kh-steps">
                <li>Request a challenge and copy it.</li>
                <li>Sparrow → Tools → Sign/Verify Message, on your auth address.</li>
                <li>Paste the base64 signature and Verify.</li>
              </ol>
              <label class="donate-amount-label" for="kh-auth-addr">Auth address</label>
              <input id="kh-auth-addr" class="donate-amount mono" placeholder="tb1… / bc1…" value="${escapeHtml(kh.auth_address || "")}" autocomplete="off" />
              <button type="button" class="btn" id="kh-challenge">Request challenge</button>
              <p class="mono kh-challenge-msg" id="kh-challenge-msg" hidden role="status"></p>
              <button type="button" class="btn ghost" id="kh-challenge-copy" hidden>Copy message</button>
              <label class="donate-amount-label" for="kh-challenge-sig">Signature (base64)</label>
              <textarea id="kh-challenge-sig" class="comment-input mono" rows="2" placeholder="Paste compact signed message"></textarea>
              <button type="button" class="btn ghost" id="kh-challenge-verify">Verify</button>
              <p class="builder-msg" id="kh-challenge-status" hidden role="status" aria-live="polite"></p>
            </div>`
          : ""
      }
      ${
        kh.status === "active" && kh.keys_stale
          ? `<div class="form-panel">
              <h2 class="proposal-block-title">Re-confirm keys</h2>
              <p class="muted">Attestation older than 365 days. Update public material if needed.</p>
              <label class="donate-amount-label" for="kh-fp">Fingerprint (8 hex)</label>
              <input id="kh-fp" class="donate-amount mono" maxlength="8" value="${escapeHtml(kh.fingerprint || "")}" />
              <label class="donate-amount-label" for="kh-xpub">xpub / tpub</label>
              <textarea id="kh-xpub" class="comment-input mono" rows="3">${escapeHtml(kh.xpub || "")}</textarea>
              <label class="donate-amount-label" for="kh-auth-addr-keys">Auth address (P2WPKH from this xpub)</label>
              <input id="kh-auth-addr-keys" class="donate-amount mono" placeholder="tb1… / bc1…" />
              <button type="button" class="btn" id="kh-keys-submit">Save keys</button>
              <p class="builder-msg" id="kh-keys-msg" hidden role="status" aria-live="polite"></p>
            </div>`
          : ""
      }
      ${
        kh.status !== "active"
          ? `<div class="form-panel">
              <h2 class="proposal-block-title">Your keys</h2>
              <p class="muted">Status: ${escapeHtml(kh.status)}. Submit fingerprint + xpub, then wait for two active keyholders to co-attest.</p>
              <label class="donate-amount-label" for="kh-fp">Fingerprint (8 hex)</label>
              <input id="kh-fp" class="donate-amount mono" maxlength="8" value="${escapeHtml(kh.fingerprint || "")}" />
              <label class="donate-amount-label" for="kh-xpub">xpub / tpub</label>
              <textarea id="kh-xpub" class="comment-input mono" rows="3">${escapeHtml(kh.xpub || "")}</textarea>
              <label class="donate-amount-label" for="kh-auth-addr-keys">Auth address (P2WPKH from this xpub)</label>
              <input id="kh-auth-addr-keys" class="donate-amount mono" placeholder="tb1… / bc1…" />
              <button type="button" class="btn" id="kh-keys-submit">Save keys</button>
              <p class="builder-msg" id="kh-keys-msg" hidden role="status" aria-live="polite"></p>
            </div>`
          : ""
      }
      <div class="account-tabs" role="tablist" aria-label="Disbursement queues">
        <button type="button" class="account-tab active" role="tab" id="kh-tab-release" data-kh-tab="release" aria-selected="true" aria-controls="kh-queue" tabindex="0">Releases</button>
        <button type="button" class="account-tab" role="tab" id="kh-tab-bond_refund" data-kh-tab="bond_refund" aria-selected="false" aria-controls="kh-queue" tabindex="-1">Bond refunds</button>
        <button type="button" class="account-tab" role="tab" id="kh-tab-contrib_refund" data-kh-tab="contrib_refund" aria-selected="false" aria-controls="kh-queue" tabindex="-1">Contributor refunds</button>
        <button type="button" class="account-tab" role="tab" id="kh-tab-roster" data-kh-tab="roster" aria-selected="false" aria-controls="kh-queue" tabindex="-1">Roster</button>
      </div>
      <div id="kh-queue" role="tabpanel" aria-labelledby="kh-tab-release" aria-live="polite"><p class="muted">Loading…</p></div>
      <div id="kh-detail" hidden></div>
    </section>
  `);

  void fetch(`${api()}/health`)
    .then((r) => r.json())
    .then((h: { escrow_map_remaining?: number }) => {
      const el = app.querySelector("#kh-health");
      if (el && h.escrow_map_remaining != null) {
        el.textContent = `Escrow map remaining: ${h.escrow_map_remaining}`;
      }
    })
    .catch(() => undefined);

  const queueEl = app.querySelector<HTMLElement>("#kh-queue")!;
  const detailEl = app.querySelector<HTMLElement>("#kh-detail")!;
  let kind = "release";
  let challengeMessage = "";

  const loadQueue = async () => {
    queueEl.setAttribute("aria-busy", "true");
    if (kh.status !== "active") {
      queueEl.innerHTML = `<p class="muted">Activate your seat to see the disbursement queue.</p>`;
      queueEl.removeAttribute("aria-busy");
      return;
    }
    const res = await authFetch(
      `${api()}/disburse/queue?kind=${encodeURIComponent(kind)}`,
    );
    if (!res.ok) {
      queueEl.innerHTML = `<p class="muted">Could not load queue.</p>`;
      queueEl.removeAttribute("aria-busy");
      return;
    }
    const data = (await res.json()) as { items: DisburseItem[] };
    if (!data.items.length) {
      queueEl.innerHTML = `<p class="muted">No open ${escapeHtml(kind.replace(/_/g, " "))} items.</p>`;
      queueEl.removeAttribute("aria-busy");
      return;
    }
    queueEl.innerHTML = `<ul class="declined-list">${data.items
      .map((item) => {
        const sum = item.outputs.reduce((a, o) => a + o.amount_sats, 0);
        const waiting = item.outputs.length === 0;
        const lines = item.line_items?.length || 0;
        const signed = item.partials?.length || 0;
        const need = item.required_threshold || 0;
        return `<li class="declined-row">
          <button type="button" class="declined-title btn ghost" data-disburse="${escapeHtml(item.id)}" aria-label="${escapeHtml(item.period || item.proposal_id)} ${escapeHtml(item.state)}${need ? ` ${signed} of ${need} signed` : ""}">${escapeHtml(item.period || item.proposal_id)}</button>
          <span class="declined-meta"><span class="pill">${escapeHtml(item.state)}</span>
          ${
            item.monthly_accruing
              ? `<span class="pill">accruing</span>`
              : ""
          }
          ${
            lines
              ? `<span class="muted">${lines} bount${lines === 1 ? "y" : "ies"}</span>`
              : ""
          }
          ${
            need
              ? `<span class="muted">${signed}/${need} signed</span>`
              : ""
          }
          ${
            waiting
              ? `<span class="pill">waiting on address</span>`
              : `<span class="muted">${formatSats(sum)}</span>`
          }</span>
        </li>`;
      })
      .join("")}</ul>`;
    queueEl.querySelectorAll<HTMLButtonElement>("[data-disburse]").forEach((btn) => {
      btn.addEventListener("click", () => {
        void openDetail(btn.dataset.disburse || "");
      });
    });
    queueEl.removeAttribute("aria-busy");
  };

  const openDetail = async (id: string) => {
    const res = await authFetch(`${api()}/disburse/${encodeURIComponent(id)}`);
    if (!res.ok) {
      detailEl.hidden = false;
      detailEl.innerHTML = `<p class="builder-msg bad" role="alert">Could not load item.</p>`;
      return;
    }
    const data = (await res.json()) as {
      item: DisburseItem;
      requires_dual_settle: boolean;
      needs_ln_lockup?: boolean;
    };
    const item = data.item;
    const needsLn = Boolean(data.needs_ln_lockup);
    const canPsbt =
      item.outputs.length > 0 && !needsLn && !item.monthly_accruing;
    const isRelease = item.kind === "release";
    const signed = item.partials?.length || 0;
    const need = item.required_threshold || 0;
    const hasUnsigned = Boolean(
      item.addresses_frozen || item.psbts?.some((p) => p.kind === "unsigned") || item.psbts?.[0],
    );
    const canUnsigned = canPsbt && !(isRelease && signed > 0);
    const canPartial = isRelease && canPsbt && hasUnsigned;
    const canBroadcast = canPartial && need > 0 && signed >= need;
    detailEl.hidden = false;
    detailEl.innerHTML = `
      <div class="form-panel form-panel-wide">
        <h2 class="proposal-block-title" id="kh-detail-title" tabindex="-1">${escapeHtml(item.kind.replace(/_/g, " "))} · ${escapeHtml(item.proposal_id)}</h2>
        <p class="muted">State: ${escapeHtml(item.state)}${item.addresses_frozen ? " · addresses frozen" : ""}${item.period ? ` · ${escapeHtml(item.period)}` : ""}${item.monthly_accruing ? " · accruing (not yet signable)" : ""}${item.required_threshold ? ` · ${item.partials?.length || 0}/${item.required_threshold} signatures` : ""}</p>
        ${
          item.line_items?.length
            ? `<h3 class="proposal-block-title">Line items</h3>
               <table class="kh-outputs">
                 <caption class="sr-only">Line items</caption>
                 <thead><tr><th scope="col">Proposal</th><th scope="col">Escrow</th><th scope="col">Payout</th></tr></thead>
                 <tbody>${item.line_items
                   .map(
                     (l) =>
                       `<tr><td class="mono">${escapeHtml(l.proposal_id)}</td><td class="mono">${escapeHtml(l.escrow_address || "—")}</td><td>${formatSats(l.payout_sats)}</td></tr>`,
                   )
                   .join("")}</tbody>
               </table>
               <h3 class="proposal-block-title">Signers</h3>
               <ul>${
                 item.partials?.length
                   ? item.partials
                       .map(
                         (p) =>
                           `<li class="mono">${escapeHtml(p.keyholder_id)} · ${escapeHtml(p.fingerprint)}</li>`,
                       )
                       .join("")
                   : `<li class="muted">No partials yet</li>`
               }</ul>`
            : ""
        }
        ${
          item.ln_destination
            ? `<p class="lifecycle-banner"><span class="lifecycle-k">Lightning payout</span>
                <span class="mono">${escapeHtml(item.ln_destination)}</span>
                ${item.ln_amount_sats != null ? ` · ${formatSats(item.ln_amount_sats)}` : ""}
               </p>`
            : ""
        }
        ${
          needsLn
            ? `<div class="lifecycle-banner lifecycle-warn">
                <span class="lifecycle-k">Boltz lockup required</span>
                <p>Create a Boltz submarine swap to that Lightning destination for the amount above, then paste the lockup address. Signing stays in Sparrow — Plebly never holds swap keys.</p>
                <label class="donate-amount-label" for="kh-lockup">Boltz lockup address</label>
                <input id="kh-lockup" class="donate-amount mono" placeholder="bc1… / tb1…" />
                <button type="button" class="btn" id="kh-lockup-save">Attach lockup</button>
              </div>`
            : ""
        }
        ${
          item.monthly_accruing
            ? `<div class="lifecycle-banner" role="status"><span class="lifecycle-k">Accruing</span><p>Signing opens after month-end freeze.</p></div>`
            : ""
        }
        ${
          isRelease
            ? `<div class="kh-recipe">
                <h3 class="proposal-block-title" id="kh-recipe-title">Sparrow</h3>
                <ol class="kh-steps">
                  <li>Inputs: escrow UTXOs in the line items only.</li>
                  <li>Outputs: the table below, exact amounts. No change, no extras.</li>
                  <li>Upload the unsigned PSBT, then sign that frozen file on hardware.</li>
                  <li>Upload your partial. Broadcast when ${need || "threshold"} signatures are in.</li>
                </ol>
              </div>`
            : `<p class="muted">Sign in Sparrow, then Propose / Confirm.</p>`
        }
        ${
          !canPsbt && !needsLn && !item.monthly_accruing
            ? `<p class="builder-msg bad">Waiting on refund/payout addresses — settle and PSBT upload are blocked until outputs exist.</p>`
            : ""
        }
        <table class="kh-outputs">
          <caption class="sr-only">Outputs</caption>
          <thead><tr><th scope="col">Label</th><th scope="col">Address</th><th scope="col">Amount</th></tr></thead>
          <tbody>
            ${
              item.outputs.length
                ? item.outputs
                    .map(
                      (o) =>
                        `<tr><td>${escapeHtml(o.label || "—")}</td><td class="mono">${escapeHtml(o.address)}</td><td>${formatSats(o.amount_sats)}</td></tr>`,
                    )
                    .join("")
                : `<tr><td colspan="3" class="muted">No outputs yet</td></tr>`
            }
          </tbody>
        </table>
        <div class="comment-compose-actions">
          <label class="donate-amount-label" for="kh-psbt-unsigned">Unsigned PSBT (base64) — freeze addresses</label>
          <textarea id="kh-psbt-unsigned" class="comment-input mono" rows="3" placeholder="cHNidP8…" ${
            canUnsigned ? "" : "disabled"
          }></textarea>
          <button type="button" class="btn" id="kh-psbt-upload" ${
            canUnsigned ? "" : "disabled"
          }>Upload unsigned</button>
          ${
            item.psbts?.[0]
              ? `<button type="button" class="btn ghost" id="kh-psbt-dl">Download latest (${escapeHtml(item.psbts[0].sha256.slice(0, 12))}…)</button>`
              : ""
          }
        </div>
        ${
          isRelease
            ? `<div class="comment-compose-actions">
          <label class="donate-amount-label" for="kh-psbt-partial">Partial PSBT (base64)</label>
          <textarea id="kh-psbt-partial" class="comment-input mono" rows="3" placeholder="cHNidP8…" ${
            canPartial ? "" : "disabled"
          }></textarea>
          <button type="button" class="btn" id="kh-sign" ${
            canPartial ? "" : "disabled"
          }>Upload partial</button>
          <button type="button" class="btn ghost" id="kh-broadcast" ${
            canBroadcast ? "" : "disabled"
          }>Broadcast</button>
        </div>`
            : ""
        }
        <label class="donate-amount-label" for="kh-txid">Broadcast txid</label>
        <input id="kh-txid" class="donate-amount mono" value="${escapeHtml(item.settle_txid || "")}" ${
          canPsbt ? "" : "disabled"
        } />
        <div id="kh-verify-panel" class="lifecycle-banner" hidden>
          <span class="lifecycle-k">Verify before settle</span>
          <p>Match this txid to the outputs above.</p>
          <ul class="kh-verify-outputs">${item.outputs
            .map(
              (o) =>
                `<li class="mono">${escapeHtml(o.address)} · ${formatSats(o.amount_sats)}${
                  o.label ? ` · ${escapeHtml(o.label)}` : ""
                }</li>`,
            )
            .join("")}</ul>
        </div>
        <div class="comment-compose-actions">
          <button type="button" class="btn" id="kh-propose" ${
            canPsbt ? "" : "disabled"
          }>Propose settle${isRelease ? " (fallback)" : ""}</button>
          ${
            data.requires_dual_settle
              ? `<button type="button" class="btn ghost" id="kh-confirm"${
                  item.settle_proposed_by === kh.user_id || !canPsbt
                    ? " disabled"
                    : ""
                }>Confirm settle${isRelease ? " (fallback)" : ""}</button>`
              : ""
          }
        </div>
        <p class="builder-msg" id="kh-settle-msg" hidden role="status" aria-live="polite"></p>
        <h3 class="proposal-block-title">Coordination</h3>
        <div id="kh-chat"></div>
        <label class="sr-only" for="kh-chat-input">Message other keyholders</label>
        <textarea id="kh-chat-input" class="comment-input" rows="2" maxlength="2000" placeholder="Message other keyholders…"></textarea>
        <button type="button" class="btn ghost" id="kh-chat-send">Post</button>
      </div>`;

    detailEl.querySelector<HTMLElement>("#kh-detail-title")?.focus();

    const setMsg = (t: string) => {
      const el = detailEl.querySelector<HTMLElement>("#kh-settle-msg");
      if (!el) return;
      el.hidden = !t;
      el.textContent = t;
    };

    detailEl.querySelector("#kh-lockup-save")?.addEventListener("click", async () => {
      const lockup =
        detailEl.querySelector<HTMLInputElement>("#kh-lockup")?.value.trim() ||
        "";
      if (!lockup) {
        setMsg("Paste the Boltz lockup address.");
        return;
      }
      const res = await authFetch(`${api()}/disburse/${id}/lockup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lockup_address: lockup }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setMsg(res.ok ? "Lockup attached." : body.error || "Could not attach lockup");
      if (res.ok) void openDetail(id);
    });

    detailEl.querySelector("#kh-sign")?.addEventListener("click", async () => {
      const b64 = detailEl.querySelector<HTMLTextAreaElement>("#kh-psbt-partial")?.value.trim() || "";
      if (!b64) {
        setMsg("Paste a partial PSBT.");
        return;
      }
      const wouldComplete = need > 0 && signed + 1 >= need;
      const ok = await confirmAction({
        title: wouldComplete ? "Upload partial and broadcast" : "Upload partial",
        body: wouldComplete
          ? "This signature may complete the threshold. The Worker will try to broadcast."
          : "Store your signature on the frozen PSBT.",
        confirmLabel: wouldComplete ? "Sign and broadcast" : "Upload",
        danger: wouldComplete,
      });
      if (!ok) return;
      const res = await authFetch(`${api()}/disburse/${id}/sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ psbt_base64: b64 }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        threshold_met?: boolean;
        broadcast?: boolean;
        txid?: string;
      };
      setMsg(
        res.ok
          ? body.broadcast
            ? `Broadcast ${body.txid}`
            : body.threshold_met
              ? "Threshold met — broadcast if ready"
              : "Partial stored"
          : body.error || "Sign failed",
      );
      if (res.ok) void openDetail(id);
    });

    detailEl.querySelector("#kh-broadcast")?.addEventListener("click", async () => {
      const sum = item.outputs.reduce((a, o) => a + o.amount_sats, 0);
      const ok = await confirmAction({
        title: "Broadcast",
        body: `Broadcast the combined transaction (${item.outputs.length} outputs, ${formatSats(sum)}).`,
        confirmLabel: "Broadcast",
        danger: true,
      });
      if (!ok) return;
      const res = await authFetch(`${api()}/disburse/${id}/broadcast`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        txid?: string;
      };
      setMsg(res.ok ? `Broadcast ${body.txid}` : body.error || "Broadcast failed");
      if (res.ok) void openDetail(id);
    });

    detailEl.querySelector("#kh-psbt-upload")?.addEventListener("click", async () => {
      if (!canUnsigned) {
        setMsg(
          item.monthly_accruing
            ? "Month still accruing."
            : needsLn
              ? "Attach Boltz lockup first."
              : signed > 0
                ? "Unsigned PSBT is frozen."
                : "No outputs yet.",
        );
        return;
      }
      const b64 = detailEl.querySelector<HTMLTextAreaElement>("#kh-psbt-unsigned")?.value.trim() || "";
      if (!b64) {
        setMsg("Paste an unsigned PSBT.");
        return;
      }
      const outs = item.outputs
        .map(
          (o) =>
            `${o.label || "out"}: ${o.address} · ${formatSats(o.amount_sats)}`,
        )
        .join("\n");
      const ok = await confirmAction({
        title: "Upload PSBT",
        body: `Confirm this PSBT pays exactly these outputs (addresses freeze after upload):\n\n${outs}`,
        confirmLabel: "Upload",
      });
      if (!ok) return;
      const res = await authFetch(`${api()}/disburse/${id}/psbt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ psbt_base64: b64 }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setMsg(res.ok ? "PSBT uploaded." : body.error || "Upload failed");
      if (res.ok) void openDetail(id);
    });

    detailEl.querySelector("#kh-psbt-dl")?.addEventListener("click", async () => {
      const res = await authFetch(`${api()}/disburse/${id}/psbt`);
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${item.proposal_id}.psbt`;
      a.click();
      URL.revokeObjectURL(url);
    });

    detailEl.querySelector("#kh-propose")?.addEventListener("click", async () => {
      if (!canPsbt) {
        setMsg(
          needsLn
            ? "Attach Boltz lockup for the Lightning payout first."
            : "No outputs yet — waiting on refund/payout addresses.",
        );
        return;
      }
      const txid = detailEl.querySelector<HTMLInputElement>("#kh-txid")?.value || "";
      const panel = detailEl.querySelector<HTMLElement>("#kh-verify-panel");
      if (panel) panel.hidden = false;
      const ok = await confirmAction({
        title: "Propose settle",
        body: `Confirm this txid pays every output listed (${item.outputs.length} outputs).${
          data.requires_dual_settle
            ? " A second keyholder must confirm before status becomes settled."
            : ""
        } Dual-ack is the fallback if broadcast fails.`,
        confirmLabel: "Propose",
      });
      if (!ok) return;
      const res = await authFetch(`${api()}/disburse/${id}/propose-settle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txid }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        missing?: { address: string; amount_sats: number }[];
      };
      if (res.ok) {
        setMsg("Settle proposed / completed.");
        void openDetail(id);
        void loadQueue();
      } else {
        const miss = body.missing?.length
          ? ` Missing: ${body.missing
              .map((m) => `${m.address} (${m.amount_sats} sats)`)
              .join("; ")}`
          : "";
        setMsg((body.error || "Failed") + miss);
      }
    });

    detailEl.querySelector("#kh-confirm")?.addEventListener("click", async () => {
      const ok = await confirmAction({
        title: "Confirm settle",
        body: "Second keyholder confirmation. Re-verifies the txid on-chain.",
        confirmLabel: "Confirm",
        danger: true,
      });
      if (!ok) return;
      const res = await authFetch(`${api()}/disburse/${id}/confirm-settle`, {
        method: "POST",
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setMsg(res.ok ? "Settled." : body.error || "Failed");
      if (res.ok) {
        void openDetail(id);
        void loadQueue();
      }
    });

    const chatEl = detailEl.querySelector<HTMLElement>("#kh-chat");
    const loadChat = async () => {
      const res = await authFetch(`${api()}/disburse/${id}/chat`);
      if (!res.ok || !chatEl) return;
      const data = (await res.json()) as {
        messages: { author: string; body: string; created_at: string }[];
      };
      chatEl.innerHTML = data.messages.length
        ? data.messages
            .map(
              (m) =>
                `<p><strong>@${escapeHtml(m.author)}</strong> <span class="muted">${escapeHtml(m.created_at.slice(0, 16))}</span><br />${escapeHtml(m.body)}</p>`,
            )
            .join("")
        : `<p class="muted">No messages yet.</p>`;
    };
    void loadChat();
    detailEl.querySelector("#kh-chat-send")?.addEventListener("click", async () => {
      const input = detailEl.querySelector<HTMLTextAreaElement>("#kh-chat-input");
      const body = input?.value.trim() || "";
      if (!body) return;
      await authFetch(`${api()}/disburse/${id}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (input) input.value = "";
      void loadChat();
    });
  };

  app.querySelector("#kh-challenge")?.addEventListener("click", async () => {
    const res = await authFetch(`${api()}/keyholders/challenge`);
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
    };
    const el = app.querySelector<HTMLElement>("#kh-challenge-msg");
    const copyBtn = app.querySelector<HTMLButtonElement>("#kh-challenge-copy");
    challengeMessage = res.ok ? body.message || "" : "";
    if (el) {
      el.hidden = false;
      el.textContent = res.ok
        ? challengeMessage
        : body.error || "Challenge failed";
    }
    if (copyBtn) copyBtn.hidden = !challengeMessage;
  });
  app.querySelector("#kh-challenge-copy")?.addEventListener("click", async () => {
    const ok = await copyText(challengeMessage);
    const el = app.querySelector<HTMLElement>("#kh-challenge-status");
    if (el) {
      el.hidden = false;
      el.textContent = ok
        ? "Copied."
        : "Copy failed — select the message manually.";
    }
  });
  app.querySelector("#kh-challenge-verify")?.addEventListener("click", async () => {
    const address =
      app.querySelector<HTMLInputElement>("#kh-auth-addr")?.value.trim() || "";
    const signature =
      app.querySelector<HTMLTextAreaElement>("#kh-challenge-sig")?.value.trim() ||
      "";
    const el = app.querySelector<HTMLElement>("#kh-challenge-status");
    if (!address || !signature) {
      if (el) {
        el.hidden = false;
        el.textContent = "Address and signature required.";
      }
      return;
    }
    const res = await authFetch(`${api()}/keyholders/challenge/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, signature }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (el) {
      el.hidden = false;
      el.textContent = res.ok ? "Signing session active." : body.error || "Verify failed";
    }
  });

  app.querySelector("#kh-keys-submit")?.addEventListener("click", async () => {
    const fingerprint = (
      app.querySelector<HTMLInputElement>("#kh-fp")?.value || ""
    ).trim();
    const xpub = (
      app.querySelector<HTMLTextAreaElement>("#kh-xpub")?.value || ""
    ).trim();
    const res = await authFetch(`${api()}/keyholders/me/keys`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fingerprint, xpub, auth_address: (
        app.querySelector<HTMLInputElement>("#kh-auth-addr-keys")?.value ||
        app.querySelector<HTMLInputElement>("#kh-auth-addr")?.value ||
        ""
      ).trim() }),
    });
    const msg = app.querySelector<HTMLElement>("#kh-keys-msg");
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (msg) {
      msg.hidden = false;
      msg.textContent = res.ok ? "Keys saved." : body.error || "Failed";
    }
  });

  const loadRoster = async () => {
    const [pub, pending] = await Promise.all([
      fetch(`${api()}/keyholders/public`).then((r) =>
        r.ok ? r.json() : { keyholders: [] },
      ),
      kh.status === "active"
        ? authFetch(`${api()}/keyholders/pending`).then((r) =>
            r.ok ? r.json() : { keyholders: [] },
          )
        : Promise.resolve({ keyholders: [] }),
    ]);
    const active = (pub as { keyholders: KeyholderMe[] }).keyholders || [];
    const wait = (pending as { keyholders: KeyholderMe[] }).keyholders || [];
    const rows = [
      ...active.map((k) => ({ ...k, _pending: false })),
      ...wait.map((k) => ({ ...k, _pending: true })),
    ];
    queueEl.innerHTML = rows.length
      ? `<p class="builder-msg" id="kh-roster-msg" hidden role="status" aria-live="polite"></p>
         <ul class="declined-list">${rows
          .map(
            (k) =>
              `<li class="declined-row"><span>@${escapeHtml(k.github)}</span>
          <span class="declined-meta"><span class="pill">${escapeHtml(k.status)}</span>
          <span class="mono muted">${escapeHtml(k.fingerprint || "—")}</span></span>
          ${
            k._pending && kh.status === "active"
              ? `<button type="button" class="btn ghost" data-coattest="${escapeHtml(k.user_id)}">Co-attest</button>`
              : ""
          }</li>`,
          )
          .join("")}</ul>`
      : `<p class="muted">No keyholders listed yet.</p>`;
    queueEl.querySelectorAll<HTMLButtonElement>("[data-coattest]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.coattest || "";
        const res = await authFetch(
          `${api()}/keyholders/${encodeURIComponent(id)}/co-attest`,
          { method: "POST" },
        );
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        const msg = queueEl.querySelector<HTMLElement>("#kh-roster-msg");
        if (msg) {
          msg.hidden = false;
          msg.textContent = res.ok ? "Co-attested." : body.error || "Failed";
        }
        if (res.ok) void loadRoster();
      });
    });
  };

  const setTab = (next: string, btn: HTMLButtonElement) => {
    kind = next;
    app.querySelectorAll<HTMLButtonElement>("[data-kh-tab]").forEach((t) => {
      const on = t === btn;
      t.classList.toggle("active", on);
      t.setAttribute("aria-selected", on ? "true" : "false");
      t.tabIndex = on ? 0 : -1;
    });
    queueEl.setAttribute("aria-labelledby", btn.id);
    detailEl.hidden = true;
    if (kind === "roster") {
      void loadRoster();
    } else {
      void loadQueue();
    }
  };
  app.querySelectorAll<HTMLButtonElement>("[data-kh-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      setTab(btn.dataset.khTab || "release", btn);
    });
  });
  app.querySelector(".account-tabs")?.addEventListener("keydown", (ev) => {
    const ke = ev as KeyboardEvent;
    if (ke.key !== "ArrowRight" && ke.key !== "ArrowLeft") return;
    const tabs = [
      ...app.querySelectorAll<HTMLButtonElement>("[data-kh-tab]"),
    ];
    const i = tabs.findIndex((t) => t.getAttribute("aria-selected") === "true");
    if (i < 0) return;
    ke.preventDefault();
    const next =
      tabs[(i + (ke.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
    if (!next) return;
    next.focus();
    setTab(next.dataset.khTab || "release", next);
  });

  void loadQueue();
}
