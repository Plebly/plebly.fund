import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearUnreadNotificationCache,
  notificationNavBadgeHtml,
  peekUnreadNotificationCount,
  setUnreadNotificationCount,
  unreadNotificationCount,
  updateNavUnreadBadge,
  type ProposalNotification,
} from "./auth";

function note(
  partial: Partial<ProposalNotification> & Pick<ProposalNotification, "id">,
): ProposalNotification {
  return {
    type: "listed",
    proposal_id: "plebly-1",
    proposal_path: "proposals/listed/demo.md",
    created_at: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

describe("unreadNotificationCount", () => {
  it("counts only items without read_at", () => {
    expect(
      unreadNotificationCount([
        note({ id: "a" }),
        note({ id: "b", read_at: "2026-01-02T00:00:00.000Z" }),
        note({ id: "c" }),
      ]),
    ).toBe(2);
  });
});

describe("unread cache", () => {
  beforeEach(() => {
    clearUnreadNotificationCache();
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

  afterEach(() => {
    clearUnreadNotificationCache();
    vi.unstubAllGlobals();
  });

  it("round-trips count without another network hop", () => {
    expect(peekUnreadNotificationCount()).toBeNull();
    setUnreadNotificationCount(4);
    expect(peekUnreadNotificationCount()).toBe(4);
    clearUnreadNotificationCache();
    expect(peekUnreadNotificationCount()).toBeNull();
  });
});

describe("notificationNavBadgeHtml", () => {
  it("hides at zero, links to notifications, and caps at 99+", () => {
    expect(notificationNavBadgeHtml(0)).toBe("");
    const html = notificationNavBadgeHtml(3);
    expect(html).toContain(">3<");
    expect(html).toContain("tab=notifications");
    expect(html).toContain('aria-label="3 unread notifications"');
    expect(html).toContain("data-nav-notify-dropdown");
    expect(notificationNavBadgeHtml(120)).toContain(">99+<");
  });
});

describe("updateNavUnreadBadge", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    clearUnreadNotificationCache();
  });

  it("adds, updates, and removes the badge beside the account link", () => {
    document.body.innerHTML = `
      <span data-nav-account-wrap>
        <a href="/account" data-nav-account>alice</a>
      </span>
    `;
    const wrap = document.querySelector("[data-nav-account-wrap]")!;

    updateNavUnreadBadge(2);
    const badge = wrap.querySelector("[data-nav-notify-badge]");
    expect(badge?.textContent).toBe("2");
    expect(wrap.querySelector("[data-nav-notify]")).toBeTruthy();
    expect(wrap.querySelector(".nav-notify-all")?.getAttribute("href")).toContain(
      "tab=notifications",
    );

    updateNavUnreadBadge(1);
    expect(wrap.querySelector("[data-nav-notify-badge]")?.textContent).toBe("1");

    updateNavUnreadBadge(0);
    expect(wrap.querySelector("[data-nav-notify-badge]")).toBeNull();
  });
});
