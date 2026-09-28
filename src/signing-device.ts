/**
 * Ledger WebHID and SeedSigner BBQr. Both libraries load only when a sitting starts.
 */
import { decodePsbtBase64 } from "./psbt-hash-gate";

export type PolicyParts = {
  name: string;
  descriptorTemplate: string;
  keys: string[];
};

const KEY_RE =
  /\[([0-9a-fA-F]{8}(?:\/[0-9]+['h]?)*)\]((?:[tx]pub)[1-9A-HJ-NP-Za-km-z]+)(?:\/<0;1>\/\*|\/\*\*|\/[01]\/\*)?/g;

export function descriptorToWalletPolicy(descriptor: string): PolicyParts {
  const keys: string[] = [];
  const descriptorTemplate = descriptor.replace(KEY_RE, (_m, origin: string, xpub: string) => {
    const i = keys.length;
    keys.push(`[${origin}]${xpub}`);
    return `@${i}/**`;
  });
  if (!keys.length) throw new Error("descriptor has no keys");
  return { name: "Plebly escrow", descriptorTemplate, keys };
}

const HMAC_PREFIX = "plebly_ledger_hmac:";

async function descriptorStamp(descriptor: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(descriptor));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function readPolicyHmac(descriptor: string): Promise<Uint8Array | null> {
  const stamp = await descriptorStamp(descriptor);
  const hex = localStorage.getItem(HMAC_PREFIX + stamp);
  if (!hex || hex.length !== 64 || !/^[0-9a-f]+$/i.test(hex)) return null;
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export async function savePolicyHmac(descriptor: string, hmac: Uint8Array): Promise<void> {
  const stamp = await descriptorStamp(descriptor);
  const hex = [...hmac].map((b) => b.toString(16).padStart(2, "0")).join("");
  localStorage.setItem(HMAC_PREFIX + stamp, hex);
}

export function clearPolicyHmac(descriptor: string, stamp: string): void {
  localStorage.removeItem(HMAC_PREFIX + stamp);
  void descriptor;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export async function applyPartialSigs(
  psbtBase64: string,
  sigs: { index: number; pubkey: Uint8Array; signature: Uint8Array }[],
): Promise<string> {
  const { Transaction } = await import("@scure/btc-signer");
  const raw = decodePsbtBase64(psbtBase64);
  if (!raw) throw new Error("invalid PSBT");
  const tx = Transaction.fromPSBT(raw, { allowUnknown: true });
  for (const sig of sigs) {
    const prev = tx.getInput(sig.index).partialSig as [Uint8Array, Uint8Array][] | undefined;
    const next = [...(prev || []), [sig.pubkey, sig.signature] as [Uint8Array, Uint8Array]];
    tx.updateInput(sig.index, { partialSig: next });
  }
  return bytesToBase64(tx.toPSBT());
}

export type LedgerSession = {
  sign(psbtBase64: string): Promise<string>;
  close(): Promise<void>;
};

/** One USB connection for the whole sitting. Registers the policy once. */
export async function openLedgerSession(descriptor: string): Promise<LedgerSession> {
  const [{ default: TransportWebHID }, { AppClient, WalletPolicy }, { Buffer }] = await Promise.all([
    import("@ledgerhq/hw-transport-webhid"),
    import("@ledgerhq/ledger-bitcoin"),
    import("buffer"),
  ]);
  const parts = descriptorToWalletPolicy(descriptor);
  const policy = new WalletPolicy(parts.name, parts.descriptorTemplate, parts.keys);
  const transport = await TransportWebHID.create();
  const app = new AppClient(transport);
  let hmac = await readPolicyHmac(descriptor);
  if (!hmac) {
    const registered = await app.registerWallet(policy);
    hmac = new Uint8Array(registered[1]);
    await savePolicyHmac(descriptor, hmac);
  }
  const signWith = async (psbtBase64: string, hmacBytes: Uint8Array) =>
    app.signPsbt(psbtBase64, policy, Buffer.from(hmacBytes));
  return {
    async sign(psbtBase64: string) {
      let signed: Awaited<ReturnType<typeof signWith>>;
      try {
        signed = await signWith(psbtBase64, hmac as Uint8Array);
      } catch {
        const registered = await app.registerWallet(policy);
        hmac = new Uint8Array(registered[1]);
        await savePolicyHmac(descriptor, hmac);
        signed = await signWith(psbtBase64, hmac);
      }
      return applyPartialSigs(
        psbtBase64,
        signed.map(([index, partial]) => ({
          index,
          pubkey: new Uint8Array(partial.pubkey),
          signature: new Uint8Array(partial.signature),
        })),
      );
    },
    async close() {
      await transport.close();
    },
  };
}

export async function signPsbtWithLedger(
  psbtBase64: string,
  descriptor: string,
): Promise<string> {
  const session = await openLedgerSession(descriptor);
  try {
    return await session.sign(psbtBase64);
  } finally {
    await session.close();
  }
}

export async function seedSignerParts(psbtBase64: string): Promise<string[]> {
  const raw = decodePsbtBase64(psbtBase64);
  if (!raw) throw new Error("invalid PSBT");
  const { splitQRs } = await import("bbqr");
  return splitQRs(raw, "P").parts;
}

export async function joinScannedParts(parts: string[]): Promise<string> {
  const { joinQRs } = await import("bbqr");
  const joined = joinQRs(parts);
  return bytesToBase64(joined.raw);
}

export async function scanQrParts(
  video: HTMLVideoElement,
  signal: AbortSignal,
): Promise<string[]> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "environment" },
  });
  video.srcObject = stream;
  await video.play();
  const Detector = await loadBarcodeDetector();
  const detector = new Detector({ formats: ["qr_code"] });
  const seen: string[] = [];
  try {
    while (!signal.aborted) {
      const codes = await detector.detect(video);
      for (const code of codes) {
        const value = code.rawValue || "";
        if (!value || seen.includes(value)) continue;
        seen.push(value);
        try {
          await joinScannedParts(seen);
          return seen;
        } catch {
          /* need more parts */
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  } finally {
    stream.getTracks().forEach((track) => track.stop());
  }
  throw new Error("scan cancelled");
}

async function loadBarcodeDetector(): Promise<
  new (opts: { formats: string[] }) => { detect: (source: HTMLVideoElement) => Promise<{ rawValue?: string }[]> }
> {
  const builtin = (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector;
  if (typeof builtin === "function") {
    return builtin as new (opts: { formats: string[] }) => {
      detect: (source: HTMLVideoElement) => Promise<{ rawValue?: string }[]>;
    };
  }
  const mod = (await import("barcode-detector")) as {
    BarcodeDetector: new (opts: { formats: string[] }) => {
      detect: (source: HTMLVideoElement) => Promise<{ rawValue?: string }[]>;
    };
  };
  return mod.BarcodeDetector;
}
