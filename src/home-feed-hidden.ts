import {
  catalogIdKey,
  LISTED_TTL_MS,
  loadAllPublicProposals,
  loadListedProposals,
  withoutHiddenCompletedListings,
} from "./github";

/**
 * What the home feeds (Recent donations, Recent activity) may show.
 * `hidden`: catalog ids withoutHiddenCompletedListings drops.
 * `onlyKnown`: set when either Worker catalog failed and the GitHub folder
 * fallback answered instead. The live folders do not hold every catalog row
 * (completed 009–011 are Worker-only), so an id the fallback never returned
 * cannot be shown to be public; feeds then show only these ids.
 */
export type HomeFeedVisibility = {
  hidden: Set<string>;
  onlyKnown: Set<string> | null;
};

let hiddenIdsCache: { at: number; view: HomeFeedVisibility } | null = null;
let hiddenIdsInFlight: Promise<HomeFeedVisibility> | null = null;

export function clearHiddenCompletedListingIdsCache(): void {
  hiddenIdsCache = null;
  hiddenIdsInFlight = null;
}

async function computeHomeFeedVisibility(): Promise<HomeFeedVisibility> {
  const allLoaded = await loadAllPublicProposals();
  const all = allLoaded.proposals;
  let listed: Awaited<ReturnType<typeof loadListedProposals>>["proposals"] = [];
  let listedFromCatalog = false;
  try {
    const loaded = await loadListedProposals();
    // Folder fallback includes `completed`, so hidden rows look listed.
    listedFromCatalog = loaded.fromCatalog;
    listed = loaded.fromCatalog ? loaded.proposals : [];
  } catch {
    listed = [];
  }
  const visibleRows = withoutHiddenCompletedListings(all, listed);
  const visible = new Set(
    visibleRows.map((p) => catalogIdKey(p.id)).filter(Boolean),
  );
  const hidden = new Set(
    all.map((p) => catalogIdKey(p.id)).filter((key) => key && !visible.has(key)),
  );
  const fromCatalog = allLoaded.fromCatalog && listedFromCatalog;
  return { hidden, onlyKnown: fromCatalog ? null : visible };
}

/**
 * Home feed visibility, cached for LISTED_TTL_MS; concurrent callers share
 * one in-flight load. A thrown load is not cached.
 */
export async function homeFeedVisibility(): Promise<HomeFeedVisibility> {
  if (hiddenIdsCache && Date.now() - hiddenIdsCache.at < LISTED_TTL_MS) {
    return hiddenIdsCache.view;
  }
  if (!hiddenIdsInFlight) {
    hiddenIdsInFlight = computeHomeFeedVisibility()
      .then((view) => {
        hiddenIdsCache = { at: Date.now(), view };
        return view;
      })
      .finally(() => {
        hiddenIdsInFlight = null;
      });
  }
  return hiddenIdsInFlight;
}

/** True when a project id must stay off the home feeds. */
export function isHiddenFromHomeFeed(
  view: HomeFeedVisibility,
  key: string,
): boolean {
  if (view.hidden.has(key)) return true;
  return view.onlyKnown != null && !view.onlyKnown.has(key);
}

/**
 * Catalog ids that withoutHiddenCompletedListings drops. If the listed
 * catalog fails to load, or only the GitHub folder fallback answered,
 * every completed row in scope=all is treated as hidden. During an outage
 * this set cannot include ids the folder fallback never returned; home
 * feeds use homeFeedVisibility() / isHiddenFromHomeFeed() instead.
 */
export async function hiddenCompletedListingIds(): Promise<Set<string>> {
  return (await homeFeedVisibility()).hidden;
}
