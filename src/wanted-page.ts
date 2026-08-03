import { fetchWanted } from "./builder";
import { applySeo, href, proposalHref, seoForRoute } from "./router";
import { escapeHtml } from "./util";

export type WantedShell = (inner: string) => string;

export async function renderWanted(shell: WantedShell): Promise<void> {
  const app = document.querySelector<HTMLDivElement>("#app")!;
  applySeo(
    seoForRoute(
      { name: "wanted" },
      {
        title: "Most wanted",
        description:
          "Projects with high watch interest relative to funding progress.",
      },
    ),
  );
  app.innerHTML = shell(`
    <section class="wrap detail wanted-page">
      <h1>Most wanted</h1>
      <p class="lede">Watches from accounts with completed bounty history count double. Rescue-stalled projects are listed separately on the home grid.</p>
      <div id="wanted-full" class="wanted-list"><p class="loading">Loading…</p></div>
    </section>
  `);
  const host = app.querySelector("#wanted-full")!;
  const rows = await fetchWanted(50).catch(() => []);
  if (!rows.length) {
    host.innerHTML = `<p class="muted">No watched projects yet. <a href="${href("/")}">Browse projects</a> and watch ones you care about.</p>`;
    return;
  }
  host.innerHTML = rows
    .map(
      (r) => `<a class="wanted-row" href="${proposalHref(r.path, r.id)}">
      <span class="wanted-title">${escapeHtml(r.title)}</span>
      <span class="wanted-nums mono">${r.watches} watches · ${r.weighted} weighted · ${
        r.funded_pct != null ? `${r.funded_pct}% funded` : "—"
      }</span>
    </a>`,
    )
    .join("");
}
