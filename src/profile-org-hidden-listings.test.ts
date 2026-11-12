import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Proposal } from "./types";

const gh = vi.hoisted(() => ({ listAll: vi.fn(), listListed: vi.fn() }));
vi.mock("./github", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./github")>();
  return {
    ...actual,
    listAllPublicProposals: gh.listAll,
    listListedProposals: gh.listListed,
    loadListedProposals: async () => ({
      proposals: await gh.listListed(),
      fromCatalog: true,
    }),
  };
});

const auth = vi.hoisted(() => ({
  fetchPublicProfile: vi.fn(),
  authFetch: vi.fn(),
}));
vi.mock("./auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./auth")>();
  return {
    ...actual,
    fetchPublicProfile: auth.fetchPublicProfile,
    authFetch: auth.authFetch,
  };
});

import { renderArchive } from "./archive-page";
import { renderPublicOrgProfile } from "./org-page";
import { renderPublicProfile } from "./profile-pages";
import { renderStats } from "./stats-page";

const VISIBLE_COMPLETED = "PLEBLY-2026-001";
const PUBLIC_DECLINED = "PLEBLY-2026-002";
const HIDDEN_COMPLETED = "PLEBLY-2026-010";

function proposal(
  overrides: Partial<Proposal> & Pick<Proposal, "id" | "status">,
): Proposal {
  const id = overrides.id as string;
  const status = overrides.status;
  const dir =
    status === "completed"
      ? "completed"
      : status === "declined"
        ? "declined"
        : "listed";
  return {
    title: id,
    path: `proposals/${dir}/${id}.md`,
    proposal_type: "bounty",
    target_sats: status === "completed" ? 50_000 : null,
    escrow_address: null,
    submission_fee_txid: null,
    created_at: "2026-10-01T00:00:00Z",
    escrow_index: null,
    milestones: [],
    body: "",
    balance_sats: status === "completed" ? 0 : 1_000,
    ...overrides,
  };
}

const visibleCompleted = proposal({
  id: VISIBLE_COMPLETED,
  status: "completed",
  title: "Visible completed",
  proposer_type: "org",
  proposer: { github: "acme", agent: "alice" },
  claimer: "acme",
  claimer_type: "org",
  target_sats: 100_000,
  balance_sats: 0,
});

const hiddenCompleted = proposal({
  id: HIDDEN_COMPLETED,
  status: "completed",
  title: "Hidden completed fixture",
  proposer_type: "org",
  proposer: { github: "acme", agent: "alice" },
  claimer: "acme",
  claimer_type: "org",
  target_sats: 50_000,
  balance_sats: 0,
});

const publicDeclined = proposal({
  id: PUBLIC_DECLINED,
  status: "declined",
  title: "Public declined",
  proposer_type: "org",
  proposer: { github: "acme", agent: "alice" },
});

const ALL = [visibleCompleted, hiddenCompleted, publicDeclined];
const LISTED = [visibleCompleted];

const shell = (inner: string) => `<main data-shell>${inner}</main>`;
const app = () => document.querySelector<HTMLDivElement>("#app")!;
const workIds = () =>
  [...app().querySelectorAll(".work-list a")].map((a) => a.getAttribute("href") || "");
const hasListing = (id: string) => {
  const needle = id.toLowerCase();
  return workIds().some((href) => href.toLowerCase().includes(needle)) ||
    (app().textContent || "").includes(id) ||
    (app().textContent || "").includes(
      id === HIDDEN_COMPLETED ? "Hidden completed fixture" : "",
    );
};

function seedCatalog() {
  gh.listAll.mockResolvedValue(ALL);
  gh.listListed.mockResolvedValue(LISTED);
}

describe("hidden completed listings on profile and org pages", () => {
  beforeEach(() => {
    document.body.innerHTML = `<div id="app"></div>`;
    gh.listAll.mockReset();
    gh.listListed.mockReset();
    auth.fetchPublicProfile.mockReset();
    auth.authFetch.mockReset();
    seedCatalog();
  });
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("stays off org and profile lists, keeps public declined, and still counts on /stats and /archive", async () => {
    auth.fetchPublicProfile.mockResolvedValue({
      username: "alice",
      github: "alice",
    });
    auth.authFetch.mockResolvedValue(
      Response.json({
        org: {
          login: "acme",
          avatar_url: "",
          html_url: "https://github.com/acme",
          name: "Acme",
          description: null,
          public_members: [],
          synced_at: "2026-11-12T00:00:00.000Z",
        },
        can_resync: false,
      }),
    );

    await renderPublicProfile({ shell, user: null, routeName: "profile", rerender: () => {} }, "alice");
    expect(gh.listAll).toHaveBeenCalled();
    expect(gh.listListed).toHaveBeenCalled();
    expect(app().textContent).toContain("Visible completed");
    expect(app().textContent).toContain("Public declined");
    expect(app().textContent).not.toContain("Hidden completed fixture");
    expect(hasListing(HIDDEN_COMPLETED)).toBe(false);
    expect(workIds().some((href) => href.toLowerCase().includes("plebly-2026-010"))).toBe(
      false,
    );

    await renderPublicOrgProfile(shell, "acme", null);
    expect(app().textContent).toContain("Visible completed");
    expect(app().textContent).toContain("Public declined");
    expect(app().textContent).not.toContain("Hidden completed fixture");
    expect(workIds().some((href) => href.toLowerCase().includes("plebly-2026-010"))).toBe(
      false,
    );

    history.replaceState(null, "", "/stats");
    await renderStats(shell);
    const completed = [...app().querySelectorAll(".stats-metric dt")].find(
      (el) => el.textContent === "Completed",
    )?.parentElement?.querySelector("dd")?.textContent;
    expect(completed).toBe("2");
    expect(app().querySelector(".stats-primary-detail")!.textContent).toMatch(
      /3 tracked projects/,
    );

    history.replaceState(null, "", "/archive");
    await renderArchive(shell);
    const archiveIds = [...app().querySelectorAll(".declined-row .mono")].map(
      (el) => el.textContent,
    );
    expect(archiveIds).toContain(HIDDEN_COMPLETED);
    expect(archiveIds).toContain(VISIBLE_COMPLETED);
    expect(app().textContent).toContain("Hidden completed fixture");
    expect(app().querySelector(".account-tab")!.textContent).toMatch(/Completed 2/);
  });
});
