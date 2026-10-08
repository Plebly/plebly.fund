import { afterEach, describe, expect, it, vi } from "vitest";
import { claimUsername } from "./auth";
import { fetchMyClaims } from "./builder";

/**
 * Live paths that replaced two removed never-called wrappers:
 * - checkUsernameAvailable (client probe of GET /profile/check/:username):
 *   the account page claims names via claimUsername, and the Worker's
 *   POST /profile/username is the real availability gate. These tests pin that
 *   claimUsername surfaces the server's refusal instead of swallowing it.
 * - fetchMyPendingClaims (returned fetchMyClaims().pending): profile-pages
 *   calls fetchMyClaims directly; pin its fail-soft shape.
 */
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("claimUsername", () => {
  it("POSTs the name as JSON to /profile/username with credentials and returns the user", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ user: { id: "github:1", username: "alice" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = await claimUsername("alice");
    expect(user).toMatchObject({ username: "alice" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/profile\/username$/);
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect(JSON.parse(String(init.body))).toEqual({ username: "alice" });
    expect(new Headers(init.headers).get("Content-Type")).toBe("application/json");
  });

  it("a taken name throws the server's error message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "username taken" }, { status: 409 })),
    );
    await expect(claimUsername("bob")).rejects.toThrow("username taken");
  });

  it("a refusal without an error body throws HTTP <status>", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({}, { status: 400 })));
    await expect(claimUsername("x")).rejects.toThrow("HTTP 400");
  });
});

describe("fetchMyClaims", () => {
  it("GETs /claims/mine with credentials and passes pending + ledger through", async () => {
    const pending = [
      {
        user_id: "github:1",
        proposal_id: "p1",
        proposal_path: "proposals/listed/p1.md",
        payout_address: "tb1qexample",
        created_at: "2026-10-01T00:00:00Z",
      },
    ];
    const ledger = { active: [], history: [] };
    const fetchMock = vi.fn(async () => Response.json({ pending, ledger }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await fetchMyClaims();
    expect(r).toEqual({ pending, ledger });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/claims\/mine$/);
    expect(init.credentials).toBe("include");
  });

  it("missing fields default to an empty pending list and a null ledger", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({})));
    expect(await fetchMyClaims()).toEqual({ pending: [], ledger: null });
  });

  it("a non-2xx response is fail-soft: empty pending, null ledger", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 502 })));
    expect(await fetchMyClaims()).toEqual({ pending: [], ledger: null });
  });
});
