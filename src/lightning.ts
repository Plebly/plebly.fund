import { WORKERS_API } from "./config";

const API = () => WORKERS_API.replace(/\/$/, "");

export type LightningStatus = {
  enabled: boolean;
  reason?: string;
  network?: string;
  limits?: { maximal: number; minimal: number };
  fees?: {
    percentage: number;
    minerFees: { claim: number; lockup: number };
  };
  note?: string;
};

export type LightningSwapView = {
  swap_id: string;
  proposal_id: string;
  escrow_address: string;
  invoice_amount_sats: number;
  expected_onchain_sats: number;
  fee_sats: number;
  bolt11: string;
  status: string;
  claim_txid?: string;
  error?: string;
};

export async function fetchLightningStatus(): Promise<LightningStatus> {
  try {
    const res = await fetch(`${API()}/lightning/status`);
    if (!res.ok) return { enabled: false, reason: `HTTP ${res.status}` };
    return (await res.json()) as LightningStatus;
  } catch (e) {
    return { enabled: false, reason: (e as Error).message };
  }
}

export async function createLightningInvoice(input: {
  proposal_id?: string | null;
  proposal_path: string;
  escrow_address: string;
  amount_sats: number;
}): Promise<LightningSwapView> {
  const res = await fetch(`${API()}/lightning/invoice`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      proposal_id: input.proposal_id || undefined,
      proposal_path: input.proposal_path,
      escrow_address: input.escrow_address,
      amount_sats: input.amount_sats,
    }),
  });
  const data = (await res.json()) as LightningSwapView & { error?: string };
  if (!res.ok || !data.bolt11) {
    throw new Error(data.error || `Invoice failed (${res.status})`);
  }
  return data;
}

export async function fetchLightningSwap(id: string): Promise<LightningSwapView> {
  const res = await fetch(`${API()}/lightning/swap/${encodeURIComponent(id)}`);
  const data = (await res.json()) as LightningSwapView & { error?: string };
  if (!res.ok) throw new Error(data.error || `Swap status failed (${res.status})`);
  return data;
}

export async function weblnPay(bolt11: string): Promise<boolean> {
  const webln = (
    window as Window & {
      webln?: {
        enable: () => Promise<void>;
        sendPayment: (paymentRequest: string) => Promise<unknown>;
      };
    }
  ).webln;
  if (!webln) return false;
  await webln.enable();
  await webln.sendPayment(bolt11);
  return true;
}
