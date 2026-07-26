import { WORKERS_API } from "./config";
import { escapeHtml } from "./util";

const api = () => WORKERS_API.replace(/\/$/, "");

const cache = new Map<string, string | null>();

/** Empty slot filled by {@link hydrateAvatarSlots}. */
export function avatarSlotHtml(username: string | null | undefined): string {
  const handle = username?.trim().toLowerCase();
  if (!handle) return "";
  return `<span class="user-avatar-slot" data-avatar-user="${escapeHtml(handle)}" hidden></span>`;
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
  ].filter((u) => !cache.has(u));
  if (needed.length) {
    try {
      const res = await fetch(
        `${api()}/profile/avatars?u=${encodeURIComponent(needed.join(","))}`,
      );
      if (res.ok) {
        const data = (await res.json()) as { avatars?: Record<string, string> };
        const map = data.avatars || {};
        for (const name of needed) {
          cache.set(name, map[name] || null);
        }
      } else {
        for (const name of needed) cache.set(name, null);
      }
    } catch {
      for (const name of needed) cache.set(name, null);
    }
  }
  const out: Record<string, string> = {};
  for (const raw of usernames) {
    const name = raw.trim().toLowerCase();
    const url = cache.get(name);
    if (url) out[name] = url;
  }
  return out;
}

/** Fill `[data-avatar-user]` slots under root with profile images. */
export async function hydrateAvatarSlots(root: ParentNode): Promise<void> {
  const slots = [
    ...root.querySelectorAll<HTMLElement>("[data-avatar-user]"),
  ];
  if (!slots.length) return;
  const usernames = slots
    .map((el) => el.dataset.avatarUser || "")
    .filter(Boolean);
  const avatars = await fetchAvatars(usernames);
  for (const slot of slots) {
    const user = (slot.dataset.avatarUser || "").toLowerCase();
    const url = avatars[user];
    if (!url) {
      slot.hidden = true;
      slot.innerHTML = "";
      continue;
    }
    slot.hidden = false;
    slot.innerHTML = `<img class="user-avatar" src="${escapeHtml(url)}" alt="" width="28" height="28" loading="lazy" decoding="async" />`;
  }
}
