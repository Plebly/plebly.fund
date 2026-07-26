import { escapeHtml } from "./util";

export const PLEBLY_GITHUB_URL = "https://github.com/Plebly";
export const PLEBLY_X_URL = "https://x.com/joinplebly";

type BrandIcon = "github" | "x-twitter" | "reddit" | "hacker-news";
type SolidIcon =
  | "eye"
  | "eye-slash"
  | "handshake"
  | "bitcoin-sign"
  | "xmark"
  | "link"
  | "share-nodes";

export function brandIcon(className: BrandIcon | string): string {
  return `<i class="fa-brands fa-${className}" aria-hidden="true"></i>`;
}

/** Nostr face mark (nostr.com), monochrome for UI buttons. */
export function nostrIcon(): string {
  return `<svg class="icon-nostr" viewBox="0 0 1024 1024" width="1em" height="1em" aria-hidden="true" focusable="false"><g fill="currentColor"><circle cx="286" cy="382" r="86"/><circle cx="512" cy="352" r="110"/><circle cx="738" cy="382" r="86"/><rect x="135" y="480" width="302" height="226" rx="104"/><rect x="587" y="480" width="302" height="226" rx="104"/><rect x="319" y="476" width="386" height="305" rx="92"/></g></svg>`;
}

export function solidIcon(className: SolidIcon | string): string {
  return `<i class="fa-solid fa-${className}" aria-hidden="true"></i>`;
}

export function btnWithIcon(icon: SolidIcon | string, label: string): string {
  return `<span class="btn-icon">${solidIcon(icon)}<span>${escapeHtml(label)}</span></span>`;
}

export function btnWithBrandIcon(icon: BrandIcon, label: string): string {
  return `<span class="btn-icon">${brandIcon(icon)}<span>${escapeHtml(label)}</span></span>`;
}

/** Brand mark only — use with aria-label / title on the control. */
export function btnBrandIconOnly(icon: BrandIcon): string {
  return `<span class="btn-icon btn-icon-only">${brandIcon(icon)}</span>`;
}

export function btnWithNostrIcon(label: string): string {
  return `<span class="btn-icon">${nostrIcon()}<span data-login-label>${escapeHtml(label)}</span></span>`;
}

/** Nostr mark only — use with aria-label / title on the control. */
export function btnNostrIconOnly(): string {
  return `<span class="btn-icon btn-icon-only" data-login-label>${nostrIcon()}</span>`;
}

export function iconLink(
  icon: BrandIcon,
  href: string,
  label: string,
  extraClass = "",
): string {
  const cls = extraClass ? `icon-link ${extraClass}` : "icon-link";
  return `<a class="${cls}" href="${escapeHtml(href)}" target="_blank" rel="noreferrer noopener" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">${brandIcon(icon)}</a>`;
}

export function socialAccountLink(
  icon: BrandIcon,
  href: string,
  handle: string,
): string {
  return `<a class="social-account" href="${escapeHtml(href)}" target="_blank" rel="noreferrer noopener">${brandIcon(icon)}<span>@${escapeHtml(handle.replace(/^@/, ""))}</span></a>`;
}

/** Account identity row for a Nostr hex pubkey (links to njump). */
export function nostrAccountLink(pubkey: string, label: string): string {
  const pk = pubkey.trim().toLowerCase();
  const href = `https://njump.me/${encodeURIComponent(pk)}`;
  return `<a class="social-account" href="${escapeHtml(href)}" target="_blank" rel="noreferrer noopener">${nostrIcon()}<span>${escapeHtml(label)}</span></a>`;
}

export function pleblySocialLinksHtml(): string {
  return `<span class="social-links">
    ${iconLink("github", PLEBLY_GITHUB_URL, "Plebly on GitHub")}
    ${iconLink("x-twitter", PLEBLY_X_URL, "Plebly on X (@joinplebly)")}
  </span>`;
}

export function pleblySocialAccountsHtml(): string {
  return `<span class="social-accounts">
    ${socialAccountLink("github", PLEBLY_GITHUB_URL, "Plebly")}
    ${socialAccountLink("x-twitter", PLEBLY_X_URL, "joinplebly")}
  </span>`;
}
