/**
 * Leaving a project for a page that isn't a project page (home, listing,
 * endowment, account, …): no project is active, the Donate context is cleared
 * and the project's modal gets the normal close. Nothing started for the
 * project applies any more, and the endowment's modal only ever shows the
 * endowment's own address.
 *
 * Setup mirrors donate-project-race.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("qrcode", () => ({
  default: { toDataURL: vi.fn(async () => "data:image/png;base64,qq") },
}));

const ln = vi.hoisted(() => ({ allowed: false }));

vi.mock("./github", async (o) => ({
  ...(await o<typeof import("./github")>()),
  listListedProposals: vi.fn(async () => []),
}));

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return {
    ...actual,
    lightningUiAllowed: () => ln.allowed,
    MEMPOOL_API: "https://mempool.test/api",
    WORKERS_API: "https://api.test",
  };
});

import { closeAllGiftToasts, stopGiftLinks } from "./gift-link";
import { renderEndowment } from "./endowment-page";
import { renderProposalPage } from "./proposal-page";
import {
  beginDonateProject,
  donateResultIsCurrent,
  endDonateProject,
  getDonateChromeContext,
  mountDonateChromeWhenEscrowKnown,
  setDonateChromeContext,
} from "./proposal-ui";
import type { Proposal } from "./types";

const ADDR_X = "tb1q3ujq9473rc9smza7djsm8snmaxv9ccqwzn447x98r97pyr2c6ljqawv6qx";
const ADDR_E = "tb1qhj27cegpek02g8g4peps0x7gqs0svvs888svyz";
const ADDR_Y = "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx";
const base = {
  status: "listed",
  proposal_type: "bounty",
  target_sats: 1_500_000,
  submission_fee_txid: "ab".repeat(32),
  created_at: "2026-07-25T00:00:00Z",
  milestones: [],
  body: "## Problem\n\nBody.",
};
const X = {
  ...base,
  id: "PLEBLY-2026-009",
  path: "proposals/listed/PLEBLY-2026-009.md",
  title: "Signet faucet",
  escrow_address: ADDR_X,
} as unknown as Proposal;
const Y = {
  ...base,
  id: "PLEBLY-2026-010",
  path: "proposals/listed/PLEBLY-2026-010.md",
  title: "Relay fund",
  escrow_address: ADDR_Y,
} as unknown as Proposal;

const claimView = (p: Proposal) => ({
  proposal_id: p.id,
  proposal_path: p.path,
  state: "open",
  status: "listed",
  confirmed_balance_sats: 0,
  escrow_address: p.escrow_address,
  accepting_funds: true,
});

/** X's /claims answer is held until release(); everything else answers at once. */
function stubNet() {
  let release: () => void = () => undefined;
  const xClaim = new Promise<void>((r) => {
    release = r;
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (/\/address\/[^/?]+\/utxo$/.test(url)) return Response.json([]);
      if (/\/address\/[^/?]+$/.test(url)) {
        return Response.json({
          chain_stats: { funded_txo_sum: 0, spent_txo_sum: 0 },
          mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0 },
        });
      }
      if (url.endsWith("/endowment")) {
        return Response.json({
          address: ADDR_E,
          configured: true,
          display_balance_sats: 1_000,
          goal_sats: 1_000_000,
          display_updated_at: "2026-10-01T00:00:00Z",
          funded_proposal_ids: [],
          contributions: [],
          lightning_available: false,
        });
      }
      if (url.includes("/proposals/catalog")) {
        return Response.json({ scope: "listed", updated_at: "x", proposals: [X, Y] });
      }
      if (/\/claims\/[^/]+$/.test(url) && !/\/claims\/(params|apply|applications)/.test(url)) {
        if (url.includes(X.id)) {
          await xClaim;
          return Response.json(claimView(X));
        }
        return Response.json(claimView(Y));
      }
      return new Response("{}", { status: 404 });
    }),
  );
  return { releaseX: () => release() };
}

function go(p: Proposal, search = "") {
  history.pushState(null, "", `/p/${p.id}${search}`);
}

const modals = () => [...document.querySelectorAll<HTMLElement>("#donate-modal")];
const endowmentModal = () => document.querySelector<HTMLElement>('#app #donate-modal[data-donate-scope="endowment"]');

/** No trace of project X: no X address anywhere, no X modal, no X Donate context. */
function expectNoX() {
  expect(document.body.innerHTML).not.toContain(ADDR_X);
  expect(modals().some((m) => m.dataset.donateProposalId === X.id)).toBe(false);
  expect(getDonateChromeContext()).toBeNull();
}

/** What main.ts's render() runs for /endowment. */
async function goEndowment() {
  history.pushState(null, "", "/endowment");
  endDonateProject();
  await renderEndowment((s) => s);
  expect(endowmentModal()?.querySelector("#donate-address")?.textContent).toBe(ADDR_E);
}

const optsFor = (p: Proposal) => ({
  address: String(p.escrow_address),
  proposalId: p.id,
  proposalPath: p.path,
  proposalTitle: p.title,
  signedIn: false,
  initialBalance: null,
  balancePollMs: 600_000,
  utxoPollMs: 600_000,
});

beforeEach(() => {
  history.replaceState(null, "", "/");
});

afterEach(() => {
  stopGiftLinks();
  closeAllGiftToasts();
  for (const el of document.querySelectorAll<HTMLElement & { __stopDonateWatchers?: () => void }>("*")) {
    el.__stopDonateWatchers?.();
  }
  endDonateProject();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  document.body.className = "";
  sessionStorage.clear();
  history.replaceState(null, "", "/");
});

describe("project X, then the endowment page", () => {
  it("(a) X, then /endowment, then Donate: the endowment's address, never X's", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    stubNet().releaseX();
    document.body.innerHTML = `<div id="app"></div>`;
    go(X);
    await renderProposalPage(X.path, (s) => s, null, () => undefined, X);
    await vi.waitFor(() => {
      if (!modals().some((m) => m.dataset.donateProposalId === X.id)) throw new Error("X's modal not mounted");
    });
    await goEndowment();
    expectNoX();
    document.querySelector<HTMLButtonElement>("#app [data-open-donate]")!.click();
    await vi.advanceTimersByTimeAsync(500);
    const m = endowmentModal()!;
    expect(m.hidden).toBe(false);
    expect(m.querySelector("#donate-address")?.textContent).toBe(ADDR_E);
    expect(m.querySelector<HTMLElement>("#donate-copy")?.dataset.copy ?? ADDR_E).toBe(ADDR_E);
    expect(modals().filter((x) => !x.hidden)).toEqual([m]);
    expectNoX();
  });

  it("(b) X opened with ?donate, then /endowment, X's check lands late: X's modal never opens, no X address anywhere", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const net = stubNet();
    document.body.innerHTML = `<div id="app"></div>`;
    go(X, "?donate");
    void renderProposalPage(X.path, (s) => s, null, () => undefined, X);
    await vi.waitFor(() => {
      if (!document.querySelector(".proposal-onchain")) throw new Error("X not painted");
    });
    await goEndowment();
    net.releaseX();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(modals().filter((m) => !m.hidden)).toEqual([]);
    expect(document.body.classList.contains("modal-open")).toBe(false);
    expect(modals()).toEqual([endowmentModal()]);
    expect(endowmentModal()!.querySelector("#donate-address")?.textContent).toBe(ADDR_E);
    expectNoX();
  });

  it("leaving X closes X's modal the normal way: its address watchers stop", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    stubNet();
    document.body.innerHTML = `<div id="app"></div>`;
    go(X);
    beginDonateProject(X.path);
    await mountDonateChromeWhenEscrowKnown(document, X, optsFor(X), { ignoreStatusGate: true });
    const xModal = modals()[0]!;
    xModal.hidden = false;
    document.body.classList.add("modal-open");
    const stop = vi.fn();
    (xModal.querySelector(".donate-panel") as HTMLElement & { __stopDonateWatchers?: () => void }).__stopDonateWatchers = stop;
    history.pushState(null, "", "/");
    endDonateProject();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(xModal.isConnected).toBe(false);
    expect(document.body.classList.contains("modal-open")).toBe(false);
    expect(donateResultIsCurrent(X)).toBe(false);
    expectNoX();
  });
});

describe("the endowment's modal only ever shows the endowment's address", () => {
  it("a fresh /endowment Donate click opens the endowment's modal with its address (a project's claim check never closes it)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    stubNet();
    document.body.innerHTML = `<div id="app"></div>`;
    await goEndowment();
    document.querySelector<HTMLButtonElement>("#app [data-open-donate]")!.click();
    await vi.advanceTimersByTimeAsync(500);
    const m = endowmentModal();
    expect(m).not.toBeNull();
    expect(m!.hidden).toBe(false);
    expect(m!.querySelector("#donate-address")?.textContent).toBe(ADDR_E);
  });

  it("a Donate context left over for X (no project page on screen) never writes X's address into it on open", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    stubNet();
    document.body.innerHTML = `<div id="app"></div>`;
    await goEndowment();
    setDonateChromeContext({ root: document, proposal: { ...X }, panelOpts: optsFor(X) });
    document.querySelector<HTMLButtonElement>("#app [data-open-donate]")!.click();
    await vi.advanceTimersByTimeAsync(500);
    const m = endowmentModal()!;
    expect(m.hidden).toBe(false);
    expect(m.querySelector("#donate-address")?.textContent).toBe(ADDR_E);
    expect(document.body.innerHTML).not.toContain(ADDR_X);
  });

  it("a project mount never reuses or fills the endowment's modal", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    stubNet();
    document.body.innerHTML = `<div id="app"></div>`;
    await goEndowment();
    const e = endowmentModal()!;
    go(X);
    beginDonateProject(X.path);
    // The endowment's modal is still in the DOM (the page hasn't repainted yet).
    document.querySelector("#app")!.appendChild(e);
    await mountDonateChromeWhenEscrowKnown(document, X, optsFor(X), { ignoreStatusGate: true });
    expect(e.textContent).not.toContain(ADDR_X);
    if (e.isConnected) expect(e.querySelector("#donate-address")?.textContent).toBe(ADDR_E);
  });

  it("with no project page on screen, no project's result is current", () => {
    history.pushState(null, "", "/endowment");
    endDonateProject();
    expect(donateResultIsCurrent(X)).toBe(false);
    expect(donateResultIsCurrent({ path: X.path })).toBe(false);
  });
});
