export type ProfileLink = {
  label: string;
  url: string;
};

export type FunderCreditPreferences = {
  public_credit: boolean;
  show_amount: boolean;
};

export type GithubOrgAttestation = {
  login: string;
  role: "admin";
  verified_at: string;
  avatar_url?: string;
  /** GitHub org display name (e.g. Plebly vs plebly). */
  name?: string;
};

export type UserProfile = {
  id: string;
  username?: string;
  bio?: string;
  links?: ProfileLink[];
  github?: string;
  x?: string;
  nostr?: string;
  avatar_url?: string;
  payout_address?: string;
  skills_tags?: string[];
  /** Default appearance on public funder lists. */
  funder_credit?: FunderCreditPreferences;
  /** Private: linked GitHub orgs for claim-as-org (from Account). */
  github_orgs?: GithubOrgAttestation[];
  created_at?: string;
  updated_at?: string;
  username_claimed_at?: string;
};

export type ClaimSummary = {
  active: number;
  completed: number;
  expired: number;
  rejected: number;
  abandoned: number;
};

export type PublicProfile = Pick<
  UserProfile,
  "username" | "bio" | "links" | "github" | "nostr" | "x" | "avatar_url" | "created_at"
> & {
  claim_suspended?: boolean;
  claim_suspend_reason?: string;
  claim_suspend_until?: string;
  discussion_muted?: boolean;
  discussion_mute_reason?: string;
  discussion_muted_until?: string;
  claim_summary?: ClaimSummary;
  funded_completed_count?: number;
  funded_sats_total?: number;
  funder_streak?: number;
  funder_streak_best?: number;
  reviewer_active?: boolean;
  reviewer_kind?: "bootstrap" | "earned";
  /** Public GitHub orgs where this user's linked GitHub is a public member. */
  public_orgs?: { login: string; avatar_url: string; name: string | null }[];
};

export type ProposalStatus =
  | "pr_open"
  | "unindexed"
  | "listed"
  | "declined"
  | "declined_fundable"
  | "funding"
  | "underfunded"
  | "claimable"
  | "claimed"
  | "in_review"
  | "rejected"
  | "completed"
  | "abandoned_vote"
  | "refunding"
  | "redirected"
  | "redirect_pending";

export type ProposalMilestone = {
  id?: string;
  deliverable: string;
  verification: string;
  out_of_scope: string;
  allocation_sats: number;
  /** Optional funding-bar unlock (display only; not payout). */
  funding_threshold_sats?: number;
  deadline: string;
  dependencies?: string[];
};

export type ProposalProposer = {
  github?: string | null;
  username?: string | null;
  nostr?: string | null;
  x?: string | null;
  /** Submitting human GitHub login when proposer_type is org. */
  agent?: string | null;
};

export type DependsOnEntry = {
  kind: "plebly" | "external";
  label: string;
  ref?: string;
  note?: string;
};

export type RelatedWorkEntry = {
  label: string;
  url: string;
  note?: string;
};

export type ProposalType = "bounty" | "direct";

export type Proposal = {
  id: string | null;
  title: string;
  status: ProposalStatus | string;
  /** bounty (default) | direct: proposer is recipient */
  proposal_type?: ProposalType | string | null;
  tags?: string[];
  parent_initiative?: string | null;
  path: string;
  target_sats: number | null;
  escrow_address: string | null;
  submission_fee_txid: string | null;
  cover_image?: string | null;
  created_at: string | null;
  escrow_index: number | null;
  milestones: ProposalMilestone[];
  depends_on?: DependsOnEntry[];
  related_work?: RelatedWorkEntry[];
  body: string;
  balance_sats?: number;
  proposer?: ProposalProposer | null;
  /** individual (default) | org */
  proposer_type?: "individual" | "org" | string | null;
  claimer?: string | null;
  claimer_type?: "individual" | "org" | string | null;
  claim_agent?: string | null;
  claim_mode?: "first_bonded" | "proposer_select" | string | null;
  claim_window_days?: number | null;
  /** Catalog enrich from claim application pool (optional). */
  claim_apps_total?: number | null;
  claim_apps_bonded?: number | null;
  claim_phase?: string | null;
  claim_window_ends_at?: string | null;
  claim_decision_ends_at?: string | null;
  claimed_at?: string | null;
  payout_address?: string | null;
  deliverable_url?: string | null;
  escrow_allocated_at?: string | null;
  funding_window_ends_at?: string | null;
  delivery_window_ends_at?: string | null;
  milestones_due_at?: string | null;
  release_blocked_reason?: string | null;
  view_count?: number;
  /** Catalog enrich: rescue stall signal (optional). */
  rescue?: boolean;
  rescue_gap_sats?: number | null;
  watch_count?: number;
};

/** Statuses editable in-app after the file is on main (pre-claim). */
export const EDITABLE_PROPOSAL_STATUSES = new Set([
  "unindexed",
  "listed",
  "funding",
  "underfunded",
  "claimable",
  "declined_fundable",
]);

export type Route =
  | { name: "home" }
  | { name: "about" }
  | { name: "stats" }
  | { name: "declined" }
  | { name: "completed" }
  | { name: "keyholders" }
  | { name: "params" }
  | { name: "account" }
  | { name: "work" }
  | { name: "propose" }
  | { name: "reviewers" }
  | { name: "wanted" }
  | { name: "proposal"; id: string; stable?: boolean }
  | { name: "profile"; username: string }
  | { name: "org"; login: string };
