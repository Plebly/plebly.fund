/**
 * Donate modal on a shared escrow address (isSharedEscrow, which fails toward
 * shared): signed-out donors are told an anonymous gift won't show in the
 * proposal's total. Unique addresses and signed-in donors see nothing.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return { ...actual, lightningUiAllowed: () => false };
});

let catalogRows: Proposal[] = [];
vi.mock("./github", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./github")>();
  return { ...actual, loadedCatalogRows: () => catalogRows };
});

import {
  DONATE_SHARED_COUNT_COPY,
  donateModalHtml,
  donateSharedCountCopy,
  endowmentDonatePanelHtml,
} from "./proposal-ui";
import type { Proposal } from "./types";

const COPY =
  "Sign in before you send so your gift counts toward this proposal. Gifts sent without signing in are held in escrow but won't show in the total, and refunds need a signed message from the sending address, which exchanges and some wallets can't do.";
const UNIQUE_ADDR = "tb1q3ujq9473rc9smza7djsm8snmaxv9ccqwzn447x98r97pyr2c6ljqawv6qx";
/** Live signet 001–008 share this address; their catalog flag is null. */
const LIVE_SHARED = "tb1qhj27cegpek02g8g4peps0x7gqs0svvs888svyz";

const row = (n: number, address: string, flag: boolean | null | undefined): Proposal =>
  ({
    id: `PLEBLY-2026-${String(n).padStart(3, "0")}`,
    path: `proposals/listed/PLEBLY-2026-${String(n).padStart(3, "0")}.md`,
    title: `P${n}`,
    status: "listed",
    escrow_address: address,
    ...(flag === undefined ? {} : { escrow_shared: flag }),
  }) as Proposal;

function note(p: Proposal, catalog: Proposal[], signedIn: boolean): HTMLElement | null {
  catalogRows = catalog;
  document.body.innerHTML = donateModalHtml(p, { signedIn });
  return document.querySelector<HTMLElement>("#donate-shared-count");
}

describe("Donate shared-escrow count note", () => {
  it("copy is the agreed string", () => {
    expect(DONATE_SHARED_COUNT_COPY).toBe(COPY);
  });

  it("shared (null flag, like 001–008), signed out: the note, in the pay step, above the address", () => {
    const rows = [1, 2, 3].map((n) => row(n, LIVE_SHARED, null));
    const el = note(rows[0]!, rows, false);
    expect(el?.textContent).toBe(COPY);
    expect(el?.closest("#donate-step-pay")).toBeTruthy();
    const addr = document.querySelector("#donate-address")!;
    expect(el!.compareDocumentPosition(addr) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("explicit flag false but two catalog rows on one address: still shared, the note shows", () => {
    const a = row(9, UNIQUE_ADDR, false);
    const b = row(10, UNIQUE_ADDR, false);
    expect(note(a, [a, b], false)?.textContent).toBe(COPY);
  });

  it("unique address signed out, and any address signed in: no note", () => {
    const u = row(9, UNIQUE_ADDR, false);
    expect(note(u, [u], false)).toBeNull();
    const s = row(1, LIVE_SHARED, null);
    expect(note(s, [s], true)).toBeNull();
    expect(note(u, [u], true)).toBeNull();
  });

  it("donateSharedCountCopy covers all four cases", () => {
    expect(donateSharedCountCopy({ signedIn: false, shared: true })).toBe(COPY);
    expect(donateSharedCountCopy({ signedIn: false, shared: false })).toBeNull();
    expect(donateSharedCountCopy({ signedIn: true, shared: true })).toBeNull();
    expect(donateSharedCountCopy({ signedIn: true, shared: false })).toBeNull();
  });

  it("the endowment Donate panel has no note", () => {
    document.body.innerHTML = endowmentDonatePanelHtml(UNIQUE_ADDR, { signedIn: false });
    expect(document.querySelector("#donate-shared-count")).toBeNull();
  });
});
