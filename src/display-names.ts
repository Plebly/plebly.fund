/**
 * Public display names for people. Never show a raw 64-hex nostr key or a
 * bare numeric `github:` / `gh:` id: use the handle when there is one; a
 * nostr key becomes a short key (first 4 … last 4), e.g. `a5a2…33f6`; a
 * numeric GitHub id becomes "GitHub user 123". Neither ever gets an `@`.
 */

const HEX64 = /^[0-9a-f]{64}$/i;
/** Already-shortened workers labels like `a5a22eaf…33f6`. */
const SHORT_HEX = /^([0-9a-f]{4})[0-9a-f]*…([0-9a-f]{4})$/i;
const GH_NUMERIC = /^(?:github|gh):(\d+)$/i;

/** First 4 … last 4 of a long key; short values are returned as-is. */
export function shortKey(key: string): string {
  const k = key.trim();
  if (k.length < 9) return k;
  return `${k.slice(0, 4)}…${k.slice(-4)}`;
}

/** True when the value is a raw key (not a handle) and should be shortened. */
export function isRawIdentityKey(raw: string | null | undefined): boolean {
  const v = String(raw || "").trim().replace(/^@/, "");
  if (!v) return false;
  const bare = v.replace(/^(?:nostr|github|gh):/i, "");
  if (GH_NUMERIC.test(v)) return true;
  if (/^(?:nostr|github|gh):/i.test(v)) return HEX64.test(bare) || SHORT_HEX.test(bare);
  return HEX64.test(bare) || SHORT_HEX.test(bare) || /^npub1[0-9a-z]{20,}$/i.test(bare);
}

/**
 * Display form for an identity string from the API:
 * - `nostr:<hex>`, bare 64-hex, npub, `a5a22eaf…33f6` → `a5a2…33f6`
 * - `github:<numeric>` / `gh:<numeric>` → `GitHub user 184555205`
 * - a handle (`@ada`, `ada`, `github:ada`) → `ada` (no `@`; callers add one)
 * Empty input returns "".
 */
export function displayIdentity(raw: string | null | undefined): string {
  const v = String(raw || "").trim().replace(/^@/, "");
  if (!v) return "";
  const gh = GH_NUMERIC.exec(v);
  if (gh) return `GitHub user ${gh[1]}`;
  const bare = v.replace(/^(?:nostr|github|gh):/i, "");
  const short = SHORT_HEX.exec(bare);
  if (short) return `${short[1]}…${short[2]}`;
  if (isRawIdentityKey(v)) return shortKey(bare);
  return bare;
}

/** `@handle` for handles; short keys get no `@` (they are not handles). */
export function displayHandle(raw: string | null | undefined): string {
  const name = displayIdentity(raw);
  if (!name) return "";
  return isRawIdentityKey(raw) ? name : `@${name}`;
}

/** PLEBLY-style catalog id (not a human title). */
export function looksLikeProjectId(label: string | null | undefined, id?: string | null): boolean {
  const l = String(label || "").trim();
  if (!l) return true;
  if (id && l.toLowerCase() === String(id).trim().toLowerCase()) return true;
  return /^PLEBLY-[A-Z0-9-]+$/i.test(l);
}
