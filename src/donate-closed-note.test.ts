// workers#51 pairing: where accepting_funds:false hides Donate and the escrow
// address, show a short reason note in that spot (plain text, no live region).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClaimStatus } from "./builder";
import {
  DONATE_CLOSED_BUILDING,
  DONATE_CLOSED_OTHER,
  DONATE_CLOSED_REFUNDING,
  donateClosedNoteHtml,
  donateClosedReason,
  escrowClosedNoteHtml,
} from "./donate-closed-note";
import type { Proposal } from "./types";

const ESCROW = "tb1qtest";

function proposal(partial: Partial<Proposal> = {}): Proposal {
  return {
    id: "demo",
    path: "proposals/listed/demo.md",
    title: "Demo",
    status: "listed",
    target_sats: null,
    escrow_address: ESCROW,
    submission_fee_txid: null,
    created_at: null,
    escrow_index: null,
    milestones: [],
    body: "",
    balance_sats: 200_000,
    ...partial,
  };
}

describe("donateClosedReason copy", () => {
  it("claimed: funding closed while being built", () => {
    expect(DONATE_CLOSED_BUILDING).toBe("Funding is closed while this is being built.");
    expect(donateClosedReason("claimed", { accepting_funds: false, state: "claimed" })).toBe(DONATE_CLOSED_BUILDING);
  });
  it("in_review: funding closed while being built", () => {
    expect(donateClosedReason("in_review", { accepting_funds: false, state: "in_review" })).toBe(DONATE_CLOSED_BUILDING);
  });
  it("refunding: refunds in progress", () => {
    expect(DONATE_CLOSED_REFUNDING).toBe("Refunds in progress.");
    expect(donateClosedReason("refunding", { accepting_funds: false, state: "unavailable" })).toBe(DONATE_CLOSED_REFUNDING);
  });
  it("any other non-fundable state: generic copy", () => {
    expect(DONATE_CLOSED_OTHER).toBe("This listing isn't accepting funds.");
    for (const s of ["declined", "completed", "underfunded", "redirected", "rejected"]) {
      expect(donateClosedReason(s, { accepting_funds: false, state: "unavailable" })).toBe(DONATE_CLOSED_OTHER);
    }
  });
  it("control: no reason unless the claim view says accepting_funds:false", () => {
    expect(donateClosedReason("claimed", { accepting_funds: true, state: "claimed" })).toBeNull();
    expect(donateClosedReason("claimed", { state: "claimed" })).toBeNull();
    expect(donateClosedReason("claimed", null)).toBeNull();
  });
  it("note is plain text styled by .donate-closed-note (not .muted), no live region", () => {
    const html = donateClosedNoteHtml(DONATE_CLOSED_OTHER);
    expect(html).toContain('class="donate-closed-note"');
    expect(html).not.toMatch(/class="[^"]*\bmuted\b/);
    expect(escrowClosedNoteHtml(DONATE_CLOSED_REFUNDING)).toContain('class="donate-closed-note"');
    expect(escrowClosedNoteHtml(DONATE_CLOSED_REFUNDING)).not.toMatch(/class="[^"]*\bmuted\b/);
    expect(html).toContain(">This listing isn't accepting funds.</p>");
    expect(html).not.toMatch(/role=|aria-live/);
  });
  it("style.css: .donate-closed-note uses --ink-secondary (AA), not --muted", () => {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "style.css"), "utf8");
    const rule = css.match(/(?:^|\n)\.donate-closed-note\s*\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    expect(rule![1]).toMatch(/color:\s*var\(--ink-secondary\)/);
    expect(rule![1]).not.toMatch(/--muted/);
  });
});

/** `later` (if given) is what every fetch after the first returns (a refresh). */
function mockBuilder(status: Partial<ClaimStatus>, later?: Partial<ClaimStatus>): void {
  let calls = 0;
  vi.doMock("./builder", async (importOriginal) => {
    const actual = await importOriginal<typeof import("./builder")>();
    return {
      ...actual,
      fetchClaimStatus: vi.fn(async () => ({
        proposal_id: "demo",
        proposal_path: "proposals/listed/demo.md",
        confirmed_balance_sats: 15_000,
        claim_floor_sats: 10_000,
        escrow_address: ESCROW,
        title: "Demo",
        ...(calls++ > 0 && later ? later : status),
      })),
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
  vi.doMock("./reviewers", () => ({ fetchReviewerMe: vi.fn(async () => null) }));
  vi.doMock("./lightning", async (importOriginal) => {
    const actual = await importOriginal<typeof import("./lightning")>();
    return { ...actual, fetchLightningStatus: vi.fn(async () => ({ enabled: false, reason: "test" })) };
  });
}

/** Sidebar as proposal-page paints it: donate slot for claimed/in_review, escrow row otherwise. */
function paint(p: Proposal, withDonateSlot: boolean): void {
  document.body.innerHTML = `<div id="app">
    <article class="proposal-page">
      <div id="builder" class="builder-panel">
        <div class="builder-actions">
          <button type="button" class="btn ghost next-card-watch" id="builder-watch" data-watching="0">Watch</button>
        </div>
        <div id="builder-body" class="builder-body"><div class="next-card-main"><p class="next-card-sentence">…</p></div></div>
        <p class="builder-msg" id="builder-msg" hidden></p>
      </div>
      ${withDonateSlot ? `<div class="proposal-donate-slot" id="donate-slot-pending" hidden><p class="muted donate-loading" id="donate-loading">Checking donation status…</p></div>` : ""}
      <details class="proposal-onchain"><summary>On-chain details</summary>
        <div class="onchain-panel">${withDonateSlot ? "" : `<div class="onchain-row" id="onchain-escrow-row"><code class="mono">${p.escrow_address}</code></div>`}</div>
      </details>
      ${withDonateSlot ? `<div id="mobile-cta-slot" hidden></div>` : ""}
    </article>
  </div>`;
}

async function bind(p: Proposal): Promise<void> {
  const { bindBuilderPanel } = await import("./builder-panel");
  await bindBuilderPanel(document, { proposal: p, balance: 15_000, user: null, watching: false });
}

function assertNoDonateOrAddress(): void {
  expect(document.querySelector("[data-open-donate]")).toBeNull();
  expect(document.querySelector("#onchain-escrow-row")).toBeNull();
  expect(document.body.innerHTML).not.toContain(`<code class="mono">${ESCROW}</code>`);
  const mobile = document.querySelector<HTMLElement>("#mobile-cta-slot");
  if (mobile) expect(mobile.hidden).toBe(true);
}

describe("bindBuilderPanel: reason in place of Donate / the address", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("./builder");
    vi.doUnmock("./reviewers");
    vi.doUnmock("./lightning");
    document.body.innerHTML = "";
  });

  it("claimed row: donate slot shows the building note, no Donate, no address", async () => {
    vi.resetModules();
    mockBuilder({ state: "claimed", status: "claimed", claimer: "bob", accepting_funds: false });
    const p = proposal({ status: "claimed", claimer: "bob", path: "proposals/claimed/demo.md" });
    paint(p, true);
    await bind(p);
    await vi.waitFor(() => {
      const slot = document.querySelector<HTMLElement>(".proposal-donate-slot")!;
      expect(slot.hidden).toBe(false);
      const note = slot.querySelector<HTMLElement>("#donate-closed-note")!;
      expect(note.textContent).toBe("Funding is closed while this is being built.");
      expect(note.classList.contains("donate-closed-note")).toBe(true);
      expect(note.classList.contains("muted")).toBe(false);
      expect(slot.innerHTML).not.toMatch(/role="status"|aria-live/);
    });
    assertNoDonateOrAddress();
  });

  it("in_review row: donate slot shows the building note", async () => {
    vi.resetModules();
    mockBuilder({ state: "in_review", status: "in_review", claimer: "bob", accepting_funds: false });
    const p = proposal({ status: "in_review", claimer: "bob" });
    paint(p, true);
    await bind(p);
    await vi.waitFor(() => {
      expect(document.querySelector("#donate-closed-note")?.textContent).toBe(
        "Funding is closed while this is being built.",
      );
    });
    assertNoDonateOrAddress();
  });

  it("refunding row: the escrow address row is replaced by 'Refunds in progress.'", async () => {
    vi.resetModules();
    mockBuilder({ state: "unavailable", status: "refunding", accepting_funds: false });
    const p = proposal({ status: "refunding" });
    paint(p, false);
    await bind(p);
    await vi.waitFor(() => {
      const note = document.querySelector<HTMLElement>(".onchain-panel #onchain-escrow-closed-note");
      expect(note?.textContent).toBe("Refunds in progress.");
      expect(note!.classList.contains("donate-closed-note")).toBe(true);
      expect(note!.classList.contains("muted")).toBe(false);
      expect(note!.outerHTML).not.toMatch(/role=|aria-live/);
    });
    assertNoDonateOrAddress();
    // Refund action stays.
    expect(document.querySelector("#next-register")).toBeTruthy();
  });

  it("other non-fundable row (declined): generic note in the address row's place", async () => {
    vi.resetModules();
    mockBuilder({ state: "unavailable", status: "declined", accepting_funds: false });
    const p = proposal({ status: "declined", path: "proposals/declined/demo.md" });
    paint(p, false);
    await bind(p);
    await vi.waitFor(() => {
      expect(document.querySelector("#onchain-escrow-closed-note")?.textContent).toBe(
        "This listing isn't accepting funds.",
      );
    });
    assertNoDonateOrAddress();
  });

  it("funds reopen on refresh: the escrow-row note is removed (PR body: 'If funds reopen, the note is removed')", async () => {
    vi.resetModules();
    mockBuilder(
      { state: "unavailable", status: "declined", accepting_funds: false },
      { state: "unavailable", status: "declined_fundable", accepting_funds: true },
    );
    const p = proposal({ status: "declined_fundable", path: "proposals/declined/demo.md" });
    paint(p, false);
    await bind(p);
    await vi.waitFor(() => {
      expect(document.querySelector("#onchain-escrow-closed-note")?.textContent).toBe(
        "This listing isn't accepting funds.",
      );
    });
    // Tab becomes visible again -> bindBuilderPanel re-fetches the claim view.
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => {
      expect(document.querySelector("#onchain-escrow-closed-note")).toBeNull();
    });
  });

  it("control: funds open on a pooling claimed row shows no closed note", async () => {
    vi.resetModules();
    mockBuilder({
      state: "claimed",
      status: "claimed",
      claimer: "bob",
      accepting_funds: true,
      psbt: { structured_state: "awaiting_funds" } as ClaimStatus["psbt"],
    });
    const p = proposal({ status: "claimed", claimer: "bob", path: "proposals/claimed/demo.md" });
    paint(p, true);
    await bind(p);
    await vi.waitFor(() => {
      expect(document.querySelector("[data-open-donate]")).toBeTruthy();
    });
    expect(document.querySelector("#donate-closed-note")).toBeNull();
    expect(document.querySelector("#onchain-escrow-closed-note")).toBeNull();
  });
});
