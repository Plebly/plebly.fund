/**
 * Readable escrow address (after a commenter's signet donation never reached
 * tb1qf8ag…9jyt). Money checks (Review + UI UX): the Copy button copies the
 * claim-view address byte for byte, and the rendered chunks add CSS spacing
 * only, never characters, so the element's text and a hand-selected copy are
 * the same address with no whitespace.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClaimStatus } from "./builder";
import { CLAIM_FLOOR_SATS } from "./config";
import type { Proposal } from "./types";

const KNOTS = "tb1qf8agl2750ezeuwt7ys5ghzmul9wutls0cs9jyt";
const P2WSH = "tb1q3ujq9473rc9smza7djsm8snmaxv9ccqwzn447x98r97pyr2c6ljqawv6qx";
const SIGNET_LINE = "Signet test coins only. Real bitcoin can't be sent here.";
const COPIED_LINE = "Copied. Deposits show once they confirm.";

let clipboard: string[] = [];

beforeEach(() => {
  vi.resetModules();
  clipboard = [];
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn(async (t: string) => void clipboard.push(t)) },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  document.body.innerHTML = "";
  sessionStorage.clear();
  document.getSelection()?.removeAllRanges();
});

/** Every check a hand copy relies on, for one rendered address element. */
function expectExactAddress(el: HTMLElement, address: string): void {
  // textContent as is (no whitespace stripping) is the address itself.
  expect(el.textContent).toBe(address);
  expect(el.textContent).not.toMatch(/\s|\u00a0/);
  // Only chunk spans, nothing (not even whitespace text) between them.
  const nodes = [...el.childNodes];
  expect(nodes.every((n) => n instanceof HTMLElement && n.classList.contains("escrow-addr-chunk"))).toBe(true);
  for (const n of nodes) expect(n.textContent).toMatch(/^[a-z0-9]{1,4}$/);
  expect(nodes.map((n) => n.textContent).join("")).toBe(address);
  expect(el.innerHTML).not.toMatch(/&nbsp;|\s(?![^<]*>)/);
  // DOM selection across the whole address returns it with no whitespace.
  const sel = document.getSelection()!;
  sel.removeAllRanges();
  const range = document.createRange();
  range.selectNodeContents(el);
  sel.addRange(range);
  expect(sel.toString()).toBe(address);
  sel.removeAllRanges();
}

describe("escrowAddressChunks / escrowAddressChunksHtml", () => {
  it("groups of 4, joined back to the exact address; HTML has no characters between spans", async () => {
    const { escrowAddressChunks, escrowAddressChunksHtml } = await import("./escrow-address-display");
    for (const a of [KNOTS, P2WSH]) {
      const chunks = escrowAddressChunks(a);
      expect(chunks.join("")).toBe(a);
      expect(chunks.slice(0, -1).every((c) => c.length === 4)).toBe(true);
      const html = escrowAddressChunksHtml(a);
      expect(html).not.toMatch(/>\s+</);
      expect(html).not.toContain("&nbsp;");
      document.body.innerHTML = `<code id="a">${html}</code>`;
      expectExactAddress(document.querySelector<HTMLElement>("#a")!, a);
    }
  });
});

describe("on-chain escrow row", () => {
  it("chunked address, exact text and selection; Copy copies the exact address and shows the confirm line", async () => {
    const { onChainEscrowRowHtml } = await import("./proposal-ui");
    const { bindProposalCopyButtons } = await import("./proposal-copy-buttons");
    document.body.innerHTML = `<div class="onchain-panel">${onChainEscrowRowHtml(KNOTS)}</div>`;
    bindProposalCopyButtons(document);
    const el = document.querySelector<HTMLElement>("#onchain-escrow-address")!;
    expectExactAddress(el, KNOTS);
    const row = document.querySelector<HTMLElement>("#onchain-escrow-row")!;
    expect(row.querySelector(".escrow-addr-note")?.textContent).toContain(SIGNET_LINE);
    expect(row.querySelector(".escrow-addr-note a[href]")).toBeTruthy();
    const copied = row.querySelector<HTMLElement>(".escrow-addr-copied")!;
    expect(copied.hidden).toBe(true);
    row.querySelector<HTMLButtonElement>("[data-escrow-copy]")!.click();
    await vi.waitFor(() => expect(clipboard).toHaveLength(1));
    expect(clipboard[0]).toBe(KNOTS);
    expect(clipboard[0]).toBe(el.textContent);
    expect(copied.hidden).toBe(false);
    expect(copied.textContent).toBe(COPIED_LINE);
  });

  it("a row inserted after binding (builder-panel re-insert) still copies the exact address", async () => {
    const { onChainEscrowRowHtml } = await import("./proposal-ui");
    const { bindProposalCopyButtons } = await import("./proposal-copy-buttons");
    document.body.innerHTML = `<div class="onchain-panel"></div>`;
    bindProposalCopyButtons(document);
    document.querySelector(".onchain-panel")!.insertAdjacentHTML("afterbegin", onChainEscrowRowHtml(P2WSH));
    document.querySelector<HTMLButtonElement>("[data-escrow-copy]")!.click();
    await vi.waitFor(() => expect(clipboard).toHaveLength(1));
    expect(clipboard[0]).toBe(P2WSH);
  });

  it("exposure unchanged: no address where the row was not rendered before (hideEscrow)", async () => {
    const { onChainPanelHtml } = await import("./proposal-ui");
    const p = {
      id: "X", path: "proposals/listed/x.md", title: "X", status: "listed", proposal_type: "bounty",
      target_sats: 1, escrow_address: KNOTS, submission_fee_txid: "ab".repeat(32), escrow_index: null,
      milestones: [], body: "",
    } as unknown as Proposal;
    const hidden = onChainPanelHtml(p, { hideEscrow: true });
    expect(hidden).not.toContain("escrow-addr");
    expect(hidden).not.toContain(KNOTS);
    expect(onChainPanelHtml(p)).toContain('id="onchain-escrow-address"');
  });

  it("no signet line on a mainnet build", async () => {
    vi.stubEnv("VITE_BITCOIN_NETWORK", "mainnet");
    const { escrowAddressSignetNoteHtml } = await import("./escrow-address-display");
    expect(escrowAddressSignetNoteHtml()).toBe("");
  });
});

describe("donate modal address", () => {
  it("chunked, exact; late claim-view escrow re-renders; Copy copies what is shown", async () => {
    const ui = await import("./proposal-ui");
    const p = {
      id: "PLEBLY-KNOTS-SIZE-VALUE-SPAM", path: "proposals/listed/knots-size-value-spam.md", title: "Knots",
      status: "listed", proposal_type: "bounty", target_sats: 1_500_000, escrow_address: P2WSH,
      submission_fee_txid: null, escrow_index: null, milestones: [], body: "",
    } as unknown as Proposal;
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
    document.body.innerHTML = ui.donateModalHtml(p, { signedIn: false });
    await ui.bindDonatePanel(document, { address: P2WSH, proposalId: p.id, proposalPath: p.path, signedIn: false });
    const el = document.querySelector<HTMLElement>("#donate-address")!;
    expectExactAddress(el, P2WSH);
    // Claim view supplies a different (the real) escrow: display and copy follow it.
    ui.syncDonateModalEscrow(KNOTS, document);
    expectExactAddress(el, KNOTS);
    const block = el.closest<HTMLElement>("[data-escrow-address-block]")!;
    expect(block.querySelector(".escrow-addr-note")?.textContent).toContain(SIGNET_LINE);
    // bindOnchainDonate attaches the Copy listener after its first QR render.
    await vi.waitFor(() => {
      document.querySelector<HTMLButtonElement>("#donate-copy")!.click();
      expect(clipboard.length).toBeGreaterThan(0);
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(clipboard.every((c) => c === KNOTS)).toBe(true);
    expect(clipboard[0]).toBe(el.textContent);
    const copied = block.querySelector<HTMLElement>(".escrow-addr-copied")!;
    expect(copied.hidden).toBe(false);
    expect(copied.textContent).toBe(COPIED_LINE);
  });
});

describe("full page (KNOTS shape): the address on the page is the claim view's, byte for byte", () => {
  it("re-inserted row text, selection and Copy all equal the claim-view escrow", async () => {
    const preloaded = {
      id: "PLEBLY-KNOTS-SIZE-VALUE-SPAM", path: "proposals/listed/knots-size-value-spam.md", title: "Knots",
      status: "listed", proposal_type: "bounty", target_sats: 1_500_000, escrow_address: KNOTS,
      submission_fee_txid: "ab".repeat(32), created_at: "2026-07-25T00:00:00Z", escrow_index: 1,
      milestones: [], body: "## Problem\n\nBody.", balance_sats: 0, endowment_funded: false,
    } as unknown as Proposal;
    const claim: Partial<ClaimStatus> = {
      proposal_id: preloaded.id, proposal_path: preloaded.path, state: "open", status: "listed",
      confirmed_balance_sats: 0, claim_floor_sats: CLAIM_FLOOR_SATS, escrow_address: KNOTS, accepting_funds: true,
    };
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (/\/claims\/[^/]+$/.test(url) && !/\/claims\/(params|apply|applications)/.test(url)) return Response.json(claim);
      if (url.includes("/address/")) return Response.json({ chain_stats: { funded_txo_sum: 0, spent_txo_sum: 0 }, mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0 } });
      return new Response("{}", { status: 404 });
    }));
    document.body.innerHTML = `<div id="app"></div>`;
    const { renderProposalPage } = await import("./proposal-page");
    void renderProposalPage(preloaded.path, (i) => i, null, () => undefined, preloaded);
    await vi.waitFor(() => {
      if (!document.querySelector("#onchain-escrow-address")) throw new Error("row not re-inserted");
    }, { timeout: 4000 });
    const el = document.querySelector<HTMLElement>("#onchain-escrow-address")!;
    expectExactAddress(el, claim.escrow_address!);
    document.querySelector<HTMLButtonElement>("#onchain-escrow-row [data-escrow-copy]")!.click();
    await vi.waitFor(() => expect(clipboard).toHaveLength(1));
    expect(clipboard[0]).toBe(claim.escrow_address);
  });
});
