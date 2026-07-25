export type ProfileLink = {
  label: string;
  url: string;
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
  claim_summary?: ClaimSummary;
  reviewer_active?: boolean;
  reviewer_kind?: "bootstrap" | "earned";
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
  | "redirected";

export type ProposalMilestone = {
  id?: string;
  deliverable: string;
  verification: string;
  out_of_scope: string;
  allocation_sats: number;
  deadline: string;
  dependencies?: string[];
};

export type ProposalProposer = {
  github?: string | null;
  username?: string | null;
  nostr?: string | null;
};

export type Proposal = {
  id: string | null;
  title: string;
  status: ProposalStatus | string;
  path: string;
  target_sats: number | null;
  escrow_address: string | null;
  submission_fee_txid: string | null;
  cover_image?: string | null;
  created_at: string | null;
  escrow_index: number | null;
  milestones: ProposalMilestone[];
  body: string;
  balance_sats?: number;
  proposer?: ProposalProposer | null;
  claimer?: string | null;
  claimed_at?: string | null;
  payout_address?: string | null;
  deliverable_url?: string | null;
  escrow_allocated_at?: string | null;
  funding_window_ends_at?: string | null;
  milestones_due_at?: string | null;
  release_blocked_reason?: string | null;
};

export type Route =
  | { name: "home" }
  | { name: "about" }
  | { name: "params" }
  | { name: "account" }
  | { name: "work" }
  | { name: "propose" }
  | { name: "reviewers" }
  | { name: "proposal"; id: string }
  | { name: "profile"; username: string };
