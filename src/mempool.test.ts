import { afterEach, describe, expect, it, vi } from "vitest";
import { watchConfirmedBalance } from "./mempool";

describe("watchConfirmedBalance", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fires when confirmed balance increases", async () => {
    let balance = 10_000;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          chain_stats: {
            funded_txo_sum: balance,
            spent_txo_sum: 0,
          },
        }),
      })),
    );

    const onUpdate = vi.fn();
    const watcher = watchConfirmedBalance("tb1qtest", onUpdate, {
      baseline: 10_000,
      intervalMs: 20,
    });
    await watcher.ready;
    expect(onUpdate).not.toHaveBeenCalled();

    balance = 25_000;
    await vi.waitFor(() => {
      expect(onUpdate).toHaveBeenCalledWith(25_000, { previous: 10_000 });
    });

    watcher.stop();
  });
});
