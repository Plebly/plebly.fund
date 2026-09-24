import { fetchWanted, type WantedRow } from "./builder";
import { statusPillHtml } from "./proposal-ui";
import { applySeo, projectsHref, proposalHref, seoForRoute } from "./router";
import { escapeHtml } from "./util";

export type WantedShell = (inner: string) => string;

export type WantedRowHtmlOpts = {
  /** Home rail shows bare `%`; full /wanted page appends ` funded`. */
  fundedSuffix?: boolean;
};

/** Shared wanted card chrome: title + proposal id + status + watch metrics. */
export function wantedRowHtml(
  r: Pick<
    WantedRow,
    "id" | "path" | "title" | "status" | "watches" | "weighted" | "funded_pct"
  >,
  opts?: WantedRowHtmlOpts,
): string {
  const funded =
    r.funded_pct != null
      ? opts?.fundedSuffix === false
        ? `${r.funded_pct}%`
        : `${r.funded_pct}% funded`
      : "—";
  const idHtml = r.id
    ? `<span class="mono proposal-meta-id">${escapeHtml(r.id)}</span>`
    : "";
  const statusHtml = statusPillHtml(r.status || "");
  const metaBits = [idHtml, statusHtml].filter(Boolean);
  const metaHtml = metaBits.length
    ? `<span class="wanted-meta">${metaBits.join(
        '<span class="wanted-metric-sep" aria-hidden="true">·</span>',
      )}</span>`
    : "";
  return `<a class="wanted-row" href="${proposalHref(r.path, r.id)}">
      <span class="wanted-main">
        <span class="wanted-title">${escapeHtml(r.title)}</span>
        ${metaHtml}
      </span>
      <span class="wanted-nums mono">
        <span class="wanted-metric">${r.watches} watches</span>
        <span class="wanted-metric-sep" aria-hidden="true">·</span>
        <span class="wanted-metric">${r.weighted} weighted</span>
        <span class="wanted-metric-sep" aria-hidden="true">·</span>
        <span class="wanted-metric wanted-metric-funded">${escapeHtml(funded)}</span>
      </span>
    </a>`;
}

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
    <section class="wrap-wide detail wanted-page">
      <h1>Most wanted</h1>
      <p class="lede">Watches from accounts with completed bounty history count double. Rescue-stalled projects are listed separately on the home grid.</p>
      <div id="wanted-full" class="wanted-list"><p class="loading">Loading…</p></div>
    </section>
  `);
  const host = app.querySelector("#wanted-full")!;
  const rows = await fetchWanted(50).catch(() => []);
  if (!rows.length) {
    host.innerHTML = `<p class="muted">No watched projects yet. <a href="${projectsHref()}">Browse projects</a> and watch ones you care about.</p>`;
    return;
  }
  host.innerHTML = rows.map((r) => wantedRowHtml(r)).join("");
}
