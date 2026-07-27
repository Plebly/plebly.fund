import type { Route } from "./types";
import { proposalRepoPath, proposalSlug, proposalStablePath } from "./util";

export const SITE_ORIGIN = "https://plebly.fund";
const DEFAULT_DESCRIPTION =
  "Fund open Bitcoin work with publicly verifiable on-chain escrow. No custodian in the middle.";

/** Vite base path, always with trailing slash (e.g. "/" or "/plebly.fund/"). */
export function basePath(): string {
  const base = import.meta.env.BASE_URL || "/";
  return base.endsWith("/") ? base : `${base}/`;
}

/** Strip the deploy base so routes are always "/propose", "/u/foo", etc. */
export function appPathname(): string {
  const base = basePath().replace(/\/$/, "") || "";
  let path = location.pathname;
  if (base && (path === base || path.startsWith(`${base}/`))) {
    path = path.slice(base.length) || "/";
  }
  if (!path.startsWith("/")) path = `/${path}`;
  return path.replace(/\/+$/, "") || "/";
}

/** Build an in-app href (respects Vite base). Path should start with "/". */
export function href(path: string, search = "", hash = ""): string {
  let p = path.trim() || "/";
  if (!p.startsWith("/")) p = `/${p}`;
  if (p.length > 1) p = p.replace(/\/+$/, "");
  const base = basePath();
  const prefixed =
    base === "/" ? p : `${base.replace(/\/$/, "")}${p === "/" ? "/" : p}`;
  const q = search
    ? search.startsWith("?")
      ? search
      : `?${search}`
    : "";
  const h = hash
    ? hash.startsWith("#")
      ? hash
      : `#${hash}`
    : "";
  return `${prefixed}${q}${h}`;
}

export function proposalHref(repoPath: string, id?: string | null): string {
  if (id?.trim()) return href(proposalStablePath(id));
  const segments = proposalSlug(repoPath)
    .split("/")
    .filter(Boolean)
    .map((s) => encodeURIComponent(s));
  return href(`/proposal/${segments.join("/")}`);
}

export function profileHref(username: string): string {
  return href(`/u/${encodeURIComponent(username)}`);
}

export function parseLocation(
  pathname = appPathname(),
  search = location.search,
): Route {
  const path = pathname.replace(/^\/+/, "").split("?")[0];
  if (!path || path === "home") return { name: "home" };
  if (path === "about") return { name: "about" };
  if (path === "stats") return { name: "stats" };
  if (path === "parameters") return { name: "params" };
  if (path === "account") return { name: "account" };
  if (path === "work") return { name: "work" };
  if (path === "propose" || path === "submit") return { name: "propose" };
  if (path === "reviewers" || path === "governance") return { name: "reviewers" };
  if (path.startsWith("u/")) {
    return { name: "profile", username: decodeURIComponent(path.slice(2)) };
  }
  if (path.startsWith("proposal/")) {
    const slug = path.slice("proposal/".length);
    return { name: "proposal", id: proposalRepoPath(slug) };
  }
  if (path.startsWith("p/")) {
    const id = decodeURIComponent(path.slice("p/".length)).trim();
    if (id) return { name: "proposal", id, stable: true };
  }
  void search;
  return { name: "home" };
}

/** Current app path + query for OAuth return_to (no origin). */
export function currentReturnPath(): string {
  const path = appPathname();
  const search = location.search || "";
  return `${path}${search}`;
}

export function navigate(
  to: string,
  opts?: { replace?: boolean; state?: unknown },
): void {
  const url = to.startsWith("http") ? to : resolveInAppUrl(to);
  if (opts?.replace) history.replaceState(opts.state ?? null, "", url);
  else history.pushState(opts?.state ?? null, "", url);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function resolveInAppUrl(to: string): string {
  if (to.startsWith("#") && !to.startsWith("#/")) {
    return `${location.pathname}${location.search}${to}`;
  }
  if (to.startsWith("#/")) {
    return resolveInAppUrl(to.slice(1));
  }
  const u = new URL(to.startsWith("/") ? to : `/${to}`, "https://plebly.local");
  return href(u.pathname, u.search, u.hash);
}

/**
 * Migrate legacy hash routes (#/propose) to path routes (/propose).
 * Leaves #plebly_auth=… alone for OAuth session handoff.
 */
export function migrateHashRoute(): boolean {
  const raw = location.hash;
  if (!raw || raw === "#") return false;
  if (/^#(?:plebly_auth=)/.test(raw)) return false;
  if (!raw.startsWith("#/")) return false;

  const body = raw.slice(1); // /propose?tab=x or /propose
  const authMatch = body.match(/[?&]?(plebly_auth=[^&]+)/);
  const cleaned = body
    .replace(/[?&]?plebly_auth=[^&]*/g, "")
    .replace(/\?&/, "?")
    .replace(/\?$/, "");
  const qIdx = cleaned.indexOf("?");
  const path = qIdx === -1 ? cleaned : cleaned.slice(0, qIdx);
  const search = qIdx === -1 ? "" : cleaned.slice(qIdx);
  const authHash = authMatch ? `#${authMatch[1]}` : "";
  history.replaceState(null, "", href(path || "/", search, authHash));
  return true;
}

/** Intercept same-app link clicks for SPA navigation (no full reload). */
export function bindSpaNavigation(root: ParentNode = document): void {
  root.addEventListener("click", (event) => {
    const e = event as MouseEvent;
    if (e.defaultPrevented || e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as Element | null)?.closest?.("a");
    if (!a) return;
    if (a.target && a.target !== "_self") return;
    if (a.hasAttribute("download")) return;
    const raw = a.getAttribute("href");
    if (!raw || raw.startsWith("mailto:") || raw.startsWith("tel:")) return;

    // Pure in-page anchors on current path
    if (raw.startsWith("#") && !raw.startsWith("#/")) return;

    let url: URL;
    try {
      url = new URL(raw, location.href);
    } catch {
      return;
    }
    if (url.origin !== location.origin) return;

    const base = basePath().replace(/\/$/, "");
    const path = url.pathname;
    const inApp =
      !base ||
      path === base ||
      path.startsWith(`${base}/`) ||
      base === "";
    if (!inApp) return;

    e.preventDefault();
    const next = `${url.pathname}${url.search}${url.hash}`;
    if (next === `${location.pathname}${location.search}${location.hash}`) {
      return;
    }
    history.pushState(null, "", next);
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
}

export type SeoInput = {
  title?: string;
  description?: string;
  path?: string;
  image?: string;
  noindex?: boolean;
  /** JSON-LD graph objects (FundingCampaign, WebSite, etc.) */
  jsonLd?: Record<string, unknown> | Record<string, unknown>[];
};

function ensureMeta(attr: "name" | "property", key: string): HTMLMetaElement {
  const sel =
    attr === "name"
      ? `meta[name="${key}"]`
      : `meta[property="${key}"]`;
  let el = document.head.querySelector<HTMLMetaElement>(sel);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  return el;
}

function ensureLink(rel: string): HTMLLinkElement {
  let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement("link");
    el.rel = rel;
    document.head.appendChild(el);
  }
  return el;
}

function canonicalUrl(appPath: string): string {
  let p = (appPath || "/").split("?")[0];
  if (!p.startsWith("/")) p = `/${p}`;
  if (p.length > 1) p = p.replace(/\/+$/, "");
  return p === "/" ? `${SITE_ORIGIN}/` : `${SITE_ORIGIN}${p}`;
}

function applyJsonLd(
  data: Record<string, unknown> | Record<string, unknown>[] | undefined,
): void {
  const id = "plebly-jsonld";
  const existing = document.getElementById(id);
  if (!data) {
    existing?.remove();
    return;
  }
  const el =
    (existing as HTMLScriptElement | null) ||
    document.createElement("script");
  el.id = id;
  el.type = "application/ld+json";
  el.textContent = JSON.stringify(data);
  if (!existing) document.head.appendChild(el);
}

/** Update document title + Open Graph / Twitter / canonical for the active route. */
export function applySeo(input: SeoInput): void {
  const title = input.title?.trim() || "Plebly";
  const description = input.description?.trim() || DEFAULT_DESCRIPTION;
  const path = input.path || currentReturnPath().split("?")[0] || "/";
  const canonical = canonicalUrl(path);
  const image = input.image || `${SITE_ORIGIN}/logo.jpeg`;

  document.title = title.includes("Plebly") ? title : `${title} · Plebly`;

  ensureMeta("name", "description").content = description;
  ensureMeta("name", "robots").content = input.noindex
    ? "noindex, nofollow"
    : "index, follow";

  ensureLink("canonical").href = canonical;

  ensureMeta("property", "og:type").content = "website";
  ensureMeta("property", "og:site_name").content = "Plebly";
  ensureMeta("property", "og:locale").content = "en_US";
  ensureMeta("property", "og:title").content = document.title;
  ensureMeta("property", "og:description").content = description;
  ensureMeta("property", "og:url").content = canonical;
  ensureMeta("property", "og:image").content = image;
  ensureMeta("property", "og:image:alt").content = "Plebly";

  ensureMeta("name", "twitter:card").content =
    image !== `${SITE_ORIGIN}/logo.jpeg` ? "summary_large_image" : "summary";
  ensureMeta("name", "twitter:site").content = "@joinplebly";
  ensureMeta("name", "twitter:title").content = document.title;
  ensureMeta("name", "twitter:description").content = description;
  ensureMeta("name", "twitter:image").content = image;

  applyJsonLd(input.jsonLd);
}

/** Build FundingCampaign JSON-LD for a proposal page. */
export function proposalJsonLd(input: {
  id: string | null;
  title: string;
  description: string;
  path: string;
  status: string;
  target_sats?: number | null;
  balance_sats?: number | null;
  cover_image?: string | null;
}): Record<string, unknown> {
  const url = input.id
    ? `${SITE_ORIGIN}/p/${encodeURIComponent(input.id.trim().toLowerCase())}`
    : canonicalUrl(input.path.startsWith("/") ? input.path : `/${input.path}`);
  const raised =
    typeof input.balance_sats === "number" && input.balance_sats > 0
      ? {
          "@type": "MonetaryAmount",
          currency: "XBT",
          value: (input.balance_sats / 1e8).toFixed(8),
        }
      : undefined;
  const goal =
    typeof input.target_sats === "number" && input.target_sats > 0
      ? {
          "@type": "MonetaryAmount",
          currency: "XBT",
          value: (input.target_sats / 1e8).toFixed(8),
        }
      : undefined;
  return {
    "@context": "https://schema.org",
    "@type": "FundingCampaign",
    name: input.title,
    description: input.description,
    url,
    identifier: input.id || undefined,
    creativeWorkStatus: input.status,
    ...(input.cover_image ? { image: input.cover_image } : {}),
    ...(raised ? { amount: raised } : {}),
    ...(goal ? { fundingGoal: goal } : {}),
    funder: { "@type": "Organization", name: "Plebly", url: SITE_ORIGIN },
  };
}

export function seoForRoute(
  route: Route,
  extra?: { title?: string; description?: string; path?: string },
): SeoInput {
  switch (route.name) {
    case "home":
      return {
        title: "Plebly: Fund open Bitcoin work",
        description: DEFAULT_DESCRIPTION,
        path: "/",
        jsonLd: {
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "Organization",
              "@id": `${SITE_ORIGIN}/#organization`,
              name: "Plebly",
              url: `${SITE_ORIGIN}/`,
              logo: `${SITE_ORIGIN}/logo.jpeg`,
              sameAs: [
                "https://x.com/joinplebly",
                "https://github.com/Plebly",
              ],
            },
            {
              "@type": "WebSite",
              "@id": `${SITE_ORIGIN}/#website`,
              name: "Plebly",
              url: `${SITE_ORIGIN}/`,
              description: DEFAULT_DESCRIPTION,
              publisher: { "@id": `${SITE_ORIGIN}/#organization` },
            },
          ],
        },
      };
    case "about":
      return {
        title: "About Plebly",
        description:
          "Non-custodial escrow, uncensorable proposals, and protocol-over-platform rules for Bitcoin public goods funding.",
        path: "/about",
      };
    case "stats":
      return {
        title: "Funding stats",
        description:
          "Public, best-effort funding and completion totals for Plebly Bitcoin work.",
        path: "/stats",
      };
    case "propose":
      return {
        title: "Start a project",
        description:
          "Propose Bitcoin development or research work, pay the on-chain submission fee, and list it for public funding.",
        path: "/propose",
      };
    case "reviewers":
      return {
        title: "Reviewers",
        description:
          "Active reviewer roster, open decisions, and funder removal ballots on Plebly.",
        path: "/reviewers",
      };
    case "account":
      return {
        title: "Account",
        description: "Manage your Plebly profile, watches, and claims.",
        path: "/account",
        noindex: true,
      };
    case "profile":
      return {
        title: extra?.title || `@${route.username}`,
        description:
          extra?.description ||
          `Public Plebly profile for @${route.username} on Plebly.`,
        path: `/u/${encodeURIComponent(route.username)}`,
      };
    case "proposal":
      return {
        title: extra?.title || "Project",
        description:
          extra?.description ||
          "Open Bitcoin project with publicly verifiable on-chain escrow on Plebly.",
        path: extra?.path || `/proposal/${proposalSlug(route.id)}`,
      };
    default:
      return { title: "Plebly", description: DEFAULT_DESCRIPTION, path: "/" };
  }
}
