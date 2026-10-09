import { isSharedEscrow, type EscrowRow } from "./escrow-shared";
import { MEMPOOL_API } from "./config";

/**
 * Address to read a live chain balance from for this proposal, or null.
 * Never the address of a shared row (`isSharedEscrow`: a null flag, a
 * `true` flag, or several catalog rows on one address all count as shared):
 * that address holds several proposals' coins, so its balance is not this
 * proposal's. Those rows use only the catalog's per-proposal balance_sats; null
 * means no confirmed own funding yet and renders as "Awaiting confirmation"
 * (fundable) or no meter (terminal) — never as 0 sats.
 */
export function balanceAddressFor(
  p: { escrow_address?: string | null; escrow_shared?: boolean | null } | null | undefined,
  catalog: ReadonlyArray<EscrowRow> = [],
): string | null {
  // One shared-address rule (fails toward shared: a null flag is shared).
  // A non-string address is bad data: no read, and no throw.
  if (!p || isSharedEscrow(p, catalog)) return null;
  if (typeof p.escrow_address !== "string") return null;
  const address = p.escrow_address.trim();
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
 *
 * `baseline` is the caller's known balance. When it is unknown (omitted), the
 * first successful read becomes the baseline and fires once with
 * `previous: null` so callers can show the real balance, but never a delta:
 * an unknown balance is not 0, and a failed first read must not turn the next
 * good read into "N added".
 */
export function watchConfirmedBalance(
  address: string,
  onUpdate: (balance: number, meta: { previous: number | null }) => void,
  opts?: { intervalMs?: number; baseline?: number },
): { stop: () => void; ready: Promise<void> } {
  const intervalMs = opts?.intervalMs ?? 10_000;
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let previous =
    typeof opts?.baseline === "number" && Number.isFinite(opts.baseline)
      ? opts.baseline
      : null;

  const setBaseline = (balance: number) => {
    previous = balance;
    if (!stopped) onUpdate(balance, { previous: null });
  };

  const tick = async () => {
    if (stopped) return;
    try {
      const balance = await addressBalanceSats(address);
      // stop() may land while the read is in flight; never report after it.
      if (stopped) return;
      if (previous == null) {
        setBaseline(balance);
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
        setBaseline(await addressBalanceSats(address));
      } catch {
        // Stay unknown: the next successful tick sets the baseline.
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
  // A 200 that isn't a list is an unreadable address, not an empty one: an
  // empty baseline would turn every existing UTXO into "new" on the next read.
  if (!Array.isArray(data)) throw new Error("mempool utxo: not a list");
  return data;
}
