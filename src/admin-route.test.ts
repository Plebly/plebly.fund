import { beforeEach, describe, expect, it, vi } from "vitest";

const { authFetch } = vi.hoisted(() => ({ authFetch: vi.fn() }));

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return { ...actual, WORKERS_API: "https://api.test/" };
});

vi.mock("./auth", () => ({
  authFetch,
  currentReturnPath: () => "/admin?tab=config",
  loginMenuHtml: () => "",
}));

vi.mock("./admin-me", () => ({
  fetchAdminMe: vi.fn(async () => ({ admin: true, github: "ada" })),
}));

vi.mock("./confirm-modal", () => ({
  confirmAction: vi.fn(async () => true),
}));

import { renderAdmin } from "./admin-page";

const shell = (inner: string) => `<main data-shell>${inner}</main>`;

function inventory(route: string) {
  return {
    rows: [
      {
        key: "funding_route",
        label: "Funding route for new listings",
        group: "Receive / money routing",
        mutability: "quorum",
        value: route,
        source: route === "direct-builder" ? "kv" : "default",
        edit_hint:
          "multisig or direct-builder. Existing listings keep the route they listed with.",
      },
      {
        key: "endowment_address",
        label: "Endowment address",
        group: "Receive / money routing",
        mutability: "quorum",
        value: null,
        source: "kv",
      },
    ],
    audit: [],
    open_ballots: [],
  };
}

beforeEach(() => {
  authFetch.mockReset();
  document.body.innerHTML = `<div id="app"></div>`;
  window.history.replaceState(null, "", "/admin?tab=config");
});

describe("admin funding route", () => {
  it("shows pay the builder and does not offer an escrow choice", async () => {
    authFetch.mockResolvedValue(
      Response.json({
        ...inventory("direct-builder"),
        rows: inventory("direct-builder").rows.map((row) =>
          row.key === "funding_route"
            ? {
                ...row,
                locked: true,
                value: "direct-builder",
                edit_hint:
                  "Multisig escrow is off. New listings pay the builder. A listing that already has an escrow keeps it.",
              }
            : row,
        ),
      }),
    );
    await renderAdmin(shell);
    expect(document.querySelector('select[data-quorum-field="funding_route"]')).toBeNull();
    expect(document.querySelector('[data-quorum-propose="funding_route"]')).toBeNull();
    expect(document.body.textContent).toContain("direct-builder");
    expect(document.body.textContent).toContain("Multisig escrow is off");
    expect(
      document.querySelector('input[data-quorum-field="endowment_address"]'),
    ).toBeTruthy();
  });
});
