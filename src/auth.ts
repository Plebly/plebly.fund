import { WORKERS_API } from "./config";
import type { ProfileLink, PublicProfile, UserProfile } from "./types";

const SESSION_KEY = "plebly_session";

const API = () => WORKERS_API.replace(/\/$/, "");

function storedSession(): string | null {
  try {
    return sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

function setStoredSession(token: string): void {
  sessionStorage.setItem(SESSION_KEY, token);
}

function clearStoredSession(): void {
  sessionStorage.removeItem(SESSION_KEY);
}

/** Read OAuth session from URL hash and strip it (workers.dev cookies are third-party). */
export function consumeSessionFromHash(): boolean {
  const hash = location.hash;
  const match = hash.match(/plebly_auth=([^&]+)/);
  if (!match) return false;

  setStoredSession(decodeURIComponent(match[1]));
  const routeHash = hash.replace(/[?&]?plebly_auth=[^&]*/, "");
  if (!routeHash || routeHash === "#") {
    location.hash = "#/";
  } else {
    location.hash = routeHash.startsWith("#") ? routeHash : `#${routeHash}`;
  }
  return true;
}

function authFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = storedSession();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers, credentials: "include" });
}

export type AuthUser = UserProfile;

export function profilePath(username: string): string {
  return `#/u/${encodeURIComponent(username)}`;
}

/** Current hash route for post-login redirect, e.g. #/propose */
export function currentReturnPath(): string {
  const hash = location.hash.replace(/[?&]?plebly_auth=[^&]*/, "");
  if (!hash || hash === "#") return "#/";
  return hash.startsWith("#") ? hash : `#${hash}`;
}

export function githubLoginUrl(returnPath?: string): string {
  const base = `${API()}/auth/github`;
  const siteBase = import.meta.env.BASE_URL || "/";
  const origin = `${window.location.origin}${siteBase}`.replace(/\/$/, "");
  const path = returnPath ?? currentReturnPath();
  const returnTo = encodeURIComponent(
    `${origin}${path.startsWith("#") ? path : `#${path}`}`,
  );
  return `${base}?return_to=${returnTo}`;
}

export async function fetchCurrentUser(): Promise<AuthUser | null> {
  if (!WORKERS_API) return null;
  try {
    const res = await authFetch(`${API()}/auth/me`);
    if (res.status === 401) {
      clearStoredSession();
      return null;
    }
    if (!res.ok) return null;
    const data = (await res.json()) as { user: AuthUser | null };
    return data.user;
  } catch {
    return null;
  }
}

export async function fetchPublicProfile(
  username: string,
): Promise<PublicProfile | null> {
  if (!WORKERS_API) return null;
  const res = await fetch(`${API()}/profile/${encodeURIComponent(username)}`);
  if (!res.ok) return null;
  const data = (await res.json()) as { user: PublicProfile };
  return data.user;
}

export async function updateProfile(input: {
  bio: string;
  links: ProfileLink[];
  payout_address?: string;
}): Promise<UserProfile> {
  let res: Response;
  try {
    res = await authFetch(`${API()}/profile/me`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  } catch {
    throw new Error(
      "Could not reach the API. If this persists after a refresh, the server may need an update.",
    );
  }
  const data = (await res.json()) as { user?: UserProfile; error?: string };
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data.user!;
}

export async function claimUsername(username: string): Promise<UserProfile> {
  const res = await authFetch(`${API()}/profile/username`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username }),
  });
  const data = (await res.json()) as { user?: UserProfile; error?: string };
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data.user!;
}

export async function checkUsernameAvailable(
  username: string,
): Promise<boolean> {
  const res = await fetch(`${API()}/profile/check/${encodeURIComponent(username)}`);
  if (!res.ok) return false;
  const data = (await res.json()) as { available?: boolean };
  return Boolean(data.available);
}

export async function deleteAccount(): Promise<void> {
  if (!WORKERS_API) throw new Error("API not configured");
  let res: Response;
  try {
    res = await authFetch(`${API()}/profile/me`, { method: "DELETE" });
  } catch {
    throw new Error("Could not reach the API.");
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  clearStoredSession();
}

export async function logout(): Promise<void> {
  if (!WORKERS_API) return;
  clearStoredSession();
  await authFetch(`${API()}/auth/logout`, { method: "POST" });
}

export function userLabel(user: AuthUser): string {
  if (user.username) return `@${user.username}`;
  if (user.github) return `@${user.github}`;
  if (user.nostr) return `${user.nostr.slice(0, 8)}…`;
  if (user.x) return `@${user.x}`;
  return user.id;
}

/** Nav label for the signed-in account link (no @ prefix). */
export function accountNavLabel(user: AuthUser): string {
  if (user.username) return user.username;
  if (user.github) return user.github;
  if (user.x) return user.x.replace(/^@/, "");
  return "Account";
}

export type SubmitProposalInput = {
  title: string;
  problem: string;
  deliverable: string;
  verification: string;
  out_of_scope: string;
  submission_fee_txid: string;
  target_sats?: number | null;
};

export async function submitProposal(
  input: SubmitProposalInput,
): Promise<{ pr_url?: string; branch?: string; ok?: boolean; error?: string }> {
  const res = await authFetch(`${API()}/proposals/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = (await res.json()) as {
    ok?: boolean;
    pr_url?: string;
    branch?: string;
    error?: string;
    detail?: string;
    draft?: string;
  };
  if (!res.ok) {
    throw new Error(data.error || data.detail || `HTTP ${res.status}`);
  }
  return data;
}
