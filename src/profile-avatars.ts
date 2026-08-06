import { WORKERS_API } from "./config";
import { escapeHtml } from "./util";

const api = () => WORKERS_API.replace(/\/$/, "");

const userCache = new Map<string, string | null>();
const orgCache = new Map<string, string | null>();

/** Empty slot filled by {@link hydrateAvatarSlots}. */
export function avatarSlotHtml(username: string | null | undefined): string {
  const handle = username?.trim().toLowerCase();
  if (!handle) return "";
  return `<span class="user-avatar-slot" data-avatar-user="${escapeHtml(handle)}" hidden></span>`;
}

/** Org avatar slot (`data-avatar-org`). */
export function orgAvatarSlotHtml(login: string | null | undefined): string {
  const handle = login?.replace(/^@/, "").trim().toLowerCase();
  if (!handle) return "";
  return `<span class="user-avatar-slot org-avatar-slot" data-avatar-org="${escapeHtml(handle)}" hidden></span>`;
}

export async function fetchAvatars(
  usernames: string[],
): Promise<Record<string, string>> {
  if (!WORKERS_API || !usernames.length) return {};
  const needed = [
    ...new Set(
      usernames
        .map((u) => u.trim().toLowerCase())
        .filter((u) => /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/.test(u)),
    ),
  ].filter((u) => !userCache.has(u));
  if (needed.length) {
    try {
      const res = await fetch(
        `${api()}/profile/avatars?u=${encodeURIComponent(needed.join(","))}`,
      );
      if (res.ok) {
        const data = (await res.json()) as { avatars?: Record<string, string> };
        const map = data.avatars || {};
        for (const name of needed) {
          userCache.set(name, map[name] || null);
        }
      }
    } catch {
      /* transient */
    }
  }
  const out: Record<string, string> = {};
  for (const raw of usernames) {
    const name = raw.trim().toLowerCase();
    const url = userCache.get(name);
    if (url) out[name] = url;
  }
  return out;
}

export async function fetchOrgAvatars(
  logins: string[],
): Promise<Record<string, string>> {
  if (!WORKERS_API || !logins.length) return {};
  const needed = [
    ...new Set(
      logins
        .map((u) => u.replace(/^@/, "").trim().toLowerCase())
        .filter((u) => /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(u)),
    ),
  ].filter((u) => !orgCache.has(u));
  if (needed.length) {
    try {
      const res = await fetch(
        `${api()}/orgs/avatars?o=${encodeURIComponent(needed.join(","))}`,
      );
      if (res.ok) {
        const data = (await res.json()) as { avatars?: Record<string, string> };
        const map = data.avatars || {};
        for (const name of needed) {
          orgCache.set(name, map[name] || null);
        }
      }
    } catch {
      /* transient */
    }
  }
  const out: Record<string, string> = {};
  for (const raw of logins) {
    const name = raw.replace(/^@/, "").trim().toLowerCase();
    const url = orgCache.get(name);
    if (url) out[name] = url;
  }
  return out;
}

function fillSlot(slot: HTMLElement, url: string | undefined): void {
  if (!url) {
    slot.hidden = true;
    slot.innerHTML = "";
    return;
  }
  slot.hidden = false;
  slot.innerHTML = `<img class="user-avatar" src="${escapeHtml(url)}" alt="" width="28" height="28" loading="lazy" decoding="async" />`;
}

/** Fill `[data-avatar-user]` and `[data-avatar-org]` slots under root. */
export async function hydrateAvatarSlots(root: ParentNode): Promise<void> {
  const userSlots = [
    ...root.querySelectorAll<HTMLElement>("[data-avatar-user]"),
  ];
  const orgSlots = [
    ...root.querySelectorAll<HTMLElement>("[data-avatar-org]"),
  ];
  const [avatars, orgAvatars] = await Promise.all([
    userSlots.length
      ? fetchAvatars(userSlots.map((el) => el.dataset.avatarUser || ""))
      : Promise.resolve({} as Record<string, string>),
    orgSlots.length
      ? fetchOrgAvatars(orgSlots.map((el) => el.dataset.avatarOrg || ""))
      : Promise.resolve({} as Record<string, string>),
  ]);
  for (const slot of userSlots) {
    fillSlot(slot, avatars[(slot.dataset.avatarUser || "").toLowerCase()]);
  }
  for (const slot of orgSlots) {
    fillSlot(
      slot,
      orgAvatars[(slot.dataset.avatarOrg || "").toLowerCase()],
    );
  }
}
