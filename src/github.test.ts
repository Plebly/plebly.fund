import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyCatalogRuntimeToProposal,
  clearListedProposalsCache,
  listListedProposals,
} from "./github";
import type { Proposal } from "./types";

describe("listed catalog cache", () => {
  afterEach(() => {
    clearListedProposalsCache();
    vi.unstubAllGlobals();
  });

  it("reuses the Worker catalog until cleared", async () => {
    let hits = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/proposals/catalog")) {
          hits += 1;
          return Response.json({
            proposals: [
              {
                id: "PLEBLY-1",
                path: "proposals/listed/PLEBLY-1.md",
                title: "One",
                status: "listed",
              },
            ],
          });
        }
        throw new Error(`unexpected fetch ${url}`);
      }),
    );
    const first = await listListedProposals();
    const second = await listListedProposals();
    expect(hits).toBe(1);
    expect(first[0]?.id).toBe("PLEBLY-1");
    expect(second[0]?.id).toBe("PLEBLY-1");
    clearListedProposalsCache();
    await listListedProposals();
    expect(hits).toBe(2);
  });
});


describe("applyCatalogRuntimeToProposal", () => {
  const doc = (over: Partial<Proposal> = {}): Proposal =>
    ({
      id: "PLEBLY-2026-003",
      path: "proposals/listed/PLEBLY-2026-003.md",
      title: "Wave B",
      status: "listed",
      proposal_type: "bounty",
      tags: [],
      cover_image: null,
      created_at: null,
      target_sats: 10000,
      escrow_address: null,
      proposer_type: "individual",
      proposer: null,
      submission_fee_txid: null,
      escrow_index: null,
      milestones: [],
      body: "",
      ...over,
    }) as Proposal;

  it("overlays catalog in_review onto listed markdown (never Still-raising shape)", () => {
    const merged = applyCatalogRuntimeToProposal(
      doc({ status: "listed" }),
      doc({
        status: "in_review",
        claimer: "nostr:abc",
        escrow_address: "tb1qhj27cegpek02g8g4peps0x7gqs0svvs888svyz",
        balance_sats: 26000,
      }),
    );
    expect(merged.status).toBe("in_review");
    expect(merged.claimer).toBe("nostr:abc");
    expect(merged.body).toBe(""); // keep markdown body
  });

  it("leaves listed alone when catalog is also listed", () => {
    expect(
      applyCatalogRuntimeToProposal(doc(), doc({ status: "listed" })).status,
    ).toBe("listed");
  });

  it("does not downgrade in_review doc to listed catalog", () => {
    expect(
      applyCatalogRuntimeToProposal(
        doc({ status: "in_review" }),
        doc({ status: "listed" }),
      ).status,
    ).toBe("in_review");
  });
});
