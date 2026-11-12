import {
  catalogIdKey,
  LISTED_TTL_MS,
  listAllPublicProposals,
  listListedProposals,
  withoutHiddenCompletedListings,
} from "./github";

let hiddenIdsCache: { at: number; ids: Set<string> } | null = null;
let hiddenIdsInFlight: Promise<Set<string>> | null = null;

export function clearHiddenCompletedListingIdsCache(): void {
  hiddenIdsCache = null;
  hiddenIdsInFlight = null;
}

async function computeHiddenCompletedListingIds(): Promise<Set<string>> {
  const all = await listAllPublicProposals();
  let listed: Awaited<ReturnType<typeof listListedProposals>> = [];
  try {
    listed = await listListedProposals();
  } catch {
    listed = [];
  }
  const visible = new Set(
    withoutHiddenCompletedListings(all, listed)
      .map((p) => catalogIdKey(p.id))
      .filter(Boolean),
  );
  return new Set(
    all.map((p) => catalogIdKey(p.id)).filter((key) => key && !visible.has(key)),
  );
}

/**
 * Catalog ids that withoutHiddenCompletedListings drops. If the listed
 * catalog fails to load, every completed row in scope=all is treated as hidden.
 * Successful results are cached for LISTED_TTL_MS; concurrent callers share
 * one in-flight load. A thrown load is not cached.
 */
export async function hiddenCompletedListingIds(): Promise<Set<string>> {
  if (hiddenIdsCache && Date.now() - hiddenIdsCache.at < LISTED_TTL_MS) {
    return hiddenIdsCache.ids;
  }
  if (!hiddenIdsInFlight) {
    hiddenIdsInFlight = computeHiddenCompletedListingIds()
      .then((ids) => {
        hiddenIdsCache = { at: Date.now(), ids };
        return ids;
      })
      .finally(() => {
        hiddenIdsInFlight = null;
      });
  }
  return hiddenIdsInFlight;
}
