/**
 * main.ts render(): every page that isn't a project page ends the Donate
 * project (proposal-ui.ts endDonateProject) before it renders; a project page
 * doesn't (renderProposalPage starts its own).
 */
import { beforeAll, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  end: vi.fn(),
  home: vi.fn(async () => {}),
  endowment: vi.fn(async () => {}),
  about: vi.fn(async () => {}),
  proposal: vi.fn(async () => {}),
  missing: vi.fn(),
  find: vi.fn(async (id: string) =>
    id === "PLEBLY-2026-009" ? ({ id, path: "proposals/listed/PLEBLY-2026-009.md" } as never) : null,
  ),
}));

vi.mock("./proposal-ui", async (o) => ({
  ...(await o<typeof import("./proposal-ui")>()),
  endDonateProject: m.end,
  installDonateClickCapture: vi.fn(),
}));
vi.mock("./home-page", async (o) => ({ ...(await o<typeof import("./home-page")>()), renderHome: m.home }));
vi.mock("./endowment-page", async (o) => ({ ...(await o<typeof import("./endowment-page")>()), renderEndowment: m.endowment }));
vi.mock("./about-page", async (o) => ({ ...(await o<typeof import("./about-page")>()), renderAbout: m.about }));
vi.mock("./proposal-page", async (o) => ({
  ...(await o<typeof import("./proposal-page")>()),
  renderProposalPage: m.proposal,
  renderMissingProposal: m.missing,
}));
vi.mock("./github", async (o) => ({ ...(await o<typeof import("./github")>()), findListedProposalById: m.find }));
vi.mock("./auth", async (o) => ({
  ...(await o<typeof import("./auth")>()),
  consumeSessionFromHash: vi.fn(async () => {}),
  fetchCurrentUser: vi.fn(async () => null),
}));
vi.mock("./pwa", async (o) => ({
  ...(await o<typeof import("./pwa")>()),
  registerPwaServiceWorker: vi.fn(async () => {}),
}));

async function visit(path: string, rendered: ReturnType<typeof vi.fn>) {
  m.end.mockClear();
  rendered.mockClear();
  history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
  await vi.waitFor(() => expect(rendered).toHaveBeenCalled());
}

beforeAll(async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
  document.body.innerHTML = `<div id="app"></div>`;
  history.replaceState(null, "", "/about");
  await import("./main");
  await vi.waitFor(() => expect(m.about).toHaveBeenCalled());
});

describe("main.ts render(): the Donate project follows the route", () => {
  it("a project page doesn't end it (renderProposalPage starts its own)", async () => {
    await visit("/p/PLEBLY-2026-009", m.proposal);
    expect(m.end).not.toHaveBeenCalled();
  });

  it.each([
    ["/endowment", () => m.endowment],
    ["/", () => m.home],
    ["/about", () => m.about],
  ])("%s ends it before the page renders", async (path, rendered) => {
    await visit("/p/PLEBLY-2026-009", m.proposal);
    await visit(path, rendered());
    expect(m.end).toHaveBeenCalledTimes(1);
    expect(m.end.mock.invocationCallOrder[0]).toBeLessThan(rendered().mock.invocationCallOrder[0]!);
  });

  it("a project route with no such project ends it too", async () => {
    await visit("/p/PLEBLY-2026-009", m.proposal);
    await visit("/p/PLEBLY-2026-404", m.missing);
    expect(m.end).toHaveBeenCalled();
  });
});
