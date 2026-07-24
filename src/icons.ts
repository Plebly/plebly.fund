import { escapeHtml } from "./util";

export const PLEBLY_GITHUB_URL = "https://github.com/Plebly";
export const PLEBLY_X_URL = "https://x.com/joinplebly";

type BrandIcon = "github" | "x-twitter";

export function brandIcon(className: BrandIcon | string): string {
  return `<i class="fa-brands fa-${className}" aria-hidden="true"></i>`;
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
