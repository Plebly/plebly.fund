import QRCode from "qrcode";
import { currentReturnPath, loginMenuHtml } from "./auth";
import { CLAIM_FLOOR_SATS, WORKERS_API, lightningUiAllowed } from "./config";
import { listListedProposals } from "./github";
import { bindCardWatches, proposalCardHtml } from "./home-page";
import {
  createEndowmentLightningInvoice,
  fetchLightningStatus,
  fetchLightningSwap,
  weblnPay,
} from "./lightning";
import { watchConfirmedBalance } from "./mempool";
import { hydrateAvatarSlots } from "./profile-avatars";
import { applySeo, href, projectsHref, seoForRoute } from "./router";
import type { Proposal } from "./types";
import { bitcoinUri, escapeHtml, formatSats } from "./util";

export type EndowmentShell = (inner: string) => string;

const API = () => WORKERS_API.replace(/\/$/, "");
const ACTIVE = new Set([
  "listed",
  "funding",
  "claimable",
  "claimed",
  "in_review",
]);

type EndowmentPublic = {
  address: string | null;
  configured: boolean;
  display_balance_sats: number;
  display_updated_at: string;
  funded_proposal_ids: string[];
  lightning_available: boolean;
};

async function fetchEndowment(): Promise<EndowmentPublic> {
  const res = await fetch(`${API()}/endowment`);
  if (!res.ok) throw new Error(`Could not load endowment (${res.status})`);
  return (await res.json()) as EndowmentPublic;
}

function heroHtml(opts: {
  configured: boolean;
  displayBalance: number;
  updated: string;
}): string {
  const balance =
    opts.configured
      ? `<p class="endowment-hero-balance mono">${escapeHtml(formatSats(opts.displayBalance))}${
          opts.updated
            ? ` <span class="endowment-hero-balance-meta">published · ${escapeHtml(opts.updated)}</span>`
            : ` <span class="endowment-hero-balance-meta">published</span>`
        }</p>`
      : "";
  const cta = opts.configured
    ? `<div class="landing-cta-row">
        <a class="btn landing-btn" href="#donate">Donate</a>
        <a class="btn ghost landing-btn" href="#funded">Funded projects</a>
      </div>`
    : `<p class="endowment-hero-closed muted">Donations open once the endowment address is set.</p>`;

  return `<section class="endowment-hero">
    <div class="endowment-hero-bg" aria-hidden="true"></div>
    <div class="wrap-wide endowment-hero-inner">
      <h1 class="landing-brand">Endowment</h1>
      <p class="landing-title">Support open Bitcoin work from one shared pool.</p>
      <p class="landing-sub">Anonymous by default. Send Bitcoin to the endowment address below.</p>
      ${balance}
      ${cta}
    </div>
  </section>`;
}

function fundedCardsHtml(
  proposals: Proposal[],
  lightningEnabled: boolean,
): string {
  if (!proposals.length) {
    return `<div class="endowment-funded-empty">
      <p class="muted">No endowment-funded projects listed yet.</p>
      <p><a href="${projectsHref()}">Browse open projects →</a></p>
    </div>`;
  }
  return `<div class="project-grid endowment-funded-grid">${proposals
    .map((p) => proposalCardHtml(p, CLAIM_FLOOR_SATS, lightningEnabled, false))
    .join("")}</div>`;
}

function contributeHtml(address: string, lnOk: boolean): string {
  return `<section class="wrap-wide endowment-contribute" id="donate">
    <div class="endowment-donate-layout">
      <div class="endowment-donate-copy">
        <h2>Donate</h2>
        <p>Send Bitcoin on-chain${lnOk ? " or Lightning" : ""}. The displayed total updates when admins publish it — not automatically from your payment.</p>
      </div>
      <div class="donate-panel endowment-donate" data-endowment-donate>
        <div class="donate-rails" role="tablist">
          <button type="button" class="donate-rail active" data-rail="onchain">On-chain</button>
          ${
            lnOk
              ? `<button type="button" class="donate-rail" data-rail="ln">Lightning</button>`
              : ""
          }
        </div>
        <div data-endowment-rail="onchain" class="endowment-onchain">
          <img id="endowment-qr" alt="Bitcoin payment QR" width="200" height="200" />
          <p class="mono endowment-addr">${escapeHtml(address)}</p>
          <p class="donate-actions">
            <a class="btn" id="endowment-wallet" href="${escapeHtml(bitcoinUri(address, null))}">Open wallet</a>
            <button type="button" class="btn ghost" id="endowment-copy">Copy address</button>
          </p>
          <p class="muted" id="endowment-onchain-status" aria-live="polite"></p>
        </div>
        ${
          lnOk
            ? `<div data-endowment-rail="ln" hidden>
          <label>Amount (sats)
            <input type="number" id="endowment-ln-amount" min="1" step="1" inputmode="numeric" />
          </label>
          <button type="button" class="btn" id="endowment-ln-pay">Create invoice</button>
          <p class="muted" id="endowment-ln-status" aria-live="polite"></p>
          <p class="mono" id="endowment-ln-bolt11" hidden></p>
        </div>`
            : ""
        }
      </div>
    </div>
  </section>`;
}

function bindContribute(root: ParentNode, address: string): void {
  const copy = root.querySelector<HTMLButtonElement>("#endowment-copy");
  copy?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(address);
      const st = root.querySelector("#endowment-onchain-status");
      if (st) st.textContent = "Address copied.";
    } catch {
      /* ignore */
    }
  });

  const qr = root.querySelector<HTMLImageElement>("#endowment-qr");
  void QRCode.toDataURL(bitcoinUri(address, null), { width: 200, margin: 1 }).then(
    (url) => {
      if (qr) qr.src = url;
    },
  );

  watchConfirmedBalance(
    address,
    () => {
      const st = root.querySelector("#endowment-onchain-status");
      if (st) {
        st.textContent =
          "Payment seen on-chain. The published total updates when admins refresh it.";
      }
    },
    { intervalMs: 12_000 },
  );

  root.querySelectorAll<HTMLButtonElement>(".donate-rail").forEach((btn) => {
    btn.addEventListener("click", () => {
      const rail = btn.dataset.rail || "onchain";
      root.querySelectorAll(".donate-rail").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      root.querySelectorAll<HTMLElement>("[data-endowment-rail]").forEach((el) => {
        el.hidden = el.dataset.endowmentRail !== rail;
      });
    });
  });

  const lnBtn = root.querySelector<HTMLButtonElement>("#endowment-ln-pay");
  lnBtn?.addEventListener("click", async () => {
    const amount = Number(
      root.querySelector<HTMLInputElement>("#endowment-ln-amount")?.value,
    );
    const status = root.querySelector("#endowment-ln-status");
    const boltEl = root.querySelector<HTMLElement>("#endowment-ln-bolt11");
    if (!Number.isFinite(amount) || amount <= 0) {
      if (status) status.textContent = "Enter a positive amount in sats.";
      return;
    }
    if (status) status.textContent = "Creating invoice…";
    try {
      const swap = await createEndowmentLightningInvoice({
        amount_sats: Math.floor(amount),
        escrow_address: address,
      });
      if (boltEl) {
        boltEl.hidden = false;
        boltEl.textContent = swap.bolt11;
      }
      if (status) {
        status.textContent = `Invoice created. Expected on-chain: ${formatSats(swap.expected_onchain_sats)}.`;
      }
      try {
        await weblnPay(swap.bolt11);
      } catch {
        /* manual pay */
      }
      const poll = window.setInterval(async () => {
        try {
          const s = await fetchLightningSwap(swap.swap_id);
          if (String(s.status).includes("settle") || s.claim_txid) {
            window.clearInterval(poll);
            if (status) {
              status.textContent =
                "Lightning settled. The published total updates when admins refresh it.";
            }
          }
        } catch {
          /* ignore */
        }
      }, 4000);
    } catch (e) {
      if (status) status.textContent = (e as Error).message;
    }
  });
}

function scrollToHashTarget(): void {
  const hash = location.hash.replace(/^#/, "");
  const fromQuery = new URLSearchParams(location.search).has("donate")
    ? "donate"
    : "";
  const id = hash || fromQuery;
  if (!id) return;
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
}

export async function renderEndowment(shell: EndowmentShell): Promise<void> {
  applySeo(seoForRoute({ name: "endowment" }));
  const app = document.querySelector("#app")!;
  if (!WORKERS_API) {
    app.innerHTML = shell(
      `<section class="wrap-wide"><p class="muted">Workers API not configured.</p></section>`,
    );
    return;
  }

  app.innerHTML = shell(`
    ${heroHtml({ configured: false, displayBalance: 0, updated: "" })}
    <section class="wrap-wide endowment-page">
      <p class="muted">Loading…</p>
    </section>
  `);

  try {
    const [view, listed, lnStatus] = await Promise.all([
      fetchEndowment(),
      listListedProposals().catch(() => [] as Proposal[]),
      lightningUiAllowed()
        ? fetchLightningStatus()
        : Promise.resolve({ enabled: false }),
    ]);
    const fundedSet = new Set(
      view.funded_proposal_ids.map((id) => id.trim().toLowerCase()),
    );
    const funded = listed.filter(
      (p) =>
        p.id &&
        fundedSet.has(p.id.trim().toLowerCase()) &&
        ACTIVE.has(String(p.status)),
    );
    const lnOk = Boolean(view.lightning_available && lnStatus.enabled);
    const updated = view.display_updated_at
      ? view.display_updated_at.slice(0, 10)
      : "";
    const open = Boolean(view.configured && view.address);

    app.innerHTML = shell(`
      ${heroHtml({
        configured: open,
        displayBalance: view.display_balance_sats,
        updated,
      })}
      ${
        open && view.address
          ? contributeHtml(view.address, lnOk)
          : `<section class="wrap-wide endowment-contribute"><p class="muted">Donations are not open yet.</p></section>`
      }
      <section class="wrap-wide endowment-funded" id="funded">
        <h2>Funded projects</h2>
        ${fundedCardsHtml(funded, lnOk)}
      </section>
    `);

    if (view.address) bindContribute(app, view.address);
    const fundedRoot = app.querySelector("#funded");
    if (fundedRoot) {
      bindCardWatches(fundedRoot, new Set());
      void hydrateAvatarSlots(fundedRoot);
    }
    scrollToHashTarget();
  } catch (e) {
    const msg = (e as Error).message || "Could not load endowment";
    const looksLikeApiDown = /\b(404|502|503)\b/.test(msg);
    app.innerHTML = shell(`
      ${heroHtml({ configured: false, displayBalance: 0, updated: "" })}
      <section class="wrap-wide endowment-page">
        <p class="error">${escapeHtml(msg)}</p>
        ${
          looksLikeApiDown
            ? `<p class="muted">The Workers API has not published this route yet — try again after deploy. Login is not required to view the endowment.</p>`
            : `<p>${loginMenuHtml(currentReturnPath())}</p>`
        }
      </section>
    `);
  }
}
