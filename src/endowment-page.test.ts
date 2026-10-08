import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  list: vi.fn(),
  user: vi.fn(),
  bindModal: vi.fn(),
  bindPanel: vi.fn(async () => {}),
}));
vi.mock("./github", async (orig) => ({ ...(await orig<typeof import("./github")>()), listListedProposals: m.list }));
vi.mock("./auth", async (orig) => ({ ...(await orig<typeof import("./auth")>()), fetchCurrentUser: m.user }));
vi.mock("./proposal-ui", async (orig) => ({
  ...(await orig<typeof import("./proposal-ui")>()),
  bindDonateModal: m.bindModal,
  bindDonatePanel: m.bindPanel,
}));
vi.mock("./home-page", async (orig) => ({ ...(await orig<typeof import("./home-page")>()), bindCardWatches: vi.fn() }));
vi.mock("./profile-avatars", async (orig) => ({
  ...(await orig<typeof import("./profile-avatars")>()),
  hydrateAvatarSlots: vi.fn(async () => {}),
}));

import { renderEndowment } from "./endowment-page";
import type { Proposal } from "./types";

const ADDR = "tb1qhj27cegpek02g8g4peps0x7gqs0svvs888svyz";
const p = (id: string, status: string, over: Partial<Proposal> = {}): Proposal =>
  ({
    id,
    path: `proposals/listed/${id}.md`,
    title: `Title ${id}`,
    status,
    proposal_type: "bounty",
    target_sats: 10_000,
    escrow_address: null,
    created_at: "2026-10-01T00:00:00Z",
    milestones: [],
    body: "",
    ...over,
  }) as Proposal;

const view = (over: Record<string, unknown> = {}) => ({
  address: ADDR,
  configured: true,
  display_balance_sats: 12_345,
  goal_sats: 1_000_000,
  display_updated_at: "2026-10-01T00:00:00Z",
  funded_proposal_ids: [],
  contributions: [],
  lightning_available: false,
  ...over,
});

let endowment: () => Response;
const fetchMock = vi.fn(async (url: string) => {
  if (String(url).endsWith("/endowment")) return endowment();
  return new Response("not mocked", { status: 599 });
});

const shell = (inner: string) => `<main data-shell>${inner}</main>`;
const app = () => document.querySelector<HTMLDivElement>("#app")!;
const text = () => app().textContent!.replace(/\s+/g, " ");

beforeEach(() => {
  document.body.innerHTML = `<div id="app"></div>`;
  history.replaceState(null, "", "/endowment");
  m.list.mockReset().mockResolvedValue([]);
  m.user.mockReset().mockResolvedValue(null);
  m.bindModal.mockReset();
  m.bindPanel.mockReset().mockResolvedValue(undefined);
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  endowment = () => Response.json(view());
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("renderEndowment: Donate gate", () => {
  it("configured with an address: Donate button, modal and panel bound to that address", async () => {
    await renderEndowment(shell);
    expect(app().querySelector("[data-open-donate]")).not.toBeNull();
    expect(app().querySelector("#donate-modal")).not.toBeNull();
    expect(app().querySelector(".endowment-meter")).not.toBeNull();
    expect(m.bindModal).toHaveBeenCalledTimes(1);
    expect(m.bindModal.mock.calls[0][1]).toEqual({ open: false, rail: undefined });
    expect(m.bindPanel).toHaveBeenCalledTimes(1);
    expect(m.bindPanel.mock.calls[0][1]).toMatchObject({ address: ADDR, proposalId: "endowment", mode: "endowment", signedIn: false });
  });

  it.each([
    ["not configured", { configured: false }],
    ["no address", { address: null }],
  ])("%s: 'Donations open soon.', no Donate, no meter, nothing bound", async (_n, over) => {
    endowment = () => Response.json(view(over));
    await renderEndowment(shell);
    expect(text()).toContain("Donations open soon.");
    expect(app().querySelector("[data-open-donate]")).toBeNull();
    expect(app().querySelector("#donate-modal")).toBeNull();
    expect(app().querySelector(".endowment-meter")).toBeNull();
    expect(m.bindModal).not.toHaveBeenCalled();
    expect(m.bindPanel).not.toHaveBeenCalled();
  });

  it("a failed /endowment load shows the error and no Donate", async () => {
    endowment = () => new Response("down", { status: 502 });
    await renderEndowment(shell);
    expect(text()).toContain("Could not load endowment right now.");
    expect(app().querySelector("[data-open-donate]")).toBeNull();
    expect(m.bindPanel).not.toHaveBeenCalled();
  });

  it.each([
    ["?donate", "/endowment?donate", { open: true, rail: undefined }],
    ["#donate", "/endowment#donate", { open: true, rail: undefined }],
    ["?rail=lightning", "/endowment?rail=lightning", { open: true, rail: "lightning" }],
    ["?donate=ln", "/endowment?donate=ln", { open: true, rail: "lightning" }],
  ])("deep link %s opens the modal", async (_n, url, expected) => {
    history.replaceState(null, "", url);
    await renderEndowment(shell);
    expect(m.bindModal.mock.calls[0][1]).toEqual(expected);
  });

  it("a signed-in donor's credit prefs are passed to the panel", async () => {
    m.user.mockResolvedValue({ id: "github:1", funder_credit: { public_credit: false, show_amount: true } });
    await renderEndowment(shell);
    expect(m.bindPanel.mock.calls[0][1]).toMatchObject({
      signedIn: true,
      creditPrefs: { public_credit: false, anonymous: true, show_amount: true },
    });
  });
});

describe("renderEndowment: contributions and funded projects", () => {
  it("no contributions: empty copy; funded: none yet", async () => {
    await renderEndowment(shell);
    expect(text()).toContain("No monthly contributions listed yet.");
    expect(text()).toContain("0 projects");
    expect(app().querySelector(".endowment-funded-empty")).not.toBeNull();
  });

  it("contribution rows link listed proposals by id (case-insensitive), escape notes and link the tx", async () => {
    m.list.mockResolvedValue([p("PLEBLY-2026-003", "listed", { title: "Docs <b>pass</b>" })]);
    endowment = () =>
      Response.json(
        view({
          contributions: [
            { id: "g1", proposal_id: "Plebly-2026-003", amount_sats: 5000, granted_at: "2026-09-01T00:00:00Z", txid: "a".repeat(64) },
            { id: "g2", proposal_id: "PLEBLY-2026-999", amount_sats: 700, granted_at: "" },
          ],
        }),
      );
    await renderEndowment(shell);
    const rows = app().querySelectorAll(".endowment-contrib-row");
    expect(rows).toHaveLength(2);
    expect(text()).toContain("2 entries");
    const link = rows[0].querySelector<HTMLAnchorElement>(".endowment-contrib-project a")!;
    expect(link.textContent).toBe("Docs <b>pass</b>");
    expect(rows[0].querySelector("b")).toBeNull();
    const tx = rows[0].querySelector<HTMLAnchorElement>(".endowment-tx-link")!;
    expect(tx.href).toContain(`/tx/${"a".repeat(64)}`);
    expect(tx.textContent).toBe("aaaaaaaa…");
    expect(rows[1].querySelector("a")).toBeNull();
    expect(rows[1].textContent).toContain("PLEBLY-2026-999");
    expect(rows[1].querySelector("time")!.textContent).toBe("—");
  });

  it("funded cards: only ids the endowment funded AND still active", async () => {
    m.list.mockResolvedValue([
      p("PLEBLY-2026-001", "listed"),
      p("PLEBLY-2026-002", "in_review"),
      p("PLEBLY-2026-004", "completed"),
      p("PLEBLY-2026-005", "listed"),
    ]);
    endowment = () =>
      Response.json(view({ funded_proposal_ids: ["plebly-2026-001", "PLEBLY-2026-002", "PLEBLY-2026-004"] }));
    await renderEndowment(shell);
    expect(text()).toContain("2 projects");
    const funded = app().querySelector("#funded")!.innerHTML;
    expect(funded).toContain("PLEBLY-2026-001");
    expect(funded).toContain("PLEBLY-2026-002");
    expect(funded).not.toContain("PLEBLY-2026-004");
    expect(funded).not.toContain("PLEBLY-2026-005");
  });

  it("a failing proposal listing still renders the page with the Donate gate intact", async () => {
    m.list.mockRejectedValue(new Error("github down"));
    await renderEndowment(shell);
    expect(app().querySelector("[data-open-donate]")).not.toBeNull();
    expect(text()).toContain("0 projects");
  });
});
