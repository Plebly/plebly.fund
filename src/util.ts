export function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const BARE_URL_RE = /(https?:\/\/[^\s<]+)/gi;

/**
 * Escape text, then turn bare http(s) URLs into external links.
 * Safe for notes / labels / comments that are otherwise plain text.
 */
export function linkifyText(text: string): string {
  return escapeHtml(text).replace(BARE_URL_RE, (raw) => {
    let url = raw;
    let trail = "";
    while (/[.,;:!?)\]}'"]$/u.test(url)) {
      trail = `${url.slice(-1)}${trail}`;
      url = url.slice(0, -1);
    }
    if (!/^https?:\/\//i.test(url)) return raw;
    return `<a href="${url}" target="_blank" rel="noreferrer noopener">${url}</a>${trail}`;
  });
}

/** QR module colors from live CSS theme tokens. */
export function themeQrColors(): { dark: string; light: string } {
  try {
    const styles = getComputedStyle(document.documentElement);
    const dark = styles.getPropertyValue("--bg").trim() || "#0c0b10";
    const light = styles.getPropertyValue("--ink").trim() || "#f2f0f6";
    return { dark, light };
  } catch {
    return { dark: "#0c0b10", light: "#f2f0f6" };
  }
}

export function formatSats(n: number): string {
  return `${n.toLocaleString("en-US")} sats`;
}

/** Exact local date/time for `title` tooltips. */
export function formatAbsoluteDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Relative time label with absolute `title` for hover.
 * Pass `nowMs` in tests for stable output.
 */
export function formatTimeAgo(
  iso: string,
  nowMs = Date.now(),
): { text: string; title: string } | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const title = formatAbsoluteDateTime(iso);
  const deltaSec = Math.round((nowMs - d.getTime()) / 1000);
  if (deltaSec < 45) return { text: "just now", title };
  if (deltaSec < 90) return { text: "1m ago", title };
  const deltaMin = Math.round(deltaSec / 60);
  if (deltaMin < 60) return { text: `${deltaMin}m ago`, title };
  const deltaHr = Math.round(deltaMin / 60);
  if (deltaHr < 36) return { text: `${deltaHr}h ago`, title };
  const deltaDay = Math.round(deltaHr / 24);
  if (deltaDay < 14) return { text: `${deltaDay}d ago`, title };
  const text = d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  return { text, title };
}

/** `<time datetime title>` markup for relative timestamps. */
export function timeAgoHtml(iso: string | null | undefined, nowMs = Date.now()): string {
  if (!iso) return "";
  const ago = formatTimeAgo(iso, nowMs);
  if (!ago) return "";
  return `<time class="timeago" datetime="${escapeHtml(iso)}" title="${escapeHtml(ago.title)}">${escapeHtml(ago.text)}</time>`;
}

function pluralUnit(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

/**
 * Relative horizon for due dates: "in 6 months", "3 days overdue".
 * Prefer calendar-ish units for longer spans (milestones).
 */
export function formatTimeAhead(
  iso: string,
  nowMs = Date.now(),
): { text: string; title: string } | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const title = formatAbsoluteDateTime(iso);
  const deltaMs = d.getTime() - nowMs;
  const absSec = Math.abs(Math.round(deltaMs / 1000));
  if (absSec < 12 * 3600) {
    return { text: "due today", title };
  }

  let span: string;
  if (absSec < 14 * 86400) {
    span = pluralUnit(
      Math.max(1, Math.round(absSec / 86400)),
      "day",
      "days",
    );
  } else if (absSec < 28 * 86400) {
    span = pluralUnit(
      Math.max(1, Math.round(absSec / (7 * 86400))),
      "week",
      "weeks",
    );
  } else if (absSec < 540 * 86400) {
    span = pluralUnit(
      Math.max(1, Math.round(absSec / (30 * 86400))),
      "month",
      "months",
    );
  } else {
    span = pluralUnit(
      Math.max(1, Math.round(absSec / (365 * 86400))),
      "year",
      "years",
    );
  }

  return {
    text: deltaMs >= 0 ? `in ${span}` : `${span} overdue`,
    title,
  };
}

/** BIP21 URI; optional amount in sats → BTC. */
export function bitcoinUri(address: string, amountSats?: number | null): string {
  if (amountSats != null && amountSats > 0) {
    const btc = (amountSats / 1e8).toFixed(8).replace(/\.?0+$/, "");
    return `bitcoin:${address}?amount=${btc}`;
  }
  return `bitcoin:${address}`;
}

const PROPOSALS_PREFIX = "proposals/";

/** Frontmatter ID → stable public proposal path (lowercase; resolve is case-insensitive). */
export function proposalStablePath(id: string): string {
  return `/p/${encodeURIComponent(id.trim().toLowerCase())}`;
}

/** Repo path → URL slug, e.g. proposals/listed/foo.md → listed/foo */
export function proposalSlug(repoPath: string): string {
  let slug = repoPath.trim().replace(/^\/+/, "");
  if (slug.startsWith(PROPOSALS_PREFIX)) {
    slug = slug.slice(PROPOSALS_PREFIX.length);
  }
  if (slug.endsWith(".md")) {
    slug = slug.slice(0, -3);
  }
  return slug;
}

/** URL slug → repo path, e.g. listed/foo → proposals/listed/foo.md */
export function proposalRepoPath(slug: string): string {
  let path = decodeURIComponent(slug.trim()).replace(/^\/+/, "");
  if (path.startsWith(PROPOSALS_PREFIX)) {
    return path.endsWith(".md") ? path : `${path}.md`;
  }
  return `${PROPOSALS_PREFIX}${path.endsWith(".md") ? path : `${path}.md`}`;
}
