import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyClaimStatusToProposal,
  claimFloorShortfall,
  claimWindowDaysLeft,
  fetchClaimStatus,
  isDirectProposal,
  isNearFloor,
  isOpenToClaim,
  isTakenStatus,
  type ClaimStatus,
} from "./builder";
import type { Proposal } from "./types";

function proposal(partial: Partial<Proposal> = {}): Proposal {
  return {
    id: "demo",
    path: "proposals/listed/demo.md",
    title: "Demo",
    status: "listed",
    target_sats: null,
    escrow_address: null,
    submission_fee_txid: null,
    created_at: null,
    escrow_index: null,
    milestones: [],
    body: "",
    ...partial,
  };
}

describe("claim floor helpers", () => {
  it("isTakenStatus covers claim lifecycle", () => {
    expect(isTakenStatus("claimed")).toBe(true);
    expect(isTakenStatus("in_review")).toBe(true);
    expect(isTakenStatus("rejected")).toBe(true);
    expect(isTakenStatus("listed")).toBe(false);
  });

  it("isOpenToClaim requires claimable status, no claimer, and floor", () => {
    const floor = 100_000;
    expect(
      isOpenToClaim(
        proposal({ status: "listed", balance_sats: floor, claimer: null }),
        floor,
      ),
    ).toBe(true);
    expect(
      isOpenToClaim(
        proposal({ status: "funding", balance_sats: floor - 1 }),
        floor,
      ),
    ).toBe(false);
    expect(
      isOpenToClaim(
        proposal({ status: "listed", balance_sats: floor, claimer: "github:1" }),
        floor,
      ),
    ).toBe(false);
    expect(
      isOpenToClaim(proposal({ status: "claimed", balance_sats: floor * 2 }), floor),
    ).toBe(false);
  });

  it("isNearFloor is half-to-floor exclusive of open", () => {
    const floor = 100_000;
    expect(
      isNearFloor(proposal({ status: "listed", balance_sats: 50_000 }), floor),
    ).toBe(true);
    expect(
      isNearFloor(proposal({ status: "listed", balance_sats: 49_999 }), floor),
    ).toBe(false);
    expect(
      isNearFloor(proposal({ status: "listed", balance_sats: 100_000 }), floor),
    ).toBe(false);
  });

  it("claimWindowDaysLeft prefers claim_window_ends_at (extensions)", () => {
    const claimed = "2026-01-01T00:00:00.000Z";
    const ends = new Date(Date.now() + 10 * 86400_000).toISOString();
    const days = claimWindowDaysLeft(claimed, ends);
    expect(days).toBeGreaterThanOrEqual(9);
    expect(days).toBeLessThanOrEqual(11);
  });

  it("direct proposals are never open-to-claim or near-floor claim filters", () => {
    const floor = 100_000;
    const direct = proposal({
      proposal_type: "direct",
      status: "listed",
      balance_sats: floor,
    });
    expect(isDirectProposal(direct)).toBe(true);
    expect(isDirectProposal(proposal({ proposal_type: undefined }))).toBe(false);
    expect(isOpenToClaim(direct, floor)).toBe(false);
    expect(isNearFloor(direct, floor)).toBe(false);
  });

  it("claim-floor shortfall ignores direct campaigns", () => {
    const out = claimFloorShortfall(
      [
        proposal({
          proposal_type: "direct",
          status: "listed",
          balance_sats: 1_000,
        }),
        proposal({
          proposal_type: "bounty",
          status: "listed",
          balance_sats: 2_000,
        }),
      ],
      10_000,
    );
    expect(out.projectCount).toBe(1);
    expect(out.shortfallSats).toBe(8_000);
  });
});

describe("applyClaimStatusToProposal", () => {
  it("prefers state=claimed over catalog status=listed for stepper", () => {
    const base = proposal({ status: "listed", claimer: null });
    const merged = applyClaimStatusToProposal(base, {
      proposal_id: "demo",
      proposal_path: base.path,
      state: "claimed",
      status: "listed",
      confirmed_balance_sats: 15_000,
      claim_floor_sats: 10_000,
      claimer: "nostr:5255bf327a891ac325e8d4be7f1ecf42915336092b8ef134974afd2b28a508e6",
      claimer_user_id:
        "nostr:5255bf327a891ac325e8d4be7f1ecf42915336092b8ef134974afd2b28a508e6",
      claimed_at: "2026-09-19T21:21:08.656Z",
    });
    expect(merged.status).toBe("claimed");
    expect(merged.claimer).toContain("5255bf327a89");
  });

  it("overlays claimed / in_review / declined from Worker status", () => {
    const base = proposal({ status: "listed", claimer: null });
    const claimed: ClaimStatus = {
      proposal_id: "demo",
      proposal_path: base.path,
      state: "claimed",
      confirmed_balance_sats: 1,
      claim_floor_sats: 1,
      claimer: "bob",
      claimed_at: "2026-08-14T00:00:00Z",
    };
    expect(applyClaimStatusToProposal(base, claimed)).toMatchObject({
      status: "claimed",
      claimer: "bob",
    });
    expect(
      applyClaimStatusToProposal(base, { ...claimed, state: "in_review" }),
    ).toMatchObject({ status: "in_review" });
    expect(
      applyClaimStatusToProposal(base, {
        ...claimed,
        state: "unavailable",
        status: "declined",
      }),
    ).toMatchObject({ status: "declined" });
    expect(
      applyClaimStatusToProposal(base, {
        ...claimed,
        state: "open",
        status: "listed",
        escrow_address: "tb1qallocated",
        funding_window_ends_at: "2026-09-01T00:00:00Z",
      }),
    ).toMatchObject({
      status: "listed",
      escrow_address: "tb1qallocated",
      funding_window_ends_at: "2026-09-01T00:00:00Z",
    });
    expect(
      applyClaimStatusToProposal(base, {
        ...claimed,
        state: "in_review",
        status: "in_review",
        release_blocked: true,
        release_blocked_reason: "Keyholder stall",
        release_blocked_seats: [2],
        donor_review_status: "window_open",
        donor_review_expires_at: "2026-08-21T00:00:00Z",
        rebuttal_expires_at: "2026-08-28T00:00:00Z",
        rebuttal_reasoning: "Here is the reply.",
      }),
    ).toMatchObject({
      release_blocked_reason: "Keyholder stall",
      release_blocked_seats: [2],
      donor_review_status: "window_open",
      donor_review_expires_at: "2026-08-21T00:00:00Z",
      rebuttal_expires_at: "2026-08-28T00:00:00Z",
      rebuttal_reasoning: "Here is the reply.",
    });
  });
});

describe("fetchClaimStatus", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads claim status with plain fetch (no Authorization)", async () => {
    const payload: ClaimStatus = {
      proposal_id: "demo",
      proposal_path: "proposals/listed/demo.md",
      state: "claimed",
      confirmed_balance_sats: 15_000,
      claim_floor_sats: 10_000,
      claimer: "nostr:5255bf32",
      claimer_user_id:
        "nostr:5255bf327a891ac325e8d4be7f1ecf42915336092b8ef134974afd2b28a508e6",
    };
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    // Session present must not attach Bearer — that path stalls Workers KV.
    vi.stubGlobal("sessionStorage", {
      getItem: () => "fake-bearer-token",
      setItem: () => {},
      removeItem: () => {},
      clear: () => {},
    });

    const status = await fetchClaimStatus(
      "proposals/listed/demo.md",
      "PLEBLY-2026-001",
    );
    expect(status).toMatchObject({
      state: "claimed",
      claimer_user_id: payload.claimer_user_id,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain("/claims/");
    expect(init.credentials).toBe("omit");
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBeNull();
  });

  it("returns null when the public fetch fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network");
      }),
    );
    expect(
      await fetchClaimStatus("proposals/listed/demo.md", "demo"),
    ).toBeNull();
  });
});
