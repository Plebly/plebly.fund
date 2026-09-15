import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PROPOSE_DRAFT_KEY,
  clearProposeDraft,
  loadProposeDraft,
  saveProposeDraft,
  type ProposeLocalDraft,
} from "./propose-draft";

const sample: ProposeLocalDraft = {
  v: 1,
  saved_at: 1,
  step: "review",
  title: "Signet rehearsal bounty",
  proposer_type: "individual",
  proposer_org_login: "",
  proposal_type: "bounty",
  claim_mode: "proposer_select",
  claim_window_days: 7,
  tags: ["signet"],
  parent_initiative: "",
  problem: "p".repeat(40),
  deliverable: "d".repeat(40),
  verification: "v".repeat(40),
  out_of_scope: "out of scope",
  notes: "",
  target_sats: "10000",
  cover_image: null,
  fee_txid: "c5c37b83eb89202d4688f4e16ebec2b99256e0cf543217bffc42b59f3b257884",
  milestones: [],
  depends_on: [],
  related_work: [],
};

describe("propose local draft", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
    });
  });

  it("round-trips a draft and clears it", () => {
    expect(loadProposeDraft()).toBeNull();
    saveProposeDraft(sample);
    const loaded = loadProposeDraft();
    expect(loaded?.title).toBe(sample.title);
    expect(loaded?.fee_txid).toBe(sample.fee_txid);
    expect(loaded?.step).toBe("review");
    expect(loaded?.v).toBe(1);
    clearProposeDraft();
    expect(loadProposeDraft()).toBeNull();
    expect(sessionStorage.getItem(PROPOSE_DRAFT_KEY)).toBeNull();
  });

  it("rejects junk json", () => {
    sessionStorage.setItem(PROPOSE_DRAFT_KEY, "{not json");
    expect(loadProposeDraft()).toBeNull();
  });
});
