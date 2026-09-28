export type SigningCard = {
  card_id: string;
  source: "structure" | "branch" | "release";
  bucket: "approved" | "flagged" | "blocked";
  block_reason?: string;
  flag_text?: string;
  proposal_id: string;
  allocation_id?: string;
  disburse_id?: string;
  kind: string;
  title: string;
  published_sha256: string;
  psbt_base64: string;
  outputs: { address: string; amount_sats: number; label?: string }[];
  outpoints: string[];
  signed: number;
  required_threshold: number;
  state: string;
  settle_txid?: string;
  awaiting_confirmation: boolean;
  in_sitting: boolean;
  recompute?: {
    work_sats?: number;
    miner_fee_sats?: number;
    disbursed_sats?: number;
    input_sats?: number;
  };
};
