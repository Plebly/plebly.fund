import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { watchConfirmedBalance } from "./mempool";

const ADDR = "tb1qhj27cegpek02g8g4peps0x7gqs0svvs888svyz";

/** Each fetch returns a promise the test settles by hand. */
let pending: ((sats: number) => void)[];
const fetchMock = vi.fn(
  () =>
    new Promise<Response>((resolve) => {
      pending.push((sats) =>
        resolve(Response.json({ chain_stats: { funded_txo_sum: sats, spent_txo_sum: 0 } })),
      );
    }),
);

async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

beforeEach(() => {
  pending = [];
  fetchMock.mockClear();
  vi.useFakeTimers();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("watchConfirmedBalance: stop() during an in-flight read", () => {
  it("control: a changed balance on a tick fires onUpdate once", async () => {
    const onUpdate = vi.fn();
    const w = watchConfirmedBalance(ADDR, onUpdate, { intervalMs: 1_000, baseline: 1_000 });
    await w.ready;
    vi.advanceTimersByTime(1_000);
    expect(pending).toHaveLength(1);
    pending[0](6_000);
    await flush();
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith(6_000, { previous: 1_000 });
    w.stop();
  });

  it("stop() while the tick's read is in flight: the read resolves with a new balance, onUpdate never fires", async () => {
    const onUpdate = vi.fn();
    const w = watchConfirmedBalance(ADDR, onUpdate, { intervalMs: 1_000, baseline: 1_000 });
    await w.ready;
    vi.advanceTimersByTime(1_000);
    expect(pending).toHaveLength(1);

    w.stop();
    pending[0](6_000);
    await flush();

    expect(onUpdate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stop() during the first read (no baseline): no interval starts and nothing fires", async () => {
    const onUpdate = vi.fn();
    const w = watchConfirmedBalance(ADDR, onUpdate, { intervalMs: 1_000 });
    expect(pending).toHaveLength(1);
    w.stop();
    pending[0](6_000);
    await w.ready;
    vi.advanceTimersByTime(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onUpdate).not.toHaveBeenCalled();
  });
});
