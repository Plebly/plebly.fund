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

function fundedCardsHtml(
  proposals: Proposal[],
  lightningEnabled: boolean,
): string {
  if (!proposals.length) {
    return `<div class="endowment-funded-empty">
      <p class="muted">No active endowment-funded projects right now. Admins mark supported work from the platform console; direct donations to a project escrow still go to that project.</p>
      <p class="landing-cta-row">
        <a class="btn ghost" href="${projectsHref()}">Browse all projects</a>
        <a class="btn ghost" href="#donate">Contribute anyway</a>
      </p>
    </div>`;
  }
  return `<div class="project-grid endowment-funded-grid">${proposals
    .map((p) => proposalCardHtml(p, CLAIM_FLOOR_SATS, lightningEnabled, false))
    .join("")}</div>`;
}

function contributeHtml(address: string, lnOk: boolean): string {
  return `<section class="endowment-contribute" id="donate">
    <div class="landing-section-head">
      <h2>Contribute</h2>
      <p>Contributions are anonymous by default. Funds go to the endowment wallet — not a per-project escrow.</p>
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
      <div data-endowment-rail="onchain">
        <p class="mono endowment-addr">${escapeHtml(address)}</p>
        <img id="endowment-qr" alt="Bitcoin payment QR" width="168" height="168" />
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
          : `<p class="muted">Lightning is unavailable on this network.</p>`
      }
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
  const wallet = root.querySelector<HTMLAnchorElement>("#endowment-wallet");
  void QRCode.toDataURL(bitcoinUri(address, null), { width: 168, margin: 1 }).then(
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
          "Confirmed balance increased. Displayed endowment total updates when admins publish it.";
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
                "Lightning settled into the endowment address. Displayed total is admin-authored.";
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

  void wallet;
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
    <section class="wrap-wide endowment-page">
      <header class="endowment-head">
        <p class="eyebrow"><a href="${href("/")}">Plebly</a> · Endowment</p>
        <h1>Endowment</h1>
        <p class="lede">A shared pool that supports open Bitcoin work. Contributions are anonymous by default.</p>
      </header>
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

    app.innerHTML = shell(`
      <section class="wrap-wide endowment-page">
        <header class="endowment-head">
          <p class="eyebrow"><a href="${href("/")}">Plebly</a> · Endowment</p>
          <h1>Endowment</h1>
          <p class="lede">A shared pool that supports open Bitcoin work. Contributions are anonymous by default.</p>
          ${
            view.configured && view.address
              ? `<p class="landing-cta-row"><a class="btn" href="#donate">Contribute</a><a class="btn ghost" href="#funded">Funded projects</a></p>`
              : ""
          }
        </header>

        <div class="endowment-balance" aria-live="polite">
          <p class="endowment-balance-label">Displayed balance</p>
          <p class="endowment-balance-value mono">${escapeHtml(formatSats(view.display_balance_sats))}</p>
          <p class="endowment-balance-trust muted">
            Admin-published display${updated ? ` · last updated ${escapeHtml(updated)}` : ""} · not a live chain proof.
            On-chain sends go to the address below; they do not auto-update this number.
          </p>
        </div>

        ${
          view.configured && view.address
            ? contributeHtml(view.address, lnOk)
            : `<p class="muted endowment-closed">Contributions are not open yet — endowment address not configured.</p>`
        }

        <section class="endowment-funded" id="funded">
          <div class="landing-section-head">
            <h2>Projects currently funded</h2>
            <p>Active work marked as endowment-supported. Direct donations to a project escrow still go to that project.</p>
          </div>
          ${fundedCardsHtml(funded, lnOk)}
        </section>

        <section class="endowment-differs">
          <div class="landing-section-head">
            <h2>How it differs</h2>
            <p>The endowment is a shared receive address. Project escrow is per-proposal, public, and claimable by builders.</p>
          </div>
          <ul class="endowment-differs-list">
            <li><strong>Pool vs escrow.</strong> Endowment contributions fund the shared wallet. Project donations fund that project’s on-chain address.</li>
            <li><strong>Attribution only.</strong> “Endowment-funded” on a project is a public label — the app does not transfer endowment sats into project escrow.</li>
            <li><strong>Published total.</strong> The number above is set by platform admins for donors; verify the receive address on-chain if you need chain proof.</li>
          </ul>
          <p class="landing-how-link"><a href="${href("/about")}#endowment">Read more in About →</a></p>
        </section>
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
      <section class="wrap-wide endowment-page">
        <header class="endowment-head">
          <p class="eyebrow"><a href="${href("/")}">Plebly</a> · Endowment</p>
          <h1>Endowment</h1>
        </header>
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
