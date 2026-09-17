import { authFetch } from "./auth";
import { assertLightningSwapMatches } from "./bolt11-amount";
import { WORKERS_API } from "./config";
import { formatSats } from "./util";

const API = () => WORKERS_API.replace(/\/$/, "");

export type LightningStatus = {
  enabled: boolean;
  reason?: string;
  processor?: string;
  network?: string;
  limits?: { maximal: number; minimal: number };
  sweep?: {
    chain_min_sats: number;
    pending_min_sats: number;
    fee_bps?: number;
  };
  fees?: {
    percentage: number;
    minerFees: { claim: number; lockup: number };
  };
  note?: string;
};

export function lightningLimits(status: LightningStatus): {
  min: number;
  max: number;
} {
  return {
    min: status.limits?.minimal ?? 1,
    max: status.limits?.maximal ?? 5 * 100_000_000,
  };
}

export function lightningAmountError(
  amount: number,
  status: LightningStatus,
): string | null {
  const { min, max } = lightningLimits(status);
  if (!Number.isFinite(amount) || amount < min) {
    return `Enter at least ${formatSats(min)}.`;
  }
  if (amount > max) {
    return `Enter at most ${formatSats(max)}.`;
  }
  return null;
}

export function lightningFeeHint(opts: {
  status: LightningStatus;
  mode?: "project" | "endowment";
  expectedOnchainSats?: number;
}): string {
  const dest = opts.mode === "endowment" ? "the endowment" : "the project";
  if (opts.expectedOnchainSats && opts.expectedOnchainSats > 0) {
    return `About ${formatSats(opts.expectedOnchainSats)} landed in ${dest} after the sweep.`;
  }
  const pending = opts.status.sweep?.pending_min_sats;
  const bps = opts.status.sweep?.fee_bps ?? 100;
  const pct = bps / 100;
  const sweepLine = pending
    ? ` when pending Lightning for ${dest} reaches ${formatSats(pending)}`
    : ` on the later chain sweep into ${dest}`;
  return `OpenNode ${pct}% + miner fee${sweepLine}. Not on the claim floor until that UTXO confirms.`;
}

export function lightningStatusSentence(
  status: string,
  opts?: { error?: string; endowment?: boolean },
): { text: string; kind: "live" | "ok" | "bad" | "" } {
  const dest = opts?.endowment ? "the endowment" : "escrow";
  switch (status) {
    case "pending":
    case "unpaid":
      return { text: "Waiting for payment.", kind: "live" };
    case "invoice_paid":
    case "paid":
    case "processing":
      return {
        text: `Invoice paid to OpenNode. Waiting for the batched on-chain sweep into ${dest}…`,
        kind: "live",
      };
    case "claiming":
      return { text: `Sweeping on-chain into ${dest}…`, kind: "live" };
    case "settled":
      return { text: "On-chain sweep confirmed.", kind: "ok" };
    case "expired":
      return { text: "Invoice expired. Create a new Lightning invoice.", kind: "bad" };
    case "failed":
      return {
        text: opts?.error || "Payment didn’t go through. Try again or use on-chain.",
        kind: "bad",
      };
    default:
      return { text: status || "", kind: "" };
  }
}

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
  reused?: boolean;
};

const STATUS_CACHE_KEY = "plebly:ln-status";
const STATUS_CACHE_MS = 5 * 60 * 1000;

function readStatusCache(): LightningStatus | null {
  try {
    const raw = sessionStorage.getItem(STATUS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at?: number; status?: LightningStatus };
    if (
      !parsed.status ||
      !parsed.at ||
      Date.now() - parsed.at >= STATUS_CACHE_MS
    ) {
      return null;
    }
    return parsed.status;
  } catch {
    return null;
  }
}

function writeStatusCache(status: LightningStatus): void {
  try {
    sessionStorage.setItem(
      STATUS_CACHE_KEY,
      JSON.stringify({ at: Date.now(), status }),
    );
  } catch {
    /* ignore */
  }
}

export async function fetchLightningStatus(): Promise<LightningStatus> {
  const cached = readStatusCache();
  if (cached) return cached;
  try {
    const res = await fetch(`${API()}/lightning/status`);
    if (!res.ok) return { enabled: false, reason: `HTTP ${res.status}` };
    const status = (await res.json()) as LightningStatus;
    writeStatusCache(status);
    return status;
  } catch (e) {
    return { enabled: false, reason: (e as Error).message };
  }
}

export async function createLightningInvoice(input: {
  proposal_id?: string | null;
  proposal_path: string;
  escrow_address: string;
  amount_sats: number;
  legal_name?: string;
  proposal_title?: string;
}): Promise<LightningSwapView> {
  const res = await authFetch(`${API()}/lightning/invoice`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      proposal_id: input.proposal_id || undefined,
      proposal_path: input.proposal_path,
      escrow_address: input.escrow_address,
      amount_sats: input.amount_sats,
      legal_name: input.legal_name,
      proposal_title: input.proposal_title,
    }),
  });
  const data = (await res.json()) as LightningSwapView & { error?: string };
  if (!res.ok || !data.bolt11) {
    throw new Error(data.error || `Invoice failed (${res.status})`);
  }
  assertLightningSwapMatches(data, {
    amount_sats: input.amount_sats,
    escrow_address: input.escrow_address,
  });
  return data;
}

/** Endowment LN — dedicated Worker path (no proposal escrow verify). */
export async function createEndowmentLightningInvoice(input: {
  amount_sats: number;
  escrow_address: string;
  anonymous?: boolean;
  legal_name?: string;
}): Promise<LightningSwapView> {
  const res = await authFetch(`${API()}/endowment/lightning/invoice`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      amount_sats: input.amount_sats,
      escrow_address: input.escrow_address,
      anonymous: input.anonymous,
      legal_name: input.legal_name,
    }),
  });
  const data = (await res.json()) as LightningSwapView & { error?: string };
  if (!res.ok || !data.bolt11) {
    throw new Error(data.error || `Invoice failed (${res.status})`);
  }
  assertLightningSwapMatches(data, {
    amount_sats: input.amount_sats,
    escrow_address: input.escrow_address,
  });
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
