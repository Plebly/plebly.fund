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
};
