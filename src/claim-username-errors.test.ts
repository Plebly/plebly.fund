import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return { ...actual, WORKERS_API: "https://api.test" };
});

import { claimUsername } from "./auth";

/**
 * The account page shows claimUsername's error message verbatim
 * (profile-pages: `msg.textContent = (e as Error).message`).
 * An edge/proxy error page must not surface as a JSON parse error.
 */
const html = (status: number) =>
  new Response("<html><body>502 Bad Gateway</body></html>", {
    status,
    headers: { "Content-Type": "text/html" },
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("claimUsername error responses", () => {
  it("a 502 HTML page reads as HTTP 502, not a JSON parse error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => html(502)));
    const err = await claimUsername("alice").catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("HTTP 502");
  });

  it("an empty-bodied 503 reads as HTTP 503", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 503 })));
    await expect(claimUsername("alice")).rejects.toThrow(/^HTTP 503$/);
  });

  it("a 200 that isn't JSON or has no user throws a readable error, never resolves undefined", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => html(200)));
    await expect(claimUsername("alice")).rejects.toThrow("Username claim failed — try again.");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({})));
    await expect(claimUsername("alice")).rejects.toThrow("Username claim failed — try again.");
  });

  it("still surfaces the worker's JSON error and returns the user on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "username taken" }, { status: 409 })),
    );
    await expect(claimUsername("bob")).rejects.toThrow("username taken");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ user: { id: "github:1", username: "alice" } })),
    );
    await expect(claimUsername("alice")).resolves.toMatchObject({ username: "alice" });
  });
});
