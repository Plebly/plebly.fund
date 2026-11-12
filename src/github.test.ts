import { afterEach, describe, expect, it, vi } from "vitest";
import { PROPOSALS_API, PROPOSALS_RAW } from "./config";
import {
  applyCatalogRuntimeToProposal,
  clearListedProposalsCache,
  listListedProposals,
  loadListedProposals,
  withoutHiddenCompletedListings,
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

  it("keeps catalog accepting_funds and structured_state on a matching status", () => {
    const merged = applyCatalogRuntimeToProposal(
      doc({ status: "claimable" }),
      doc({
        status: "claimable",
        accepting_funds: false,
        structured_state: "psbt_ready",
      }),
    );
    expect(merged.status).toBe("claimable");
    expect(merged.accepting_funds).toBe(false);
    expect(merged.structured_state).toBe("psbt_ready");
  });
});

describe("worker catalog funding signals", () => {
  afterEach(() => {
    clearListedProposalsCache();
    vi.unstubAllGlobals();
  });

  it("copies accepting_funds and structured_state off the catalog JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/proposals/catalog")) {
          return Response.json({
            proposals: [
              {
                id: "PLEBLY-FUNDS-CLOSED",
                path: "proposals/listed/PLEBLY-FUNDS-CLOSED.md",
                title: "Closed to coins",
                status: "claimable",
                accepting_funds: false,
                structured_state: "psbt_ready",
                balance_sats: 200_000,
              },
            ],
          });
        }
        throw new Error(`unexpected fetch ${url}`);
      }),
    );
    const [row] = await listListedProposals();
    expect(row?.accepting_funds).toBe(false);
    expect(row?.structured_state).toBe("psbt_ready");
    expect(row?.balance_sats).toBe(200_000);
  });
});

describe("loadListedProposals catalog source", () => {
  afterEach(() => {
    clearListedProposalsCache();
    vi.unstubAllGlobals();
  });

  it("sets fromCatalog when the Worker scope=listed catalog answers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/proposals/catalog?scope=listed")) {
          return Response.json({
            proposals: [
              {
                id: "PLEBLY-2026-001",
                path: "proposals/completed/PLEBLY-2026-001.md",
                title: "Visible completed",
                status: "completed",
              },
            ],
          });
        }
        throw new Error(`unexpected fetch ${url}`);
      }),
    );
    const loaded = await loadListedProposals();
    expect(loaded.fromCatalog).toBe(true);
    expect(loaded.proposals.map((p) => p.id)).toEqual(["PLEBLY-2026-001"]);
  });

  it("sets fromCatalog false when the catalog is down and the folder fallback returns completed", async () => {
    const folders: Record<string, { id: string; status: string; dir: string }[]> = {
      listed: [{ id: "OPEN", status: "listed", dir: "listed" }],
      claimed: [],
      completed: [
        { id: "PLEBLY-2026-001", status: "completed", dir: "completed" },
        { id: "PLEBLY-2026-010", status: "completed", dir: "completed" },
        { id: "PLEBLY-2026-011", status: "completed", dir: "completed" },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/proposals/catalog")) {
          return new Response("down", { status: 503 });
        }
        if (url.startsWith(`${PROPOSALS_API}/`)) {
          const dir = url.slice(PROPOSALS_API.length + 1);
          const files = (folders[dir] || []).map((row) => ({
            name: `${row.id}.md`,
            path: `proposals/${row.dir}/${row.id}.md`,
            type: "file",
            download_url: `${PROPOSALS_RAW}/proposals/${row.dir}/${row.id}.md`,
          }));
          return Response.json(files);
        }
        if (url.startsWith(`${PROPOSALS_RAW}/`)) {
          const path = url.slice(PROPOSALS_RAW.length + 1);
          const id = path.split("/").pop()?.replace(/\.md$/, "") || "unknown";
          const status = path.includes("/completed/") ? "completed" : "listed";
          return new Response(
            `---\nid: ${id}\ntitle: ${id}\nstatus: ${status}\n---\n`,
          );
        }
        throw new Error(`unexpected fetch ${url}`);
      }),
    );
    const loaded = await loadListedProposals();
    expect(loaded.fromCatalog).toBe(false);
    expect(loaded.proposals.map((p) => p.id).sort()).toEqual([
      "OPEN",
      "PLEBLY-2026-001",
      "PLEBLY-2026-010",
      "PLEBLY-2026-011",
    ]);
    expect(await listListedProposals()).toBe(loaded.proposals);
  });
});

describe("withoutHiddenCompletedListings", () => {
  const row = (id: string, status: string): Proposal =>
    ({
      id,
      title: id,
      path: `proposals/${status}/${id}.md`,
      status,
      proposal_type: "bounty",
      target_sats: null,
      escrow_address: null,
      submission_fee_txid: null,
      created_at: null,
      escrow_index: null,
      milestones: [],
      body: "",
    }) as Proposal;

  it("drops completed rows in scope=all that are absent from scope=listed", () => {
    const listed = [row("VIS-1", "completed"), row("VIS-2", "listed")];
    const all = [
      ...listed,
      row("HID-DONE", "completed"),
      row("PUB-DECLINED", "declined"),
    ];
    expect(withoutHiddenCompletedListings(all, listed).map((p) => p.id)).toEqual([
      "VIS-1",
      "VIS-2",
      "PUB-DECLINED",
    ]);
  });

  it("matches listed ids case-insensitively", () => {
    const listed = [row("vis-1", "completed")];
    const all = [row("VIS-1", "completed"), row("HID-DONE", "completed")];
    expect(withoutHiddenCompletedListings(all, listed).map((p) => p.id)).toEqual([
      "VIS-1",
    ]);
  });

  it("hides every completed row when the listed catalog is empty (fail safe)", () => {
    const all = [
      row("VIS-1", "completed"),
      row("HID-DONE", "completed"),
      row("PUB-DECLINED", "declined"),
    ];
    expect(withoutHiddenCompletedListings(all, []).map((p) => p.id)).toEqual([
      "PUB-DECLINED",
    ]);
  });
});

