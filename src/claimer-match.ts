import type { AuthUser } from "./auth";

/**
 * Workers often store nostr claimers as a short display label
 * (`nostr:` + first 12 hex of the pubkey) via claimerLabel, while
 * AuthUser.id is the full `nostr:<64-hex>`. Exact equality then fails and
 * the SPA treats the fulfiller as a donor (pooling UI, no Submit deliverable).
 */
export function sessionMatchesClaimer(
  user: AuthUser | null,
  claimer: string | null | undefined,
  claimerType?: string | null,
  claimAgent?: string | null,
): boolean {
  if (!user || !claimer) return false;
  if (
    claimer === user.username ||
    claimer === user.github ||
    claimer === user.id
  ) {
    return true;
  }

  const c = claimer.trim().toLowerCase();
  const userId = (user.id || "").trim().toLowerCase();
  const userNostr = (user.nostr || "").trim().toLowerCase();
  if (c.startsWith("nostr:")) {
    const claimHex = c.slice("nostr:".length);
    if (userId === c || (userNostr && userNostr === claimHex)) return true;
    // Truncated display label (typically 12 hex chars)
    if (claimHex.length >= 8 && claimHex.length < 64) {
      if (userId.startsWith(`nostr:${claimHex}`)) return true;
      if (userNostr.startsWith(claimHex)) return true;
    }
  }

  if (claimerType === "org") {
    const agent = (claimAgent || "").replace(/^@/, "").trim().toLowerCase();
    if (!agent) return false;
    const gh = (user.github || "").replace(/^@/, "").trim().toLowerCase();
    const un = (user.username || "").replace(/^@/, "").trim().toLowerCase();
    return agent === gh || agent === un;
  }
  return false;
}

function nostrHex(value: string): string {
  const v = value.trim().toLowerCase();
  return v.startsWith("nostr:") ? v.slice("nostr:".length) : v;
}

/** True when session owns the pending/full claimer user id. */
export function sessionMatchesPendingClaim(
  user: AuthUser | null,
  pendingUserId?: string | null,
): boolean {
  if (!user || !pendingUserId) return false;
  const pending = pendingUserId.trim().toLowerCase();
  if (user.id && user.id.toLowerCase() === pending) return true;
  const nostr = (user.nostr || "").trim();
  if (!nostr) return false;
  const pendingHex = nostrHex(pending);
  const userHex = nostrHex(nostr);
  return Boolean(pendingHex && userHex && pendingHex === userHex);
}

/** Full fulfiller id from Workers claim status (claimer_user_id or pending). */
export function claimerFullUserId(claim?: {
  claimer_user_id?: string | null;
  pending?: { user_id?: string | null } | null;
} | null): string | null {
  const id = claim?.claimer_user_id || claim?.pending?.user_id || null;
  return id && id.trim() ? id.trim() : null;
}
