import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  addWatch: vi.fn(),
  removeWatch: vi.fn(),
  fetchWatches: vi.fn(),
  fetchWanted: vi.fn(),
  fetchWatchMetaBatch: vi.fn(),
  listListedProposals: vi.fn(),
  fetchLightningStatus: vi.fn(),
  fetchProposalViewsBatch: vi.fn(),
  bindActivityStrip: vi.fn(),
  bindDonationsLive: vi.fn(),
  hydrateAvatarSlots: vi.fn(),
}));

vi.mock("./builder", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./builder")>();
  return {
    ...actual,
    addWatch: api.addWatch,
    removeWatch: api.removeWatch,
    fetchWatches: api.fetchWatches,
    fetchWanted: api.fetchWanted,
    fetchWatchMetaBatch: api.fetchWatchMetaBatch,
  };
});

vi.mock("./github", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./github")>();
  return { ...actual, listListedProposals: api.listListedProposals };
});

vi.mock("./lightning", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lightning")>();
  return { ...actual, fetchLightningStatus: api.fetchLightningStatus };
});

vi.mock("./views", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./views")>();
  return { ...actual, fetchProposalViewsBatch: api.fetchProposalViewsBatch };
});

vi.mock("./activity", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./activity")>();
  return { ...actual, bindActivityStrip: api.bindActivityStrip };
});

vi.mock("./donations-live", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./donations-live")>();
  return { ...actual, bindDonationsLive: api.bindDonationsLive };
});

vi.mock("./profile-avatars", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./profile-avatars")>();
  return { ...actual, hydrateAvatarSlots: api.hydrateAvatarSlots };
});

import { bindCardWatches, renderHome } from "./home-page";
import type { Proposal } from "./types";

const shell = (inner: string) => inner;
const app = () => document.querySelector<HTMLDivElement>("#app")!;
const list = () => app().querySelector("#list")!;

const proposal = (over: Partial<Proposal> = {}): Proposal =>
  ({
    id: "PLEBLY-2026-001",
    path: "proposals/listed/PLEBLY-2026-001.md",
    title: "Knots PR: reject high size-to-value relay spam",
    status: "listed",
    proposal_type: "bounty",
    target_sats: 10_000,
    escrow_address: "tb1qexample",
    created_at: "2026-10-01T00:00:00Z",
    milestones: [],
    body: "A listed bounty.",
    watch_count: 0,
    ...over,
  }) as Proposal;

function watchCardHtml(): string {
  return `<article class="project-card">
    <div class="project-card-actions">
      <button type="button" class="project-card-watch-btn" data-card-watch="PLEBLY-2026-001" data-path="proposals/listed/PLEBLY-2026-001.md" data-watch-title="Knots PR" data-watching="0" aria-label="Watch Knots PR, 0">
        <span class="project-card-watch-icon" aria-hidden="true">☆</span>
        <span class="mono project-card-watch-count">0</span>
      </button>
    </div>
  </article>`;
}

beforeEach(() => {
  document.body.innerHTML = `<div id="app"></div>`;
  history.replaceState(null, "", "/");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }),
  );
  api.addWatch.mockReset();
  api.removeWatch.mockReset();
  api.fetchWatches.mockReset().mockResolvedValue([]);
  api.fetchWanted.mockReset().mockResolvedValue([]);
  api.fetchWatchMetaBatch.mockReset().mockResolvedValue({});
  api.listListedProposals.mockReset();
  api.fetchLightningStatus.mockReset().mockResolvedValue({ enabled: false });
  api.fetchProposalViewsBatch.mockReset().mockResolvedValue(new Map());
  api.bindActivityStrip.mockReset();
  api.bindDonationsLive.mockReset();
  api.hydrateAvatarSlots.mockReset();
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("bindCardWatches", () => {
  it("prompts sign-in when Watch returns login_required", async () => {
    api.addWatch.mockRejectedValue(new Error("login_required"));
    app().innerHTML = watchCardHtml();
    const btn = app().querySelector<HTMLButtonElement>("[data-card-watch]")!;
    bindCardWatches(app(), new Set());
    btn.click();
    await vi.waitFor(() => {
      expect(app().textContent).toContain("Sign in to watch this project.");
    });
    expect(app().querySelector('a[href*="/auth/github"]')).toBeTruthy();
    expect(app().querySelector("[data-nostr-login]")).toBeTruthy();
    expect(btn.dataset.watching).toBe("0");
    expect(btn.querySelector(".project-card-watch-icon")!.textContent).toBe("☆");
    expect(btn.querySelector(".project-card-watch-count")!.textContent).toBe("0");
  });

  it("shows a short error when Watch fails for another reason", async () => {
    api.addWatch.mockRejectedValue(new Error("Watch failed (500)"));
    app().innerHTML = watchCardHtml();
    const btn = app().querySelector<HTMLButtonElement>("[data-card-watch]")!;
    bindCardWatches(app(), new Set());
    btn.click();
    const msg = await vi.waitFor(() => {
      const el = app().querySelector(".project-card-watch-msg");
      expect(el?.textContent).toBe("Watch failed (500)");
      return el!;
    });
    expect(msg.classList.contains("error")).toBe(true);
    expect(app().textContent).not.toContain("Sign in to watch this project.");
    expect(btn.dataset.watching).toBe("0");
  });

  it("updates the button and clears a prior error after a successful Watch", async () => {
    api.addWatch
      .mockRejectedValueOnce(new Error("Watch failed (500)"))
      .mockResolvedValueOnce(undefined);
    app().innerHTML = watchCardHtml();
    const btn = app().querySelector<HTMLButtonElement>("[data-card-watch]")!;
    bindCardWatches(app(), new Set());
    btn.click();
    await vi.waitFor(() => {
      expect(app().querySelector(".project-card-watch-msg")?.textContent).toBe(
        "Watch failed (500)",
      );
    });
    btn.click();
    await vi.waitFor(() => {
      expect(btn.dataset.watching).toBe("1");
    });
    expect(app().querySelector(".project-card-watch-msg")).toBeNull();
    expect(btn.querySelector(".project-card-watch-icon")!.textContent).toBe("★");
    expect(btn.querySelector(".project-card-watch-count")!.textContent).toBe("1");
  });
});

describe("renderHome list loading", () => {
  it("clears aria-busy and the loading label after projects load", async () => {
    let release!: (value: Proposal[]) => void;
    api.listListedProposals.mockReturnValue(
      new Promise<Proposal[]>((resolve) => {
        release = resolve;
      }),
    );
    const done = renderHome(shell);
    expect(list().getAttribute("aria-busy")).toBe("true");
    expect(list().getAttribute("aria-label")).toBe("Loading open projects");
    expect(list().classList.contains("project-grid-skeleton")).toBe(true);
    release([proposal()]);
    await done;
    expect(list().getAttribute("aria-busy")).toBe("false");
    expect(list().getAttribute("aria-label")).toBeNull();
    expect(list().classList.contains("project-grid-skeleton")).toBe(false);
    expect(list().querySelector("[data-card-watch]")).toBeTruthy();
  });

  it("clears the loading state when there are no open projects", async () => {
    api.listListedProposals.mockResolvedValue([]);
    await renderHome(shell);
    expect(list().getAttribute("aria-busy")).toBe("false");
    expect(list().getAttribute("aria-label")).toBeNull();
    expect(list().classList.contains("project-grid-skeleton")).toBe(false);
    expect(list().querySelector(".empty-state-title")!.textContent).toBe(
      "No open projects yet",
    );
  });

  it("clears the loading state when filters match nothing", async () => {
    api.listListedProposals.mockResolvedValue([proposal()]);
    await renderHome(shell);
    const search = app().querySelector<HTMLInputElement>("#project-search")!;
    search.value = "zzzz-no-match";
    search.dispatchEvent(new Event("input"));
    expect(list().getAttribute("aria-busy")).toBe("false");
    expect(list().getAttribute("aria-label")).toBeNull();
    expect(list().classList.contains("project-grid-skeleton")).toBe(false);
    expect(list().querySelector(".empty-state-title")!.textContent).toBe(
      "No matching projects",
    );
  });

  it("clears the loading state after a load error", async () => {
    api.listListedProposals.mockRejectedValue(new Error("rate limited"));
    await renderHome(shell);
    expect(list().getAttribute("aria-busy")).toBe("false");
    expect(list().getAttribute("aria-label")).toBeNull();
    expect(list().classList.contains("project-grid-skeleton")).toBe(false);
    expect(list().className).toBe("error");
    expect(list().textContent).toBe("Could not load projects: rate limited");
  });
});
