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
  body: string;
  balance_sats?: number;
  proposer?: ProposalProposer | null;
};

export type Route =
  | { name: "home" }
  | { name: "params" }
  | { name: "account" }
  | { name: "submit" }
  | { name: "proposal"; id: string }
  | { name: "profile"; username: string };
