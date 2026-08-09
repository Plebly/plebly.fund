import { BITCOIN_NETWORK } from "./config";

/**
 * Decode optional amount from a BOLT11 invoice prefix (msat → sats).
 * Returns null when the invoice is amount-less or unparseable.
 */
export function bolt11AmountSats(bolt11: string): number | null {
  const s = bolt11.trim().toLowerCase();
  const m = s.match(/^ln(?:bc|tb|bcrt)(\d+)([munp]?)1/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const mult = m[2];
  const btc =
    mult === "m"
      ? n / 1e3
      : mult === "u"
        ? n / 1e6
        : mult === "n"
          ? n / 1e9
          : mult === "p"
            ? n / 1e12
            : n;
  return Math.round(btc * 1e8);
}

/** Expected BOLT11 HRP prefix for the SPA build network. */
export function expectedBolt11Prefix(
  network: string = BITCOIN_NETWORK,
): "lnbc" | "lntb" {
  const n = network.toLowerCase();
  if (n === "mainnet" || n === "bitcoin") return "lnbc";
  return "lntb"; // testnet (and refuse signet LN elsewhere)
}

export function assertLightningSwapMatches(
  swap: {
    bolt11: string;
    invoice_amount_sats: number;
    escrow_address: string;
  },
  expected: { amount_sats: number; escrow_address: string },
  network: string = BITCOIN_NETWORK,
): void {
  const wantAddr = expected.escrow_address.trim().toLowerCase();
  const gotAddr = swap.escrow_address.trim().toLowerCase();
  if (!wantAddr || gotAddr !== wantAddr) {
    throw new Error("Lightning invoice escrow_address mismatch");
  }
  if (swap.invoice_amount_sats !== expected.amount_sats) {
    throw new Error(
      `Lightning invoice amount mismatch (api ${swap.invoice_amount_sats} ≠ ${expected.amount_sats})`,
    );
  }
  const bolt11 = swap.bolt11.trim().toLowerCase();
  const prefix = expectedBolt11Prefix(network);
  if (!bolt11.startsWith(prefix)) {
    throw new Error(
      `Lightning invoice network mismatch (want ${prefix}… for ${network})`,
    );
  }
  const decoded = bolt11AmountSats(swap.bolt11);
  if (decoded == null) {
    throw new Error("amount-less lightning invoice rejected");
  }
  if (decoded !== expected.amount_sats) {
    throw new Error(
      `Lightning invoice amount mismatch (bolt11 ${decoded} ≠ ${expected.amount_sats})`,
    );
  }
}
