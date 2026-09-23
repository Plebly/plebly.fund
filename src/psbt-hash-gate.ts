import { solidIcon } from "./icons";
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

function shortMiddle(value: string): string {
  if (value.length <= 18) return value;
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

/** Hash of raw PSBT bytes (same as Worker sha256Hex), not the base64 string. */
export function hashGateHtml(opts: {
  publishedHash?: string | null;
  inputId: string;
  statusId: string;
  /** Truncate the published hash and offer an icon copy. */
  compact?: boolean;
  /** Override paste-field label (distinguish PSBT vs settle txid). */
  pasteLabel?: string;
  /** Override textarea placeholder. */
  placeholder?: string;
}): string {
  const hash = (opts.publishedHash || "").trim();
  const published = !hash
    ? `<p class="muted">No published SHA-256 yet.</p>`
    : opts.compact
      ? `<p class="muted structured-id-line">Published SHA-256 <span class="structured-id"><code class="mono" title="${escapeHtml(hash)}">${escapeHtml(shortMiddle(hash))}</code><button type="button" class="copy-btn copy-btn-icon" data-copy="${escapeHtml(hash)}" title="Copy hash" aria-label="Copy hash">${solidIcon("copy")}</button></span></p>`
      : `<p class="muted">Published SHA-256 <code class="mono">${escapeHtml(hash)}</code></p>`;
  const pasteLabel =
    opts.pasteLabel?.trim() || "Unsigned transaction you received (base64)";
  const placeholder = opts.placeholder?.trim() || "Paste to verify hash";
  return `<div class="kh-hash-gate">
    ${published}
    <label class="donate-amount-label" for="${escapeHtml(opts.inputId)}">${escapeHtml(pasteLabel)}</label>
    <textarea id="${escapeHtml(opts.inputId)}" class="comment-input mono" rows="3" placeholder="${escapeHtml(placeholder)}"></textarea>
    <p class="muted" id="${escapeHtml(opts.statusId)}" role="status">${escapeHtml(hashGateLabel("empty"))}</p>
  </div>`;
}

/** Pure enable predicate for hash-gated actions (+ optional signed-partial). */
export function hashGateActionEnabled(opts: {
  state: HashGateState;
  hasPublishedHash: boolean;
  enableActionWithoutHash?: boolean;
  /** When set, must be true (e.g. signed-partial.trim() non-empty). */
  extraOk?: boolean;
}): boolean {
  const hashOk = !opts.hasPublishedHash
    ? opts.enableActionWithoutHash !== false
    : opts.state === "match";
  if (!hashOk) return false;
  if (opts.extraOk === false) return false;
  return true;
}

export function bindHashGate(opts: {
  input: HTMLTextAreaElement | null;
  status: HTMLElement | null;
  publishedHash?: string | null;
  action?: HTMLButtonElement | null;
  enableActionWithoutHash?: boolean;
  /**
   * When set, action stays disabled until this field is non-empty
   * (in addition to the hash match). Used for Upload signature + signed partial.
   */
  alsoRequire?: HTMLTextAreaElement | null;
  /** Title/aria when hash matches but alsoRequire is empty. */
  alsoRequireEmptyReason?: string;
  /** Title/aria when the gated action is disabled (idiot-proof why). */
  disabledReason?: string;
  /** Title/aria when the gated action is enabled. */
  enabledReason?: string;
}): void {
  const { input, status, action } = opts;
  if (!input) return;
  const published = (opts.publishedHash || "").trim();
  const alsoRequire = opts.alsoRequire ?? null;
  const disabledReason =
    opts.disabledReason?.trim() ||
    "Paste a matching unsigned PSBT (base64) to enable — not a settle txid";
  const enabledReason =
    opts.enabledReason?.trim() || "Hash matches — ready to copy for Sparrow";
  const alsoRequireEmptyReason =
    opts.alsoRequireEmptyReason?.trim() ||
    "Paste a signed partial to enable";
  const sync = async () => {
    const state = await hashGateState(input.value, published);
    if (status) status.textContent = hashGateLabel(state);
    if (!action) return;
    const extraOk = alsoRequire
      ? alsoRequire.value.trim().length > 0
      : undefined;
    const enabled = hashGateActionEnabled({
      state,
      hasPublishedHash: Boolean(published),
      enableActionWithoutHash: opts.enableActionWithoutHash,
      extraOk,
    });
    action.disabled = !enabled;
    let why: string;
    if (enabled) {
      why = enabledReason;
    } else {
      const hashWouldEnable = hashGateActionEnabled({
        state,
        hasPublishedHash: Boolean(published),
        enableActionWithoutHash: opts.enableActionWithoutHash,
      });
      if (hashWouldEnable && alsoRequire && extraOk === false) {
        why = alsoRequireEmptyReason;
      } else if (!published) {
        why = "No published hash to compare yet";
      } else {
        why = disabledReason;
      }
    }
    action.title = why;
    action.setAttribute("aria-label", why);
  };
  input.addEventListener("input", () => {
    void sync();
  });
  alsoRequire?.addEventListener("input", () => {
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
