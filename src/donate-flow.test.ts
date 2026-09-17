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
const createEndowmentLightningInvoice = vi.fn();
const fetchLightningSwap = vi.fn();
const weblnPay = vi.fn();
vi.mock("./lightning", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lightning")>();
  return {
    ...actual,
    fetchLightningStatus: (...args: unknown[]) => fetchLightningStatus(...args),
    createLightningInvoice: (...args: unknown[]) => createLightningInvoice(...args),
    createEndowmentLightningInvoice: (...args: unknown[]) =>
      createEndowmentLightningInvoice(...args),
    fetchLightningSwap: (...args: unknown[]) => fetchLightningSwap(...args),
    weblnPay: (...args: unknown[]) => weblnPay(...args),
  };
});

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
import { nextActionPrimaryHtml } from "./next-action";

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
  sessionStorage.clear();
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
    processor: "opennode",
    limits: { maximal: 10_000_000, minimal: 25_000 },
    sweep: { chain_min_sats: 200_000, pending_min_sats: 207_000, fee_bps: 100 },
  });
  createLightningInvoice.mockReset();
  createEndowmentLightningInvoice.mockReset();
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

  it("opens from the next-action card primary via data-open-donate", async () => {
    document.body.innerHTML = `
      ${nextActionPrimaryHtml({ sentence: "Still raising.", button: "donate", moreIds: [] })}
      ${donateModalHtml(proposal, { signedIn: true })}
    `;
    bindDonateModal(document);
    await bindDonatePanel(document, {
      address: proposal.escrow_address!,
      proposalId: proposal.id,
      proposalPath: proposal.path,
      signedIn: true,
    });
    const modal = document.querySelector<HTMLElement>("#donate-modal")!;
    expect(modal.hidden).toBe(true);
    document.querySelector<HTMLButtonElement>("[data-open-donate]")!.click();
    expect(modal.hidden).toBe(false);
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
      "Get credit for this donation",
    );
    expect(document.body.textContent).toContain("GitHub");
    expect(document.body.textContent).toContain("Nostr");
    expect(document.querySelector(".donate-credit-advisory")).toBeTruthy();
    expect(document.body.textContent).toContain("more options later");
    expect(document.body.textContent).toContain("flag a close");
    expect(document.querySelector("#donate-credit-public")).toBeNull();
    expect(document.querySelector("#donate-credit-continue")?.textContent).toContain(
      "Continue anonymously",
    );

    continueToPay();
    expect(document.querySelector("#donate")?.getAttribute("data-donate-step")).toBe(
      "pay",
    );
    expect(document.querySelector("#donate-step-pay .donate-credit-advisory")).toBeTruthy();
    document.querySelector<HTMLButtonElement>("#donate-credit-signin")!.click();
    expect(document.querySelector("#donate")?.getAttribute("data-donate-step")).toBe(
      "credit",
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
      expect(claimContributionWithRetry).toHaveBeenCalledWith(
        expect.objectContaining({
          proposal_id: "PLEBLY-42",
          txid,
          vout: 1,
          public_credit: true,
          anonymous: false,
          show_amount: true,
          proposal_path: "proposals/demo.md",
        }),
      );
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
    await vi.advanceTimersByTimeAsync(8000);
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

  it("does not link credit while OpenNode is still waiting to sweep", async () => {
    vi.useFakeTimers();
    const linked = vi.fn();
    createLightningInvoice.mockResolvedValue({
      swap_id: "chg-wait",
      proposal_id: "PLEBLY-42",
      escrow_address: proposal.escrow_address,
      invoice_amount_sats: 50_000,
      expected_onchain_sats: 0,
      fee_sats: 0,
      bolt11: "lnbc50u1ptest",
      status: "pending",
    });
    fetchLightningSwap.mockResolvedValue({
      swap_id: "chg-wait",
      proposal_id: "PLEBLY-42",
      escrow_address: proposal.escrow_address,
      invoice_amount_sats: 50_000,
      expected_onchain_sats: 0,
      fee_sats: 0,
      bolt11: "lnbc50u1ptest",
      status: "invoice_paid",
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
    await vi.advanceTimersByTimeAsync(8000);
    await vi.waitFor(() => {
      expect(document.querySelector("#donate-ln-status")?.textContent).toMatch(
        /batched on-chain sweep/i,
      );
    });
    expect(claimContributionWithRetry).not.toHaveBeenCalled();
    expect(linked).not.toHaveBeenCalled();
  });
});

describe("donate Lightning OpenNode UX", () => {
  it("shows processor unavailable copy", async () => {
    fetchLightningStatus.mockResolvedValue({
      enabled: false,
      reason: "OPENNODE_API_KEY not set",
    });
    mountDonate({ signedIn: true, open: true });
    await bindSignedInPanel();
    await vi.waitFor(() =>
      expect(document.querySelector("#donate-credit-continue")).toBeTruthy(),
    );
    continueToPay();
    document.querySelector<HTMLButtonElement>("#donate-rail-lightning")!.click();
    expect(document.querySelector("#donate-ln-wait")?.textContent).toContain(
      "OPENNODE_API_KEY",
    );
    expect(document.querySelector("#donate-ln-ready")?.hidden).toBe(true);
  });

  it("requires sign-in on project invoices", async () => {
    mountDonate({ signedIn: false, open: true });
    await bindDonatePanel(document, {
      address: proposal.escrow_address!,
      proposalId: proposal.id,
      proposalPath: proposal.path,
      signedIn: false,
    });
    continueToPay();
    document.querySelector<HTMLButtonElement>("#donate-rail-lightning")!.click();
    expect(document.querySelector("#donate-ln-login")?.hidden).toBe(false);
    const create = document.querySelector<HTMLButtonElement>("#donate-ln-create")!;
    expect(create.disabled).toBe(true);
    expect(create.textContent).toMatch(/Sign in/i);
    document.querySelector<HTMLInputElement>("#donate-ln-amount")!.value = "50000";
    create.click();
    expect(createLightningInvoice).not.toHaveBeenCalled();
  });

  it("rejects amounts outside OpenNode limits", async () => {
    mountDonate({ signedIn: true, open: true });
    await bindSignedInPanel();
    await vi.waitFor(() =>
      expect(document.querySelector("#donate-credit-continue")).toBeTruthy(),
    );
    continueToPay();
    document.querySelector<HTMLButtonElement>("#donate-rail-lightning")!.click();
    const amount = document.querySelector<HTMLInputElement>("#donate-ln-amount")!;
    const create = document.querySelector<HTMLButtonElement>("#donate-ln-create")!;
    amount.value = "1000";
    create.click();
    expect(createLightningInvoice).not.toHaveBeenCalled();
    expect(document.querySelector("#donate-ln-error")?.textContent).toMatch(
      /at least/i,
    );
    amount.value = "20000000";
    create.click();
    expect(createLightningInvoice).not.toHaveBeenCalled();
    expect(document.querySelector("#donate-ln-error")?.textContent).toMatch(
      /at most/i,
    );
  });

  it("hides the compose form and waits for payment after invoice create", async () => {
    createLightningInvoice.mockResolvedValue({
      swap_id: "chg-wait",
      proposal_id: "PLEBLY-42",
      escrow_address: proposal.escrow_address,
      invoice_amount_sats: 50_000,
      expected_onchain_sats: 0,
      fee_sats: 0,
      bolt11: "lnbc50u1ptest",
      status: "pending",
    });
    mountDonate({ signedIn: true, open: true });
    await bindSignedInPanel();
    await vi.waitFor(() =>
      expect(document.querySelector("#donate-credit-continue")).toBeTruthy(),
    );
    continueToPay();
    document.querySelector<HTMLButtonElement>("#donate-rail-lightning")!.click();
    document.querySelector<HTMLInputElement>("#donate-ln-amount")!.value = "50000";
    document.querySelector<HTMLButtonElement>("#donate-ln-create")!.click();
    await vi.waitFor(() => {
      expect(document.querySelector("#donate-ln-status")?.textContent).toBe(
        "Waiting for payment.",
      );
    });
    expect(document.querySelector("#donate-ln-ready")?.getAttribute("data-ln-phase")).toBe(
      "wait",
    );
    expect(document.querySelector("#donate-ln-amount-echo")?.textContent).toMatch(
      /50,000/,
    );
    expect(document.querySelector("#donate-ln-invoice")?.hidden).toBe(false);
    document.querySelector<HTMLButtonElement>("#donate-ln-create")!.click();
    expect(createLightningInvoice).toHaveBeenCalledTimes(1);
  });

  it("restores an unpaid invoice instead of creating another", async () => {
    sessionStorage.setItem(
      `plebly:donate-receipt:${proposal.escrow_address}`,
      JSON.stringify({ rail: "lightning", swap_id: "chg-resume", at: Date.now() }),
    );
    fetchLightningSwap.mockResolvedValue({
      swap_id: "chg-resume",
      proposal_id: "PLEBLY-42",
      escrow_address: proposal.escrow_address,
      invoice_amount_sats: 50_000,
      expected_onchain_sats: 0,
      fee_sats: 0,
      bolt11: "lnbc50u1resume",
      status: "pending",
    });
    mountDonate({ signedIn: true, open: true });
    await bindSignedInPanel();
    await vi.waitFor(() =>
      expect(document.querySelector("#donate-credit-continue")).toBeTruthy(),
    );
    continueToPay();
    document.querySelector<HTMLButtonElement>("#donate-rail-lightning")!.click();
    await vi.waitFor(() => {
      expect(fetchLightningSwap).toHaveBeenCalledWith("chg-resume");
      expect(document.querySelector("#donate-ln-status")?.textContent).toBe(
        "Waiting for payment.",
      );
    });
    expect(createLightningInvoice).not.toHaveBeenCalled();
    expect(document.querySelector("#donate-ln-bolt11")?.textContent).toBe(
      "lnbc50u1resume",
    );
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
    expect(html).toContain("Legal name for tax receipt (optional)");
    expect(html).toContain('id="donate-legal-name"');
    expect(html).toContain('data-tab="onchain"');
    expect(html).toContain('data-tab="lightning"');
    expect(html).toContain("OpenNode");
    expect(html).toContain("payment id");
    expect(html).toContain('id="donate-ln-login"');
    expect(html).toContain('id="donate-ln-limits"');
    expect(html).toContain('id="donate-ln-compose"');
    expect(html).toContain('id="donate-ln-amount-echo"');
  });

  it("omits the legal-name field when signed out", () => {
    const html = donateModalHtml(proposal, { signedIn: false });
    expect(html).not.toContain("donate-legal-name");
    expect(html).not.toContain("Legal name for tax receipt");
  });
});
