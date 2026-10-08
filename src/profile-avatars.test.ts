import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./config", () => ({ WORKERS_API: "https://api.test/" }));

type Mod = typeof import("./profile-avatars");
let m: Mod;

function stubFetch(body: unknown, status = 200) {
  const fn = vi.fn(async (_url: string) => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

beforeEach(async () => {
  // Fresh module per test: the user/org caches are module-level.
  vi.resetModules();
  m = await import("./profile-avatars");
});
afterEach(() => vi.unstubAllGlobals());

describe("slot markup", () => {
  it("lower-cases and escapes the user handle; empty handle renders nothing", () => {
    expect(m.avatarSlotHtml(" Alice ")).toBe(
      '<span class="user-avatar-slot" data-avatar-user="alice" hidden></span>',
    );
    expect(m.avatarSlotHtml('a"b')).toContain('data-avatar-user="a&quot;b"');
    expect(m.avatarSlotHtml("")).toBe("");
    expect(m.avatarSlotHtml(null)).toBe("");
  });

  it("strips @ from org logins", () => {
    expect(m.orgAvatarSlotHtml("@Plebly")).toBe(
      '<span class="user-avatar-slot org-avatar-slot" data-avatar-org="plebly" hidden></span>',
    );
    expect(m.orgAvatarSlotHtml("@")).toBe("");
    expect(m.orgAvatarSlotHtml(undefined)).toBe("");
  });
});

describe("fetchAvatars", () => {
  it("batches valid, de-duplicated handles into one request", async () => {
    const fn = stubFetch({ avatars: { alice: "https://a/alice.png" } });
    const out = await m.fetchAvatars(["Alice", "alice", "bob", "-bad", "a".repeat(33), "x y"]);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn.mock.calls[0][0]).toBe(
      `https://api.test/profile/avatars?u=${encodeURIComponent("alice,bob")}`,
    );
    expect(out).toEqual({ alice: "https://a/alice.png" });
  });

  it("caches hits and misses so a repeat call makes no request", async () => {
    const fn = stubFetch({ avatars: { alice: "https://a/alice.png" } });
    await m.fetchAvatars(["alice", "bob"]);
    expect(await m.fetchAvatars(["ALICE", "bob"])).toEqual({ alice: "https://a/alice.png" });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does not cache after a failed request", async () => {
    let fn = stubFetch({}, 500);
    expect(await m.fetchAvatars(["alice"])).toEqual({});
    fn = stubFetch({ avatars: { alice: "u" } });
    expect(await m.fetchAvatars(["alice"])).toEqual({ alice: "u" });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("makes no request for an empty list", async () => {
    const fn = stubFetch({});
    expect(await m.fetchAvatars([])).toEqual({});
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("fetchOrgAvatars", () => {
  it("strips @, allows 40-char logins and calls /orgs/avatars", async () => {
    const long = "o".repeat(40);
    const fn = stubFetch({ avatars: { plebly: "https://a/p.png", [long]: "https://a/l.png" } });
    const out = await m.fetchOrgAvatars(["@Plebly", long, "o".repeat(41)]);
    expect(fn.mock.calls[0][0]).toBe(
      `https://api.test/orgs/avatars?o=${encodeURIComponent(`plebly,${long}`)}`,
    );
    expect(out).toEqual({ plebly: "https://a/p.png", [long]: "https://a/l.png" });
  });
});

describe("hydrateAvatarSlots", () => {
  it("fills user and org slots it has URLs for and keeps the rest hidden", async () => {
    const root = document.createElement("div");
    root.innerHTML =
      m.avatarSlotHtml("alice") + m.avatarSlotHtml("bob") + m.orgAvatarSlotHtml("plebly");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        new Response(
          JSON.stringify({
            avatars: url.includes("/orgs/")
              ? { plebly: "https://a/p.png" }
              : { alice: 'https://a/a.png?x="y' },
          }),
        ),
      ),
    );
    await m.hydrateAvatarSlots(root);
    const [alice, bob, org] = [...root.querySelectorAll<HTMLElement>(".user-avatar-slot")];
    expect(alice.hidden).toBe(false);
    expect(alice.querySelector("img")?.getAttribute("src")).toBe('https://a/a.png?x="y');
    expect(bob.hidden).toBe(true);
    expect(bob.innerHTML).toBe("");
    expect(org.hidden).toBe(false);
    expect(org.querySelector("img")?.getAttribute("src")).toBe("https://a/p.png");
  });

  it("clears a previously filled slot when there is no URL any more", async () => {
    const root = document.createElement("div");
    root.innerHTML = '<span data-avatar-user="carol"><img src="https://a/old.png" /></span>';
    stubFetch({ avatars: {} });
    await m.hydrateAvatarSlots(root);
    const slot = root.querySelector<HTMLElement>("[data-avatar-user]")!;
    expect(slot.hidden).toBe(true);
    expect(slot.innerHTML).toBe("");
  });

  it("makes no request when there are no slots", async () => {
    const fn = stubFetch({});
    await m.hydrateAvatarSlots(document.createElement("div"));
    expect(fn).not.toHaveBeenCalled();
  });
});
