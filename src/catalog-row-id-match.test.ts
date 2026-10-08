/**
 * Review / UI UX gate on plebly.fund#74: the catalog row is found by the
 * proposal's frontmatter id, never by path.
 *
 * DEMO and KNOTS were renamed in Plebly/proposals#21 (709b4ea), so two path
 * forms are in play for the same proposal:
 *   - catalog row `path` (Worker catalog snapshot, updated_at
 *     2026-10-08T04:02:54Z): the slug filename,
 *     `proposals/listed/knots-size-value-spam.md` /
 *     `proposals/listed/demo-signet-smoke.md`;
 *   - git doc path and claim view `proposal_path` (live
 *     `/claims/proposals%2Flisted%2F<file>.md`, `/proposals/lookup/<id>`):
 *     the ID filename, `proposals/listed/PLEBLY-KNOTS-SIZE-VALUE-SPAM.md` /
 *     `proposals/listed/PLEBLY-SIGNET-DEMO.md`.
 * Matching on the exact path treated KNOTS as missing (shared, no meter,
 * "Balance temporarily unavailable.") for as long as the forms differ.
 *
 * Rules: same id with different path forms matches; different ids never match
 * (no path, stem, substring or prefix match); no row, no id, or an ambiguous
 * id still fails closed (shared, no meter).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClaimStatus } from "./builder";
import { CLAIM_FLOOR_SATS } from "./config";
import { parseLocation } from "./router";

type Fixture = {
  name: string;
  id: string;
  /** git doc path and claim view proposal_path (ID filename, live). */
  idPath: string;
  /** catalog row path (slug filename, catalog snapshot 2026-10-08T04:02:54Z). */
  slugPath: string;
  escrow: string;
  /** catalog balance_sats in that snapshot. */
  catalogBalance: number;
  /** what the mempool stub reports for the proposal's own address. */
  addressTotal: number;
  addressLabel: RegExp;
};

const KNOTS: Fixture = {
  name: "KNOTS",
  id: "PLEBLY-KNOTS-SIZE-VALUE-SPAM",
  idPath: "proposals/listed/PLEBLY-KNOTS-SIZE-VALUE-SPAM.md",
  slugPath: "proposals/listed/knots-size-value-spam.md",
  escrow: "tb1qf8agl2750ezeuwt7ys5ghzmul9wutls0cs9jyt",
  catalogBalance: 0,
  addressTotal: 4_321,
  addressLabel: /4,321/,
};
const DEMO: Fixture = {
  name: "DEMO",
  id: "PLEBLY-SIGNET-DEMO",
  idPath: "proposals/listed/PLEBLY-SIGNET-DEMO.md",
  slugPath: "proposals/listed/demo-signet-smoke.md",
  escrow: "tb1qhj27cegpek02g8g4peps0x7gqs0svvs888svyz",
  catalogBalance: 10_586,
  addressTotal: 10_586,
  addressLabel: /10,586/,
};

/** Balance a wrong (non-matching) row carries; it must never reach the page. */
const WRONG_BALANCE = 999_999;
const WRONG_ESCROW = "tb1q3ujq9473rc9smza7djsm8snmaxv9ccqwzn447x98r97pyr2c6ljqawv6qx";

function markdown(f: Fixture, withId = true): string {
  return `---
${withId ? `id: ${f.id}\n` : ""}title: "${f.name} bounty"
status: listed
target_sats: 1500000
escrow_address: "${f.escrow}"
escrow_index: 1
submission_fee_txid: "${"ab".repeat(32)}"
proposer:
  username: secsovereign
  github: null
  nostr: null
created_at: "2026-07-25T00:00:00Z"
---

# ${f.name}

## Problem

Body.
`;
}

function claimView(f: Fixture): Partial<ClaimStatus> {
  return {
    proposal_id: f.id,
    proposal_path: f.idPath,
    state: "open",
    status: "listed",
    confirmed_balance_sats: f.catalogBalance,
    claim_floor_sats: CLAIM_FLOOR_SATS,
    escrow_address: f.escrow,
    accepting_funds: true,
  };
}

/** The catalog row as the Worker served it: slug path, same frontmatter id. */
function slugRow(f: Fixture, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: f.id,
    path: f.slugPath,
    title: `${f.name} bounty`,
    status: "listed",
    proposal_type: "bounty",
    target_sats: 1_500_000,
    escrow_address: f.escrow,
    balance_sats: f.catalogBalance,
    ...over,
  };
}

const OTHER_ROW = {
  id: "PLEBLY-2026-011",
  path: "proposals/listed/PLEBLY-2026-011.md",
  title: "Other",
  status: "completed",
  proposal_type: "bounty",
  escrow_address: "tb1qother0000000000000000000000000000000",
  balance_sats: 0,
};

let addressHits: string[] = [];

type Route = "stable" | "path" | "lookup";

function stubFetch(
  f: Fixture,
  rows: Record<string, unknown>[],
  opts: { route: Route; withId?: boolean; docMiss?: boolean },
) {
  const md = markdown(f, opts.withId ?? true);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const addr = url.match(/\/address\/([^/?]+)$/);
      if (addr) {
        const a = decodeURIComponent(addr[1]!);
        addressHits.push(a);
        const total = a === f.escrow ? f.addressTotal : WRONG_BALANCE;
        return Response.json({
          chain_stats: { funded_txo_sum: total, spent_txo_sum: 0 },
          mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0 },
        });
      }
      if (url.includes("/proposals/catalog")) {
        return Response.json({ scope: "listed", updated_at: "2026-10-08T04:02:54.146Z", proposals: rows });
      }
      // Like the live Worker (probed 2026-10-08 ~04:40 ET): /proposals/doc
      // and /proposals/lookup accept the exact id in any case (or the exact
      // path); anything else misses.
      const known = (key: string) => key.toUpperCase() === f.id || key === f.idPath;
      const doc = url.match(/\/proposals\/doc\/(.+)$/);
      if (doc) {
        const key = decodeURIComponent(doc[1]!);
        if (!known(key) || opts.docMiss) return new Response("{}", { status: 404 });
        // "lookup" route: the id doc read misses, the Worker id→path index
        // answers with the ID-filename path, and that doc read succeeds.
        if (opts.route === "lookup" && key !== f.idPath) return new Response("{}", { status: 404 });
        return Response.json({ id: f.id, markdown: md, path: f.idPath });
      }
      const look = url.match(/\/proposals\/lookup\/(.+)$/);
      if (look) {
        const key = decodeURIComponent(look[1]!);
        if (!known(key) || opts.docMiss) return Response.json({ id: key, path: null, found: false });
        return Response.json({ id: key, path: f.idPath, found: true });
      }
      if (url.includes("raw.githubusercontent.com")) return new Response(md, { status: 200 });
      if (/\/claims\/[^/]+$/.test(url) && !/\/claims\/(params|apply|applications)/.test(url)) {
        return Response.json(claimView(f));
      }
      return new Response("{}", { status: 404 });
    }),
  );
}

/**
 * main.ts: /p/{id} ("stable", and "lookup" when the doc read needs the id
 * index) resolves via findListedProposalById(id); legacy /proposal/<path>
 * ("path") lets renderProposalPage resolve the ID-filename path itself.
 */
async function renderPage(
  f: Fixture,
  rows: Record<string, unknown>[],
  route: Route,
  withId = true,
  routeId: string = f.id,
): Promise<HTMLElement> {
  document.body.innerHTML = `<div id="app"></div>`;
  stubFetch(f, rows, { route, withId });
  const { renderProposalPage } = await import("./proposal-page");
  let preloaded = null;
  if (route !== "path") {
    const { findListedProposalById } = await import("./github");
    preloaded = await findListedProposalById(routeId);
    expect(preloaded?.path).toBe(f.idPath);
  }
  void renderProposalPage(f.idPath, (inner) => inner, null, () => undefined, preloaded);
  const app = document.querySelector<HTMLElement>("#app")!;
  await vi.waitFor(() => {
    if (!app.querySelector(".proposal-sidebar")) throw new Error("not painted yet");
  });
  await vi.waitFor(() => {
    const s = app.querySelector("#next-card-sentence")?.textContent || "";
    if (!s || s === "…") throw new Error("next card not resolved");
    if (app.querySelector("#donate-loading")) throw new Error("donate slot still loading");
  });
  await new Promise((r) => setTimeout(r, 0));
  return app;
}

function expectMeter(app: HTMLElement): void {
  expect(app.querySelector(".proposal-funding-bar .funding-meter")).toBeTruthy();
  expect(app.querySelector(".funding-balance-unknown")).toBeNull();
}

function expectFailClosed(app: HTMLElement, f: Fixture): void {
  expect(app.querySelector(".proposal-funding-bar:not([data-shared-pending])")).toBeNull();
  expect(app.querySelector(".funding-meter-goal")).toBeNull();
  expect(app.textContent || "").not.toMatch(/to open/i);
  const line =
    app.querySelector(".funding-balance-unknown")?.textContent ??
    app.querySelector("[data-shared-pending] .funding-meter-label")?.textContent;
  expect(["Balance temporarily unavailable.", "Awaiting confirmation"]).toContain(line);
  // Treated as shared: never reads or shows its own address total, and never
  // shows a wrong row's balance.
  expect(addressHits).not.toContain(f.escrow);
  expect(app.textContent || "").not.toMatch(/999,999|999999/);
}

beforeAll(async () => {
  await import("./proposal-page");
  await import("./github");
}, 30_000);
beforeEach(() => {
  addressHits = [];
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  sessionStorage.clear();
});

for (const f of [KNOTS, DEMO]) {
  describe(`${f.name}: catalog slug path ${f.slugPath} vs claim view / git ${f.idPath}`, () => {
    for (const route of ["path", "stable", "lookup"] as const) {
      it(`${route} route: the slug-path row with the same id is used; its own address balance draws the meter`, async () => {
        // Row as served but without a balance: a unique (not shared) row, so
        // the page reads the proposal's own address.
        const app = await renderPage(f, [OTHER_ROW, slugRow(f, { balance_sats: undefined })], route);
        expect(addressHits).toContain(f.escrow);
        expectMeter(app);
        expect(app.querySelector(".proposal-funding-bar")?.textContent || "").toMatch(f.addressLabel);
        expect(app.textContent || "").not.toMatch(/999,999|999999/);
      });

      it(`${route} route: the slug-path row exactly as in the catalog snapshot (balance ${f.catalogBalance}) draws the meter`, async () => {
        const app = await renderPage(f, [OTHER_ROW, slugRow(f)], route);
        expectMeter(app);
      });
    }

    it("matches whatever the case/whitespace of the frontmatter id (same id)", async () => {
      const app = await renderPage(f, [slugRow(f, { id: `  ${f.id.toLowerCase()} `, balance_sats: undefined })], "path");
      expect(addressHits).toContain(f.escrow);
      expectMeter(app);
    });
  });
}

describe("different ids never match, whatever the path", () => {
  const f = KNOTS;
  const cases: [string, Record<string, unknown>][] = [
    [
      "same ID filename, different id",
      slugRow(f, { id: `${f.id}-V2`, path: f.idPath, balance_sats: WRONG_BALANCE, escrow_address: WRONG_ESCROW }),
    ],
    [
      "same filename stem in another folder, different id",
      slugRow(f, { id: "PLEBLY-2026-099", path: `proposals/claimed/${f.id}.md`, balance_sats: WRONG_BALANCE, escrow_address: WRONG_ESCROW }),
    ],
    [
      "old slug claim-view id (filename stem) on the slug path",
      slugRow(f, { id: "knots-size-value-spam", path: f.slugPath, balance_sats: WRONG_BALANCE, escrow_address: WRONG_ESCROW }),
    ],
    [
      "id that is a prefix of the real id",
      slugRow(f, { id: "PLEBLY-KNOTS", path: f.slugPath, balance_sats: WRONG_BALANCE, escrow_address: WRONG_ESCROW }),
    ],
    [
      "row without an id on the exact ID-filename path",
      slugRow(f, { id: null, path: f.idPath, balance_sats: WRONG_BALANCE, escrow_address: WRONG_ESCROW }),
    ],
  ];
  for (const route of ["path", "stable"] as const) {
    for (const [label, row] of cases) {
      it(`${route} route: ${label} → no match, fails closed`, async () => {
        const app = await renderPage(f, [OTHER_ROW, row], route);
        expectFailClosed(app, f);
        expect(document.body.innerHTML).not.toContain(WRONG_ESCROW);
      });
    }
  }
});

describe("still fails closed", () => {
  for (const f of [KNOTS, DEMO]) {
    for (const route of ["path", "stable"] as const) {
      it(`${f.name} ${route} route: no row with its id → shared, no meter`, async () => {
        const app = await renderPage(f, [OTHER_ROW], route);
        expectFailClosed(app, f);
      });
    }
  }

  it("git doc without a frontmatter id: even a row on the exact path is not used", async () => {
    const f = KNOTS;
    const app = await renderPage(f, [slugRow(f, { path: f.idPath, balance_sats: undefined })], "path", false);
    expectFailClosed(app, f);
  });

  it("two rows whose ids collide only after case-normalising (ambiguous) → treated as missing, not first-wins", async () => {
    const f = DEMO;
    const app = await renderPage(
      f,
      [
        slugRow(f, { id: f.id, balance_sats: undefined }),
        slugRow(f, { id: f.id.toLowerCase(), path: f.idPath, balance_sats: WRONG_BALANCE, escrow_address: WRONG_ESCROW }),
      ],
      "path",
    );
    expectFailClosed(app, f);
    expect(document.body.innerHTML).not.toContain(WRONG_ESCROW);
  });

  it("catalog-only fallback: case-colliding ids are ambiguous → no proposal (not first-wins)", async () => {
    const f = KNOTS;
    stubFetch(f, [slugRow(f), slugRow(f, { id: f.id.toLowerCase(), path: f.idPath })], { route: "stable", docMiss: true });
    const { findListedProposalById } = await import("./github");
    expect(await findListedProposalById(f.id.toLowerCase())).toBeNull();
  });

  it("two rows with the same id (ambiguous) → treated as missing", async () => {
    const f = KNOTS;
    const app = await renderPage(
      f,
      [slugRow(f, { balance_sats: undefined }), slugRow(f, { path: f.idPath, balance_sats: WRONG_BALANCE })],
      "path",
    );
    expectFailClosed(app, f);
  });
});

describe("findListedProposalById overlays the id-matched row", () => {
  it("path input (ID filename) + slug-path catalog row: catalog lifecycle and balance apply, not escrow_shared", async () => {
    const f = KNOTS;
    stubFetch(f, [slugRow(f, { status: "claimable", balance_sats: 7_000 })], { route: "path" });
    const { findListedProposalById } = await import("./github");
    const p = await findListedProposalById(f.idPath);
    expect(p?.path).toBe(f.idPath);
    expect(p?.status).toBe("claimable");
    expect(p?.balance_sats).toBe(7_000);
    expect(p?.escrow_shared).toBeUndefined();
  });
});

/**
 * The live link is lower-case: router.ts turns `/p/plebly-knots-size-value-spam`
 * into `{ id: "plebly-knots-size-value-spam", stable: true }` (decoded,
 * trimmed, case kept), and main.ts calls findListedProposalById with it. The
 * Worker's doc read accepts any case of the exact id and returns the git doc;
 * the catalog row is then matched on that doc's frontmatter id
 * (`PLEBLY-KNOTS-SIZE-VALUE-SPAM`), so the route value never feeds the match.
 * Only the catalog-only fallback compares the route value itself, after
 * normalising it to the canonical (upper-case) id, exactly.
 */
describe("lower-case /p/ route", () => {
  for (const f of [KNOTS, DEMO]) {
    const routeId = f.id.toLowerCase();
    it(`${f.name}: /p/${routeId} resolves to its slug-path row and draws its own meter`, async () => {
      const app = await renderPage(f, [OTHER_ROW, slugRow(f, { balance_sats: undefined })], "stable", true, routeId);
      expect(addressHits).toContain(f.escrow);
      expectMeter(app);
      expect(app.querySelector(".proposal-funding-bar")?.textContent || "").toMatch(f.addressLabel);
    });

    it(`${f.name}: /p/${routeId} with no row for that id still fails closed`, async () => {
      const app = await renderPage(f, [OTHER_ROW], "stable", true, routeId);
      expectFailClosed(app, f);
    });

    it(`${f.name}: catalog-only fallback (doc and lookup miss) finds the row by canonical id`, async () => {
      stubFetch(f, [OTHER_ROW, slugRow(f)], { route: "stable", docMiss: true });
      const { findListedProposalById } = await import("./github");
      const p = await findListedProposalById(routeId);
      expect(p?.id).toBe(f.id);
      expect(p?.path).toBe(f.slugPath);
    });
  }

  for (const bad of [
    "plebly-knots-size-value-spa",
    "plebly-knots-size-value-spam-2",
    "plebly-knots",
    "knots-size-value-spam",
    "plebly_knots_size_value_spam",
  ]) {
    it(`/p/${bad} (differs by more than case) never matches KNOTS`, async () => {
      stubFetch(KNOTS, [OTHER_ROW, slugRow(KNOTS)], { route: "stable" });
      const { findListedProposalById } = await import("./github");
      expect(await findListedProposalById(bad)).toBeNull();
    });
  }
});

/**
 * Legacy /proposal/listed/<file> route: router.ts maps it to the repo path
 * (proposalRepoPath), main.ts hands that path to renderProposalPage, which
 * loads the git doc and matches the catalog row on the doc's frontmatter id.
 */
describe("legacy /proposal/listed/ route", () => {
  for (const f of [KNOTS, DEMO]) {
    for (const file of [f.id, `${f.id}.md`]) {
      it(`${f.name}: /proposal/listed/${file} resolves to its slug-path row and draws its own meter`, async () => {
        const r = parseLocation(`/proposal/listed/${file}`, "");
        expect(r).toEqual({ name: "proposal", id: f.idPath });
        const app = await renderPage(f, [OTHER_ROW, slugRow(f, { balance_sats: undefined })], "path");
        expect(addressHits).toContain(f.escrow);
        expectMeter(app);
        expect(app.querySelector(".proposal-funding-bar")?.textContent || "").toMatch(f.addressLabel);
      });
    }

    it(`${f.name}: /proposal/listed/${f.id} with no row for that id still fails closed`, async () => {
      const app = await renderPage(f, [OTHER_ROW], "path");
      expectFailClosed(app, f);
    });
  }
});
