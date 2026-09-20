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

/** True when session owns the pending claim row (full user id). */
export function sessionMatchesPendingClaim(
  user: AuthUser | null,
  pendingUserId?: string | null,
): boolean {
  if (!user?.id || !pendingUserId) return false;
  return user.id === pendingUserId;
}
