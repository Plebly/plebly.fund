import { WORKERS_API } from "./config";
import { btnWithBrandIcon, btnWithNostrIcon } from "./icons";
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

export type ProposalNotification = {
  id: string;
  type:
    | "listed"
    | "floor_reached"
    | "target_reached"
    | "claimed"
    | "deliverable_submitted"
    | "completed";
  proposal_id: string;
  proposal_path: string;
  created_at: string;
  read_at?: string;
};

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

/** @deprecated X OAuth hidden until secrets are configured. */
export function xLoginUrl(returnPath?: string): string {
  return `${API()}/auth/x?return_to=${encodeURIComponent(oauthReturnTo(returnPath))}`;
}

type Nip07 = {
  getPublicKey: () => Promise<string>;
  signEvent: (event: {
    kind: number;
    created_at: number;
    tags: string[][];
    content: string;
  }) => Promise<{
    id: string;
    pubkey: string;
    created_at: number;
    kind: number;
    tags: string[][];
    content: string;
    sig: string;
  }>;
};

function nip07(): Nip07 | null {
  const w = window as Window & { nostr?: Nip07 };
  return w.nostr ?? null;
}

function nostrAuthHeader(event: object): string {
  const json = JSON.stringify(event);
  // Event JSON is ASCII (hex ids/sigs); btoa is fine.
  return `Nostr ${btoa(json)}`;
}

/**
 * Challenge-wrapped NIP-98 login via NIP-07 extension (Alby, nos2x, etc.).
 * Stores session token the same way as OAuth hash handoff.
 */
export async function loginWithNostr(): Promise<void> {
  if (!WORKERS_API) throw new Error("API not configured");
  const ext = nip07();
  if (!ext?.signEvent) {
    throw new Error(
      "No Nostr extension found. Install a NIP-07 signer (Alby, nos2x, or similar), then try again.",
    );
  }

  const chalRes = await fetch(`${API()}/auth/nostr/challenge`, {
    credentials: "include",
  });
  if (!chalRes.ok) throw new Error("Could not start Nostr login");
  const { challenge } = (await chalRes.json()) as { challenge?: string };
  if (!challenge) throw new Error("Nostr challenge missing");

  const authUrl = new URL(`${API()}/auth/nostr`);
  authUrl.searchParams.set("challenge", challenge);
  const url = authUrl.toString();

  const unsigned = {
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["u", url],
      ["method", "POST"],
    ],
    content: "",
  };
  const signed = await ext.signEvent(unsigned);

  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Authorization: nostrAuthHeader(signed),
    },
    body: JSON.stringify({ challenge }),
  });
  const data = (await res.json()) as {
    token?: string;
    error?: string;
  };
  if (!res.ok) throw new Error(data.error || `Nostr login failed (${res.status})`);
  if (!data.token) throw new Error("Nostr login succeeded but no session token returned");
  setStoredSession(data.token);
}

/** Compact GitHub + Nostr login choices for gates and empty states. */
export function loginChoicesHtml(prompt?: string, returnPath?: string): string {
  const lead = prompt
    ? `<p class="login-choices-prompt">${escapeHtml(prompt)}</p>`
    : "";
  return `<div class="login-choices">
    ${lead}
    <div class="login-choices-actions">
      <a class="btn" href="${escapeHtml(githubLoginUrl(returnPath))}">${btnWithBrandIcon("github", "GitHub")}</a>
      <button type="button" class="btn ghost" data-nostr-login>${btnWithNostrIcon("Nostr")}</button>
    </div>
  </div>`;
}

/** Nav login control: summary opens provider list. */
export function loginMenuHtml(returnPath?: string): string {
  return `<details class="login-menu">
    <summary>Log in</summary>
    <div class="login-menu-panel">
      <a href="${escapeHtml(githubLoginUrl(returnPath))}">${btnWithBrandIcon("github", "Continue with GitHub")}</a>
      <button type="button" class="login-menu-item" data-nostr-login>${btnWithNostrIcon("Continue with Nostr")}</button>
    </div>
  </details>`;
}

/** Wire NIP-07 Nostr login buttons after each render. */
export function bindLoginHandlers(onAuthed: () => void): void {
  document.querySelectorAll<HTMLElement>("[data-nostr-login]").forEach((el) => {
    if (el.dataset.nostrBound === "1") return;
    el.dataset.nostrBound = "1";
    el.addEventListener("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const btn = el;
      const label = btn.querySelector<HTMLElement>("[data-login-label]");
      const prev = label?.textContent ?? btn.textContent;
      btn.setAttribute("disabled", "true");
      if (btn.tagName === "BUTTON") {
        if (label) label.textContent = "Signing…";
        else btn.textContent = "Signing…";
      }
      try {
        await loginWithNostr();
        onAuthed();
      } catch (err) {
        window.alert((err as Error).message || "Nostr login failed");
        if (btn.tagName === "BUTTON" && prev) {
          if (label) label.textContent = prev;
          else btn.textContent = prev;
        }
      } finally {
        btn.removeAttribute("disabled");
      }
    });
  });
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

export async function fetchNotifications(): Promise<ProposalNotification[]> {
  if (!WORKERS_API) return [];
  const res = await authFetch(`${API()}/notifications`);
  if (!res.ok) return [];
  const data = (await res.json()) as { notifications?: ProposalNotification[] };
  return data.notifications || [];
}

export async function markNotificationsRead(ids?: string[]): Promise<void> {
  if (!WORKERS_API) return;
  const res = await authFetch(`${API()}/notifications/read`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(ids?.length ? { ids } : {}),
  });
  if (!res.ok) throw new Error("Could not mark notifications read");
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
  skills_tags?: string[];
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
  if (user.nostr) return `${user.nostr.slice(0, 8)}…`;
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
  proposal_type?: "bounty" | "direct";
  tags?: string[];
  parent_initiative?: string | null;
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

export type AiDraftInput = Pick<
  ProposalAuthorInput,
  "title" | "problem" | "deliverable" | "verification" | "tags"
>;

export type AiDraftAssist = {
  suggestions: Required<Pick<AiDraftInput, "title" | "problem" | "deliverable" | "verification">>;
  notes: string[];
};

export type AiSubmissionCheck = {
  ok: boolean;
  hints: string[];
  warnings: string[];
  blockers: string[];
};

async function aiRequest<T>(path: string, input: AiDraftInput): Promise<T> {
  const res = await authFetch(`${API()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export function requestDraftAssist(input: AiDraftInput): Promise<AiDraftAssist> {
  return aiRequest("/ai/draft-assist", input);
}

export function requestSubmissionCheck(
  input: AiDraftInput,
): Promise<AiSubmissionCheck> {
  return aiRequest("/ai/submission-check", input);
}
