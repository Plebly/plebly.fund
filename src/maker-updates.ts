import { authFetch } from "./auth";
import { WORKERS_API } from "./config";
import { catalogIdKey } from "./github";
import {
  homeFeedVisibility,
  isHiddenFromHomeFeed,
} from "./home-feed-hidden";
import { projectsHref, proposalHref } from "./router";
import { escapeHtml, timeAgoHtml } from "./util";

export type PublicMakerUpdate = {
  id: string;
  proposal_id: string;
  proposal_path: string;
  title: string;
  body: string;
  link: string | null;
  author: string;
  username?: string;
  created_at: string;
};

export type MakerUpdateFeedItem = {
  id: string;
  proposal_id: string;
  proposal_path: string;
  proposal_title?: string;
  title: string;
  excerpt: string;
  author: string;
  created_at: string;
};

type UpdateAccess = {
  can_post: boolean;
  can_moderate: boolean;
  own_ids: string[];
};

const api = () => WORKERS_API.replace(/\/$/, "");

function httpLink(raw: string | null | undefined): string | null {
  const link = (raw || "").trim();
  if (!link) return null;
  try {
    const url = new URL(link);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function proposalGlanceHtml(excerpt: string | undefined): string {
  if (!excerpt) {
    return `<section class="proposal-glance" id="proposal-glance" hidden></section>`;
  }
  return `<section class="proposal-glance" id="proposal-glance" aria-label="At a glance">
    <p>${escapeHtml(excerpt)}</p>
  </section>`;
}

export function makerUpdatesHtml(proposalId: string | null): string {
  if (!proposalId) return "";
  return `<section class="proposal-updates" id="maker-updates" aria-labelledby="maker-updates-heading">
    <h2 class="proposal-block-title" id="maker-updates-heading">From the maker</h2>
    <form id="maker-update-form" class="maker-update-form" hidden>
      <label class="sr-only" for="maker-update-title">Update title</label>
      <input id="maker-update-title" class="comment-input" maxlength="80" required placeholder="Title" />
      <label class="sr-only" for="maker-update-body">Update</label>
      <textarea id="maker-update-body" class="comment-input" rows="4" minlength="40" maxlength="2000" required placeholder="What changed? At least 40 characters."></textarea>
      <label class="sr-only" for="maker-update-link">Link</label>
      <input id="maker-update-link" class="comment-input" type="url" maxlength="500" placeholder="Optional link (https://)" />
      <div class="comment-compose-actions">
        <button type="submit" class="btn" id="maker-update-submit">Post update</button>
      </div>
      <p class="builder-msg error" id="maker-update-error" role="alert" hidden></p>
    </form>
    <div id="maker-update-list"><p class="muted">Loading updates…</p></div>
  </section>`;
}

function updateArticleHtml(
  update: PublicMakerUpdate,
  canDelete: boolean,
): string {
  const link = httpLink(update.link);
  const when = timeAgoHtml(update.created_at);
  return `<article class="maker-update" data-update-id="${escapeHtml(update.id)}">
    <h3>${escapeHtml(update.title)}</h3>
    <p class="maker-update-meta muted">${escapeHtml(update.author)}${when ? ` · ${when}` : ""}</p>
    <p class="maker-update-body">${escapeHtml(update.body)}</p>
    ${
      link
        ? `<p><a href="${escapeHtml(link)}" rel="noopener noreferrer">${escapeHtml(link)}</a></p>`
        : ""
    }
    ${
      canDelete
        ? `<button type="button" class="btn ghost maker-update-delete" data-delete-update="${escapeHtml(update.id)}" aria-label="${escapeHtml(makerUpdateRemoveLabel(update.title))}">Remove</button>`
        : ""
    }
  </article>`;
}

export function visibleMakerFeed(
  items: MakerUpdateFeedItem[],
  hidden: (id: string) => boolean,
): MakerUpdateFeedItem[] {
  return items.filter((item) => !hidden(catalogIdKey(item.proposal_id)));
}

export function makerUpdateRailHtml(items: MakerUpdateFeedItem[]): string {
  if (!items.length) return "";
  return `<section class="wrap-wide project-rail" aria-labelledby="maker-updates-rail-heading">
    <div class="rail-head">
      <div>
        <h2 id="maker-updates-rail-heading">Latest from the makers</h2>
        <p>Progress posted on the project.</p>
      </div>
      <a href="${projectsHref("?sort=updated")}">Recently updated →</a>
    </div>
    <ul class="maker-update-rail">${items
      .map((item) => {
        const when = timeAgoHtml(item.created_at);
        return `<li><a href="${proposalHref(item.proposal_path || "", item.proposal_id)}#maker-updates">
          <span class="maker-update-rail-project">${escapeHtml(item.proposal_title || item.proposal_id)}</span>
          <span class="maker-update-rail-title">${escapeHtml(item.title)}</span>
          <span class="maker-update-rail-excerpt">${escapeHtml(item.excerpt)}</span>
          ${when ? `<span class="activity-strip-date">${when}</span>` : ""}
        </a></li>`;
      })
      .join("")}</ul>
  </section>`;
}

async function readUpdates(proposalId: string): Promise<PublicMakerUpdate[]> {
  const res = await fetch(
    `${api()}/updates/${encodeURIComponent(proposalId)}`,
  );
  if (res.status >= 500) throw new Error("updates unavailable");
  if (!res.ok) return [];
  const data = (await res.json()) as { updates?: PublicMakerUpdate[] };
  return Array.isArray(data.updates) ? data.updates : [];
}

async function readAccess(proposalId: string): Promise<UpdateAccess> {
  const res = await authFetch(
    `${api()}/updates/${encodeURIComponent(proposalId)}/access`,
  );
  if (!res.ok) return { can_post: false, can_moderate: false, own_ids: [] };
  const data = (await res.json()) as Partial<UpdateAccess>;
  return {
    can_post: Boolean(data.can_post),
    can_moderate: Boolean(data.can_moderate),
    own_ids: Array.isArray(data.own_ids) ? data.own_ids.filter((id) => typeof id === "string") : [],
  };
}

export function makerUpdateHeading(count: number): string {
  if (count <= 0) return "From the maker";
  return `From the maker · ${count} ${count === 1 ? "update" : "updates"}`;
}

export function makerUpdateSideLabel(count: number): string {
  return count > 0 ? `Updates · ${count}` : "Updates";
}

export function makerUpdateRemoveLabel(title: string): string {
  const name = title.trim() || "update";
  return `Remove ${name}`;
}

function paintHeading(root: ParentNode, count: number): void {
  const heading = root.querySelector("#maker-updates-heading");
  if (heading) heading.textContent = makerUpdateHeading(count);
  const side = root.querySelector("#maker-updates-side-link");
  if (side) side.textContent = makerUpdateSideLabel(count);
}

function paintGlance(root: ParentNode, updates: PublicMakerUpdate[]): void {
  const glance = root.querySelector<HTMLElement>("#proposal-glance");
  if (!glance) return;
  glance.querySelector(".maker-update-latest")?.remove();
  const latest = updates[0];
  const hasExcerpt = Boolean(glance.querySelector("p"));
  if (!latest) {
    glance.hidden = !hasExcerpt;
    return;
  }
  glance.hidden = false;
  const line = document.createElement("p");
  line.className = "maker-update-latest";
  const link = document.createElement("a");
  link.href = "#maker-updates";
  link.textContent = `Latest: ${latest.title}`;
  line.appendChild(link);
  glance.appendChild(line);
}
function paintList(
  host: HTMLElement,
  updates: PublicMakerUpdate[],
  access: UpdateAccess,
): void {
  if (!updates.length) {
    host.innerHTML = `<p class="muted">The first update has not been posted.</p>`;
    return;
  }
  host.innerHTML = updates
    .map((update) =>
      updateArticleHtml(
        update,
        access.can_moderate || access.own_ids.includes(update.id),
      ),
    )
    .join("");
}

export async function bindMakerUpdates(
  root: ParentNode,
  proposalId: string,
): Promise<void> {
  const list = root.querySelector<HTMLElement>("#maker-update-list");
  const form = root.querySelector<HTMLFormElement>("#maker-update-form");
  if (!list) return;
  let access = { can_post: false, can_moderate: false, own_ids: [] as string[] };
  let updates: PublicMakerUpdate[] = [];
  try {
    [updates, access] = await Promise.all([
      readUpdates(proposalId),
      readAccess(proposalId),
    ]);
  } catch {
    list.innerHTML = `<p class="muted">Updates are unavailable right now.</p>`;
    return;
  }
  if (form) form.hidden = !access.can_post;
  const paint = () => {
    paintList(list, updates, access);
    paintGlance(root, updates);
    paintHeading(root, updates.length);
  };
  paint();

  form?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const error = root.querySelector<HTMLElement>("#maker-update-error");
    const title = root.querySelector<HTMLInputElement>("#maker-update-title");
    const body = root.querySelector<HTMLTextAreaElement>("#maker-update-body");
    const link = root.querySelector<HTMLInputElement>("#maker-update-link");
    if (error) error.hidden = true;
    try {
      const res = await authFetch(`${api()}/updates/${encodeURIComponent(proposalId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title?.value || "",
          body: body?.value || "",
          link: link?.value || "",
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        update?: PublicMakerUpdate;
      };
      if (!res.ok || !data.update) {
        if (error) {
          error.hidden = false;
          error.textContent = data.error || "Could not post that update.";
        }
        return;
      }
      if (title) title.value = "";
      if (body) body.value = "";
      if (link) link.value = "";
      updates = [data.update, ...updates];
      access = { ...access, own_ids: [data.update.id, ...access.own_ids] };
      paint();
    } catch {
      if (error) {
        error.hidden = false;
        error.textContent = "Could not post that update.";
      }
    }
  });

  list.addEventListener("click", async (ev) => {
    const target = ev.target;
    if (!(target instanceof HTMLButtonElement)) return;
    const id = target.dataset.deleteUpdate;
    if (!id) return;
    target.disabled = true;
    try {
      const res = await authFetch(
        `${api()}/updates/${encodeURIComponent(proposalId)}/${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        target.disabled = false;
        return;
      }
      updates = updates.filter((update) => update.id !== id);
      paint();
    } catch {
      target.disabled = false;
    }
  });
}

export type CardUpdate = { title: string; created_at: string; count?: number };

export function summarizeUpdateLatest(
  rows: { title?: string; count?: number }[],
): { projects: number; updates: number } {
  let projects = 0;
  let updates = 0;
  for (const row of rows) {
    if (!(row.title || "").trim()) continue;
    projects += 1;
    updates += typeof row.count === "number" && row.count > 0 ? row.count : 1;
  }
  return { projects, updates };
}

export async function fetchUpdateMomentum(): Promise<
  { projects: number; updates: number } | null
> {
  try {
    const res = await fetch(`${api()}/updates/latest`);
    if (!res.ok) return null;
    const data = (await res.json()) as { latest?: { title?: string; count?: number }[] };
    return summarizeUpdateLatest(Array.isArray(data.latest) ? data.latest : []);
  } catch {
    return null;
  }
}

export async function fetchLatestUpdates(): Promise<Map<string, CardUpdate>> {
  const res = await fetch(`${api()}/updates/latest`);
  if (!res.ok) return new Map();
  const data = (await res.json()) as {
    latest?: { proposal_id?: string; title?: string; created_at?: string; count?: number }[];
  };
  const rows = Array.isArray(data.latest) ? data.latest : [];
  const view = await homeFeedVisibility();
  const map = new Map<string, CardUpdate>();
  for (const row of rows) {
    const key = catalogIdKey(row.proposal_id);
    const title = (row.title || "").trim();
    if (!key || !title || !row.created_at || isHiddenFromHomeFeed(view, key)) continue;
    const count = typeof row.count === "number" && row.count > 0 ? row.count : 1;
    map.set(key, { title, created_at: row.created_at, count });
  }
  return map;
}

export async function bindMakerUpdateRail(root: ParentNode): Promise<void> {
  const mount = root.querySelector<HTMLElement>("#maker-updates-rail");
  if (!mount || !WORKERS_API) return;
  try {
    const res = await fetch(`${api()}/updates?limit=6`);
    if (!res.ok) return;
    const data = (await res.json()) as { updates?: MakerUpdateFeedItem[] };
    const items = Array.isArray(data.updates) ? data.updates : [];
    const view = await homeFeedVisibility();
    const visible = visibleMakerFeed(items, (id) =>
      isHiddenFromHomeFeed(view, id),
    );
    mount.innerHTML = makerUpdateRailHtml(visible);
  } catch {
    mount.innerHTML = "";
  }
}
