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

export function parseRoute(hash: string): import("./types").Route {
  const path = hash.replace(/^#\/?/, "");
  if (!path || path === "home") return { name: "home" };
  if (path === "parameters") return { name: "params" };
  if (path === "account") return { name: "account" };
  if (path === "submit") return { name: "submit" };
  if (path.startsWith("u/")) {
    return { name: "profile", username: decodeURIComponent(path.slice(2)) };
  }
  if (path.startsWith("proposal/")) {
    return {
      name: "proposal",
      id: decodeURIComponent(path.slice("proposal/".length)),
    };
  }
  return { name: "home" };
}
