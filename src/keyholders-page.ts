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
  psbts?: { sha256: string; uploader: string; created_at: string }[];
  addresses_frozen?: boolean;
  ln_destination?: string;
  ln_amount_sats?: number;
};

type KeyholderMe = {
  user_id: string;
  github: string;
  fingerprint?: string | null;
  xpub?: string | null;
  status: string;
  verified_at?: string | null;
  keys_stale?: boolean;
};

const api = () => WORKERS_API.replace(/\/$/, "");

export async function renderKeyholders(
  shell: KeyholdersShell,
  user: AuthUser | null,
): Promise<void> {
  const app = document.querySelector<HTMLDivElement>("#app")!;
  if (!user) {
    app.innerHTML = shell(`
      <section class="wrap-wide detail">
        <h1>Keyholders</h1>
        <p class="lede">Sign in with a keyholder GitHub account to coordinate Sparrow cosigns. Plebly never holds keys.</p>
        <p><a class="btn" href="${href("/account")}">Account</a></p>
      </section>
    `);
    return;
  }

  const meRes = await authFetch(`${api()}/keyholders/me`);
  const meBody = meRes.ok
    ? ((await meRes.json()) as { keyholder: KeyholderMe | null })
    : { keyholder: null };
  const kh = meBody.keyholder;
  if (!kh || (kh.status !== "active" && kh.status !== "invited" && kh.status !== "pending_attest")) {
    app.innerHTML = shell(`
      <section class="wrap-wide detail">
        <h1>Keyholders</h1>
        <p class="lede">This console is for active escrow keyholders only. Signing stays in Sparrow — the site never moves funds.</p>
        <p><a href="${projectsHref()}">Back to projects</a></p>
      </section>
    `);
    return;
  }

  app.innerHTML = shell(`
    <section class="wrap-wide detail keyholders-page">
      <header class="declined-head">
        <p class="eyebrow"><a href="${projectsHref()}">Projects</a> · Ops</p>
        <h1>Keyholders</h1>
        <p class="lede">Coordinate Sparrow cosigns. Plebly never holds keys. Releases and contributor refunds need dual keyholder settle.</p>
        <p class="muted" id="kh-health"></p>
        ${
          kh.keys_stale
            ? `<div class="lifecycle-banner lifecycle-warn" role="status"><span class="lifecycle-k">Keys older than 1 year</span><p>Re-confirm fingerprint + xpub below (or re-submit) and ask peers to co-attest if material changed. Signing still happens only in Sparrow.</p></div>`
            : ""
        }
      </header>
      ${
        kh.status === "active" && kh.keys_stale
          ? `<div class="form-panel">
              <h2 class="proposal-block-title">Re-confirm keys</h2>
              <p class="muted">Attestation older than 365 days. Update public material if needed.</p>
              <label class="donate-amount-label" for="kh-fp">Fingerprint (8 hex)</label>
              <input id="kh-fp" class="donate-amount mono" maxlength="8" value="${escapeHtml(kh.fingerprint || "")}" />
              <label class="donate-amount-label" for="kh-xpub">xpub / tpub</label>
              <textarea id="kh-xpub" class="comment-input mono" rows="3">${escapeHtml(kh.xpub || "")}</textarea>
              <button type="button" class="btn" id="kh-keys-submit">Save keys</button>
              <p class="builder-msg" id="kh-keys-msg" hidden></p>
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
              <button type="button" class="btn" id="kh-keys-submit">Save keys</button>
              <p class="builder-msg" id="kh-keys-msg" hidden></p>
            </div>`
          : ""
      }
      <div class="account-tabs" role="tablist">
        <button type="button" class="account-tab active" data-kh-tab="release">Releases</button>
        <button type="button" class="account-tab" data-kh-tab="bond_refund">Bond refunds</button>
        <button type="button" class="account-tab" data-kh-tab="contrib_refund">Contributor refunds</button>
        <button type="button" class="account-tab" data-kh-tab="roster">Roster</button>
      </div>
      <div id="kh-queue"><p class="muted">Loading…</p></div>
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

  const loadQueue = async () => {
    if (kh.status !== "active") {
      queueEl.innerHTML = `<p class="muted">Activate your seat to see the disbursement queue.</p>`;
      return;
    }
    const res = await authFetch(
      `${api()}/disburse/queue?kind=${encodeURIComponent(kind)}`,
    );
    if (!res.ok) {
      queueEl.innerHTML = `<p class="muted">Could not load queue.</p>`;
      return;
    }
    const data = (await res.json()) as { items: DisburseItem[] };
    if (!data.items.length) {
      queueEl.innerHTML = `<p class="muted">No open ${escapeHtml(kind.replace(/_/g, " "))} items.</p>`;
      return;
    }
    queueEl.innerHTML = `<ul class="declined-list">${data.items
      .map((item) => {
        const sum = item.outputs.reduce((a, o) => a + o.amount_sats, 0);
        const waiting = item.outputs.length === 0;
        return `<li class="declined-row">
          <button type="button" class="declined-title btn ghost" data-disburse="${escapeHtml(item.id)}">${escapeHtml(item.proposal_id)}</button>
          <span class="declined-meta"><span class="pill">${escapeHtml(item.state)}</span>
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
  };

  const openDetail = async (id: string) => {
    const res = await authFetch(`${api()}/disburse/${encodeURIComponent(id)}`);
    if (!res.ok) return;
    const data = (await res.json()) as {
      item: DisburseItem;
      requires_dual_settle: boolean;
      needs_ln_lockup?: boolean;
    };
    const item = data.item;
    const needsLn = Boolean(data.needs_ln_lockup);
    const canPsbt = item.outputs.length > 0 && !needsLn;
    detailEl.hidden = false;
    detailEl.innerHTML = `
      <div class="form-panel form-panel-wide">
        <h2 class="proposal-block-title">${escapeHtml(item.kind.replace(/_/g, " "))} · ${escapeHtml(item.proposal_id)}</h2>
        <p class="muted">State: ${escapeHtml(item.state)}${item.addresses_frozen ? " · addresses frozen" : ""}</p>
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
          !canPsbt && !needsLn
            ? `<p class="builder-msg bad">Waiting on refund/payout addresses — settle and PSBT upload are blocked until outputs exist.</p>`
            : ""
        }
        <table class="kh-outputs">
          <thead><tr><th>Label</th><th>Address</th><th>Amount</th></tr></thead>
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
          <label class="donate-amount-label" for="kh-psbt">PSBT (base64)</label>
          <textarea id="kh-psbt" class="comment-input mono" rows="3" placeholder="cHNidP8…" ${
            canPsbt ? "" : "disabled"
          }></textarea>
          <button type="button" class="btn" id="kh-psbt-upload" ${
            canPsbt ? "" : "disabled"
          }>Upload PSBT</button>
          ${
            item.psbts?.[0]
              ? `<a class="btn ghost" id="kh-psbt-dl" href="#">Download latest (${escapeHtml(item.psbts[0].sha256.slice(0, 12))}…)</a>`
              : ""
          }
        </div>
        <label class="donate-amount-label" for="kh-txid">Broadcast txid</label>
        <input id="kh-txid" class="donate-amount mono" value="${escapeHtml(item.settle_txid || "")}" ${
          canPsbt ? "" : "disabled"
        } />
        <div id="kh-verify-panel" class="lifecycle-banner" hidden>
          <span class="lifecycle-k">Verify before settle</span>
          <p>Worker will match this txid to the exact outputs above (address + amount). Plebly never broadcasts.</p>
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
          }>Propose settle</button>
          ${
            data.requires_dual_settle
              ? `<button type="button" class="btn ghost" id="kh-confirm"${
                  item.settle_proposed_by === kh.user_id || !canPsbt
                    ? " disabled"
                    : ""
                }>Confirm settle</button>`
              : ""
          }
        </div>
        <p class="builder-msg" id="kh-settle-msg" hidden></p>
        <h3 class="proposal-block-title">Coordination</h3>
        <div id="kh-chat"></div>
        <textarea id="kh-chat-input" class="comment-input" rows="2" maxlength="2000" placeholder="Message other keyholders…"></textarea>
        <button type="button" class="btn ghost" id="kh-chat-send">Post</button>
      </div>`;

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

    detailEl.querySelector("#kh-psbt-upload")?.addEventListener("click", async () => {
      if (!canPsbt) {
        setMsg(
          needsLn
            ? "Attach Boltz lockup for the Lightning payout first."
            : "No outputs yet — waiting on refund/payout addresses.",
        );
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
      const b64 = detailEl.querySelector<HTMLTextAreaElement>("#kh-psbt")?.value || "";
      const res = await authFetch(`${api()}/disburse/${id}/psbt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ psbt_base64: b64 }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setMsg(res.ok ? "PSBT uploaded." : body.error || "Upload failed");
      if (res.ok) void openDetail(id);
    });

    detailEl.querySelector("#kh-psbt-dl")?.addEventListener("click", async (ev) => {
      ev.preventDefault();
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
        } Plebly verifies on-chain; it never broadcasts.`,
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
      body: JSON.stringify({ fingerprint, xpub }),
    });
    const msg = app.querySelector<HTMLElement>("#kh-keys-msg");
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (msg) {
      msg.hidden = false;
      msg.textContent = res.ok ? "Keys saved." : body.error || "Failed";
    }
  });

  app.querySelectorAll<HTMLButtonElement>("[data-kh-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      kind = btn.dataset.khTab || "release";
      app.querySelectorAll(".account-tab").forEach((t) => t.classList.remove("active"));
      btn.classList.add("active");
      detailEl.hidden = true;
      if (kind === "roster") {
        void loadRoster();
      } else {
        void loadQueue();
      }
    });
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
      ? `<ul class="declined-list">${rows
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
        alert(res.ok ? "Co-attested." : body.error || "Failed");
        void loadRoster();
      });
    });
  };

  void loadQueue();
}
