import { escapeHtml } from "./util";

export type HashGateState =
  | "empty"
  | "invalid"
  | "match"
  | "mismatch"
  | "no-published";

export function decodePsbtBase64(b64: string): Uint8Array | null {
  const s = b64.trim().replace(/\s+/g, "");
  if (!s) return null;
  try {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

export async function sha256HexOfBytes(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy);
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

export async function sha256HexOfPsbtBase64(
  b64: string,
): Promise<string | null> {
  const bytes = decodePsbtBase64(b64);
  if (!bytes) return null;
  return sha256HexOfBytes(bytes);
}

export async function hashGateState(
  receivedBase64: string,
  publishedHex: string | undefined | null,
): Promise<HashGateState> {
  if (!receivedBase64.trim()) return "empty";
  const hex = await sha256HexOfPsbtBase64(receivedBase64);
  if (!hex) return "invalid";
  const published = (publishedHex || "").trim().toLowerCase();
  if (!published) return "no-published";
  return hex === published ? "match" : "mismatch";
}

export function hashGateLabel(state: HashGateState): string {
  if (state === "empty") {
    return "Paste the unsigned transaction you received to compare SHA-256.";
  }
  if (state === "invalid") return "Not valid base64.";
  if (state === "no-published") return "No published hash to compare.";
  if (state === "match") return "SHA-256 matches the published hash.";
  return "SHA-256 does not match the published hash.";
}

/** Hash of raw PSBT bytes (same as Worker sha256Hex), not the base64 string. */
export function hashGateHtml(opts: {
  publishedHash?: string | null;
  inputId: string;
  statusId: string;
}): string {
  const hash = (opts.publishedHash || "").trim();
  return `<div class="kh-hash-gate">
    ${
      hash
        ? `<p class="muted">Published SHA-256 <code class="mono">${escapeHtml(hash)}</code></p>`
        : `<p class="muted">No published SHA-256 yet.</p>`
    }
    <label class="donate-amount-label" for="${escapeHtml(opts.inputId)}">Unsigned transaction you received (base64)</label>
    <textarea id="${escapeHtml(opts.inputId)}" class="comment-input mono" rows="3" placeholder="Paste to verify hash"></textarea>
    <p class="muted" id="${escapeHtml(opts.statusId)}" role="status">${escapeHtml(hashGateLabel("empty"))}</p>
  </div>`;
}

export function bindHashGate(opts: {
  input: HTMLTextAreaElement | null;
  status: HTMLElement | null;
  publishedHash?: string | null;
  action?: HTMLButtonElement | null;
  enableActionWithoutHash?: boolean;
}): void {
  const { input, status, action } = opts;
  if (!input) return;
  const published = (opts.publishedHash || "").trim();
  const sync = async () => {
    const state = await hashGateState(input.value, published);
    if (status) status.textContent = hashGateLabel(state);
    if (!action) return;
    if (!published) {
      action.disabled = opts.enableActionWithoutHash === false;
      return;
    }
    action.disabled = state !== "match";
  };
  input.addEventListener("input", () => {
    void sync();
  });
  void sync();
}

/** <1M → 7d, 1M–10M → 14d, >10M → 30d. Keep aligned with Worker challengeWindowDays. */
export function challengeWindowDays(allocationSats: number): number {
  const n = Math.max(0, Math.floor(Number(allocationSats) || 0));
  if (n < 1_000_000) return 7;
  if (n <= 10_000_000) return 14;
  return 30;
}
