/**
 * Check a published PSBT before a device is asked to sign.
 * Amounts use the same split as the Worker, including dust folding.
 */
import {
  BDI_FEE_PERCENT,
  KEYHOLDER_CAP_SATS,
  KEYHOLDER_FEE_PERCENT,
  PLATFORM_FEE_PERCENT,
} from "./generated/parameters";

export const DISPUTE_PENALTY_PERCENT = 1;
const DUST_SATS = 546;

export type AmountRow = { label?: string; amount_sats: number; address?: string };

export function estimateStructureMinerFeeSats(inputCount: number, outputCount: number): number {
  const nIn = Math.max(1, Math.floor(inputCount));
  const nOut = Math.max(1, Math.floor(outputCount));
  const vsize = 11 + nIn * 150 + nOut * 43;
  return Math.max(DUST_SATS, vsize * 10);
}

export function splitWorkOutput(workSats: number, outputCount: number) {
  const work = Math.max(0, Math.floor(workSats));
  const miner = estimateStructureMinerFeeSats(1, outputCount);
  const bdi = Math.floor((work * BDI_FEE_PERCENT) / 100);
  const ops = Math.floor((work * PLATFORM_FEE_PERCENT) / 100);
  const kh = Math.floor((work * KEYHOLDER_FEE_PERCENT) / 100);
  const penalty = Math.floor((work * DISPUTE_PENALTY_PERCENT) / 100);
  const fees = bdi + ops + kh;
  return {
    miner_fee_sats: miner,
    bdi_sats: bdi,
    ops_sats: ops,
    kh_sats: kh,
    penalty_sats: penalty,
    clean_builder_sats: work - fees - miner,
    disputed_builder_sats: work - fees - penalty - miner,
    refund_sats: work - estimateStructureMinerFeeSats(1, 1),
  };
}

export function dustAwareOutputs(outputs: AmountRow[]): AmountRow[] {
  const builder = outputs.find((o) => o.label === "builder");
  let extra = 0;
  const kept: AmountRow[] = [];
  for (const o of outputs) {
    if (o.label === "builder") continue;
    if (o.amount_sats >= DUST_SATS) kept.push(o);
    else extra += o.amount_sats;
  }
  if (!builder) return kept.filter((o) => o.amount_sats >= DUST_SATS);
  return [{ ...builder, amount_sats: builder.amount_sats + extra }, ...kept];
}

export function computeMonthlyFeeOutput(disbursedSats: number): number {
  const D = Math.max(0, Math.floor(disbursedSats));
  const platform = Math.floor((D * PLATFORM_FEE_PERCENT) / 100);
  const kh = Math.floor((D * KEYHOLDER_FEE_PERCENT) / 100);
  void KEYHOLDER_CAP_SATS;
  return platform + kh;
}

export type VerifyCard = {
  kind: string;
  outputs: AmountRow[];
  recompute?: {
    work_sats?: number;
    miner_fee_sats?: number;
    disbursed_sats?: number;
    input_sats?: number;
  };
};

function amountByLabel(rows: AmountRow[], label: string): number | undefined {
  const row = rows.find((r) => r.label === label);
  return row ? row.amount_sats : undefined;
}

export function expectedAmountRows(card: VerifyCard): AmountRow[] | { error: string } {
  const kind = card.kind;
  const rec = card.recompute || {};
  if (kind === "clean" || kind === "disputed") {
    const work = rec.work_sats;
    if (work == null) return { error: "missing work amount" };
    const split = splitWorkOutput(work, kind === "clean" ? 4 : 5);
    const rows =
      kind === "clean"
        ? dustAwareOutputs([
            { label: "builder", amount_sats: split.clean_builder_sats },
            { label: "bdi_fee", amount_sats: split.bdi_sats },
            { label: "ops_fee", amount_sats: split.ops_sats },
            { label: "kh_fee", amount_sats: split.kh_sats },
          ])
        : dustAwareOutputs([
            { label: "builder", amount_sats: split.disputed_builder_sats },
            { label: "reviewer_penalty", amount_sats: split.penalty_sats },
            { label: "bdi_fee", amount_sats: split.bdi_sats },
            { label: "ops_fee", amount_sats: split.ops_sats },
            { label: "kh_fee", amount_sats: split.kh_sats },
          ]);
    return rows;
  }
  if (kind === "refund" || kind === "timelock" || kind === "reserve_refund") {
    const input = rec.input_sats;
    const fee = rec.miner_fee_sats;
    if (input == null || fee == null) return { error: "missing pool or miner fee" };
    return [{ label: "pool", amount_sats: input - fee }];
  }
  if (kind === "structure") {
    if (!card.outputs.length) return { error: "missing structure outputs" };
    return card.outputs.map((o) => ({ label: o.label, amount_sats: o.amount_sats }));
  }
  if (kind === "release") {
    const D = rec.disbursed_sats;
    if (D == null) return { error: "missing disbursed amount" };
    return [{ label: "fee", amount_sats: computeMonthlyFeeOutput(D) }];
  }
  return { error: "unknown kind" };
}

export function amountsMatchCard(card: VerifyCard): { ok: true } | { ok: false; error: string } {
  const expected = expectedAmountRows(card);
  if ("error" in expected) return { ok: false, error: expected.error };
  if (card.kind === "refund" || card.kind === "timelock" || card.kind === "reserve_refund") {
    const want = expected[0]?.amount_sats;
    const got = card.outputs.reduce((n, o) => n + o.amount_sats, 0);
    if (got !== want) return { ok: false, error: "pool amount does not match the frozen fee" };
    return { ok: true };
  }
  if (card.kind === "release") {
    const want = expected[0]?.amount_sats || 0;
    const got = card.outputs
      .filter((o) => o.label === "platform fee" || o.label === "keyholder pool")
      .reduce((n, o) => n + o.amount_sats, 0);
    if (got !== want) return { ok: false, error: "monthly fee does not match" };
    return { ok: true };
  }
  if (card.kind === "structure") {
    if (card.outputs.length !== expected.length) {
      return { ok: false, error: "structure outputs do not match" };
    }
    return { ok: true };
  }
  for (const row of expected) {
    const got = amountByLabel(card.outputs, row.label || "");
    if (got !== row.amount_sats) {
      return { ok: false, error: `${row.label} amount does not match` };
    }
  }
  return { ok: true };
}

export type ParsedOutput = { address: string; amount_sats: number };

export async function parsedPsbtOutputs(psbtBase64: string): Promise<ParsedOutput[] | { error: string }> {
  const { Transaction, Address, OutScript, NETWORK, TEST_NETWORK } = await import(
    "@scure/btc-signer"
  );
  let bytes: Uint8Array;
  try {
    const bin = atob(psbtBase64.trim().replace(/\s+/g, ""));
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } catch {
    return { error: "not valid base64" };
  }
  let tx: InstanceType<typeof Transaction>;
  try {
    tx = Transaction.fromPSBT(bytes, { allowUnknown: true });
  } catch {
    return { error: "invalid PSBT" };
  }
  const outputs: ParsedOutput[] = [];
  for (let i = 0; i < tx.outputsLength; i++) {
    const o = tx.getOutput(i);
    if (!o.script || o.amount == null) return { error: "output missing" };
    let address = "";
    for (const net of [NETWORK, TEST_NETWORK]) {
      try {
        address = Address(net).encode(OutScript.decode(o.script));
        break;
      } catch {
        address = "";
      }
    }
    if (!address) return { error: "unrecognized output" };
    outputs.push({ address, amount_sats: Number(o.amount) });
  }
  return outputs;
}

export function outputsMatchPublished(
  parsed: ParsedOutput[],
  published: { address: string; amount_sats: number }[],
): boolean {
  if (parsed.length !== published.length) return false;
  const pool = parsed.map((p) => ({
    address: p.address.toLowerCase(),
    amount_sats: p.amount_sats,
  }));
  for (const row of published) {
    const idx = pool.findIndex(
      (p) => p.address === row.address.toLowerCase() && p.amount_sats === row.amount_sats,
    );
    if (idx < 0) return false;
    pool.splice(idx, 1);
  }
  return pool.length === 0;
}
