import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Proposal } from "./types";

vi.mock("qrcode", () => ({
  default: {
    toDataURL: vi.fn(async () => "data:image/png;base64,qq"),
  },
}));

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return {
    ...actual,
    BITCOIN_NETWORK: "mainnet",
    lightningUiAllowed: () => true,
    MEMPOOL_API: "https://mempool.test/api",
    WORKERS_API: "https://api.test",
  };
});

const addressUtxos = vi.fn();
vi.mock("./mempool", () => ({
  addressBalanceSats: vi.fn(async () => 0),
  addressUtxos: (...args: unknown[]) => addressUtxos(...args),
  watchConfirmedBalance: () => ({
    stop: () => {},
    ready: Promise.resolve(),
  }),
}));

const fetchLightningStatus = vi.fn();
const createLightningInvoice = vi.fn();
const fetchLightningSwap = vi.fn();
const weblnPay = vi.fn();
vi.mock("./lightning", () => ({
  fetchLightningStatus: (...args: unknown[]) => fetchLightningStatus(...args),
  createLightningInvoice: (...args: unknown[]) => createLightningInvoice(...args),
  fetchLightningSwap: (...args: unknown[]) => fetchLightningSwap(...args),
  weblnPay: (...args: unknown[]) => weblnPay(...args),
}));

const recordContribution = vi.fn();
const claimContributionWithRetry = vi.fn();
vi.mock("./funder-credit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./funder-credit")>();
  return {
    ...actual,
    recordContribution: (...args: unknown[]) => recordContribution(...args),
    claimContributionWithRetry: (...args: unknown[]) =>
      claimContributionWithRetry(...args),
  };
});

import {
  bindDonateModal,
  bindDonatePanel,
  donateModalHtml,
  donateTriggerHtml,
} from "./proposal-ui";

const proposal = {
  id: "PLEBLY-42",
  path: "proposals/demo.md",
  escrow_address: "bc1qdonateescrowxxxxxxxxxxxxxxxxxxxx",
  title: "Demo",
} as Proposal;

const storage = new Map<string, string>();

function mountDonate(opts?: { signedIn?: boolean; open?: boolean }) {
  document.body.innerHTML = `
    ${donateTriggerHtml()}
    ${donateModalHtml(proposal, { signedIn: Boolean(opts?.signedIn) })}
  `;
  bindDonateModal(document, {
    open: opts?.open,
  });
  return document.body;
}

async function bindSignedInPanel(extra?: {
  onCreditLinked?: () => void;
}): Promise<void> {
  await bindDonatePanel(document, {
    address: proposal.escrow_address!,
    proposalId: proposal.id,
    proposalPath: proposal.path,
    signedIn: true,
    utxoPollMs: 100,
    onCreditLinked: extra?.onCreditLinked,
  });
}

function continueToPay(): void {
  document.querySelector<HTMLButtonElement>("#donate-credit-continue")!.click();
}

beforeEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
  document.body.className = "";
  storage.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, v),
    removeItem: (k: string) => storage.delete(k),
    clear: () => storage.clear(),
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/contributions/mine/")) {
        return new Response(JSON.stringify({ contributions: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }),
  );
  addressUtxos.mockReset();
  addressUtxos.mockResolvedValue([]);
  recordContribution.mockReset();
  recordContribution.mockResolvedValue(undefined);
  claimContributionWithRetry.mockReset();
  claimContributionWithRetry.mockResolvedValue(undefined);
  fetchLightningStatus.mockReset();
  fetchLightningStatus.mockResolvedValue({
    enabled: true,
    limits: { maximal: 10_000_000, minimal: 25_000 },
    fees: { percentage: 0.5, minerFees: { claim: 500, lockup: 0 } },
  });
  createLightningInvoice.mockReset();
  fetchLightningSwap.mockReset();
  weblnPay.mockReset();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      origin: "https://plebly.fund",
      pathname: "/p/PLEBLY-42",
      search: "",
      hash: "",
      href: "https://plebly.fund/p/PLEBLY-42",
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("donate wizard steps", () => {
  it("starts on funder credit preferences", async () => {
    mountDonate({ signedIn: true, open: true });
    await bindSignedInPanel();
    await vi.waitFor(() => {
      expect(document.querySelector("#donate")?.getAttribute("data-donate-step")).toBe(
        "credit",
      );
    });
    expect(document.querySelector("#donate-step-credit")?.hidden).toBe(false);
    expect(document.querySelector("#donate-step-pay")?.hidden).toBe(true);
    expect(document.querySelector("#donate-modal-title")?.textContent).toContain(
      "Funder credit",
    );
    expect(document.querySelector("#donate-credit-public")).toBeTruthy();
    expect(document.querySelector("#donate-credit-continue")?.textContent).toContain(
      "Continue to payment",
    );
  });

  it("continues to the payment step and can return to edit prefs", async () => {
    mountDonate({ signedIn: true, open: true });
    await bindSignedInPanel();
    await vi.waitFor(() =>
      expect(document.querySelector("#donate-credit-continue")).toBeTruthy(),
    );

    document.querySelector<HTMLInputElement>("#donate-credit-amount")!.checked = true;
    continueToPay();

    expect(document.querySelector("#donate")?.getAttribute("data-donate-step")).toBe(
      "pay",
    );
    expect(document.querySelector("#donate-step-pay")?.hidden).toBe(false);
    expect(document.querySelector("#donate-step-credit")?.hidden).toBe(true);
    expect(document.querySelector("#donate-credit-summary")?.textContent).toContain(
      "public identity + amount",
    );

    document.querySelector<HTMLButtonElement>("#donate-credit-edit")!.click();
    expect(document.querySelector("#donate")?.getAttribute("data-donate-step")).toBe(
      "credit",
    );
    expect(document.querySelector("#donate-step-credit")?.hidden).toBe(false);
  });

  it("skips credit step when preferences were already saved", async () => {
    storage.set(
      "plebly_funder_credit_prefs",
      JSON.stringify({
        public_credit: true,
        anonymous: false,
        show_amount: false,
        chosen: true,
      }),
    );
    mountDonate({ signedIn: true, open: true });
    await bindSignedInPanel();
    await vi.waitFor(() => {
      expect(document.querySelector("#donate")?.getAttribute("data-donate-step")).toBe(
        "pay",
      );
    });
    expect(document.querySelector("#donate-step-pay")?.hidden).toBe(false);
    expect(document.querySelector("#donate-credit-summary")?.textContent).toContain(
      "public identity, amount hidden",
    );
  });

  it("skips credit step when mine contributions already have prefs", async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/contributions/mine/")) {
        return new Response(
          JSON.stringify({
            contributions: [
              {
                txid: "a".repeat(64),
                vout: 0,
                amount_sats: 21_000,
                confirmed: true,
                public_credit: false,
                anonymous: true,
                show_amount: false,
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    mountDonate({ signedIn: true, open: true });
    await bindSignedInPanel();
    await vi.waitFor(() => {
      expect(document.querySelector("#donate")?.getAttribute("data-donate-step")).toBe(
        "pay",
      );
    });
    expect(document.querySelector("#donate-credit-summary")?.textContent).toContain(
      "anonymous",
    );
  });
});

describe("donate modal UX", () => {
  it("opens from trigger and closes via button, backdrop, and Escape", async () => {
    mountDonate({ signedIn: false });
    await bindDonatePanel(document, {
      address: proposal.escrow_address!,
      proposalId: proposal.id,
      proposalPath: proposal.path,
      signedIn: false,
    });

    const modal = document.querySelector<HTMLElement>("#donate-modal")!;
    expect(modal.hidden).toBe(true);

    document.querySelector<HTMLButtonElement>("#donate-open")!.click();
    expect(modal.hidden).toBe(false);
    expect(document.body.classList.contains("modal-open")).toBe(true);

    document.querySelector<HTMLButtonElement>("#donate-close")!.click();
    expect(modal.hidden).toBe(true);

    document.querySelector<HTMLButtonElement>("#donate-open")!.click();
    document.querySelector<HTMLElement>("[data-close-donate]")!.click();
    expect(modal.hidden).toBe(true);

    document.querySelector<HTMLButtonElement>("#donate-open")!.click();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(modal.hidden).toBe(true);
  });

  it("switches rails on the payment step", async () => {
    mountDonate({ signedIn: true, open: true });
    await bindSignedInPanel();
    await vi.waitFor(() =>
      expect(document.querySelector("#donate-credit-continue")).toBeTruthy(),
    );
    continueToPay();

    const onchainPane = document.querySelector<HTMLElement>('[data-pane="onchain"]')!;
    const lnPane = document.querySelector<HTMLElement>('[data-pane="lightning"]')!;
    expect(onchainPane.hidden).toBe(false);
    expect(lnPane.hidden).toBe(true);

    document.querySelector<HTMLButtonElement>("#donate-rail-lightning")!.click();
    expect(onchainPane.hidden).toBe(true);
    expect(lnPane.hidden).toBe(false);
  });

  it("updates on-chain wallet URI when amount presets are chosen", async () => {
    mountDonate({ signedIn: true, open: true });
    await bindSignedInPanel();
    await vi.waitFor(() =>
      expect(document.querySelector("#donate-credit-continue")).toBeTruthy(),
    );
    continueToPay();

    const wallet = document.querySelector<HTMLAnchorElement>("#donate-wallet")!;
    const amount = document.querySelector<HTMLInputElement>("#donate-amount")!;
    document
      .querySelector<HTMLButtonElement>('.donate-preset[data-rail="onchain"][data-sats="50000"]')!
      .click();
    expect(amount.value).toBe("50000");
    expect(wallet.href).toContain("amount=0.0005");
  });
});

describe("donate credit UX (signed out)", () => {
  it("offers sign-in on credit step and continues anonymously", async () => {
    mountDonate({ signedIn: false, open: true });
    await bindDonatePanel(document, {
      address: proposal.escrow_address!,
      proposalId: proposal.id,
      proposalPath: proposal.path,
      signedIn: false,
      utxoPollMs: 100,
    });

    await vi.waitFor(() => {
      expect(document.querySelector("#donate-step-credit")?.hidden).toBe(false);
    });
    expect(document.querySelector("#donate-modal-title")?.textContent).toContain(
      "Sign in",
    );
    expect(document.body.textContent).toContain("GitHub");
    expect(document.body.textContent).toContain("Nostr");
    expect(document.querySelector("#donate-credit-public")).toBeNull();
    expect(document.querySelector("#donate-credit-continue")?.textContent).toContain(
      "Continue anonymously",
    );

    continueToPay();
    expect(document.querySelector("#donate")?.getAttribute("data-donate-step")).toBe(
      "pay",
    );
    // Anonymous pay still polls for confirmation status (no credit-claim UI).
    await vi.waitFor(() => {
      expect(addressUtxos).toHaveBeenCalled();
    });
    expect(document.querySelector("#donate-credit-claim")?.hasAttribute("hidden")).toBe(
      true,
    );
  });
});

describe("donate credit UX (signed in, on-chain)", () => {
  it("watches only after continuing, then links credit with prefs", async () => {
    vi.useFakeTimers();
    const linked = vi.fn();
    const txid = "a".repeat(64);

    addressUtxos
      .mockResolvedValueOnce([])
      .mockResolvedValue([
        {
          txid,
          vout: 1,
          value: 50_000,
          status: { confirmed: false },
        },
      ]);

    mountDonate({ signedIn: true, open: true });
    await bindSignedInPanel({ onCreditLinked: linked });
    await vi.waitFor(() =>
      expect(document.querySelector("#donate-credit-continue")).toBeTruthy(),
    );
    expect(addressUtxos).not.toHaveBeenCalled();

    document.querySelector<HTMLInputElement>("#donate-credit-amount")!.checked = true;
    continueToPay();

    await vi.waitFor(() => {
      expect(document.querySelector("#donate-watch-hint")?.textContent).toContain(
        "detected automatically",
      );
    });
    expect(document.querySelector("#donate-confirm-status")?.hidden).toBe(true);
    expect(
      document.querySelector("#donate-credit-status")?.textContent || "",
    ).not.toContain("Watching");

    await vi.advanceTimersByTimeAsync(100);
    await vi.waitFor(() => {
      expect(recordContribution).toHaveBeenCalled();
      expect(claimContributionWithRetry).toHaveBeenCalledWith({
        proposal_id: "PLEBLY-42",
        txid,
        vout: 1,
        public_credit: true,
        anonymous: false,
        show_amount: true,
      });
      expect(linked).toHaveBeenCalled();
      expect(document.querySelector("#donate-confirm-status")?.textContent).toContain(
        "Credit linked",
      );
    });
  });
});

describe("donate credit UX (signed in, Lightning)", () => {
  it("auto-links credit after settle using saved prefs", async () => {
    vi.useFakeTimers();
    const linked = vi.fn();
    createLightningInvoice.mockResolvedValue({
      swap_id: "swap-abc",
      proposal_id: "PLEBLY-42",
      escrow_address: proposal.escrow_address,
      invoice_amount_sats: 50_000,
      expected_onchain_sats: 49_000,
      fee_sats: 1_000,
      bolt11: "lnbc50u1ptest",
      status: "pending",
    });
    fetchLightningSwap.mockResolvedValue({
      swap_id: "swap-abc",
      proposal_id: "PLEBLY-42",
      escrow_address: proposal.escrow_address,
      invoice_amount_sats: 50_000,
      expected_onchain_sats: 49_000,
      fee_sats: 1_000,
      bolt11: "lnbc50u1ptest",
      status: "settled",
      claim_txid: "d".repeat(64),
    });

    mountDonate({ signedIn: true, open: true });
    await bindSignedInPanel({ onCreditLinked: linked });
    await vi.waitFor(() =>
      expect(document.querySelector("#donate-credit-continue")).toBeTruthy(),
    );
    continueToPay();

    document.querySelector<HTMLButtonElement>("#donate-rail-lightning")!.click();
    document.querySelector<HTMLInputElement>("#donate-ln-amount")!.value = "50000";
    document.querySelector<HTMLButtonElement>("#donate-ln-create")!.click();

    await vi.waitFor(() => expect(createLightningInvoice).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(4000);
    await vi.waitFor(() => {
      expect(claimContributionWithRetry).toHaveBeenCalledWith(
        expect.objectContaining({
          proposal_id: "PLEBLY-42",
          swap_id: "swap-abc",
        }),
      );
      expect(linked).toHaveBeenCalled();
    });
  });
});

describe("donate markup contract", () => {
  it("keeps credit and pay as separate steps in the modal shell", () => {
    const html = donateModalHtml(proposal, { signedIn: true });
    expect(html).toContain('data-donate-step="credit"');
    expect(html).toContain('id="donate-step-credit"');
    expect(html).toContain('id="donate-step-pay"');
    expect(html).toContain("Continue to payment");
    expect(html).toContain("Change credit preferences");
    expect(html).toContain('id="donate-credit-public"');
    expect(html).toContain('data-tab="onchain"');
    expect(html).toContain('data-tab="lightning"');
  });
});
