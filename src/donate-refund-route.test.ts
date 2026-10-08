/**
 * Donate modal: signed-out donors see a refund-route line above the escrow
 * address before they send. Shared and unique addresses get different copy
 * (catalog escrow_shared, workers#50). Signed-in donors see nothing here.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return { ...actual, lightningUiAllowed: () => false };
});

import {
  DONATE_SIGNED_OUT_SHARED_COPY,
  DONATE_SIGNED_OUT_UNIQUE_COPY,
  donateModalHtml,
  donateRefundRouteCopy,
  endowmentDonatePanelHtml,
} from "./proposal-ui";
import type { Proposal } from "./types";

/** UI UX / Review / Tester final copy, pinned literally. */
const UNIQUE =
  "Sign in before you send to get funder credit and a refund route. Anonymous gifts can only be refunded by signing a message from the sending address, which exchanges and some wallets can't do.";
const SHARED =
  "Sign in before you send to get funder credit. Refunds on this proposal need a signed message from the sending address, which exchanges and some wallets can't do.";
const BANNED = ["Refund addresses aren't available", "Your gift stays in escrow"];

const ADDR = "tb1q3ujq9473rc9smza7djsm8snmaxv9ccqwzn447x98r97pyr2c6ljqawv6qx";
const proposal = (shared: boolean): Proposal =>
  ({
    id: "PLEBLY-2026-009",
    path: "proposals/listed/PLEBLY-2026-009.md",
    title: "U",
    status: "listed",
    escrow_address: ADDR,
    ...(shared ? { escrow_shared: true } : {}),
  }) as Proposal;

function render(shared: boolean, signedIn: boolean): HTMLElement | null {
  document.body.innerHTML = donateModalHtml(proposal(shared), { signedIn });
  return document.querySelector<HTMLElement>("#donate-refund-route");
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
