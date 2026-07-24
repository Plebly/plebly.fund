import { WORKERS_API } from "./config";
import type { ProfileLink, PublicProfile, UserProfile } from "./types";

const API = () => WORKERS_API.replace(/\/$/, "");

export type AuthUser = UserProfile;

export function profilePath(username: string): string {
  return `#/u/${encodeURIComponent(username)}`;
}

export function githubLoginUrl(returnPath?: string): string {
  const base = `${API()}/auth/github`;
  const siteBase = import.meta.env.BASE_URL || "/";
  const origin = `${window.location.origin}${siteBase}`.replace(/\/$/, "");
  const returnTo = encodeURIComponent(
    returnPath ? `${origin}${returnPath.replace(/^\#/, "#")}` : origin,
  );
  return `${base}?return_to=${returnTo}`;
}

export async function fetchCurrentUser(): Promise<AuthUser | null> {
  if (!WORKERS_API) return null;
  try {
    const res = await fetch(`${API()}/auth/me`, { credentials: "include" });
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
}): Promise<UserProfile> {
  const res = await fetch(`${API()}/profile/me`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = (await res.json()) as { user?: UserProfile; error?: string };
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data.user!;
}

export async function claimUsername(username: string): Promise<UserProfile> {
  const res = await fetch(`${API()}/profile/username`, {
    method: "POST",
    credentials: "include",
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

export async function logout(): Promise<void> {
  if (!WORKERS_API) return;
  await fetch(`${API()}/auth/logout`, {
    method: "POST",
    credentials: "include",
  });
}

export function userLabel(user: AuthUser): string {
  if (user.username) return `@${user.username}`;
  if (user.github) return `@${user.github}`;
  if (user.nostr) return `${user.nostr.slice(0, 8)}…`;
  if (user.x) return `@${user.x}`;
  return user.id;
}

export type SubmitProposalInput = {
  title: string;
  deliverable: string;
  verification: string;
  out_of_scope: string;
  submission_fee_txid: string;
  target_sats?: number | null;
};

export async function submitProposal(
  input: SubmitProposalInput,
): Promise<{ pr_url?: string; branch?: string; ok?: boolean; error?: string }> {
  const res = await fetch(`${API()}/proposals/submit`, {
    method: "POST",
    credentials: "include",
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
