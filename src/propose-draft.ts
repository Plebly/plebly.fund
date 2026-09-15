import type { DependsOnEntry, RelatedWorkEntry } from "./types";
import type { MilestoneDraft } from "./propose-milestones";
import {
  PROPOSE_WIZARD_STEPS,
  type ProposeWizardStepId,
} from "./propose-wizard";

export const PROPOSE_DRAFT_KEY = "plebly:propose-draft";

export type ProposeLocalDraft = {
  v: 1;
  saved_at: number;
  step: ProposeWizardStepId;
  title: string;
  proposer_type: "individual" | "org";
  proposer_org_login: string;
  proposal_type: "bounty" | "direct";
  claim_mode: "first_bonded" | "proposer_select";
  claim_window_days: number;
  tags: string[];
  parent_initiative: string;
  problem: string;
  deliverable: string;
  verification: string;
  out_of_scope: string;
  notes: string;
  target_sats: string;
  cover_image: string | null;
  fee_txid: string;
  milestones: MilestoneDraft[];
  depends_on: DependsOnEntry[];
  related_work: RelatedWorkEntry[];
};

function isStep(raw: unknown): raw is ProposeWizardStepId {
  return PROPOSE_WIZARD_STEPS.some((s) => s.id === raw);
}

export function loadProposeDraft(): ProposeLocalDraft | null {
  try {
    const raw = sessionStorage.getItem(PROPOSE_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ProposeLocalDraft>;
    if (parsed.v !== 1 || typeof parsed.title !== "string") return null;
    if (!isStep(parsed.step)) parsed.step = "basics";
    return parsed as ProposeLocalDraft;
  } catch {
    return null;
  }
}

export function saveProposeDraft(draft: ProposeLocalDraft): void {
  try {
    sessionStorage.setItem(
      PROPOSE_DRAFT_KEY,
      JSON.stringify({ ...draft, v: 1 as const, saved_at: Date.now() }),
    );
  } catch {
    /* quota / private mode */
  }
}

export function clearProposeDraft(): void {
  try {
    sessionStorage.removeItem(PROPOSE_DRAFT_KEY);
  } catch {
    /* ignore */
  }
}
