import { WORKERS_API } from "./config";
import { cachedProposalTitle } from "./github";
import { escapeHtml } from "./util";

/**
 * id → title for feeds (/donations, the live strip, the activity strip) that
 * only get a proposal id from the API. One public catalog read (scope=all, so
 * voided/declined rows resolve too), shared by every caller for a while; its
 * own cache so it never replaces the home listing's catalog cache.
 */
const TTL_MS = 60_000;
let cache: { at: number; titles: Promise<Map<string, string>> } | null = null;

async function loadTitles(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!WORKERS_API) return out;
  try {
    const res = await fetch(`${WORKERS_API.replace(/\/$/, "")}/proposals/catalog?scope=all`);
    if (!res || !res.ok) return out;
    const data = (await res.json()) as { proposals?: { id?: string | null; title?: string | null }[] };
    for (const p of Array.isArray(data?.proposals) ? data.proposals : []) {
      const id = String(p?.id || "").trim().toLowerCase();
      const title = String(p?.title || "").trim();
      if (id && title) out.set(id, title);
    }
  } catch {
    /* titles are optional: callers fall back to the id */
  }
  return out;
}

export function clearProjectTitlesCache(): void {
  cache = null;
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
  if (!cache || Date.now() - cache.at > TTL_MS) {
    cache = { at: Date.now(), titles: loadTitles() };
  }
  const titles = await cache.titles;
  for (const id of missing) {
    const t = titles.get(id);
    if (t) out.set(id, t);
  }
  return out;
}

/** Title as the primary label, the catalog id as quiet secondary text. */
export function projectRefHtml(id: string, title?: string | null): string {
  const t = String(title || "").trim();
  const i = String(id || "").trim();
  if (!t || t.toLowerCase() === i.toLowerCase()) {
    return `<span class="project-ref-title">${escapeHtml(i)}</span>`;
  }
  return `<span class="project-ref-title">${escapeHtml(t)}</span>${
    i ? ` <span class="project-ref-id mono muted">${escapeHtml(i)}</span>` : ""
  }`;
}
