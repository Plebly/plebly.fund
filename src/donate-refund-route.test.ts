/**
 * Donate modal: signed-out donors see a refund-route line above the escrow
 * address before they send. Shared and unique addresses get different copy
 * (isSharedEscrow, which fails toward shared). The line is plain text with no
 * link. Signed-in donors see nothing here.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return { ...actual, lightningUiAllowed: () => false };
});

/** Catalog rows "already loaded" for the render under test. */
let catalogRows: Proposal[] = [];
vi.mock("./github", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./github")>();
  return { ...actual, loadedCatalogRows: () => catalogRows };
});

import {
  DONATE_SIGNED_OUT_SHARED_COPY,
  DONATE_SIGNED_OUT_UNIQUE_COPY,
  donateModalHtml,
  donateRefundRouteCopy,
  endowmentDonatePanelHtml,
} from "./proposal-ui";
import { isSharedEscrow } from "./escrow-shared";
import { applyCatalogRuntimeToProposal } from "./github";
import type { Proposal } from "./types";

/** UI UX / Review / Tester final copy, pinned literally. */
const UNIQUE =
  "Sign in before you send to get funder credit and a refund route. Anonymous gifts can only be refunded by signing a message from the sending address, which exchanges and some wallets can't do.";
const SHARED =
  "Sign in before you send to get funder credit. Refunds on this proposal need a signed message from the sending address, which exchanges and some wallets can't do.";
const BANNED = ["Refund addresses aren't available", "Your gift stays in escrow"];

const ADDR = "tb1q3ujq9473rc9smza7djsm8snmaxv9ccqwzn447x98r97pyr2c6ljqawv6qx";
/** Live signet DEMO and 001-008 all pay this one address; their flag is null. */
const LIVE_SHARED = "tb1qhj27cegpek02g8g4peps0x7gqs0svvs888svyz";

type Flag = boolean | null | undefined;
const row = (n: number, address: string, flag: Flag): Proposal =>
  ({
    id: `PLEBLY-2026-${String(n).padStart(3, "0")}`,
    path: `proposals/listed/PLEBLY-2026-${String(n).padStart(3, "0")}.md`,
    title: `P${n}`,
    status: "listed",
    escrow_address: address,
    ...(flag === undefined ? {} : { escrow_shared: flag }),
  }) as Proposal;
/** shared=true: flag true; shared=false: flag false (unique), nothing else loaded. */
const proposal = (shared: boolean): Proposal => row(9, ADDR, shared);

function renderRow(p: Proposal, catalog: Proposal[], signedIn = false): HTMLElement | null {
  catalogRows = catalog;
  document.body.innerHTML = donateModalHtml(p, { signedIn });
  return document.querySelector<HTMLElement>("#donate-refund-route");
}

function render(shared: boolean, signedIn: boolean): HTMLElement | null {
  return renderRow(proposal(shared), [], signedIn);
}

describe("signed-out Donate refund-route line", () => {
  it("copy constants are the agreed strings", () => {
    expect(DONATE_SIGNED_OUT_UNIQUE_COPY).toBe(UNIQUE);
    expect(DONATE_SIGNED_OUT_SHARED_COPY).toBe(SHARED);
  });

  it("unique address, signed out: the unique line, in the pay step, above the address", () => {
    const line = render(false, false);
    expect(line?.textContent).toBe(UNIQUE);
    expect(line?.closest("#donate-step-pay")).toBeTruthy();
    const addr = document.querySelector("#donate-address")!;
    expect(line!.compareDocumentPosition(addr) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shared address, signed out: the shared line, which promises no refund route", () => {
    const line = render(true, false);
    expect(line?.textContent).toBe(SHARED);
    expect(line?.textContent).not.toContain("refund route");
    const addr = document.querySelector("#donate-address")!;
    expect(line!.compareDocumentPosition(addr) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("both lines are plain text: no link, no anchor, the text word for word", () => {
    for (const [shared, copy] of [
      [false, UNIQUE],
      [true, SHARED],
    ] as const) {
      const line = render(shared, false)!;
      expect(line.textContent).toBe(copy);
      expect(line.querySelectorAll("a, [href]")).toHaveLength(0);
      expect(line.children).toHaveLength(0);
      expect(line.innerHTML).not.toContain("signed-refund");
    }
  });

  it("signed in: no line, on either address kind", () => {
    expect(render(false, true)).toBeNull();
    expect(render(true, true)).toBeNull();
    expect(document.body.textContent).not.toContain("Sign in before you send");
  });

  it("donateRefundRouteCopy covers all four cases", () => {
    expect(donateRefundRouteCopy({ signedIn: false, shared: false })).toBe(UNIQUE);
    expect(donateRefundRouteCopy({ signedIn: false, shared: true })).toBe(SHARED);
    expect(donateRefundRouteCopy({ signedIn: true, shared: false })).toBeNull();
    expect(donateRefundRouteCopy({ signedIn: true, shared: true })).toBeNull();
  });

  it("the endowment Donate panel has no refund-route line", () => {
    document.body.innerHTML = endowmentDonatePanelHtml(ADDR, { signedIn: false });
    expect(document.querySelector("#donate-refund-route")).toBeNull();
  });

  it("the retired strings appear nowhere: not in any rendered variant, not in any source file", () => {
    for (const shared of [false, true]) {
      for (const signedIn of [false, true]) {
        render(shared, signedIn);
        for (const b of BANNED) expect(document.body.innerHTML).not.toContain(b);
      }
    }
    const root = join(process.cwd(), "src");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|html|css|md|json)$/.test(name) && !/\.test\.ts$/.test(name)) files.push(p);
      }
    };
    walk(root);
    expect(files.length).toBeGreaterThan(20);
    const hits = files.filter((f) => BANNED.some((b) => readFileSync(f, "utf8").includes(b)));
    expect(hits).toEqual([]);
  });
});

describe("isSharedEscrow: fails toward shared (display only; the server is the gate)", () => {
  it("live-like catalog: 9 rows on one address, all flags null: the shared line", () => {
    const rows = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((n) => row(n, LIVE_SHARED, null));
    for (const p of rows) expect(isSharedEscrow(p, rows)).toBe(true);
    expect(renderRow(rows[3]!, rows)?.textContent).toBe(SHARED);
  });

  it("direct link, no catalog loaded, null or missing flag: shared", () => {
    for (const flag of [null, undefined] as const) {
      expect(isSharedEscrow(row(9, ADDR, flag), [])).toBe(true);
      expect(isSharedEscrow(row(9, ADDR, flag))).toBe(true);
      expect(renderRow(row(9, ADDR, flag), [])?.textContent).toBe(SHARED);
    }
  });

  it("partial catalog with the address once and a null flag: shared", () => {
    const p = row(9, ADDR, null);
    const partial = [p, row(10, "tb1qother0000000000000000000000000000000x", null)];
    expect(isSharedEscrow(p, partial)).toBe(true);
    expect(renderRow(p, partial)?.textContent).toBe(SHARED);
  });

  it("flag false and the address unique in the catalog: the unique line", () => {
    const p = row(9, ADDR, false);
    const catalog = [p, row(10, LIVE_SHARED, false), row(11, LIVE_SHARED, false)];
    expect(isSharedEscrow(p, catalog)).toBe(false);
    expect(renderRow(p, catalog)?.textContent).toBe(UNIQUE);
  });

  it("flag false but 2 loaded rows on the address (whitespace trimmed): shared", () => {
    const p = row(9, ADDR, false);
    const catalog = [p, row(10, `  ${ADDR}\n`, false)];
    expect(isSharedEscrow(p, catalog)).toBe(true);
    expect(isSharedEscrow({ ...p, escrow_address: ` ${ADDR} ` }, catalog)).toBe(true);
    expect(renderRow(p, catalog)?.textContent).toBe(SHARED);
  });

  it("flag true on a single row: shared", () => {
    const p = row(9, ADDR, true);
    expect(isSharedEscrow(p, [p])).toBe(true);
    expect(renderRow(p, [p])?.textContent).toBe(SHARED);
  });

  it("flag false on the page but the catalog row for that address says true: shared", () => {
    const p = row(9, ADDR, false);
    expect(isSharedEscrow(p, [row(9, ADDR, true)])).toBe(true);
  });

  it("an explicit false survives the catalog overlay; a missing one stays missing", () => {
    const doc = { ...row(9, ADDR, undefined) };
    expect(applyCatalogRuntimeToProposal(doc, row(9, ADDR, false)).escrow_shared).toBe(false);
    expect(applyCatalogRuntimeToProposal(doc, row(9, ADDR, undefined)).escrow_shared).toBeUndefined();
    expect(applyCatalogRuntimeToProposal(doc, row(9, ADDR, true)).escrow_shared).toBe(true);
  });
});
