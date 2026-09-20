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

describe("Donate click capture — production listing DOM", () => {
  const pending: Array<(e?: unknown) => void> = [];

  afterEach(() => {
    while (pending.length) pending.pop()?.(new Error("teardown"));
    document.body.innerHTML = "";
    document.body.classList.remove("modal-open");
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

  it("inserts #donate-modal on body immediately when claims never resolve", async () => {
    const { setDonateChromeContext, installDonateClickCapture } = await loadUi();
    const p = listedProposal();
    document.body.innerHTML = `<div id="app">
      <button type="button" data-open-donate id="donate-open">Donate</button>
    </div>`;
    setDonateChromeContext({
      root: document,
      proposal: p,
      panelOpts: {
        address: "",
        proposalId: p.id,
        proposalPath: p.path,
        proposalTitle: p.title,
        signedIn: false,
      },
      claimStatusPromise: new Promise((_, reject) => {
        pending.push(reject);
      }),
    });
    installDonateClickCapture();
    expect(document.querySelector("#donate-modal")).toBeNull();

    document.querySelector<HTMLButtonElement>("#donate-open")!.click();

    const modal = document.querySelector<HTMLElement>("#donate-modal");
    expect(modal).toBeTruthy();
    expect(modal!.parentElement).toBe(document.body);
    expect(modal!.hidden).toBe(false);
    expect(document.body.classList.contains("modal-open")).toBe(true);
  });

  it("shows catalog escrow on click without waiting on /claims", async () => {
    const { setDonateChromeContext, installDonateClickCapture } = await loadUi();
    const p = listedProposal({ escrow_address: ESCROW });
    document.body.innerHTML = `<div id="app">
      <button type="button" data-open-donate id="donate-open">Donate</button>
    </div>`;
    setDonateChromeContext({
      root: document,
      proposal: p,
      panelOpts: {
        address: ESCROW,
        proposalId: p.id,
        proposalPath: p.path,
        proposalTitle: p.title,
        signedIn: true,
      },
      claimStatusPromise: null,
    });
    installDonateClickCapture();
    document.querySelector<HTMLButtonElement>("#donate-open")!.click();

    const modal = document.querySelector<HTMLElement>("#donate-modal");
    expect(modal).toBeTruthy();
    expect(modal!.parentElement).toBe(document.body);
    expect(modal!.hidden).toBe(false);
    expect(document.querySelector("#donate-address")?.textContent).toBe(ESCROW);
  });

  it("keeps #donate-modal when /claims returns no escrow", async () => {
    const { setDonateChromeContext, installDonateClickCapture } = await loadUi({
      fetchClaimStatus: async () => null,
    });
    const p = listedProposal();
    document.body.innerHTML = `<div id="app">
      <button type="button" data-open-donate id="donate-open">Donate</button>
    </div>`;
    setDonateChromeContext({
      root: document,
      proposal: p,
      panelOpts: {
        address: "",
        proposalId: p.id,
        proposalPath: p.path,
        proposalTitle: p.title,
        signedIn: false,
      },
      claimStatusPromise: Promise.resolve(null),
    });
    installDonateClickCapture();
    document.querySelector<HTMLButtonElement>("#donate-open")!.click();
    expect(document.querySelector("#donate-modal")).toBeTruthy();

    await vi.waitFor(() => {
      const modal = document.querySelector<HTMLElement>("#donate-modal");
      expect(modal).toBeTruthy();
      expect(modal!.parentElement).toBe(document.body);
      expect(modal!.hidden).toBe(false);
    });
  });

  it("keeps the visible stub when chrome html cannot replace it", async () => {
    const { mountDonateChromeWhenEscrowKnown } = await loadUi();
    const p = listedProposal();
    const stub = document.createElement("div");
    stub.id = "donate-modal";
    stub.className = "site-modal donate-modal";
    stub.setAttribute("data-donate-shell", "1");
    stub.hidden = false;
    stub.innerHTML = `<code id="donate-address"></code>`;
    document.body.appendChild(stub);

    const ok = await mountDonateChromeWhenEscrowKnown(
      document,
      p,
      {
        address: "",
        proposalId: p.id,
        proposalPath: p.path,
        proposalTitle: p.title,
        signedIn: false,
      },
      { ignoreStatusGate: true },
    );
    expect(ok).toBe(false);
    const modal = document.querySelector<HTMLElement>("#donate-modal");
    expect(modal).toBe(stub);
    expect(modal!.parentElement).toBe(document.body);
    expect(modal!.hidden).toBe(false);
    expect(modal!.getAttribute("data-donate-shell")).toBe("1");
    expect(document.querySelectorAll("#donate-modal")).toHaveLength(1);
  });

  it("guest and logged-in clicks insert #donate-modal before /claims returns", async () => {
    for (const signedIn of [false, true]) {
      document.body.innerHTML = "";
      document.body.classList.remove("modal-open");
      const { setDonateChromeContext, installDonateClickCapture } = await loadUi();
      const p = listedProposal();
      document.body.innerHTML = `<div id="app">
        <button type="button" data-open-donate id="donate-open">Donate</button>
      </div>`;
      setDonateChromeContext({
        root: document,
        proposal: p,
        panelOpts: {
          address: "",
          proposalId: p.id,
          proposalPath: p.path,
          proposalTitle: p.title,
          signedIn,
        },
        claimStatusPromise: new Promise((_, reject) => {
          pending.push(reject);
        }),
      });
      installDonateClickCapture();
      document.querySelector<HTMLButtonElement>("#donate-open")!.click();
      const modal = document.querySelector<HTMLElement>("#donate-modal");
      expect(modal, `signedIn=${signedIn}`).toBeTruthy();
      expect(modal!.parentElement).toBe(document.body);
      expect(modal!.hidden).toBe(false);
      expect(modal!.getAttribute("data-donate-shell")).toBe("1");
    }
  });
});
