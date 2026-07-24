import { WORKERS_API } from "./config";

export type AuthUser = {
  id: string;
  github?: string;
  x?: string;
  nostr?: string;
};

export function githubLoginUrl(): string {
  const base = `${WORKERS_API.replace(/\/$/, "")}/auth/github`;
  const siteBase = import.meta.env.BASE_URL || "/";
  const returnTo = encodeURIComponent(
    `${window.location.origin}${siteBase}`.replace(/\/$/, ""),
  );
  return `${base}?return_to=${returnTo}`;
}

export async function fetchCurrentUser(): Promise<AuthUser | null> {
  if (!WORKERS_API) return null;
  try {
    const res = await fetch(`${WORKERS_API.replace(/\/$/, "")}/auth/me`, {
      credentials: "include",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { user: AuthUser | null };
    return data.user;
  } catch {
    return null;
  }
}

export async function logout(): Promise<void> {
  if (!WORKERS_API) return;
  await fetch(`${WORKERS_API.replace(/\/$/, "")}/auth/logout`, {
    method: "POST",
    credentials: "include",
  });
}

export function userLabel(user: AuthUser): string {
  if (user.github) return `@${user.github}`;
  if (user.nostr) return `${user.nostr.slice(0, 8)}…`;
  if (user.x) return `@${user.x}`;
  return user.id;
}
