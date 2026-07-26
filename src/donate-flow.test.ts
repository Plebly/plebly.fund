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

beforeEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
  document.body.className = "";
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
  document.body.innerHTML = "";
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
    expect(document.body.classList.contains("modal-open")).toBe(false);

    document.querySelector<HTMLButtonElement>("#donate-open")!.click();
    document.querySelector<HTMLElement>("[data-close-donate]")!.click();
    expect(modal.hidden).toBe(true);

    document.querySelector<HTMLButtonElement>("#donate-open")!.click();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(modal.hidden).toBe(true);
  });

  it("switches rails between on-chain and Lightning panes", async () => {
    mountDonate({ signedIn: true, open: true });
    await bindSignedInPanel();

    const onchainPane = document.querySelector<HTMLElement>('[data-pane="onchain"]')!;
    const lnPane = document.querySelector<HTMLElement>('[data-pane="lightning"]')!;
    expect(onchainPane.hidden).toBe(false);
    expect(lnPane.hidden).toBe(true);

    document.querySelector<HTMLButtonElement>("#donate-rail-lightning")!.click();
    expect(onchainPane.hidden).toBe(true);
    expect(lnPane.hidden).toBe(false);
    expect(
      document.querySelector("#donate-rail-lightning")?.getAttribute("aria-selected"),
    ).toBe("true");

    document.querySelector<HTMLButtonElement>("#donate-rail-onchain")!.click();
    expect(onchainPane.hidden).toBe(false);
    expect(lnPane.hidden).toBe(true);
  });

  it("updates on-chain wallet URI when amount presets are chosen", async () => {
    mountDonate({ signedIn: true, open: true });
    await bindSignedInPanel();

    const wallet = document.querySelector<HTMLAnchorElement>("#donate-wallet")!;
    const amount = document.querySelector<HTMLInputElement>("#donate-amount")!;
    expect(wallet.href).toContain("bitcoin:bc1qdonateescrow");

    document
      .querySelector<HTMLButtonElement>('.donate-preset[data-rail="onchain"][data-sats="50000"]')!
      .click();
    expect(amount.value).toBe("50000");
    expect(wallet.href).toContain("amount=0.0005");
  });
});

describe("donate credit UX (signed out)", () => {
  it("offers sign-in and does not watch or claim", async () => {
    mountDonate({ signedIn: false, open: true });
    await bindDonatePanel(document, {
      address: proposal.escrow_address!,
      proposalId: proposal.id,
      proposalPath: proposal.path,
      signedIn: false,
      utxoPollMs: 100,
    });

    const credit = document.querySelector("#donate-credit")!;
    expect(credit.textContent).toContain("Sign in before or after paying");
    expect(credit.querySelector(".login-choices, [data-nostr-login], a[href*='auth/github']")).toBeTruthy();
    expect(document.querySelector("#donate-credit-public")).toBeNull();
    expect(addressUtxos).not.toHaveBeenCalled();
  });
});

describe("donate credit UX (signed in, on-chain)", () => {
  it("shows preference controls and gates amount behind public identity", async () => {
    mountDonate({ signedIn: true, open: true });
    await bindSignedInPanel();

    const publicBox = document.querySelector<HTMLInputElement>("#donate-credit-public")!;
    const amountBox = document.querySelector<HTMLInputElement>("#donate-credit-amount")!;
    expect(publicBox.checked).toBe(true);
    expect(amountBox.disabled).toBe(false);

    amountBox.checked = true;
    publicBox.checked = false;
    publicBox.dispatchEvent(new Event("change"));
    expect(amountBox.checked).toBe(false);
    expect(amountBox.disabled).toBe(true);
  });

  it("watches for a new UTXO, then links credit with current prefs on confirm", async () => {
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

    await vi.waitFor(() => {
      expect(
        document.querySelector("#donate-credit-status")?.textContent,
      ).toContain("Watching for a new on-chain payment");
    });

    document.querySelector<HTMLInputElement>("#donate-credit-amount")!.checked = true;

    await vi.advanceTimersByTimeAsync(100);
    await vi.waitFor(() => {
      expect(document.querySelector("#donate-credit-claim")?.hidden).toBe(false);
    });

    const claim = document.querySelector("#donate-credit-claim")!;
    expect(claim.textContent).toContain("New payment detected");
    expect(claim.textContent).toContain("50,000 sats");
    expect(claim.querySelector("[data-claim-txid]")?.textContent).toContain("This was me");

    claim.querySelector<HTMLButtonElement>("[data-claim-txid]")!.click();

    await vi.waitFor(() => {
      expect(recordContribution).toHaveBeenCalledWith({
        proposal_id: "PLEBLY-42",
        txid,
        vout: 1,
        address: proposal.escrow_address,
      });
      expect(claimContributionWithRetry).toHaveBeenCalledWith({
        proposal_id: "PLEBLY-42",
        txid,
        vout: 1,
        public_credit: true,
        anonymous: false,
        show_amount: true,
      });
      expect(linked).toHaveBeenCalled();
    });

    expect(document.querySelector("#donate-credit-status")?.textContent).toContain(
      "Credit linked for 50,000 sats",
    );
    expect(document.querySelector("#donate-credit-claim")?.hidden).toBe(true);
  });

  it("surfaces claim errors in the credit status", async () => {
    vi.useFakeTimers();
    const txid = "b".repeat(64);
    addressUtxos
      .mockResolvedValueOnce([])
      .mockResolvedValue([
        { txid, vout: 0, value: 21_000, status: { confirmed: true } },
      ]);
    claimContributionWithRetry.mockRejectedValueOnce(
      new Error("contribution already claimed by another user"),
    );

    mountDonate({ signedIn: true, open: true });
    await bindSignedInPanel();
    await vi.waitFor(() =>
      expect(
        document.querySelector("#donate-credit-status")?.textContent,
      ).toContain("Watching"),
    );
    await vi.advanceTimersByTimeAsync(100);
    await vi.waitFor(() =>
      expect(document.querySelector("[data-claim-txid]")).toBeTruthy(),
    );

    document.querySelector<HTMLButtonElement>("[data-claim-txid]")!.click();
    await vi.waitFor(() => {
      expect(document.querySelector("#donate-credit-status")?.textContent).toContain(
        "already claimed",
      );
      expect(
        document.querySelector("#donate-credit-status")?.classList.contains("bad"),
      ).toBe(true);
    });
  });

  it("links anonymously when public identity is unchecked", async () => {
    vi.useFakeTimers();
    const txid = "c".repeat(64);
    addressUtxos
      .mockResolvedValueOnce([])
      .mockResolvedValue([
        { txid, vout: 0, value: 10_000, status: { confirmed: false } },
      ]);

    mountDonate({ signedIn: true, open: true });
    await bindSignedInPanel();
    await vi.waitFor(() =>
      expect(
        document.querySelector("#donate-credit-status")?.textContent,
      ).toContain("Watching"),
    );

    const publicBox = document.querySelector<HTMLInputElement>("#donate-credit-public")!;
    publicBox.checked = false;
    publicBox.dispatchEvent(new Event("change"));

    await vi.advanceTimersByTimeAsync(100);
    await vi.waitFor(() =>
      expect(document.querySelector("[data-claim-txid]")).toBeTruthy(),
    );
    document.querySelector<HTMLButtonElement>("[data-claim-txid]")!.click();

    await vi.waitFor(() => {
      expect(claimContributionWithRetry).toHaveBeenCalledWith(
        expect.objectContaining({
          public_credit: false,
          anonymous: true,
          show_amount: false,
        }),
      );
    });
  });
});

describe("donate credit UX (signed in, Lightning)", () => {
  it("creates an invoice, polls to settled, then auto-links credit", async () => {
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
    fetchLightningSwap
      .mockResolvedValueOnce({
        swap_id: "swap-abc",
        proposal_id: "PLEBLY-42",
        escrow_address: proposal.escrow_address,
        invoice_amount_sats: 50_000,
        expected_onchain_sats: 49_000,
        fee_sats: 1_000,
        bolt11: "lnbc50u1ptest",
        status: "invoice_paid",
      })
      .mockResolvedValue({
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

    document.querySelector<HTMLButtonElement>("#donate-rail-lightning")!.click();
    const amount = document.querySelector<HTMLInputElement>("#donate-ln-amount")!;
    amount.value = "50000";
    amount.dispatchEvent(new Event("input"));

    document.querySelector<HTMLButtonElement>("#donate-ln-create")!.click();
    await vi.waitFor(() => {
      expect(createLightningInvoice).toHaveBeenCalledWith(
        expect.objectContaining({
          proposal_id: "PLEBLY-42",
          amount_sats: 50_000,
        }),
      );
      expect(document.querySelector("#donate-ln-invoice")?.hidden).toBe(false);
      expect(document.querySelector("#donate-ln-bolt11")?.textContent).toBe(
        "lnbc50u1ptest",
      );
    });

    await vi.advanceTimersByTimeAsync(4000);
    await vi.waitFor(() => {
      expect(document.querySelector("#donate-ln-status")?.textContent).toContain(
        "Invoice paid",
      );
    });

    await vi.advanceTimersByTimeAsync(4000);
    await vi.waitFor(() => {
      expect(claimContributionWithRetry).toHaveBeenCalledWith({
        proposal_id: "PLEBLY-42",
        swap_id: "swap-abc",
        public_credit: true,
        anonymous: false,
        show_amount: false,
      });
      expect(linked).toHaveBeenCalled();
      expect(document.querySelector("#donate-credit-status")?.textContent).toContain(
        "Lightning credit linked",
      );
    });
  });

  it("shows a recoverable error when Lightning credit link fails", async () => {
    vi.useFakeTimers();
    createLightningInvoice.mockResolvedValue({
      swap_id: "swap-fail",
      proposal_id: "PLEBLY-42",
      escrow_address: proposal.escrow_address,
      invoice_amount_sats: 50_000,
      expected_onchain_sats: 49_000,
      fee_sats: 1_000,
      bolt11: "lnbc50u1fail",
      status: "pending",
    });
    fetchLightningSwap.mockResolvedValue({
      swap_id: "swap-fail",
      proposal_id: "PLEBLY-42",
      escrow_address: proposal.escrow_address,
      invoice_amount_sats: 50_000,
      expected_onchain_sats: 49_000,
      fee_sats: 1_000,
      bolt11: "lnbc50u1fail",
      status: "settled",
      claim_txid: "e".repeat(64),
    });
    claimContributionWithRetry.mockRejectedValue(
      new Error("contribution not found"),
    );

    mountDonate({ signedIn: true, open: true });
    await bindSignedInPanel();
    document.querySelector<HTMLButtonElement>("#donate-rail-lightning")!.click();
    document.querySelector<HTMLInputElement>("#donate-ln-amount")!.value = "50000";
    document.querySelector<HTMLButtonElement>("#donate-ln-create")!.click();

    await vi.waitFor(() => expect(createLightningInvoice).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(4000);
    await vi.waitFor(() => {
      expect(document.querySelector("#donate-credit-status")?.textContent).toContain(
        "contribution not found",
      );
      expect(document.querySelector("#donate-credit-status")?.textContent).toContain(
        "retry from Funders",
      );
    });
  });
});

describe("donate markup contract", () => {
  it("keeps on-chain, Lightning, and credit regions in the modal shell", () => {
    const html = donateModalHtml(proposal, { signedIn: true });
    expect(html).toContain('id="donate-modal"');
    expect(html).toContain('id="donate"');
    expect(html).toContain('data-tab="onchain"');
    expect(html).toContain('data-tab="lightning"');
    expect(html).toContain('id="donate-credit"');
    expect(html).toContain('id="donate-credit-public"');
    expect(html).toContain('id="donate-credit-amount"');
    expect(html).toContain('id="donate-credit-status"');
    expect(html).toContain('id="donate-credit-claim"');
  });
});
