import { WORKERS_API } from "./config";
import { btnWithBrandIcon } from "./icons";
import {
  currentReturnPath,
  href,
  profileHref as profilePath,
} from "./router";
import type { ProfileLink, PublicProfile, UserProfile } from "./types";
import { escapeHtml } from "./util";

export { currentReturnPath, profilePath };

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

/**
 * Read OAuth session from URL hash and strip it.
 * Workers append `#plebly_auth=…` because workers.dev cookies are third-party on plebly.fund.
 */
export function consumeSessionFromHash(): boolean {
  const hash = location.hash;
  const match = hash.match(/plebly_auth=([^&]+)/);
  if (!match) return false;

  setStoredSession(decodeURIComponent(match[1]));
  const cleaned = hash
    .replace(/^[?#]/, "")
    .replace(/[?&]?plebly_auth=[^&]*/g, "")
    .replace(/^&/, "");
  const nextHash = cleaned ? `#${cleaned}` : "";
  history.replaceState(
    null,
    "",
    `${location.pathname}${location.search}${nextHash}`,
  );
  return true;
}

export function authFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = storedSession();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers, credentials: "include" });
}

export type AuthUser = UserProfile;

function oauthReturnTo(returnPath?: string): string {
  let path = returnPath ?? currentReturnPath();
  if (path.startsWith("#/")) path = path.slice(1);
  if (path.startsWith("#")) path = "/";
  if (!path.startsWith("/")) path = `/${path}`;
  const qIdx = path.indexOf("?");
  const pathname = qIdx === -1 ? path : path.slice(0, qIdx);
  const search = qIdx === -1 ? "" : path.slice(qIdx);
  return `${window.location.origin}${href(pathname, search)}`;
}

/** Build GitHub OAuth URL; return_to is a full path URL (e.g. https://plebly.fund/propose). */
export function githubLoginUrl(returnPath?: string): string {
  return `${API()}/auth/github?return_to=${encodeURIComponent(oauthReturnTo(returnPath))}`;
}

/** Build X OAuth URL (PKCE handled by Workers). */
export function xLoginUrl(returnPath?: string): string {
  return `${API()}/auth/x?return_to=${encodeURIComponent(oauthReturnTo(returnPath))}`;
}

/** Compact GitHub + X login choices for gates and empty states. */
export function loginChoicesHtml(prompt?: string, returnPath?: string): string {
  const lead = prompt
    ? `<p class="login-choices-prompt">${escapeHtml(prompt)}</p>`
    : "";
  return `<div class="login-choices">
    ${lead}
    <div class="login-choices-actions">
      <a class="btn" href="${escapeHtml(githubLoginUrl(returnPath))}">${btnWithBrandIcon("github", "GitHub")}</a>
      <a class="btn ghost" href="${escapeHtml(xLoginUrl(returnPath))}">${btnWithBrandIcon("x-twitter", "X")}</a>
    </div>
  </div>`;
}

/** Nav login control — summary opens provider list. */
export function loginMenuHtml(returnPath?: string): string {
  return `<details class="login-menu">
    <summary>Log in</summary>
    <div class="login-menu-panel">
      <a href="${escapeHtml(githubLoginUrl(returnPath))}">${btnWithBrandIcon("github", "Continue with GitHub")}</a>
      <a href="${escapeHtml(xLoginUrl(returnPath))}">${btnWithBrandIcon("x-twitter", "Continue with X")}</a>
    </div>
  </details>`;
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

export type ProposalMilestoneInput = {
  id?: string;
  deliverable: string;
  verification: string;
  out_of_scope: string;
  allocation_sats: number;
  deadline: string;
  dependencies?: string[];
};

export type ProposalAuthorInput = {
  title: string;
  problem: string;
  deliverable: string;
  verification: string;
  out_of_scope: string;
  target_sats?: number | null;
  cover_image?: string | null;
  notes?: string | null;
  milestones?: ProposalMilestoneInput[];
  depends_on?: {
    kind: "plebly" | "external";
    label: string;
    ref?: string;
    note?: string;
  }[];
  related_work?: { label: string; url: string; note?: string }[];
};

export type SubmitProposalInput = ProposalAuthorInput & {
  submission_fee_txid: string;
};

export type UpdateProposalInput = ProposalAuthorInput & {
  proposal_path: string;
};

async function proposalMutation(
  path: "/proposals/submit" | "/proposals/update",
  input: unknown,
): Promise<{ pr_url?: string; branch?: string; ok?: boolean }> {
  const res = await authFetch(`${API()}${path}`, {
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

export async function submitProposal(
  input: SubmitProposalInput,
): Promise<{ pr_url?: string; branch?: string; ok?: boolean; error?: string }> {
  return proposalMutation("/proposals/submit", input);
}

export async function updateProposal(
  input: UpdateProposalInput,
): Promise<{ pr_url?: string; branch?: string; ok?: boolean; error?: string }> {
  return proposalMutation("/proposals/update", input);
}
