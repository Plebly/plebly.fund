import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Proposal } from "./types";

const m = vi.hoisted(() => ({
  addWatch: vi.fn(),
  removeWatch: vi.fn(),
  list: vi.fn(),
}));

vi.mock("./builder", async (orig) => ({
  ...(await orig<typeof import("./builder")>()),
  addWatch: (...args: unknown[]) => m.addWatch(...args),
  removeWatch: (...args: unknown[]) => m.removeWatch(...args),
}));

vi.mock("./github", async (orig) => ({
  ...(await orig<typeof import("./github")>()),
  listListedProposals: (...args: unknown[]) => m.list(...args),
}));

vi.mock("./donations-live", () => ({
  bindDonationsLive: vi.fn(async () => {}),
}));

vi.mock("./activity", () => ({
  bindActivityStrip: vi.fn(async () => {}),
}));

vi.mock("./profile-avatars", async (orig) => ({
  ...(await orig<typeof import("./profile-avatars")>()),
  hydrateAvatarSlots: vi.fn(async () => {}),
}));

import { bindCardWatches, proposalCardHtml, renderHome } from "./home-page";

function proposal(
  overrides: Partial<Proposal> & Pick<Proposal, "status"> = { status: "listed" },
): Proposal {
  return {
    id: "knots",
    title: "Knots PR: reject high size-to-value relay spam",
    path: "proposals/listed/knots.md",
    target_sats: null,
    escrow_address: null,
    submission_fee_txid: null,
    created_at: "2026-10-01T00:00:00Z",
    escrow_index: null,
    milestones: [],
    body: "",
    watch_count: 0,
    ...overrides,
  };
}

function mountCard(watching = false, count = 0): HTMLButtonElement {
  const p = proposal({ status: "listed", watch_count: count });
  document.body.innerHTML = proposalCardHtml(p, 10_000, false, watching);
  bindCardWatches(document.body, new Set());
  return document.querySelector<HTMLButtonElement>("[data-card-watch]")!;
}

describe("bindCardWatches signed-out and error feedback", () => {
  beforeEach(() => {
    m.addWatch.mockReset();
    m.removeWatch.mockReset();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("prompts to sign in on login_required and leaves the button label alone", async () => {
    m.addWatch.mockRejectedValueOnce(new Error("login_required"));
    const btn = mountCard(false, 0);
    const label = btn.getAttribute("aria-label");
    expect(label).toBe(
      "Watch Knots PR: reject high size-to-value relay spam, 0",
    );

    btn.click();
    const status = await vi.waitFor(() => {
      const el = document.querySelector<HTMLElement>(".project-card-watch-status");
      expect(el).not.toBeNull();
      expect(el?.hidden).toBe(false);
      return el!;
    });

    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.textContent).toContain("Sign in to watch projects.");
    expect(status.querySelector('a[href*="/auth/github"]')).not.toBeNull();
    expect(status.querySelector("[data-nostr-login]")).not.toBeNull();
    expect(btn.getAttribute("aria-label")).toBe(label);
    expect(btn.dataset.watching).toBe("0");
    expect(btn.querySelector(".project-card-watch-count")?.textContent).toBe("0");
  });

  it("shows a generic failure message for other errors and leaves the label alone", async () => {
    m.addWatch.mockRejectedValueOnce(new Error("Watch failed (500)"));
    const btn = mountCard(false, 0);
    const label = btn.getAttribute("aria-label");

    btn.click();
    const status = await vi.waitFor(() => {
      const el = document.querySelector<HTMLElement>(".project-card-watch-status");
      expect(el).not.toBeNull();
      expect(el?.hidden).toBe(false);
      return el!;
    });

    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.textContent).toBe("Couldn't update watch. Try again.");
    expect(status.querySelector(".login-choices")).toBeNull();
    expect(btn.getAttribute("aria-label")).toBe(label);
    expect(btn.dataset.watching).toBe("0");
  });

  it("still toggles the button on success and clears any prior status", async () => {
    m.addWatch
      .mockRejectedValueOnce(new Error("login_required"))
      .mockResolvedValueOnce(undefined);
    const btn = mountCard(false, 0);

    btn.click();
    await vi.waitFor(() => {
      expect(
        document.querySelector(".project-card-watch-status")?.textContent,
      ).toContain("Sign in to watch projects.");
    });

    btn.click();
    await vi.waitFor(() => {
      expect(btn.dataset.watching).toBe("1");
    });
    expect(btn.getAttribute("aria-label")).toBe(
      "Unwatch Knots PR: reject high size-to-value relay spam, 1",
    );
    const status = document.querySelector<HTMLElement>(".project-card-watch-status");
    expect(status?.hidden).toBe(true);
    expect(status?.textContent).toBe("");
  });
});

describe("renderHome #list aria-busy", () => {
  beforeEach(() => {
    m.list.mockReset();
    document.body.innerHTML = `<div id="app"></div>`;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({})),
    );
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  async function renderPending(): Promise<{
    list: HTMLElement;
    done: Promise<void>;
    resolve: (rows: Proposal[]) => void;
    reject: (err: Error) => void;
  }> {
    let resolve!: (rows: Proposal[]) => void;
    let reject!: (err: Error) => void;
    m.list.mockImplementation(
      () =>
        new Promise<Proposal[]>((res, rej) => {
          resolve = res;
          reject = rej;
        }),
    );
    const done = renderHome((inner) => inner);
    const list = document.querySelector<HTMLElement>("#list")!;
    return { list, done, resolve, reject };
  }

  it("starts busy with a loading label, then settles after a successful load", async () => {
    const { list, done, resolve } = await renderPending();
    expect(list.getAttribute("aria-busy")).toBe("true");
    expect(list.getAttribute("aria-label")).toBe("Loading open projects");
    resolve([proposal({ status: "listed", balance_sats: 1_000 })]);
    await done;
    expect(list.getAttribute("aria-busy")).toBe("false");
    expect(list.getAttribute("aria-label")).toBe("Open projects");
    expect(list.classList.contains("project-grid-skeleton")).toBe(false);
  });

  it("settles aria-busy after an empty catalog", async () => {
    const { list, done, resolve } = await renderPending();
    expect(list.getAttribute("aria-busy")).toBe("true");
    resolve([]);
    await done;
    expect(list.getAttribute("aria-busy")).toBe("false");
    expect(list.getAttribute("aria-label")).toBe("Open projects");
    expect(list.textContent).toContain("No open projects yet");
  });

  it("settles aria-busy after a load error", async () => {
    const { list, done, reject } = await renderPending();
    expect(list.getAttribute("aria-busy")).toBe("true");
    reject(new Error("catalog down"));
    await done;
    expect(list.getAttribute("aria-busy")).toBe("false");
    expect(list.getAttribute("aria-label")).toBe("Open projects");
    expect(list.textContent).toContain("Could not load projects: catalog down");
  });
});
