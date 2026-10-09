/**
 * Async claim/escrow results are tied to the project they were started for.
 * Moving from project X to project Y while X's claim check (or a click-time
 * check) is still in flight: when it finally answers, it never sets the
 * Donate context, mounts, reuses or fills a modal for Y. Y's modal shows Y's
 * address (or nothing yet), never X's.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("qrcode", () => ({
  default: { toDataURL: vi.fn(async () => "data:image/png;base64,qq") },
}));

const ln = vi.hoisted(() => ({ allowed: false }));

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
import { renderProposalPage } from "./proposal-page";
import {
  beginDonateProject,
  ensureDonateModalMounted,
  getDonateChromeContext,
  mountDonateChromeWhenEscrowKnown,
  setDonateChromeContext,
} from "./proposal-ui";
import type { Proposal } from "./types";

const ADDR_X = "tb1q3ujq9473rc9smza7djsm8snmaxv9ccqwzn447x98r97pyr2c6ljqawv6qx";
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

/** Every Donate modal on the page belongs to Y and shows Y's address or none; X's address is nowhere. */
function expectOnlyY() {
  expect(getDonateChromeContext()?.proposal.id).toBe(Y.id);
  const modals = [...document.querySelectorAll<HTMLElement>("#donate-modal")];
  for (const m of modals) {
    expect(m.dataset.donateProposalId).toBe(Y.id);
    const shown = m.querySelector("#donate-address")?.textContent ?? "";
    expect([ADDR_Y, ""]).toContain(shown);
    expect(m.querySelector<HTMLElement>("#donate-copy")?.dataset.copy ?? ADDR_Y).toBe(ADDR_Y);
  }
  expect(document.body.innerHTML).not.toContain(ADDR_X);
}

beforeEach(() => {
  history.replaceState(null, "", "/");
});

afterEach(() => {
  ln.allowed = false;
  stopGiftLinks();
  closeAllGiftToasts();
  for (const el of document.querySelectorAll<HTMLElement & { __stopDonateWatchers?: () => void }>("*")) {
    el.__stopDonateWatchers?.();
  }
  setDonateChromeContext(null);
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  document.body.className = "";
  sessionStorage.clear();
  history.replaceState(null, "", "/");
});

async function renderXThenY(search = "") {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const net = stubNet();
  document.body.innerHTML = `<div id="app"></div>`;
  go(X);
  void renderProposalPage(X.path, (inner) => inner, null, () => undefined, X);
  await vi.waitFor(() => {
    if (!document.querySelector(".proposal-onchain")) throw new Error("X not painted");
  });
  // X's claim check is still in flight. The user moves to Y.
  go(Y, search);
  void renderProposalPage(Y.path, (inner) => inner, null, () => undefined, Y);
  await vi.waitFor(() => {
    const m = document.querySelector<HTMLElement>("#donate-modal");
    if (!m || m.dataset.donateProposalId !== Y.id) throw new Error("Y's modal not mounted");
  });
  return net;
}

describe("project X's late claim check after the move to Y", () => {
  it("(a) X's check answers after the move: Y's modal keeps Y's address; Donate on Y opens Y's address", async () => {
    const net = await renderXThenY();
    expectOnlyY();
    net.releaseX();
    await vi.advanceTimersByTimeAsync(500);
    expectOnlyY();
    document.querySelector<HTMLButtonElement>("[data-open-donate]")!.click();
    await vi.waitFor(() => expect(document.querySelector<HTMLElement>("#donate-modal")!.hidden).toBe(false));
    await vi.advanceTimersByTimeAsync(200);
    expect(document.querySelector("#donate-modal #donate-address")?.textContent).toBe(ADDR_Y);
    expectOnlyY();
  });

  it("(b) Y opened from ?donate with X's check pending never switches to X's address", async () => {
    const net = await renderXThenY("?donate");
    await vi.waitFor(() => expect(document.querySelector<HTMLElement>("#donate-modal")!.hidden).toBe(false));
    await vi.advanceTimersByTimeAsync(100);
    expect(document.querySelector("#donate-modal #donate-address")?.textContent).toBe(ADDR_Y);
    net.releaseX();
    await vi.advanceTimersByTimeAsync(500);
    const m = document.querySelector<HTMLElement>("#donate-modal")!;
    expect(m.hidden).toBe(false);
    expect(m.querySelector("#donate-address")?.textContent).toBe(ADDR_Y);
    expectOnlyY();
  });
});

describe("each Donate writer checks the project (unit)", () => {
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

  async function yOnScreen() {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    stubNet();
    document.body.innerHTML = `<div id="app"></div>`;
    go(Y);
    beginDonateProject(Y.path);
    await mountDonateChromeWhenEscrowKnown(document, Y, optsFor(Y), { ignoreStatusGate: true });
    expect(document.querySelector("#donate-modal #donate-address")?.textContent).toBe(ADDR_Y);
  }

  it("mount for a project that's no longer on screen touches nothing", async () => {
    await yOnScreen();
    const yModal = document.querySelector<HTMLElement>("#donate-modal")!;
    expect(await mountDonateChromeWhenEscrowKnown(document, X, optsFor(X), { ignoreStatusGate: true })).toBe(false);
    expect(document.querySelector("#donate-modal")).toBe(yModal);
    expectOnlyY();
  });

  it("mount never reuses or writes into a modal tagged for another project", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    stubNet();
    document.body.innerHTML = `<div id="app"></div>`;
    go(Y);
    beginDonateProject(Y.path);
    // A modal tagged for X is still on the page (e.g. mounted late by a stale path).
    document.body.insertAdjacentHTML(
      "beforeend",
      `<div class="site-modal donate-modal" id="donate-modal" hidden data-donate-proposal-id="${X.id}" data-donate-proposal-path="${X.path}"><div class="donate-panel" id="donate"><code id="donate-address">${ADDR_X}</code></div></div>`,
    );
    const xModal = document.querySelector<HTMLElement>("#donate-modal")!;
    await mountDonateChromeWhenEscrowKnown(document, Y, optsFor(Y), { ignoreStatusGate: true });
    expect(xModal.isConnected).toBe(false);
    expectOnlyY();
    expect(document.querySelector("#donate-modal #donate-address")?.textContent).toBe(ADDR_Y);
  });

  it("a mount for X that finishes after the move to Y never writes X's address into Y's modal", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    stubNet();
    // X's panel bind waits on the Lightning status read; Y's answers at once.
    ln.allowed = true;
    let releaseLn: () => void = () => undefined;
    const lnHeld = new Promise<void>((r) => {
      releaseLn = r;
    });
    let lnCalls = 0;
    const inner = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (String(input).includes("/lightning/status")) {
        if (lnCalls++ === 0) await lnHeld;
        return Response.json({ enabled: false, reason: "off" });
      }
      return inner(input, init);
    });
    document.body.innerHTML = `<div id="app"></div>`;
    go(X);
    beginDonateProject(X.path);
    const xMount = mountDonateChromeWhenEscrowKnown(document, X, optsFor(X), { ignoreStatusGate: true });
    // X's panel is still binding when the user moves to Y.
    go(Y);
    beginDonateProject(Y.path);
    await mountDonateChromeWhenEscrowKnown(document, Y, optsFor(Y), { ignoreStatusGate: true });
    expect(document.querySelector("#donate-modal #donate-address")?.textContent).toBe(ADDR_Y);
    releaseLn();
    await xMount;
    await vi.advanceTimersByTimeAsync(100);
    expect(document.querySelector("#donate-modal #donate-address")?.textContent).toBe(ADDR_Y);
    expectOnlyY();
  });

  it("a click-time check started for X that answers after the move to Y never fills Y's modal", async () => {
    await yOnScreen();
    let releaseX: (v: unknown) => void = () => undefined;
    const xStatus = new Promise((r) => {
      releaseX = r;
    });
    // X's Donate click started a check (context X), then Y's page took over.
    const yCtx = getDonateChromeContext();
    setDonateChromeContext({
      root: document,
      proposal: { ...X },
      panelOpts: optsFor(X),
      claimStatusPromise: xStatus as never,
    });
    const pending = ensureDonateModalMounted(document);
    setDonateChromeContext(yCtx);
    releaseX(claimView(X));
    expect(await pending).toBeNull();
    await vi.advanceTimersByTimeAsync(100);
    expectOnlyY();
  });

  it("a project page that finishes loading after a newer one started never paints or sets the Donate context", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let releaseDoc: () => void = () => undefined;
    const doc = new Promise<void>((r) => {
      releaseDoc = r;
    });
    stubNet();
    const inner = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      // X's page has no preloaded row: its catalog read is slow.
      if (String(input).includes("/proposals/catalog")) await doc;
      return inner(input, init);
    });
    document.body.innerHTML = `<div id="app"></div>`;
    go(X);
    void renderProposalPage(X.path, (s) => s, null, () => undefined, null);
    go(Y);
    void renderProposalPage(Y.path, (s) => s, null, () => undefined, Y);
    await vi.waitFor(() => {
      const m = document.querySelector<HTMLElement>("#donate-modal");
      if (!m || m.dataset.donateProposalId !== Y.id) throw new Error("Y's modal not mounted");
    });
    releaseDoc();
    await vi.advanceTimersByTimeAsync(500);
    // The signet help line says "Alt Signet faucet", so the page text is not a
    // safe place to look for X's title. The painted heading is.
    expect(document.querySelector("#app h1")?.textContent).toBe("Relay fund");
    expectOnlyY();
  });
});
