import {
  catalogIdKey,
  listAllPublicProposals,
  listListedProposals,
  withoutHiddenCompletedListings,
} from "./github";

/**
 * Catalog ids that withoutHiddenCompletedListings drops. If the listed
 * catalog fails to load, every completed row in scope=all is treated as hidden.
 */
export async function hiddenCompletedListingIds(): Promise<Set<string>> {
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
