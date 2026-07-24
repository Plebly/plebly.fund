export function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function formatSats(n: number): string {
  return `${n.toLocaleString("en-US")} sats`;
}

const PROPOSALS_PREFIX = "proposals/";

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

export function proposalHref(repoPath: string): string {
  const segments = proposalSlug(repoPath)
    .split("/")
    .filter(Boolean)
    .map((s) => encodeURIComponent(s));
  return `#/proposal/${segments.join("/")}`;
}

export function parseRoute(hash: string): import("./types").Route {
  const path = hash.replace(/^#\/?/, "").split("?")[0];
  if (!path || path === "home") return { name: "home" };
  if (path === "about") return { name: "about" };
  if (path === "parameters") return { name: "params" };
  if (path === "account") return { name: "account" };
  if (path === "propose") return { name: "propose" };
  if (path === "submit") return { name: "propose" };
  if (path.startsWith("u/")) {
    return { name: "profile", username: decodeURIComponent(path.slice(2)) };
  }
  if (path.startsWith("proposal/")) {
    const slug = path.slice("proposal/".length);
    return {
      name: "proposal",
      id: proposalRepoPath(slug),
    };
  }
  return { name: "home" };
}
