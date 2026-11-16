import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "./auth";
import { payToSignMessage } from "./pay-to";
import type { ShellContext } from "./profile-pages";

vi.mock("./config", async () => {
  const actual = await vi.importActual<typeof import("./config")>("./config");
  return { ...actual, WORKERS_API: "https://api.test" };
});

import { renderPropose } from "./propose-page";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("propose pay-to message", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("asks for a pay-to when the parameters request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("down", { status: 503 })),
    );
    document.body.innerHTML = `<div id="app"></div>`;
    await renderPropose({
      user: { id: "github:9", github: "bob", username: "bob" } as AuthUser,
      routeName: "propose",
      shell: (inner) => inner,
      rerender: () => undefined,
    });
    document
      .querySelector<HTMLInputElement>('input[name="proposal_type"][value="direct"]')!
      .dispatchEvent(new Event("change", { bubbles: true }));
    expect(document.body.textContent).toContain("New listings pay the builder");
  });

  it("reserves a listing id and puts that id in the message to sign", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/parameters")) {
          return json({ funding_route: "direct-builder" });
        }
        if (url.endsWith("/claims/params")) {
          return json({
            claim_window_days_presets: [7],
            claim_window_days_default: 7,
          });
        }
        if (url.endsWith("/proposals/reserve-id")) {
          return json({ ok: true, proposal_id: "PLEBLY-2026-004" });
        }
        return json({});
      }),
    );
    document.body.innerHTML = `<div id="app"></div>`;
    const ctx: ShellContext = {
      user: {
        id: "github:9",
        github: "bob",
        username: "bob",
      } as AuthUser,
      routeName: "propose",
      shell: (inner) => inner,
      rerender: () => undefined,
    };
    await renderPropose(ctx);
    const campaign = document.querySelector<HTMLInputElement>(
      'input[name="proposal_type"][value="direct"]',
    );
    expect(campaign).toBeTruthy();
    campaign!.checked = true;
    campaign!.dispatchEvent(new Event("change"));
    await vi.waitFor(() => {
      expect(document.querySelector("#propose-pay-to-message")?.textContent).toContain(
        "Enter a P2WPKH address",
      );
    });
    const address = document.querySelector<HTMLInputElement>(
      'input[name="pay_to_address"]',
    )!;
    address.value = "tb1qexampleaddress";
    address.dispatchEvent(new Event("input", { bubbles: true }));
    const message = document.querySelector("#propose-pay-to-message")?.textContent;
    expect(message).toBe(payToSignMessage("tb1qexampleaddress", "PLEBLY-2026-004"));
    expect(
      document.querySelector<HTMLInputElement>('input[name="reserved_proposal_id"]')
        ?.value,
    ).toBe("PLEBLY-2026-004");
  });
});
