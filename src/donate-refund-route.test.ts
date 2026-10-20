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
  DONATE_SHARED_COUNT_COPY,
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
/** Shared address: the one combined sign-in note (UI UX, verbatim). */
const SHARED =
  "Sign in before you send so your gift counts toward this proposal. Gifts sent without signing in are held in escrow but won't show in the total, and refunds need a signed message from the sending address, which exchanges and some wallets can't do.";
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
  // Unique: the refund-route line. Shared: the single combined note.
  return document.querySelector<HTMLElement>("#donate-refund-route, #donate-shared-count");
}

function render(shared: boolean, signedIn: boolean): HTMLElement | null {
  return renderRow(proposal(shared), [], signedIn);
}

describe("signed-out Donate refund-route line", () => {
  it("copy constants are the agreed strings", () => {
    expect(DONATE_SIGNED_OUT_UNIQUE_COPY).toBe(UNIQUE);
    expect(DONATE_SHARED_COUNT_COPY).toBe(SHARED);
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

  /** Every visible sign-in note on the pay step, any wording. */
  const signInNotes = () =>
    [...document.querySelectorAll<HTMLElement>("#donate-step-pay [role=note]")]
      .filter((n) => !n.closest("[hidden]") || n.closest("[hidden]") === n.closest("#donate-step-pay"))
      .filter((n) => /sign in/i.test(n.textContent || ""))
      .map((n) => (n.textContent || "").replace(/\s+/g, " ").trim());

  it("one sign-in note per modal: shared shows only the combined note, unique only its route line", () => {
    render(true, false);
    expect(document.querySelector("#donate-refund-route")).toBeNull();
    expect(document.querySelector("#donate-step-pay .donate-credit-advisory")).toBeNull();
    expect(signInNotes()).toEqual([SHARED]);
    render(false, false);
    expect(document.querySelector("#donate-shared-count")).toBeNull();
    expect(document.querySelector("#donate-step-pay .donate-credit-advisory")).toBeNull();
    expect(signInNotes()).toEqual([UNIQUE]);
    // Endowment: no route or count note, so the anonymous-credit line is the one.
    document.body.innerHTML = endowmentDonatePanelHtml(ADDR, { signedIn: false });
    expect(signInNotes()).toEqual(["Giving anonymously. Sign in now if you want credit."]);
  });

  /** Sign in buttons on the payment step, outside the Lightning tab. */
  const signInButtons = () =>
    [...document.querySelectorAll<HTMLButtonElement>("#donate-step-pay .donate-credit-signin")].filter(
      (b) => !b.closest('[data-pane="lightning"]'),
    );

  it("exactly one Sign in button on the payment step, directly under the note, outside it", () => {
    for (const [shared, copy] of [
      [true, SHARED],
      [false, UNIQUE],
    ] as const) {
      const note = render(shared, false)!;
      expect(note.textContent).toBe(copy);
      expect(note.children).toHaveLength(0);
      const buttons = signInButtons();
      expect(buttons).toHaveLength(1);
      expect(buttons[0]!.textContent).toBe("Sign in");
      expect(buttons[0]!.id).toBe("donate-credit-signin");
      expect(note.nextElementSibling?.contains(buttons[0]!)).toBe(true);
    }
    // Endowment: the existing line and its Sign in now button, no duplicate.
    document.body.innerHTML = endowmentDonatePanelHtml(ADDR, { signedIn: false });
    const endow = signInButtons();
    expect(endow).toHaveLength(1);
    expect(endow[0]!.textContent).toBe("Sign in now");
    expect(endow[0]!.closest(".donate-credit-advisory")).toBeTruthy();
    expect(document.querySelector(".donate-note-signin")).toBeNull();
    // Signed in: none.
    render(true, true);
    expect(signInButtons()).toHaveLength(0);
    render(false, true);
    expect(signInButtons()).toHaveLength(0);
    expect(document.body.textContent).not.toContain("Sign in so your gift counts");
    expect(document.body.textContent).not.toContain("Refunds on this proposal need");
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
    expect(donateRefundRouteCopy({ signedIn: false, shared: true })).toBeNull();
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

  it("flag false but the same bech32 address in another case: shared", () => {
    const p = row(9, ADDR, false);
    const catalog = [p, row(10, ` ${ADDR.toUpperCase()} `, false)];
    expect(isSharedEscrow(p, catalog)).toBe(true);
    expect(isSharedEscrow({ ...p, escrow_address: ADDR.toUpperCase() }, catalog)).toBe(true);
    expect(renderRow(p, catalog)?.textContent).toBe(SHARED);
    expect(isSharedEscrow(row(11, ADDR.toUpperCase(), false), [row(11, ADDR.toUpperCase(), false)])).toBe(
      false,
    );
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
