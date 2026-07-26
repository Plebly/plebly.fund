import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return {
    ...actual,
    WORKERS_API: "https://api.test",
  };
});

import {
  consumeSessionFromHash,
  formatNostrLoginError,
  githubLoginUrl,
  loginChoicesHtml,
  loginMenuHtml,
  loginWithNostr,
  shortNostrPubkey,
} from "./auth";

const locationState = {
  origin: "https://plebly.fund",
  pathname: "/",
  search: "",
  hash: "",
};

beforeAll(() => {
  Object.defineProperty(globalThis, "window", {
    value: { location: locationState },
    configurable: true,
  });
  Object.defineProperty(globalThis, "location", {
    get: () => locationState,
    configurable: true,
  });
  vi.stubGlobal("history", {
    replaceState: (_s: unknown, _t: string, url: string) => {
      const u = new URL(url, "https://plebly.fund");
      locationState.pathname = u.pathname;
      locationState.search = u.search;
      locationState.hash = u.hash;
    },
  });
  vi.stubGlobal("sessionStorage", {
    store: new Map<string, string>(),
    getItem(k: string) {
      return this.store.get(k) ?? null;
    },
    setItem(k: string, v: string) {
      this.store.set(k, v);
    },
    removeItem(k: string) {
      this.store.delete(k);
    },
  });
});

beforeEach(() => {
  locationState.pathname = "/";
  locationState.search = "";
  locationState.hash = "";
  (sessionStorage as unknown as { store: Map<string, string> }).store.clear();
  vi.stubGlobal("fetch", undefined);
  delete (window as Window & { nostr?: unknown }).nostr;
});

describe("login UX helpers", () => {
  it("builds GitHub OAuth URL with return_to", () => {
    expect(githubLoginUrl("/account")).toContain("/auth/github?return_to=");
    expect(decodeURIComponent(githubLoginUrl("/propose"))).toContain("/propose");
  });

  it("loginChoicesHtml offers GitHub and Nostr (not X)", () => {
    const html = loginChoicesHtml("Sign in to continue.", "/account");
    expect(html).toContain("Sign in to continue.");
    expect(html).toContain("/auth/github");
    expect(html).toContain("GitHub");
    expect(html).toContain('data-nostr-login');
    expect(html).toContain("Nostr");
    expect(html).toContain("icon-nostr");
    expect(html).not.toContain("/auth/x");
    expect(html).not.toContain("fa-x-twitter");
  });

  it("loginMenuHtml is a compact nav details control", () => {
    const html = loginMenuHtml("/");
    expect(html).toContain("<details");
    expect(html).toContain("Continue with GitHub");
    expect(html).toContain("Continue with Nostr");
    expect(html).toContain('data-nostr-login');
    expect(html).toContain("icon-nostr");
    expect(html).toContain("fa-github");
    expect(html).not.toContain("Continue with X");
  });

  it("consumeSessionFromHash stores Bearer token and strips the hash", () => {
    locationState.hash = "#plebly_auth=tok%2B123";
    expect(consumeSessionFromHash()).toBe(true);
    expect(sessionStorage.getItem("plebly_session")).toBe("tok+123");
    expect(locationState.hash).toBe("");
  });

  it("formats Nostr login errors for cancel / network cases", () => {
    expect(formatNostrLoginError(new Error("User rejected the request"))).toBe(
      "Nostr signing was cancelled.",
    );
    expect(formatNostrLoginError(new Error("Failed to fetch"))).toMatch(/reach the login API/i);
    expect(shortNostrPubkey("a".repeat(64))).toBe(`${"a".repeat(8)}…${"a".repeat(4)}`);
  });
});

describe("loginWithNostr", () => {
  it("requires a NIP-07 extension", async () => {
    await expect(loginWithNostr()).rejects.toThrow(/No Nostr extension found/i);
  });

  it("completes challenge → sign → session token", async () => {
    const challenge = "a".repeat(32);
    const pubkey = "b".repeat(64);
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/auth/nostr/challenge")) {
        return new Response(JSON.stringify({ challenge, expires_in: 300 }), {
          status: 200,
        });
      }
      if (url.includes("/auth/nostr?challenge=")) {
        const auth = new Headers(init?.headers).get("Authorization") || "";
        expect(auth.startsWith("Nostr ")).toBe(true);
        expect(init?.body).toBe(JSON.stringify({ challenge }));
        return new Response(
          JSON.stringify({ token: "session-token", user: { id: `nostr:${pubkey}` } }),
          { status: 200 },
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    (window as Window & { nostr?: unknown }).nostr = {
      signEvent: async (event: {
        kind: number;
        tags: string[][];
        content: string;
        created_at: number;
      }) => ({
        ...event,
        id: "c".repeat(64),
        pubkey,
        sig: "d".repeat(128),
      }),
    };

    await loginWithNostr();
    expect(sessionStorage.getItem("plebly_session")).toBe("session-token");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("maps user-cancelled signing cleanly", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ challenge: "a".repeat(32) }), { status: 200 }),
      ),
    );
    (window as Window & { nostr?: unknown }).nostr = {
      signEvent: async () => {
        throw new Error("User rejected.");
      },
    };
    await expect(loginWithNostr()).rejects.toThrow(/cancelled/i);
  });
});
