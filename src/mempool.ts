import { MEMPOOL_API } from "./config";

export async function addressBalanceSats(address: string): Promise<number> {
  const res = await fetch(`${MEMPOOL_API}/address/${address}`);
  if (!res.ok) throw new Error(`mempool ${res.status}`);
  const data = (await res.json()) as {
    chain_stats: { funded_txo_sum: number; spent_txo_sum: number };
  };
  return data.chain_stats.funded_txo_sum - data.chain_stats.spent_txo_sum;
}
