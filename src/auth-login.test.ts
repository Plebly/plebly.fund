import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  consumeSessionFromHash,
  githubLoginUrl,
  loginChoicesHtml,
  loginMenuHtml,
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
    expect(html).not.toContain("/auth/x");
    expect(html).not.toContain("fa-x-twitter");
  });

  it("loginMenuHtml is a compact nav details control", () => {
    const html = loginMenuHtml("/");
    expect(html).toContain("<details");
    expect(html).toContain("Continue with GitHub");
    expect(html).toContain("Continue with Nostr");
    expect(html).toContain('data-nostr-login');
    expect(html).not.toContain("Continue with X");
  });

  it("consumeSessionFromHash stores Bearer token and strips the hash", () => {
    locationState.hash = "#plebly_auth=tok%2B123";
    expect(consumeSessionFromHash()).toBe(true);
    expect(sessionStorage.getItem("plebly_session")).toBe("tok+123");
    expect(locationState.hash).toBe("");
  });
});
