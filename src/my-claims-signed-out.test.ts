import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return { ...actual, WORKERS_API: "https://api.test" };
});

/**
 * Review follow-up (builder.ts fetchMyClaims): a 401 from /claims/mine was
 * returned as `{ pending: [], ledger: null }`, so the Account → Claims tab of a
 * user whose session had expired read "No claims yet" while they held claims.
 */

function stubClaims(claims: () => Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/claims/mine")) return claims();
      if (/\/watch(\?|$)/.test(url)) return Response.json({ watches: [] });
      return new Response("{}", { status: 404 });
    }),
  );
}

async function renderClaimsTab(): Promise<HTMLElement> {
  document.body.innerHTML = `<div id="app"></div>`;
  sessionStorage.setItem("plebly_session", "test");
  const { renderAccount } = await import("./profile-pages");
  await renderAccount(
    {
      user: { id: "github:alice", username: "alice" } as never,
      routeName: "account",
      shell: (inner) => inner,
      rerender: () => undefined,
    },
    "claims",
  );
  return document.querySelector<HTMLElement>('[data-pane="claims"]')!;
}

beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  sessionStorage.clear();
});

describe("fetchMyClaims", () => {
  it("a 401 rejects with the signed-out message instead of reading as no claims", async () => {
    stubClaims(() => Response.json({ error: "unauthorized" }, { status: 401 }));
    const { fetchMyClaims, MY_CLAIMS_SIGNED_OUT } = await import("./builder");
    await expect(fetchMyClaims()).rejects.toThrow(MY_CLAIMS_SIGNED_OUT);
  });

  it("other non-2xx responses stay fail-soft (empty pending, null ledger)", async () => {
    stubClaims(() => new Response("<html>", { status: 502 }));
    const { fetchMyClaims } = await import("./builder");
    await expect(fetchMyClaims()).resolves.toEqual({ pending: [], ledger: null });
  });
});

describe("Account → Claims tab", () => {
  it("a 401 shows that claims couldn't load and why, never 'No claims yet'", async () => {
    stubClaims(() => Response.json({ error: "unauthorized" }, { status: 401 }));
    const pane = await renderClaimsTab();
    expect(pane.querySelector("[data-claims-load-error]")).toBeTruthy();
    expect(pane.textContent).toContain("Couldn't load your claims");
    expect(pane.textContent).toContain("sign in again to see your claims");
    expect(pane.textContent).not.toContain("No claims yet");
  });

  it("control: a signed-in user with no claims still sees 'No claims yet'", async () => {
    stubClaims(() => Response.json({ pending: [], ledger: null }));
    const pane = await renderClaimsTab();
    expect(pane.textContent).toContain("No claims yet");
    expect(pane.querySelector("[data-claims-load-error]")).toBeNull();
  });
});
