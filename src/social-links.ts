import { brandIcon } from "./icons";
import type { ProfileLink } from "./types";
import { escapeHtml } from "./util";

export type SocialPlatform = {
  icon: string;
  label: string;
};

type PlatformDef = SocialPlatform & { hosts: string[] };

/** Font Awesome brand icons for known profile URLs (label optional on save). */
const PLATFORMS: PlatformDef[] = [
  { icon: "github", label: "GitHub", hosts: ["github.com", "gist.github.com"] },
  { icon: "gitlab", label: "GitLab", hosts: ["gitlab.com"] },
  { icon: "bitbucket", label: "Bitbucket", hosts: ["bitbucket.org"] },
  { icon: "codepen", label: "CodePen", hosts: ["codepen.io"] },
  { icon: "npm", label: "npm", hosts: ["npmjs.com"] },
  { icon: "docker", label: "Docker Hub", hosts: ["hub.docker.com"] },
  { icon: "x-twitter", label: "X", hosts: ["x.com", "twitter.com", "mobile.twitter.com"] },
  { icon: "linkedin", label: "LinkedIn", hosts: ["linkedin.com"] },
  { icon: "facebook", label: "Facebook", hosts: ["facebook.com", "fb.com", "m.facebook.com"] },
  { icon: "instagram", label: "Instagram", hosts: ["instagram.com"] },
  { icon: "threads", label: "Threads", hosts: ["threads.net", "threads.com"] },
  { icon: "tiktok", label: "TikTok", hosts: ["tiktok.com", "vm.tiktok.com"] },
  { icon: "snapchat", label: "Snapchat", hosts: ["snapchat.com"] },
  { icon: "pinterest", label: "Pinterest", hosts: ["pinterest.com", "pin.it"] },
  { icon: "youtube", label: "YouTube", hosts: ["youtube.com", "youtu.be", "music.youtube.com"] },
  { icon: "twitch", label: "Twitch", hosts: ["twitch.tv"] },
  { icon: "vimeo", label: "Vimeo", hosts: ["vimeo.com"] },
  { icon: "spotify", label: "Spotify", hosts: ["spotify.com", "open.spotify.com"] },
  { icon: "soundcloud", label: "SoundCloud", hosts: ["soundcloud.com"] },
  { icon: "apple", label: "Apple Music", hosts: ["music.apple.com"] },
  { icon: "bandcamp", label: "Bandcamp", hosts: ["bandcamp.com"] },
  { icon: "reddit", label: "Reddit", hosts: ["reddit.com", "old.reddit.com", "www.reddit.com"] },
  { icon: "discord", label: "Discord", hosts: ["discord.com", "discord.gg"] },
  { icon: "slack", label: "Slack", hosts: ["slack.com"] },
  { icon: "telegram", label: "Telegram", hosts: ["t.me", "telegram.me", "telegram.org"] },
  { icon: "whatsapp", label: "WhatsApp", hosts: ["whatsapp.com", "wa.me", "chat.whatsapp.com"] },
  { icon: "signal-messenger", label: "Signal", hosts: ["signal.me", "signal.group", "signal.org"] },
  { icon: "matrix", label: "Matrix", hosts: ["matrix.to"] },
  { icon: "mastodon", label: "Mastodon", hosts: ["mastodon.social", "mas.to", "mstdn.social"] },
  { icon: "bluesky", label: "Bluesky", hosts: ["bsky.app", "bsky.social"] },
  { icon: "nostr", label: "Nostr", hosts: ["nostr.com", "primal.net", "snort.social", "njump.me", "habla.news", "iris.to", "coracle.social"] },
  { icon: "medium", label: "Medium", hosts: ["medium.com"] },
  { icon: "substack", label: "Substack", hosts: ["substack.com"] },
  { icon: "dev", label: "DEV", hosts: ["dev.to"] },
  { icon: "hashnode", label: "Hashnode", hosts: ["hashnode.com", "hashnode.dev"] },
  { icon: "stackoverflow", label: "Stack Overflow", hosts: ["stackoverflow.com"] },
  {
    icon: "stack-exchange",
    label: "Stack Exchange",
    hosts: ["stackexchange.com", "superuser.com", "serverfault.com", "askubuntu.com"],
  },
  { icon: "hacker-news", label: "Hacker News", hosts: ["news.ycombinator.com"] },
  { icon: "patreon", label: "Patreon", hosts: ["patreon.com"] },
  { icon: "linktree", label: "Linktree", hosts: ["linktr.ee"] },
  { icon: "paypal", label: "PayPal", hosts: ["paypal.com", "paypal.me"] },
  { icon: "cc-venmo", label: "Venmo", hosts: ["venmo.com"] },
  { icon: "tumblr", label: "Tumblr", hosts: ["tumblr.com"] },
  { icon: "flickr", label: "Flickr", hosts: ["flickr.com"] },
  { icon: "behance", label: "Behance", hosts: ["behance.net"] },
  { icon: "dribbble", label: "Dribbble", hosts: ["dribbble.com"] },
  { icon: "figma", label: "Figma", hosts: ["figma.com"] },
  { icon: "wordpress", label: "WordPress", hosts: ["wordpress.com"] },
  { icon: "steam", label: "Steam", hosts: ["steamcommunity.com", "store.steampowered.com"] },
  { icon: "orcid", label: "ORCID", hosts: ["orcid.org"] },
  { icon: "researchgate", label: "ResearchGate", hosts: ["researchgate.net"] },
  { icon: "google-scholar", label: "Google Scholar", hosts: ["scholar.google.com"] },
  { icon: "ethereum", label: "Mirror", hosts: ["mirror.xyz"] },
  { icon: "farcaster", label: "Farcaster", hosts: ["warpcast.com", "farcaster.xyz"] },
];

const SOCIAL_BY_HOST = Object.fromEntries(
  PLATFORMS.flatMap((p) => p.hosts.map((host) => [host, { icon: p.icon, label: p.label }])),
) as Record<string, SocialPlatform>;

/** Only http(s) profile URLs may become hrefs. */
export function isSafeHttpUrl(url: string): boolean {
  try {
    const u = new URL(url.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** Escape + allowlist http(s) for Worker-sourced hrefs (rejects javascript:). */
export function safeHrefAttr(url: string | undefined | null): string | null {
  if (!url || !isSafeHttpUrl(url)) return null;
  return escapeHtml(url.trim());
}

function hostFromUrl(url: string): string | null {
  if (!isSafeHttpUrl(url)) return null;
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return null;
  }
}

function hostHeuristicPlatform(host: string): SocialPlatform | null {
  if (host.includes("mastodon") || host.endsWith(".social")) {
    return { icon: "mastodon", label: "Mastodon" };
  }
  return null;
}

export function detectSocialPlatform(url: string): SocialPlatform | null {
  const host = hostFromUrl(url);
  if (!host) return null;
  return SOCIAL_BY_HOST[host] ?? hostHeuristicPlatform(host);
}

export function isKnownSocialUrl(url: string): boolean {
  return detectSocialPlatform(url) != null;
}

function normalizeProfileUrl(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./i, "").toLowerCase();
    const path = u.pathname.replace(/\/+$/, "").toLowerCase() || "/";
    return `${host}${path}`;
  } catch {
    return url.trim().toLowerCase();
  }
}

function profilePathHandle(url: string): string | null {
  try {
    const path = new URL(url).pathname.replace(/^\/+|\/+$/g, "");
    const seg = path.split("/").filter(Boolean)[0];
    return seg ? seg.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** Drop custom links that repeat OAuth GitHub / X identities. */
export function filterIdentityDuplicateLinks(
  links: ProfileLink[],
  identity: { github?: string; x?: string },
): ProfileLink[] {
  const blocked = new Set<string>();
  if (identity.github) {
    blocked.add(normalizeProfileUrl(`https://github.com/${identity.github}`));
  }
  if (identity.x) {
    blocked.add(
      normalizeProfileUrl(`https://x.com/${identity.x.replace(/^@/, "")}`),
    );
  }

  return links.filter((link) => {
    const url = link.url.trim();
    if (!url) return false;
    if (blocked.has(normalizeProfileUrl(url))) return false;

    const platform = detectSocialPlatform(url);
    const handle = profilePathHandle(url);
    if (
      platform?.icon === "github" &&
      identity.github &&
      handle === identity.github.replace(/^@/, "").toLowerCase()
    ) {
      return false;
    }
    if (
      platform?.icon === "x-twitter" &&
      identity.x &&
      handle === identity.x.replace(/^@/, "").toLowerCase()
    ) {
      return false;
    }
    return true;
  });
}

export function profileLinksForUser(profile: {
  github?: string;
  x?: string;
  links?: ProfileLink[];
}): ProfileLink[] {
  const oauth: ProfileLink[] = [];
  if (profile.github) {
    oauth.push({
      label: "",
      url: `https://github.com/${profile.github.replace(/^@/, "")}`,
    });
  }
  if (profile.x) {
    oauth.push({
      label: "",
      url: `https://x.com/${profile.x.replace(/^@/, "")}`,
    });
  }
  const custom = filterIdentityDuplicateLinks(profile.links ?? [], profile);
  return [...oauth, ...custom];
}

function profileLinkAriaLabel(
  link: ProfileLink,
  platform: SocialPlatform | null,
): string {
  const label = link.label.trim();
  if (label) return label;
  const handle = profilePathHandle(link.url);
  if (platform && handle) return `${platform.label} @${handle}`;
  if (platform) return platform.label;
  return link.url;
}

/** Visible text beside the icon; null = icon-only (known social, blank label). */
function profileLinkVisibleText(
  link: ProfileLink,
  identity?: { github?: string; x?: string },
): string | null {
  const label = link.label.trim();
  if (label) return label;

  const platform = detectSocialPlatform(link.url);
  if (platform) {
    // Blank label on a known social → icon only (label was optional)
    return null;
  }

  // Prefer matching OAuth handle if we ever surface non-platform text
  void identity;
  return link.url;
}

export function profileLinkHtml(
  link: ProfileLink,
  identity?: { github?: string; x?: string },
): string {
  if (!isSafeHttpUrl(link.url)) {
    const label = escapeHtml(link.label.trim() || link.url);
    return `<span class="profile-link profile-link-text muted">${label}</span>`;
  }
  const href = escapeHtml(link.url);
  const platform = detectSocialPlatform(link.url);
  const text = profileLinkVisibleText(link, identity);
  const aria = escapeHtml(profileLinkAriaLabel(link, platform));

  if (platform) {
    const labelHtml = text
      ? `<span>${escapeHtml(text)}</span>`
      : "";
    const iconOnly = text ? "" : " profile-link-icon";
    return `<a class="profile-link${iconOnly}" href="${href}" target="_blank" rel="noreferrer noopener" aria-label="${aria}" title="${aria}">${brandIcon(platform.icon)}${labelHtml}</a>`;
  }

  return `<a class="profile-link profile-link-text" href="${href}" target="_blank" rel="noreferrer noopener"><span>${escapeHtml(text || link.url)}</span></a>`;
}

export function profileLinksListHtml(profile: {
  github?: string;
  x?: string;
  links?: ProfileLink[];
}): string {
  const links = profileLinksForUser(profile);
  if (!links.length) return "";
  return `<ul class="profile-links">${links
    .map((l) => `<li>${profileLinkHtml(l, profile)}</li>`)
    .join("")}</ul>`;
}

/** Hostnames that skip the label requirement (keep in sync with workers/src/lib/social-urls.ts). */
export const SOCIAL_HOSTS = Object.keys(SOCIAL_BY_HOST);
