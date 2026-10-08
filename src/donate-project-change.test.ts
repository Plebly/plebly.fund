/**
 * Moving from one project to another while project X's Donate modal is open
 * (it lives on document.body, so the page change itself doesn't remove it):
 * the modal is closed and unmounted through the same close as the Close
 * button. Nothing in the modal or its watchers refers to X afterwards, and a
 * gift still linking for X keeps running and shows its Linking toast at once.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("qrcode", () => ({
  default: { toDataURL: vi.fn(async () => "data:image/png;base64,qq") },
}));

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return {
    ...actual,
    lightningUiAllowed: () => false,
    MEMPOOL_API: "https://mempool.test/api",
    WORKERS_API: "https://api.test",
  };
});

import { closeAllGiftToasts, stopGiftLinks } from "./gift-link";
import { renderProposalPage } from "./proposal-page";
import { bindDonateModal, mountDonateChromeWhenEscrowKnown } from "./proposal-ui";
import type { Proposal } from "./types";

const RETRYING = "Linking your gift to your account\u2026 Keep this page open.";
const ADDR_X = "tb1q3ujq9473rc9smza7djsm8snmaxv9ccqwzn447x98r97pyr2c6ljqawv6qx";
const ADDR_Y = "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx";
const X = {
  id: "PLEBLY-2026-009",
  path: "proposals/listed/PLEBLY-2026-009.md",
  title: "Signet faucet",
  status: "listed",
  escrow_address: ADDR_X,
} as unknown as Proposal;
const Y = {
  id: "PLEBLY-2026-010",
  path: "proposals/listed/PLEBLY-2026-010.md",
  title: "Relay fund",
  status: "listed",
  proposal_type: "bounty",
  target_sats: 1_500_000,
  escrow_address: ADDR_Y,
  submission_fee_txid: "ab".repeat(32),
  created_at: "2026-07-25T00:00:00Z",
  milestones: [],
  body: "## Problem\n\nBody.",
} as unknown as Proposal;
const OLD = { txid: "cd".repeat(32), vout: 0, value: 25_000, status: { confirmed: true } };
const GIFT = { txid: "ef".repeat(32), vout: 1, value: 7_000, status: { confirmed: true } };
const POLL = 50;

function stubNet() {
  const utxos: Record<string, (typeof OLD)[]> = { [ADDR_X]: [OLD], [ADDR_Y]: [] };
  const hits: string[] = [];
  let records = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      hits.push(url);
      const u = /\/address\/([^/?]+)\/utxo$/.exec(url);
      if (u) return Response.json(utxos[decodeURIComponent(u[1]!)] ?? []);
      if (/\/address\/[^/?]+$/.test(url)) {
        return Response.json({
          chain_stats: { funded_txo_sum: 0, spent_txo_sum: 0 },
          mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0 },
        });
      }
      if (init?.method === "POST" && url.endsWith("/contributions/record")) {
        records += 1;
        // Two busy answers, then success: the link is mid-retry at the page change.
        if (records <= 2) {
          return Response.json({ error: "busy", code: "contribution_busy" }, { status: 503 });
        }
        return Response.json({ ok: true, entry: {} });
      }
      if (init?.method === "POST" && url.endsWith("/contributions/claim")) return Response.json({ ok: true });
      if (url.includes("/contributions/mine/")) return Response.json({ contributions: [] });
      if (url.includes("/proposals/catalog")) {
        return Response.json({ scope: "listed", updated_at: "x", proposals: [Y] });
      }
      if (/\/claims\/[^/]+$/.test(url) && !/\/claims\/(params|apply|applications)/.test(url)) {
        return Response.json({
          proposal_id: Y.id,
          proposal_path: Y.path,
          state: "open",
          status: "listed",
          confirmed_balance_sats: 0,
          escrow_address: ADDR_Y,
          accepting_funds: true,
        });
      }
      return new Response("{}", { status: 404 });
    }),
  );
  return {
    hits,
    records: () => records,
    xPolls: () => hits.filter((h) => h.includes(ADDR_X)).length,
    arrive: () => {
      utxos[ADDR_X] = [OLD, GIFT];
    },
  };
}

const toastText = () => document.querySelector("#gift-toasts .gift-toast-text")?.textContent ?? null;

afterEach(() => {
  stopGiftLinks();
  closeAllGiftToasts();
  for (const el of document.querySelectorAll<HTMLElement & { __stopDonateWatchers?: () => void }>("*")) {
    el.__stopDonateWatchers?.();
  }
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  document.body.className = "";
  sessionStorage.clear();
});

describe("project → project with the Donate modal open mid-link", () => {
  it("X's modal, panel and watchers are gone; nothing refers to X; X's link surfaces as a toast and finishes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const h = stubNet();
    document.body.innerHTML = `<div id="app"><main>Project X</main></div>`;
    // X's modal as the proposal page mounts it: on document.body, outside #app.
    await mountDonateChromeWhenEscrowKnown(
      document,
      X,
      {
        address: ADDR_X,
        proposalId: X.id,
        proposalPath: X.path,
        proposalTitle: X.title,
        signedIn: true,
        initialBalance: null,
        balancePollMs: 600_000,
        utxoPollMs: POLL,
      },
      { ignoreStatusGate: true },
    );
    const xModal = document.querySelector<HTMLElement>("#donate-modal")!;
    expect(xModal.parentElement).toBe(document.body);
    xModal.hidden = false;
    document.body.classList.add("modal-open");
    bindDonateModal(document);
    await vi.waitFor(() => expect(document.querySelector("#donate-credit-continue")).toBeTruthy());
    document.querySelector<HTMLButtonElement>("#donate-credit-continue")!.click();
    await vi.advanceTimersByTimeAsync(POLL * 2);
    h.arrive();
    await vi.advanceTimersByTimeAsync(POLL * 2);
    expect(h.records()).toBe(1); // mid-retry: next attempt at +1 s
    expect(document.querySelector("#donate-confirm-status")?.textContent).toBe(RETRYING);
    expect(toastText()).toBeNull(); // X's modal open: inline only

    // In-app navigation to project Y (what main.ts's proposal route runs).
    void renderProposalPage(Y.path, (inner) => inner, null, () => undefined, Y);
    // Synchronously, as the Close button does: no gap before the toast.
    expect(toastText()).toBe(`Gift to Signet faucet: ${RETRYING}`);
    await vi.advanceTimersByTimeAsync(10);

    // X's modal is closed and unmounted; the running link surfaces at once.
    expect(xModal.isConnected).toBe(false);
    expect(document.body.classList.contains("modal-open")).toBe(false);
    expect(toastText()).toBe(`Gift to Signet faucet: ${RETRYING}`);

    // Let Y's page and any Donate chrome it mounts settle; the link finishes.
    await vi.waitFor(() => {
      if (!document.querySelector(".proposal-onchain")) throw new Error("Y not painted yet");
    });
    const xPollsAfter = h.xPolls();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(h.records()).toBe(3);
    expect(toastText()).toBe("Gift to Signet faucet: Credit linked for 7,000 sats.");

    // X's address watchers stopped: no more reads of X's address.
    expect(h.xPolls()).toBe(xPollsAfter);
    // Y's own modal is mounted fresh; nothing in any Donate modal refers to X.
    const modals = [...document.querySelectorAll<HTMLElement>("#donate-modal")];
    expect(modals.map((m) => m.dataset.donateProposalId)).toEqual([Y.id]);
    expect(modals[0]!.outerHTML).toContain(ADDR_Y);
    for (const m of modals) {
      expect(m.outerHTML).not.toContain(ADDR_X);
      expect(m.outerHTML).not.toContain(X.id);
      expect(m.outerHTML).not.toContain(X.path);
    }
  });

  it("re-rendering the same project keeps its modal (no close on a same-project render)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    stubNet();
    document.body.innerHTML = `<div id="app"></div>`;
    await mountDonateChromeWhenEscrowKnown(
      document,
      Y,
      {
        address: ADDR_Y,
        proposalId: Y.id,
        proposalPath: Y.path,
        proposalTitle: "Relay fund",
        signedIn: false,
        initialBalance: null,
        balancePollMs: 600_000,
        utxoPollMs: POLL,
      },
      { ignoreStatusGate: true },
    );
    const yModal = document.querySelector<HTMLElement>("#donate-modal")!;
    yModal.hidden = false;
    void renderProposalPage(Y.path, (inner) => inner, null, () => undefined, Y);
    await vi.advanceTimersByTimeAsync(10);
    expect(yModal.isConnected).toBe(true);
    expect(yModal.hidden).toBe(false);
  });
});
