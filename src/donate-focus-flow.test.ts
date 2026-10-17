import { afterEach, describe, expect, it, vi } from "vitest";
import type { Proposal } from "./types";

const ESCROW = "tb1qhj27cegpek02g8g4peps0x7gqs0svvs888svyz";

function listedProposal(partial: Partial<Proposal> = {}): Proposal {
  return {
    id: "PLEBLY-SIGNET-DEMO",
    path: "proposals/listed/demo-signet-smoke.md",
    title: "Demo",
    status: "listed",
    target_sats: null,
    escrow_address: null,
    submission_fee_txid: null,
    created_at: null,
    escrow_index: null,
    milestones: [],
    body: "",
    balance_sats: 15_000,
    ...partial,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("Donate modal focus (real open flow)", () => {
  const pending: Array<(e?: unknown) => void> = [];

  afterEach(() => {
    while (pending.length) pending.pop()?.(new Error("teardown"));
    document.body.innerHTML = "";
    document.body.classList.remove("modal-open");
    localStorage.clear();
    vi.useRealTimers();
    vi.resetModules();
    vi.doUnmock("./builder");
    vi.doUnmock("./lightning");
  });

  async function loadUi(opts?: {
    fetchClaimStatus?: () => Promise<unknown>;
  }) {
    vi.resetModules();
    vi.doMock("./builder", async (importOriginal) => {
      const actual = await importOriginal<typeof import("./builder")>();
      return {
        ...actual,
        fetchClaimStatus: vi.fn(
          opts?.fetchClaimStatus ||
            (async () =>
              new Promise((_, reject) => {
                pending.push(reject);
              })),
        ),
        fetchClaimApplications: vi.fn(async () => null),
        fetchClaimParams: vi.fn(async () => ({
          claim_bond_sats: 10_000,
          max_active_claims: 1,
          reclaim_cooldown_days: 30,
          checkpoint_day: 45,
          checkpoint_grace_days: 7,
          fee_address: null,
        })),
        fetchPayoutStatus: vi.fn(async () => null),
      };
    });
    vi.doMock("./lightning", async (importOriginal) => {
      const actual = await importOriginal<typeof import("./lightning")>();
      return {
        ...actual,
        fetchLightningStatus: vi.fn(async () => ({
          enabled: false,
          reason: "test",
        })),
      };
    });
    return import("./proposal-ui");
  }

  async function openDonate() {
    const ui = await loadUi({
      fetchClaimStatus: async () => ({
        proposal_id: "PLEBLY-SIGNET-DEMO",
        proposal_path: "proposals/listed/demo-signet-smoke.md",
        escrow_address: ESCROW,
        state: "listed",
        accepting_funds: true,
      }),
    });
    const p = listedProposal({ escrow_address: ESCROW });
    document.body.innerHTML = `<div id="app">
      <button type="button" data-open-donate id="donate-open">Donate</button>
    </div>`;
    ui.beginDonateProject(p.path);
    ui.setDonateChromeContext({
      root: document,
      proposal: p,
      panelOpts: {
        address: ESCROW,
        proposalId: p.id,
        proposalPath: p.path,
        proposalTitle: p.title,
        signedIn: false,
      },
      claimStatusPromise: Promise.resolve({
        proposal_id: p.id,
        proposal_path: p.path,
        escrow_address: ESCROW,
        state: "listed",
        accepting_funds: true,
      }),
    });
    ui.installDonateClickCapture();
    const opener = document.querySelector<HTMLButtonElement>("#donate-open")!;
    opener.focus();
    opener.click();
    await vi.waitFor(() => {
      expect(document.querySelector("#donate-address")?.textContent).toBe(ESCROW);
      expect(document.querySelector<HTMLElement>("#donate-step-credit")?.hidden).toBe(false);
    });
    await sleep(20);
    return { opener };
  }

  const payStep = () => document.querySelector<HTMLElement>("#donate-step-pay")!;

  it("starts on Close while only the credit step is shown, then moves to the amount at the payment step", async () => {
    await openDonate();
    expect(payStep().hidden).toBe(true);
    expect(document.activeElement?.id).toBe("donate-close");
    document.querySelector<HTMLButtonElement>("#donate-credit-continue")!.click();
    expect(payStep().hidden).toBe(false);
    expect(document.activeElement?.id).toBe("donate-amount");
  });

  it("reopening on the payment step puts initial focus in the amount field, not Close", async () => {
    const { opener } = await openDonate();
    document.querySelector<HTMLButtonElement>("#donate-credit-continue")!.click();
    document.querySelector<HTMLButtonElement>("#donate-close")!.click();
    expect(document.querySelector<HTMLElement>("#donate-modal")!.hidden).toBe(true);
    opener.focus();
    opener.click();
    expect(document.querySelector<HTMLElement>("#donate-modal")!.hidden).toBe(false);
    expect(document.activeElement?.id).toBe("donate-amount");
    await sleep(50);
    expect(document.activeElement?.id).toBe("donate-amount");
  });

  it("does not pull focus off a control the donor is already using when the claim check re-reveals", async () => {
    const { opener } = await openDonate();
    document.querySelector<HTMLButtonElement>("#donate-credit-continue")!.click();
    document.querySelector<HTMLButtonElement>("#donate-close")!.click();
    opener.focus();
    opener.click();
    // The donor picks a preset before the async claim check finishes.
    const preset = document.querySelector<HTMLButtonElement>(".donate-pane-onchain .donate-preset")!;
    preset.focus();
    await sleep(50);
    expect(document.activeElement).toBe(preset);
  });
});
