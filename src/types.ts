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

export type PublicProfile = Pick<
  UserProfile,
  "username" | "bio" | "links" | "github" | "nostr" | "x" | "avatar_url" | "created_at"
>;

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
};

export type Route =
  | { name: "home" }
  | { name: "about" }
  | { name: "params" }
  | { name: "account" }
  | { name: "work" }
  | { name: "propose" }
  | { name: "proposal"; id: string }
  | { name: "profile"; username: string };
