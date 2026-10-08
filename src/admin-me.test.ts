import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authFetch = vi.fn();
const cfg = { WORKERS_API: "https://api.test/" };

vi.mock("./auth", () => ({ authFetch: (...a: unknown[]) => authFetch(...a) }));
vi.mock("./config", () => ({
  get WORKERS_API() {
    return cfg.WORKERS_API;
  },
}));

import { fetchAdminMe } from "./admin-me";

describe("fetchAdminMe", () => {
  beforeEach(() => {
    authFetch.mockReset();
    cfg.WORKERS_API = "https://api.test/";
  });

  it("GETs /admin/me once (trailing slash stripped) and returns the body", async () => {
    authFetch.mockResolvedValue(new Response(JSON.stringify({ admin: true, github: "josh" })));
    expect(await fetchAdminMe()).toEqual({ admin: true, github: "josh" });
    expect(authFetch).toHaveBeenCalledTimes(1);
    expect(authFetch).toHaveBeenCalledWith("https://api.test/admin/me");
  });

  it("passes a non-admin answer through", async () => {
    authFetch.mockResolvedValue(new Response(JSON.stringify({ admin: false, error: "nope" })));
    expect(await fetchAdminMe()).toEqual({ admin: false, error: "nope" });
  });

  it("is not admin, without a request, when no Workers API is configured", async () => {
    cfg.WORKERS_API = "";
    expect(await fetchAdminMe()).toEqual({ admin: false });
    expect(authFetch).not.toHaveBeenCalled();
  });

  it("is not admin when the request throws or the body is not JSON", async () => {
    authFetch.mockRejectedValueOnce(new Error("offline"));
    expect(await fetchAdminMe()).toEqual({ admin: false });
    authFetch.mockResolvedValueOnce(new Response("<html>", { status: 502 }));
    expect(await fetchAdminMe()).toEqual({ admin: false });
  });
});

describe("entry-chunk boundary", () => {
  it("main.ts imports fetchAdminMe from admin-me and loads admin-page only dynamically", () => {
    const main = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "main.ts"), "utf8");
    expect(main).toMatch(/import \{ fetchAdminMe \} from "\.\/admin-me";/);
    expect(main).not.toMatch(/^import [^;]* from "\.\/admin-page";/m);
    expect(main).toContain('await import("./admin-page")');
  });
});
