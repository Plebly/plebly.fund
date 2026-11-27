import { WORKERS_API } from "./config";
import { cachedProposalTitle, catalogIdKey } from "./github";
import { escapeHtml } from "./util";

/**
 * id → title for feeds (/donations, the live strip, the activity strip) that
 * only get a proposal id from the API. One public catalog read (scope=all, so
 * voided/declined rows resolve too), shared by every caller for a while; its
 * own cache so it never replaces the home listing's catalog cache.
 */
const TTL_MS = 60_000;
/** Hung catalog reads must not stall the donations ledger or live strip. */
export const CATALOG_TITLES_TIMEOUT_MS = 4_000;
type CatalogTitles = { titles: Map<string, string>; ids: Set<string> | null };
let cache: { at: number; data: Promise<CatalogTitles> } | null = null;

async function loadTitles(): Promise<CatalogTitles> {
  const titles = new Map<string, string>();
  if (!WORKERS_API) return { titles, ids: null };
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const res = await Promise.race([
      fetch(`${WORKERS_API.replace(/\/$/, "")}/proposals/catalog?scope=all`, {
        signal: ctrl.signal,
      }),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => {
          ctrl.abort();
          resolve(null);
        }, CATALOG_TITLES_TIMEOUT_MS);
      }),
    ]);
    if (!res || !res.ok) return { titles, ids: null };
    const data = (await res.json()) as { proposals?: unknown };
    // A 200 whose body is not a proposals array is not a loaded catalog: an
    // empty id set would mark every project gift as removed.
    if (!data || !Array.isArray(data.proposals)) return { titles, ids: null };
    const ids = new Set<string>();
    for (const p of data.proposals as { id?: string | null; title?: string | null }[]) {
      const raw = String(p?.id || "").trim();
      const key = catalogIdKey(raw);
      if (key) ids.add(key);
      const title = String(p?.title || "").trim();
      if (raw && title) titles.set(raw.toLowerCase(), title);
    }
    return { titles, ids };
  } catch {
    /* titles are optional: callers fall back to the id */
    return { titles, ids: null };
  } finally {
    clearTimeout(timer);
  }
}

function ensureCatalog(): Promise<CatalogTitles> {
  if (!cache || Date.now() - cache.at > TTL_MS) {
    cache = { at: Date.now(), data: loadTitles() };
  }
  return cache.data;
}

export function clearProjectTitlesCache(): void {
  cache = null;
}

/**
 * Catalog ids from a successful scope=all read, or null when that catalog
 * did not load. Shares the projectTitles cache. Never throws.
 */
export async function projectCatalogIds(): Promise<Set<string> | null> {
  return (await ensureCatalog()).ids;
}

/** Title for each id it can find (lower-case id keys). Never throws. */
export async function projectTitles(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const missing: string[] = [];
  for (const raw of ids) {
    const id = raw.trim().toLowerCase();
    if (!id || out.has(id)) continue;
    const hit = cachedProposalTitle(id);
    if (hit) out.set(id, hit);
    else missing.push(id);
  }
  if (!missing.length) return out;
  const { titles } = await ensureCatalog();
  for (const id of missing) {
    const t = titles.get(id);
    if (t) out.set(id, t);
  }
  return out;
}

/** Escape an id and allow wraps only at hyphens. */
export function hyphenateIdHtml(id: string): string {
  return escapeHtml(id).replace(/-/g, "-<wbr>");
}

/** Title as the primary label, the catalog id as quiet secondary text. */
export function projectRefHtml(id: string, title?: string | null): string {
  const t = String(title || "").trim();
  const i = String(id || "").trim();
  if (!t || t.toLowerCase() === i.toLowerCase()) {
    return `<span class="project-ref-title">${hyphenateIdHtml(i)}</span>`;
  }
  return `<span class="project-ref-title">${escapeHtml(t)}</span>${
    i ? ` <span class="project-ref-id mono muted">${hyphenateIdHtml(i)}</span>` : ""
  }`;
}
