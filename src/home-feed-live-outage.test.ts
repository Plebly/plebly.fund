import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicDonation } from "./donations-page";
import { PROPOSALS_API, PROPOSALS_RAW } from "./config";
import { bindActivityStrip } from "./activity";
import { bindDonationsLive } from "./donations-live";
import { clearListedProposalsCache } from "./github";
import { clearHiddenCompletedListingIdsCache } from "./home-feed-hidden";

/**
 * Replays Tester's live outage (plebly.fund#144 recheck, Deploy 43328677677)
 * against the real fetch layer:
 * - `…/proposals/catalog?scope=all` and `?scope=listed` are aborted at the
 *   network (Playwright `route.abort("failed")`), so fetch throws a TypeError
 *   rather than returning a 503.
 * - The GitHub folder fallback is left open and answers the way the live
 *   Plebly/proposals repo does: `listed/` holds only the Knots and signet demo
 *   files, and `claimed/`, `completed/`, `unindexed/`, `declined/` hold only
 *   `.gitkeep`. Completed listings 009–011 exist in the Worker catalog and
 *   donation ledger only, so the fallback never returns them at all.
 */

const P009 = "PLEBLY-2026-009";
const P010 = "PLEBLY-2026-010";
const P011 = "PLEBLY-2026-011";
const KNOTS = "PLEBLY-KNOTS-SIZE-VALUE-SPAM";
const DEMO = "PLEBLY-SIGNET-DEMO";

type Row = { id: string; title: string; status: string; dir: string };
const ROWS: Record<string, Row> = {
  [P009]: { id: P009, title: "Signet 2-of-3 Release rehearsal", status: "claimed", dir: "claimed" },
  [P010]: { id: P010, title: "Josh KH 2-of-3 Release cosign rehearsal", status: "completed", dir: "completed" },
  [P011]: { id: P011, title: "Signet A+B structure first-check", status: "completed", dir: "completed" },
  [KNOTS]: { id: KNOTS, title: "Knots PR: reject high size-to-value relay spam", status: "listed", dir: "listed" },
  [DEMO]: { id: DEMO, title: "Signet demo", status: "listed", dir: "listed" },
};
const CATALOG_ALL = [P009, P010, P011, KNOTS, DEMO];
const CATALOG_LISTED = [P009, KNOTS, DEMO];
// What api.github.com/repos/Plebly/proposals/contents/proposals/<dir> returns live.
const GITHUB_FOLDERS: Record<string, string[]> = {
  listed: [KNOTS, DEMO],
  claimed: [],
  completed: [],
  unindexed: [],
  declined: [],
};

const entry = (id: string) => {
  const r = ROWS[id]!;
  return {
    id: r.id,
    path: `proposals/${r.dir}/${r.id}.md`,
    title: r.title,
    status: r.status,
    proposal_type: "bounty",
    created_at: "2026-09-01T00:00:00Z",
  };
};

const don = (id: string, target: string): PublicDonation => ({
  id,
  amount_sats: 20_000,
  target_type: "project",
  target_id: target,
  target_label: ROWS[target]?.title || target,
  donated_at: "2026-09-28T00:00:00Z",
  anonymous: true,
  donor_display: null,
});

const DONATIONS: PublicDonation[] = [
  don("d-011", P011),
  don("d-010", P010),
  don("d-009", P009),
  don("d-knots", KNOTS),
  {
    ...don("d-endowment", KNOTS),
    target_type: "endowment",
    target_id: "endowment",
    target_label: "Endowment",
  } as PublicDonation,
];
const EVENTS = [
  { type: "completed", proposal_id: P011, created_at: "2026-09-28T00:00:00Z" },
  { type: "completed", proposal_id: P010, created_at: "2026-09-25T00:00:00Z" },
  { type: "claimed", proposal_id: P009, created_at: "2026-09-23T00:00:00Z" },
  { type: "listed", proposal_id: KNOTS, created_at: "2026-09-20T00:00:00Z" },
];

const app = () => document.querySelector<HTMLDivElement>("#app")!;
const text = (sel: string) => app().querySelector(sel)?.textContent || "";
const donationIds = () =>
  [...app().querySelectorAll<HTMLElement>(".donations-live-row")].map((el) => el.dataset.donationId);

function isCatalog(url: string): boolean {
  // Same matcher as Tester's outage.mjs.
  return url.includes("/proposals/catalog") && /[?&]scope=(all|listed)\b/.test(url);
}

function expectNoHidden(): void {
  const all = app().textContent || "";
  for (const needle of [P010, P011, ROWS[P010]!.title, ROWS[P011]!.title]) {
    expect(all).not.toContain(needle);
  }
  expect(donationIds()).not.toContain("d-010");
  expect(donationIds()).not.toContain("d-011");
}

describe("home feeds during a live-shaped catalog outage (network abort, real GitHub fallback)", () => {
  let blocked = false;
  let githubDirs: string[] = [];

  beforeEach(() => {
    blocked = false;
    githubDirs = [];
    document.body.innerHTML = `<div id="app">
      <div id="donations-live-mount"></div>
      <section id="activity-strip" hidden aria-label="Recent activity"></section>
    </div>`;
    clearListedProposalsCache();
    clearHiddenCompletedListingIdsCache();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const u = String(input);
        if (isCatalog(u)) {
          if (blocked) throw new TypeError("Failed to fetch");
          const ids = u.includes("scope=listed") ? CATALOG_LISTED : CATALOG_ALL;
          return Response.json({ proposals: ids.map(entry) });
        }
        if (u.startsWith(`${PROPOSALS_API}/`)) {
          const dir = u.slice(PROPOSALS_API.length + 1);
          githubDirs.push(dir);
          const ids = GITHUB_FOLDERS[dir];
          if (!ids) return new Response("missing", { status: 404 });
          return Response.json([
            { name: ".gitkeep", path: `proposals/${dir}/.gitkeep`, type: "file" },
            ...ids.map((id) => ({
              name: `${id}.md`,
              path: `proposals/${dir}/${id}.md`,
              type: "file",
              download_url: `${PROPOSALS_RAW}/proposals/${dir}/${id}.md`,
            })),
          ]);
        }
        if (u.startsWith(`${PROPOSALS_RAW}/`)) {
          const id = u.split("/").pop()!.replace(/\.md$/, "");
          const r = ROWS[id];
          if (!r) return new Response("missing", { status: 404 });
          return new Response(`---\nid: ${r.id}\ntitle: ${r.title}\nstatus: ${r.status}\nproposal_type: bounty\n---\n`);
        }
        if (u.includes("/endowment")) return Response.json({ configured: false });
        if (u.includes("/donations")) {
          return Response.json({ donations: DONATIONS, total: DONATIONS.length });
        }
        if (u.includes("/events")) return Response.json({ events: EVENTS });
        if (u.includes("/proposals/titles") || u.startsWith("https://api.test")) {
          return Response.json({});
        }
        throw new Error(`unexpected fetch ${u}`);
      }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    clearListedProposalsCache();
    clearHiddenCompletedListingIdsCache();
    document.body.innerHTML = "";
  });

  it("keeps 010 and 011 out of Recent donations and activity when the catalog is aborted from first load", async () => {
    blocked = true;
    await bindDonationsLive(document);
    await bindActivityStrip(document);

    expect(githubDirs).toContain("completed");
    expectNoHidden();
    expect(donationIds()).toContain("d-knots");
    expect(donationIds()).toContain("d-endowment");
    expect(text("#activity-strip")).not.toContain(P010);
    expect(text("#activity-strip")).not.toContain(P011);
  });

  it("keeps 010 and 011 out of Recent donations across 5 polls after the catalog is aborted post first paint", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    await bindDonationsLive(document);
    expect(donationIds()).toEqual(["d-009", "d-knots", "d-endowment"]);
    expectNoHidden();

    blocked = true;
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(15_000);
      expectNoHidden();
    }
    // The 60s catalog / hidden-id caches expired and the fallback ran.
    expect(githubDirs).toContain("completed");
    expect(donationIds()).toContain("d-knots");
    expect(donationIds()).toContain("d-endowment");
  });
});
