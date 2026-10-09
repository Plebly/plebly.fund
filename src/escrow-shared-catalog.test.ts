/**
 * The catalog keeps an explicit `escrow_shared: false` (isSharedEscrow treats
 * a missing flag as shared), and loadedCatalogRows only returns rows already
 * loaded: nothing before a load, never a fetch.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return { ...actual, WORKERS_API: "https://api.test" };
});

import { clearListedProposalsCache, listListedProposals, loadedCatalogRows } from "./github";
import { isSharedEscrow } from "./escrow-shared";

const A = "tb1q3ujq9473rc9smza7djsm8snmaxv9ccqwzn447x98r97pyr2c6ljqawv6qx";
const S = "tb1qhj27cegpek02g8g4peps0x7gqs0svvs888svyz";
const entry = (id: string, addr: string, flag?: boolean | null) => ({
  id,
  path: `proposals/listed/${id}.md`,
  title: id,
  status: "listed",
  escrow_address: addr,
  ...(flag === undefined ? {} : { escrow_shared: flag }),
});

afterEach(() => {
  clearListedProposalsCache();
  vi.unstubAllGlobals();
});

describe("catalog flag and loaded rows", () => {
  it("nothing loaded: no rows and no fetch", () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect(loadedCatalogRows()).toEqual([]);
    expect(f).not.toHaveBeenCalled();
  });

  it("explicit false is kept, null and missing stay unset; loaded rows drive the count", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          proposals: [
            entry("PLEBLY-2026-009", A, false),
            entry("PLEBLY-2026-001", S, null),
            entry("PLEBLY-2026-002", S, false),
            entry("PLEBLY-2026-003", S, false),
            entry("PLEBLY-2026-004", S),
          ],
        }),
      ),
    );
    const rows = await listListedProposals();
    expect(rows.map((r) => r.escrow_shared)).toEqual([false, undefined, false, false, undefined]);
    expect(loadedCatalogRows()).toBe(rows);
    expect(isSharedEscrow(rows[0]!, loadedCatalogRows())).toBe(false);
    for (const r of rows.slice(1)) expect(isSharedEscrow(r, loadedCatalogRows())).toBe(true);
  });
});
