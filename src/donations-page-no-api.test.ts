import { afterEach, expect, it, vi } from "vitest";

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return { ...actual, WORKERS_API: "" };
});

import { fetchEndowmentOpen } from "./donations-page";

afterEach(() => {
  vi.unstubAllGlobals();
});

it("fetchEndowmentOpen: no API configured is false, with no request", async () => {
  const fetchMock = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          address: "tb1qhj27cegpek02g8g4peps0x7gqs0svvs888svyz",
          configured: true,
          give_address_usable: true,
          balance_shared_with_escrow: false,
          balance_sats: 1,
          balance_unavailable: false,
          total_given_sats: 1,
          goal_sats: 0,
        }),
        { status: 200 },
      ),
  );
  vi.stubGlobal("fetch", fetchMock);
  expect(await fetchEndowmentOpen()).toBe(false);
  expect(fetchMock).not.toHaveBeenCalled();
});
