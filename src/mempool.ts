import { MEMPOOL_API } from "./config";

/**
 * Address to read a live chain balance from for this proposal, or null.
 * Never the address of a row the catalog marks `escrow_shared` (workers#50):
 * that address holds several proposals' coins, so its balance is not this
 * proposal's. Those rows use only the catalog's per-proposal balance_sats; null
 * means no confirmed own funding yet and renders as "Awaiting confirmation"
 * (fundable) or no meter (terminal) — never as 0 sats.
 */
export function balanceAddressFor(
  p: { escrow_address?: string | null; escrow_shared?: boolean | null } | null | undefined,
): string | null {
  if (!p || p.escrow_shared === true) return null;
  const address = (p.escrow_address || "").trim();
  return address || null;
}

export async function addressBalanceSats(address: string): Promise<number> {
  const res = await fetch(`${MEMPOOL_API}/address/${address}`);
  if (!res.ok) throw new Error(`mempool ${res.status}`);
  const data = (await res.json()) as {
    chain_stats: { funded_txo_sum: number; spent_txo_sum: number };
  };
  return data.chain_stats.funded_txo_sum - data.chain_stats.spent_txo_sum;
}

/**
 * Poll confirmed chain balance. Fires when the confirmed balance changes
 * (typically after a donation confirms). Mempool/unconfirmed sats are ignored.
 */
export function watchConfirmedBalance(
  address: string,
  onUpdate: (balance: number, meta: { previous: number }) => void,
  opts?: { intervalMs?: number; baseline?: number },
): { stop: () => void; ready: Promise<void> } {
  const intervalMs = opts?.intervalMs ?? 10_000;
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let previous =
    typeof opts?.baseline === "number" && Number.isFinite(opts.baseline)
      ? opts.baseline
      : null;

  const tick = async () => {
    if (stopped) return;
    try {
      const balance = await addressBalanceSats(address);
      if (previous == null) {
        previous = balance;
        return;
      }
      if (balance !== previous) {
        const prior = previous;
        previous = balance;
        onUpdate(balance, { previous: prior });
      }
    } catch {
      /* ignore transient explorer errors */
    }
  };

  const ready = (async () => {
    if (previous == null) {
      try {
        previous = await addressBalanceSats(address);
      } catch {
        previous = 0;
      }
    }
    if (!stopped) {
      timer = setInterval(() => void tick(), intervalMs);
    }
  })();

  return {
    ready,
    stop: () => {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

export type AddressUtxo = {
  txid: string;
  vout: number;
  value: number;
  status: { confirmed: boolean };
};

export async function addressUtxos(address: string): Promise<AddressUtxo[]> {
  const res = await fetch(`${MEMPOOL_API}/address/${encodeURIComponent(address)}/utxo`);
  if (!res.ok) throw new Error(`mempool utxo ${res.status}`);
  const data = (await res.json()) as AddressUtxo[];
  return Array.isArray(data) ? data : [];
}
