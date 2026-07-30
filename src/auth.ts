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
  clearUnreadNotificationCache();
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
  clearUnreadNotificationCache();
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

type Nip07Event = {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
};

type Nip07 = {
  getPublicKey?: () => Promise<string>;
  signEvent: (event: {
    kind: number;
    created_at: number;
    tags: string[][];
    content: string;
  }) => Promise<Nip07Event>;
};

function nip07(): Nip07 | null {
  const w = window as Window & { nostr?: Nip07 };
  return w.nostr ?? null;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/** Encode a signed NIP-98 event for the Authorization header. */
export function nostrAuthHeader(event: object): string {
  const json = JSON.stringify(event);
  // Event JSON is ASCII (hex ids/sigs); btoa is fine.
  return `Nostr ${btoa(json)}`;
}

/** Map extension / network failures to clear login copy. */
export function formatNostrLoginError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err || "");
  if (/user rejected|denied|cancel|rejected by user|approval/i.test(message)) {
    return "Nostr signing was cancelled.";
  }
  if (/no nostr extension|nip-07|window\.nostr/i.test(message)) {
    return message;
  }
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return "Could not reach the login API. Check your connection and try again.";
  }
  return message || "Nostr login failed";
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

  let chalRes: Response;
  try {
    chalRes = await fetch(`${API()}/auth/nostr/challenge`, {
      credentials: "include",
    });
  } catch (err) {
    throw new Error(formatNostrLoginError(err));
  }
  if (chalRes.status === 503) {
    throw new Error("Nostr login temporarily unavailable. Try again shortly.");
  }
  if (!chalRes.ok) throw new Error("Could not start Nostr login");
  const { challenge } = (await chalRes.json()) as { challenge?: string };
  if (!challenge || !/^[a-f0-9]{16,128}$/i.test(challenge)) {
    throw new Error("Nostr challenge missing");
  }

  const authUrl = new URL(`${API()}/auth/nostr`);
  authUrl.searchParams.set("challenge", challenge);
  const url = authUrl.toString();
  const body = JSON.stringify({ challenge });
  const payloadHash = await sha256Hex(body);

  const unsigned = {
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["u", url],
      ["method", "POST"],
      ["payload", payloadHash],
    ],
    content: "",
  };

  let signed: Nip07Event;
  try {
    signed = await ext.signEvent(unsigned);
  } catch (err) {
    throw new Error(formatNostrLoginError(err));
  }

  if (!signed?.sig || !signed.pubkey) {
    throw new Error("Nostr signer returned an incomplete event");
  }
  const pubkey = String(signed.pubkey).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(pubkey)) {
    throw new Error("Nostr signer returned an invalid pubkey");
  }
  if (signed.kind !== 27235) {
    throw new Error("Nostr signer returned the wrong event kind");
  }
  const signedUrl = signed.tags?.find((tag) => tag[0] === "u")?.[1];
  const signedMethod = signed.tags?.find((tag) => tag[0] === "method")?.[1];
  if (signedUrl !== url || String(signedMethod || "").toUpperCase() !== "POST") {
    throw new Error("Nostr signer altered the login request");
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        Authorization: nostrAuthHeader(signed),
      },
      body,
    });
  } catch (err) {
    throw new Error(formatNostrLoginError(err));
  }

  const data = (await res.json().catch(() => ({}))) as {
    token?: string;
    error?: string;
  };
  if (!res.ok) {
    if (res.status === 401) {
      throw new Error(
        data.error === "invalid or expired challenge"
          ? "Nostr login expired. Try again."
          : "Nostr signature was rejected. Try again.",
      );
    }
    throw new Error(data.error || `Nostr login failed (${res.status})`);
  }
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
      if (btn.getAttribute("aria-busy") === "true") return;
      const label = btn.querySelector<HTMLElement>("[data-login-label]");
      const prev = label?.textContent ?? btn.textContent;
      const status =
        btn
          .closest(".proposal-engagement, .login-choices, .login-menu")
          ?.querySelector<HTMLElement>(".builder-msg, [data-login-status]") ||
        null;
      btn.setAttribute("disabled", "true");
      btn.setAttribute("aria-busy", "true");
      if (btn.tagName === "BUTTON") {
        if (label) label.textContent = "Signing…";
        else btn.textContent = "Signing…";
      }
      if (status) {
        status.hidden = false;
        status.textContent = "Opening Nostr signer…";
      }
      try {
        await loginWithNostr();
        btn.closest("details.login-menu")?.removeAttribute("open");
        if (status) {
          status.hidden = false;
          status.textContent = "Signed in.";
        }
        onAuthed();
      } catch (err) {
        const message = formatNostrLoginError(err);
        if (status) {
          status.hidden = false;
          status.textContent = message;
        } else {
          window.alert(message);
        }
        if (btn.tagName === "BUTTON" && prev) {
          if (label) label.textContent = prev;
          else btn.textContent = prev;
        }
      } finally {
        btn.removeAttribute("disabled");
        btn.removeAttribute("aria-busy");
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

const UNREAD_CACHE_KEY = "plebly_unread_notify";
/** Avoid hitting Workers on every SPA navigation. */
const UNREAD_TTL_MS = 5 * 60 * 1000;

type UnreadCache = { count: number; at: number };

let memoryUnread: UnreadCache | null = null;

function clampUnread(count: number): number {
  return Math.max(0, Math.floor(count));
}

function readUnreadCache(): number | null {
  if (memoryUnread && Date.now() - memoryUnread.at < UNREAD_TTL_MS) {
    return memoryUnread.count;
  }
  try {
    const raw = sessionStorage.getItem(UNREAD_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as UnreadCache;
    if (
      typeof parsed?.count !== "number" ||
      typeof parsed?.at !== "number" ||
      Date.now() - parsed.at >= UNREAD_TTL_MS
    ) {
      return null;
    }
    memoryUnread = { count: clampUnread(parsed.count), at: parsed.at };
    return memoryUnread.count;
  } catch {
    return null;
  }
}

/** Persist unread locally so mark-read / nav can skip remote polls. */
export function setUnreadNotificationCount(count: number): number {
  const next = clampUnread(count);
  memoryUnread = { count: next, at: Date.now() };
  try {
    sessionStorage.setItem(
      UNREAD_CACHE_KEY,
      JSON.stringify(memoryUnread),
    );
  } catch {
    /* private mode */
  }
  return next;
}

export function clearUnreadNotificationCache(): void {
  memoryUnread = null;
  try {
    sessionStorage.removeItem(UNREAD_CACHE_KEY);
  } catch {
    /* ignore */
  }
}

export function peekUnreadNotificationCount(): number | null {
  return readUnreadCache();
}

export function unreadNotificationCount(
  items: ProposalNotification[],
): number {
  return items.reduce((n, item) => n + (item.read_at ? 0 : 1), 0);
}

export async function fetchNotifications(): Promise<ProposalNotification[]> {
  if (!WORKERS_API) return [];
  const res = await authFetch(`${API()}/notifications`);
  if (!res.ok) return [];
  const data = (await res.json()) as {
    notifications?: ProposalNotification[];
    unread?: number;
  };
  if (typeof data.unread === "number" && Number.isFinite(data.unread)) {
    setUnreadNotificationCount(data.unread);
  } else if (data.notifications) {
    setUnreadNotificationCount(unreadNotificationCount(data.notifications));
  }
  return data.notifications || [];
}

/**
 * Unread badge count. Uses a short session cache to avoid Workers calls on
 * every route change. Pass `{ force: true }` after login or rare refreshes.
 */
export async function fetchUnreadNotificationCount(
  opts: { force?: boolean } = {},
): Promise<number> {
  if (!WORKERS_API) return 0;
  if (!opts.force) {
    const cached = readUnreadCache();
    if (cached != null) return cached;
  }
  const res = await authFetch(`${API()}/notifications?count=1`);
  if (!res.ok) return readUnreadCache() ?? 0;
  const data = (await res.json()) as { unread?: number };
  const unread =
    typeof data.unread === "number" && Number.isFinite(data.unread)
      ? clampUnread(data.unread)
      : 0;
  return setUnreadNotificationCount(unread);
}

export async function markNotificationsRead(
  ids?: string[],
): Promise<number> {
  if (!WORKERS_API) return 0;
  const res = await authFetch(`${API()}/notifications/read`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(ids?.length ? { ids } : {}),
  });
  if (!res.ok) throw new Error("Could not mark notifications read");
  const data = (await res.json()) as { unread?: number };
  const unread =
    typeof data.unread === "number" ? clampUnread(data.unread) : 0;
  return setUnreadNotificationCount(unread);
}

/**
 * Mark unread notifications for a proposal as read when the user opens it.
 * One POST (no prior list fetch). Skips the network if local unread is 0.
 */
export async function markNotificationsForProposalRead(opts: {
  proposalId?: string | null;
  proposalPath?: string | null;
}): Promise<number> {
  if (!WORKERS_API) return 0;
  const id = opts.proposalId?.trim() || "";
  const path = opts.proposalPath?.trim() || "";
  if (!id && !path) return fetchUnreadNotificationCount();

  const cached = readUnreadCache();
  if (cached === 0) return 0;

  const res = await authFetch(`${API()}/notifications/read`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...(id ? { proposal_id: id } : {}),
      ...(path ? { proposal_path: path } : {}),
    }),
  });
  if (!res.ok) return cached ?? 0;
  const data = (await res.json()) as { unread?: number };
  const unread =
    typeof data.unread === "number" ? clampUnread(data.unread) : 0;
  return setUnreadNotificationCount(unread);
}

/** Compact unread count control next to the account nav link. */
export function notificationNavBadgeHtml(count: number): string {
  const n = clampUnread(count);
  if (n <= 0) return "";
  const label = n > 99 ? "99+" : String(n);
  const aria = n === 1 ? "1 unread notification" : `${label} unread notifications`;
  return `<a href="${href("/account", "?tab=notifications")}" class="nav-notify-badge" data-nav-notify-badge title="${escapeHtml(aria)}" aria-label="${escapeHtml(aria)}">${escapeHtml(label)}</a>`;
}

/** Patch the nav badge in place after mark-read without a full re-render. */
export function updateNavUnreadBadge(count: number): void {
  const next = setUnreadNotificationCount(count);
  const host = document.querySelector<HTMLElement>("[data-nav-account-wrap]");
  if (!host) return;
  const existing = host.querySelector("[data-nav-notify-badge]");
  const html = notificationNavBadgeHtml(next);
  if (!html) {
    existing?.remove();
    return;
  }
  if (existing) existing.outerHTML = html;
  else host.insertAdjacentHTML("beforeend", html);
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
  funder_credit?: {
    public_credit: boolean;
    show_amount: boolean;
  };
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

/** Compact display for a hex pubkey (npub encoding stays optional without nostr-tools). */
export function shortNostrPubkey(pubkey: string): string {
  const pk = pubkey.trim().toLowerCase();
  if (pk.length < 12) return pk || "nostr";
  return `${pk.slice(0, 8)}…${pk.slice(-4)}`;
}

export function userLabel(user: AuthUser): string {
  if (user.username) return `@${user.username}`;
  if (user.github) return `@${user.github}`;
  if (user.nostr) return shortNostrPubkey(user.nostr);
  if (user.x) return `@${user.x}`;
  return user.id;
}

/** Nav label for the signed-in account link (no @ prefix). */
export function accountNavLabel(user: AuthUser): string {
  if (user.username) return user.username;
  if (user.github) return user.github;
  if (user.nostr) return shortNostrPubkey(user.nostr);
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
  source_issue?: {
    owner: string;
    repo: string;
    number: number;
    html_url: string;
    author_login?: string | null;
  } | null;
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
