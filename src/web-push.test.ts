import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authFetch = vi.fn();
vi.mock("./auth", () => ({
  authFetch: (...args: unknown[]) => authFetch(...args),
}));

vi.mock("./config", () => ({
  WORKERS_API: "https://api.test",
}));

import {
  bindWebPushPanel,
  canOfferWebPush,
  enableWebPush,
  parsePushEventData,
  urlBase64ToUint8Array,
  webPushPanelHtml,
} from "./web-push";

describe("parsePushEventData", () => {
  it("uses defaults for empty/invalid payloads", () => {
    expect(parsePushEventData(null).title).toBe("Plebly");
    expect(parsePushEventData("not-json").url).toContain("notifications");
  });

  it("strips absolute URLs to same-origin paths", () => {
    const parsed = parsePushEventData(
      JSON.stringify({
        title: "Claim floor reached",
        body: "abc",
        url: "https://plebly.fund/p/abc?x=1",
        tag: "n1",
      }),
    );
    expect(parsed.title).toBe("Claim floor reached");
    expect(parsed.url).toBe("/p/abc?x=1");
    expect(parsed.tag).toBe("n1");
  });

  it("normalizes relative paths", () => {
    expect(
      parsePushEventData(
        JSON.stringify({ title: "T", body: "B", url: "account?tab=funds" }),
      ).url,
    ).toBe("/account?tab=funds");
  });
});

describe("urlBase64ToUint8Array", () => {
  it("decodes URL-safe base64 without padding", () => {
    const bytes = urlBase64ToUint8Array("AQID");
    expect(Array.from(bytes)).toEqual([1, 2, 3]);
  });
});

describe("canOfferWebPush", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.documentElement.classList.remove("pwa-standalone");
  });

  it("is false outside standalone PWA", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: false })),
    );
    expect(canOfferWebPush()).toBe(false);
  });

  it("requires PushManager and Notification in standalone", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn((q: string) => ({
        matches: q.includes("standalone"),
        media: q,
        addEventListener: () => {},
        removeEventListener: () => {},
      })),
    );
    // happy-dom may lack PushManager; ensure gate fails closed without it.
    const hadPush = "PushManager" in window;
    if (!hadPush) {
      expect(canOfferWebPush()).toBe(false);
    }
  });
});

describe("webPushPanelHtml", () => {
  it("renders enable/disable controls", () => {
    const html = webPushPanelHtml();
    expect(html).toContain('id="web-push-panel"');
    expect(html).toContain("web-push-enable");
    expect(html).toContain("web-push-disable");
  });
});

describe("enableWebPush + panel", () => {
  const subscribe = vi.fn();
  const getSubscription = vi.fn();

  beforeEach(() => {
    authFetch.mockReset();
    subscribe.mockReset();
    getSubscription.mockReset();
    vi.stubGlobal(
      "matchMedia",
      vi.fn((q: string) => ({
        matches: q.includes("standalone"),
        media: q,
        addEventListener: () => {},
        removeEventListener: () => {},
      })),
    );
    vi.stubGlobal("Notification", {
      permission: "default",
      requestPermission: vi.fn(async () => "granted"),
    });
    class FakePushManager {}
    vi.stubGlobal("PushManager", FakePushManager);
    vi.stubGlobal("navigator", {
      ...navigator,
      serviceWorker: {
        ready: Promise.resolve({
          pushManager: {
            getSubscription,
            subscribe,
          },
        }),
      },
    });
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("subscribes with VAPID key and posts to Workers", async () => {
    getSubscription.mockResolvedValue(null);
    const sub = {
      endpoint: "https://fcm.example/x",
      toJSON: () => ({
        endpoint: "https://fcm.example/x",
        expirationTime: null,
        keys: { p256dh: "pk", auth: "ak" },
      }),
    };
    subscribe.mockResolvedValue(sub);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("/push/vapid")) {
          return new Response(
            JSON.stringify({
              configured: true,
              publicKey: "BFK1glrgPwI_t5oSuRZZKi6BRpuef2kTIL5knf4c6yL0hG3Tx5U375TVaSR3fJJOa7cilDKtW6MMJnUkolwckX4",
            }),
          );
        }
        return new Response("{}", { status: 404 });
      }),
    );
    authFetch.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    await enableWebPush();
    expect(subscribe).toHaveBeenCalled();
    expect(authFetch).toHaveBeenCalledWith(
      "https://api.test/notifications/push/subscribe",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("shows enable control in standalone when unbound", async () => {
    getSubscription.mockResolvedValue(null);
    document.body.innerHTML = webPushPanelHtml();
    await bindWebPushPanel(document);
    const panel = document.getElementById("web-push-panel");
    expect(panel?.hidden).toBe(false);
    expect(document.getElementById("web-push-enable")?.hidden).toBe(false);
  });
});

describe("service worker push contract", () => {
  it("public/sw.js registers push and notificationclick", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const sw = await fs.readFile(
      path.resolve(import.meta.dirname, "../public/sw.js"),
      "utf8",
    );
    expect(sw).toContain('addEventListener("push"');
    expect(sw).toContain('addEventListener("notificationclick"');
    expect(sw).toContain("parsePushEventData");
  });
});
