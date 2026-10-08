/**
 * Refund by signing a message: disclosure under the refund panel (refunding proposals). Message format, P2WPKH
 * check, signature-format gate, payload, error mapping and every UI string.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "./auth";
import type { Proposal } from "./types";
import {
  REFUND_SIGN_ANCHOR,
  REFUND_SIGN_COPY,
  bindRefundSign,
  buildRefundRegisterBody,
  isP2wpkhAddress,
  normalizeTxid,
  parseVout,
  refundSignErrorCopy,
  refundSignHtml,
  refundSignMessage,
  signatureFormatSupported,
} from "./refund-sign";

/**
 * Signed with the deterministic test key 0x01…01 (no funds, no secret) using
 * workers main @ 9b7283a: `refundVinMessage` + `signBitcoinMessage`, and
 * checked there with `verifyBitcoinMessage({ testnet: true })` → true
 * (same signature over the message + "x" → false).
 */
const FIXTURE = {
  proposalId: "PLEBLY-2026-001",
  userId: "usr_fixture_01",
  txid: "4f".repeat(32),
  vout: 1,
  address: "tb1q0xcqpzrky6eff2g52qdye53xkk9jxkvraulyla",
  message:
    "plebly-refund|PLEBLY-2026-001|4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f4f:1|usr_fixture_01",
  signature: "IG3v/63lQI7AItY8tVJ8SGS2yTjp+zYvYpWJossCbkobXUAT7neVjEnevJ9QAAHUnEe9H5t3v092mjocBq+1g1A=",
};

/** BIP-173 vectors. */
const P2WPKH_TB = "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx";
const P2WSH_TB = "tb1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3q0sl5k7";
const P2WPKH_BC = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";
const P2TR_TB = "tb1pqqqqp399et2xygdj5xreqhjjvcmzhxw4aywxecjdzew6hylgvsesf3hn0c";
const REFUND_TO = "tb1qhj27cegpek02g8g4peps0x7gqs0svvs888svyz";

function withHeader(b64: string, header: number, length = 65): string {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const out = new Uint8Array(length);
  out.set(bytes.slice(0, Math.min(length, bytes.length)));
  out[0] = header;
  return btoa(String.fromCharCode(...out));
}

describe("message", () => {
  it("matches the Worker's refundVinMessage byte for byte (signed fixture)", () => {
    expect(
      refundSignMessage({
        proposalId: FIXTURE.proposalId,
        txid: FIXTURE.txid,
        vout: FIXTURE.vout,
        userId: FIXTURE.userId,
      }),
    ).toBe(FIXTURE.message);
  });

  it("is plebly-refund|<pid>|<txid>:<vout>|<user_id>, trimmed, vout 0 allowed", () => {
    expect(refundSignMessage({ proposalId: " P1 ", txid: " ab ", vout: 0, userId: " github:9 " })).toBe(
      "plebly-refund|P1|ab:0|github:9",
    );
  });

  it("is null until proposal, txid, vout and user are all known", () => {
    const ok = { proposalId: "P1", txid: "ab", vout: 1, userId: "u" };
    expect(refundSignMessage({ ...ok, proposalId: null })).toBeNull();
    expect(refundSignMessage({ ...ok, txid: "  " })).toBeNull();
    expect(refundSignMessage({ ...ok, userId: null })).toBeNull();
    for (const vout of [NaN, -1, 1.5, null]) {
      expect(refundSignMessage({ ...ok, vout: vout as number })).toBeNull();
    }
  });
});

describe("P2WPKH check", () => {
  it("accepts a P2WPKH address on this network (signet), including the fixture", () => {
    expect(isP2wpkhAddress(P2WPKH_TB)).toBe(true);
    expect(isP2wpkhAddress(FIXTURE.address)).toBe(true);
    expect(isP2wpkhAddress(P2WPKH_TB.toUpperCase())).toBe(true);
    expect(isP2wpkhAddress(`  ${P2WPKH_TB}  `)).toBe(true);
  });

  it("refuses a P2WSH tb1q address (32-byte program, longer)", () => {
    expect(P2WSH_TB.startsWith("tb1q")).toBe(true);
    expect(P2WSH_TB.length).toBeGreaterThan(P2WPKH_TB.length);
    expect(isP2wpkhAddress(P2WSH_TB)).toBe(false);
  });

  it("refuses taproot, the other network, legacy, bad checksum and mixed case", () => {
    expect(isP2wpkhAddress(P2TR_TB)).toBe(false);
    expect(isP2wpkhAddress(P2WPKH_BC)).toBe(false);
    expect(isP2wpkhAddress(P2WPKH_BC, "mainnet")).toBe(true);
    expect(isP2wpkhAddress(P2WPKH_TB, "mainnet")).toBe(false);
    expect(isP2wpkhAddress("mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn")).toBe(false);
    expect(isP2wpkhAddress("2MzQwSSnBHWHqSAqtTVQ6v47XtaisrJa1Vc")).toBe(false);
    expect(isP2wpkhAddress(`${P2WPKH_TB.slice(0, -1)}y`)).toBe(false);
    expect(isP2wpkhAddress(`TB1Q${P2WPKH_TB.slice(4)}`)).toBe(false);
    expect(isP2wpkhAddress("")).toBe(false);
  });
});

describe("signature format gate", () => {
  it("the fixture (header 32, 65 bytes) is supported", () => {
    expect(atob(FIXTURE.signature).length).toBe(65);
    expect(atob(FIXTURE.signature).charCodeAt(0)).toBe(32);
    expect(signatureFormatSupported(FIXTURE.signature)).toBe(true);
  });

  for (let h = 0; h <= 255; h++) {
    const ok = (h >= 27 && h <= 34) || (h >= 39 && h <= 42);
    if (h > 50 && h !== 255 && h !== 128) continue;
    it(`header ${h} → ${ok ? "supported" : "refused"}`, () => {
      expect(signatureFormatSupported(withHeader(FIXTURE.signature, h))).toBe(ok);
    });
  }

  it("refuses anything that isn't exactly 65 bytes (64, 66, a BIP-322-sized blob) and bad base64", () => {
    expect(signatureFormatSupported(withHeader(FIXTURE.signature, 31, 64))).toBe(false);
    expect(signatureFormatSupported(withHeader(FIXTURE.signature, 31, 66))).toBe(false);
    expect(signatureFormatSupported(withHeader(FIXTURE.signature, 2, 107))).toBe(false);
    expect(signatureFormatSupported("not base64!!")).toBe(false);
    expect(signatureFormatSupported("")).toBe(false);
  });

  it("ignores whitespace, like the Worker", () => {
    const s = FIXTURE.signature;
    expect(signatureFormatSupported(`${s.slice(0, 20)}\n ${s.slice(20)}`)).toBe(true);
  });
});

describe("payload", () => {
  const base = { proposal_id: "P1", txid: FIXTURE.txid, vout: 1, refund_address: REFUND_TO };

  it("includes vin_address and signature_b64 when both are filled", () => {
    expect(
      buildRefundRegisterBody({ ...base, vin_address: ` ${FIXTURE.address} `, signature_b64: `${FIXTURE.signature}\n` }),
    ).toEqual({ ...base, vin_address: FIXTURE.address, signature_b64: FIXTURE.signature });
  });

  it("leaves both out when empty, blank, or only one is filled", () => {
    expect(buildRefundRegisterBody(base)).toEqual(base);
    expect(buildRefundRegisterBody({ ...base, vin_address: "", signature_b64: "  " })).toEqual(base);
    expect(buildRefundRegisterBody({ ...base, vin_address: FIXTURE.address })).toEqual(base);
    expect(buildRefundRegisterBody({ ...base, signature_b64: FIXTURE.signature })).toEqual(base);
    expect(Object.keys(buildRefundRegisterBody(base))).not.toContain("vin_address");
  });
});

describe("error mapping (Worker machine values → copy; never server text)", () => {
  it("bad signature", () => {
    expect(refundSignErrorCopy({ code: "refund_bind_required", error: "invalid refund signature" })).toBe(
      "That signature doesn't match this address and message. Sign the exact message above with the address you sent from.",
    );
  });
  it("address isn't an input of the tx", () => {
    expect(refundSignErrorCopy({ code: "refund_bind_required", error: "vin_address is not a funding input" })).toBe(
      "That address didn't send this gift.",
    );
  });
  it("anything else is the neutral line, never the body's text", () => {
    for (const body of [
      { code: "refund_bind_required", error: "could not load funding transaction" },
      { error: "invalid refund signature" },
      { error: "<b>boom</b>", note: "server note" },
      null,
    ]) {
      expect(refundSignErrorCopy(body)).toBe(REFUND_SIGN_COPY.failed);
    }
  });
});


describe("txid / vout parsing", () => {
  it("txid: 64 hex, trimmed and lowercased; anything else is null", () => {
    expect(normalizeTxid(` ${"AB".repeat(32)} `)).toBe("ab".repeat(32));
    expect(normalizeTxid("ab".repeat(31))).toBeNull();
    expect(normalizeTxid(`${"ab".repeat(31)}zz`)).toBeNull();
    expect(normalizeTxid("")).toBeNull();
  });
  it("vout: whole number ≥ 0", () => {
    expect(parseVout(" 0 ")).toBe(0);
    expect(parseVout("12")).toBe(12);
    for (const bad of ["", "-1", "1.5", "1e2", "x", "99999999999999999999"]) expect(parseVout(bad)).toBeNull();
  });
});

describe("copy", () => {
  it("uses UI UX's strings exactly", () => {
    expect(REFUND_SIGN_COPY).toEqual({
      title: "Sent without signing in? Refund by signing a message",
      intro:
        "Prove you sent this gift by signing the message below with the address you paid from. This works only with single-key (P2WPKH) addresses. Exchanges and multisig wallets can't do it.",
      signedOut: "Sign in to get the message to sign.",
      signIn: "Sign in",
      txidLabel: "Funding txid",
      voutLabel: "vout",
      messageLabel: "Message to sign",
      copy: "Copy",
      copied: "Copied.",
      messageChanged: "The message changed. Sign the new message.",
      fromLabel: "Address you sent from",
      fromInvalid: "This address type can't sign a refund message.",
      signatureLabel: "Signature",
      signatureHint: "Paste the signature your wallet shows after signing.",
      signatureUnsupported:
        "This wallet's signature format isn't supported yet. Electrum and Sparrow can sign this message.",
      toLabel: "Refund to",
      submit: "Register refund",
      registered: "Refund address registered for this gift.",
      failed: "Couldn't register this refund. Try again in a few minutes.",
      badSignature:
        "That signature doesn't match this address and message. Sign the exact message above with the address you sent from.",
      notFundingInput: "That address didn't send this gift.",
      needOutpoint: "Enter the funding txid and vout.",
      needFrom: "Enter the address you sent from.",
      needSignature: "Paste the signature from your wallet.",
      needRefundTo: "Enter a refund address.",
    });
  });
});

describe("anchor", () => {
  it("is the #signed-refund disclosure (Donate-modal refund lines link here), signed in and signed out", () => {
    expect(REFUND_SIGN_ANCHOR).toBe("signed-refund");
    for (const signedIn of [true, false]) {
      document.body.innerHTML = refundSignHtml(signedIn);
      const el = document.getElementById("signed-refund");
      expect(el?.tagName).toBe("DETAILS");
      expect(document.querySelectorAll("#signed-refund")).toHaveLength(1);
      expect(el!.querySelector(":scope > summary")?.textContent).toBe(
        "Sent without signing in? Refund by signing a message",
      );
    }
  });
});

// ---------------------------------------------------------------------------
// DOM: the disclosure bound under a normal refund panel.

let fetchCalls: { url: string; body: unknown }[] = [];
let reply: { status: number; body: unknown } = { status: 200, body: { ok: true } };

function stubRegisterFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      fetchCalls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
      return typeof reply.body === "string"
        ? new Response(reply.body, { status: reply.status })
        : Response.json(reply.body, { status: reply.status });
    }),
  );
}

function mount(opts: {
  signedIn: boolean;
  status?: string;
  userId?: string | null;
  panelTxid?: string;
  panelVout?: string;
}) {
  document.body.innerHTML = `<div id="root">
    <div id="refund-panel">
      <input id="refund-txid" value="${opts.panelTxid ?? ""}" />
      <input id="refund-vout" type="number" value="${opts.panelVout ?? "0"}" />
    </div>
    ${refundSignHtml(opts.signedIn)}
  </div>`;
  const root = document.querySelector<HTMLElement>("#root")!;
  const onRegistered = vi.fn();
  bindRefundSign(root, {
    proposalId: FIXTURE.proposalId,
    status: opts.status ?? "refunding",
    userId: opts.signedIn ? (opts.userId ?? FIXTURE.userId) : null,
    onRegistered,
  });
  return { root, onRegistered };
}

const $ = <T extends HTMLElement>(root: ParentNode, sel: string) => root.querySelector<T>(sel)!;

function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function fillOutpoint(root: HTMLElement, txid = FIXTURE.txid, vout = String(FIXTURE.vout)) {
  type($<HTMLInputElement>(root, "#refund-sign-txid"), txid);
  type($<HTMLInputElement>(root, "#refund-sign-vout"), vout);
}

function fillAll(root: HTMLElement, sig = FIXTURE.signature) {
  fillOutpoint(root);
  type($<HTMLInputElement>(root, "#refund-sign-from"), FIXTURE.address);
  type($<HTMLTextAreaElement>(root, "#refund-sign-signature"), sig);
  type($<HTMLInputElement>(root, "#refund-sign-to"), REFUND_TO);
}

async function submit(root: HTMLElement): Promise<string> {
  $<HTMLButtonElement>(root, "#refund-sign-submit").click();
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  const msg = $<HTMLElement>(root, "#refund-sign-msg");
  return msg.hidden ? "" : msg.textContent || "";
}

/** Visible inline errors, by id → text. */
function inlineErrors(root: HTMLElement): Record<string, string> {
  const out: Record<string, string> = {};
  for (const el of root.querySelectorAll<HTMLElement>("p.error")) {
    if (!el.hidden) out[el.id] = el.textContent || "";
  }
  return out;
}

beforeEach(() => {
  fetchCalls = [];
  reply = { status: 200, body: { ok: true } };
  history.replaceState(null, "", "/p/PLEBLY-2026-001");
  stubRegisterFetch();
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("disclosure", () => {
  it("closed by default; opens when the page is opened at #signed-refund or the hash changes to it", () => {
    let { root } = mount({ signedIn: true });
    expect($<HTMLDetailsElement>(root, "#signed-refund").open).toBe(false);
    history.replaceState(null, "", "/p/PLEBLY-2026-001#signed-refund");
    ({ root } = mount({ signedIn: false }));
    expect($<HTMLDetailsElement>(root, "#signed-refund").open).toBe(true);
    history.replaceState(null, "", "/p/PLEBLY-2026-001");
    ({ root } = mount({ signedIn: true }));
    history.replaceState(null, "", "/p/PLEBLY-2026-001#signed-refund");
    window.dispatchEvent(new Event("hashchange"));
    expect($<HTMLDetailsElement>(root, "#signed-refund").open).toBe(true);
  });
});

describe("signed out", () => {
  it("shows only the title, the line and Sign in: no message, no fields", () => {
    const { root } = mount({ signedIn: false, panelTxid: FIXTURE.txid, panelVout: "1" });
    const sec = $<HTMLElement>(root, `#${REFUND_SIGN_ANCHOR}`);
    expect(sec.querySelector("summary")?.textContent).toBe(REFUND_SIGN_COPY.title);
    expect(sec.querySelector("#refund-sign-signedout")?.textContent).toBe("Sign in to get the message to sign.");
    expect(sec.querySelector("#refund-sign-signin")?.textContent).toBe("Sign in");
    expect(sec.querySelectorAll("input, textarea, label").length).toBe(0);
    expect(sec.textContent).not.toContain("plebly-refund");
    expect(sec.textContent).not.toContain(REFUND_SIGN_COPY.intro);
  });

  it("Sign in opens the login choices, returning to the anchor", () => {
    const { root } = mount({ signedIn: false });
    $<HTMLButtonElement>(root, "#refund-sign-signin").click();
    const login = $<HTMLElement>(root, "#refund-sign-login");
    expect(login.hidden).toBe(false);
    expect(login.querySelector(".login-choices")).toBeTruthy();
    expect(login.innerHTML).toMatch(/signed-refund/);
  });
});

describe("not refunding", () => {
  for (const status of ["listed", "funding", "declined", "underfunded", "", undefined]) {
    it(`status ${JSON.stringify(status)}: the disclosure is removed`, () => {
      document.body.innerHTML = `<div id="root">${refundSignHtml(true)}</div>`;
      const root = document.querySelector<HTMLElement>("#root")!;
      bindRefundSign(root, { proposalId: "P1", status: status as string, userId: "u" });
      expect(root.querySelector(`#${REFUND_SIGN_ANCHOR}`)).toBeNull();
      expect(root.textContent).not.toContain("plebly-refund");
    });
  }
});

describe("signed in, refunding: layout", () => {
  it("title, intro, and the fields in UI UX's order", () => {
    const { root } = mount({ signedIn: true });
    const sec = $<HTMLElement>(root, `details#${REFUND_SIGN_ANCHOR}`);
    expect(sec.querySelector("summary")?.textContent).toBe("Sent without signing in? Refund by signing a message");
    expect(sec.querySelector(".refund-sign-intro")?.textContent).toBe(REFUND_SIGN_COPY.intro);
    expect([...sec.querySelectorAll("label")].map((l) => l.textContent)).toEqual([
      "Funding txid",
      "vout",
      "Message to sign",
      "Address you sent from",
      "Signature",
      "Refund to",
    ]);
    expect([...sec.querySelectorAll("input, textarea")].map((e) => e.id)).toEqual([
      "refund-sign-txid",
      "refund-sign-vout",
      "refund-sign-message",
      "refund-sign-from",
      "refund-sign-signature",
      "refund-sign-to",
    ]);
    for (const label of sec.querySelectorAll("label")) {
      expect(sec.querySelector(`#${label.getAttribute("for")}`)).toBeTruthy();
    }
    expect(sec.querySelector("#refund-sign-signature-hint")?.textContent).toBe(
      "Paste the signature your wallet shows after signing.",
    );
    expect(sec.querySelector("#refund-sign-submit")?.textContent).toBe("Register refund");
  });

  it("the message shows only once txid and vout are valid, then is exact and read-only", () => {
    const { root } = mount({ signedIn: true });
    const block = $<HTMLElement>(root, "#refund-sign-message-block");
    const m = $<HTMLTextAreaElement>(root, "#refund-sign-message");
    expect(m.readOnly).toBe(true);
    expect(block.hidden).toBe(true);
    fillOutpoint(root, "4f".repeat(31), "1");
    expect(block.hidden).toBe(true);
    for (const vout of ["", "-1", "1.5", "x"]) {
      fillOutpoint(root, FIXTURE.txid, vout);
      expect(block.hidden).toBe(true);
    }
    fillOutpoint(root);
    expect(block.hidden).toBe(false);
    expect(m.value).toBe(FIXTURE.message);
    fillOutpoint(root, FIXTURE.txid.toUpperCase(), "7");
    expect(m.value).toBe(FIXTURE.message.replace(":1|", ":7|"));
    fillOutpoint(root, "", "7");
    expect(block.hidden).toBe(true);
  });

  it("the message names the signed-in account", () => {
    const { root } = mount({ signedIn: true, userId: "github:10" });
    fillOutpoint(root);
    expect($<HTMLTextAreaElement>(root, "#refund-sign-message").value).toBe(
      FIXTURE.message.replace("usr_fixture_01", "github:10"),
    );
  });
});

describe("prefill from the refund panel", () => {
  it("prefills txid and vout when the panel has them, and shows the message", () => {
    const { root } = mount({ signedIn: true, panelTxid: FIXTURE.txid, panelVout: "1" });
    expect($<HTMLInputElement>(root, "#refund-sign-txid").value).toBe(FIXTURE.txid);
    expect($<HTMLInputElement>(root, "#refund-sign-vout").value).toBe("1");
    expect($<HTMLElement>(root, "#refund-sign-message-block").hidden).toBe(false);
    expect($<HTMLTextAreaElement>(root, "#refund-sign-message").value).toBe(FIXTURE.message);
  });

  it("leaves txid empty when the panel has none", () => {
    const { root } = mount({ signedIn: true, panelTxid: "" });
    expect($<HTMLInputElement>(root, "#refund-sign-txid").value).toBe("");
    expect($<HTMLElement>(root, "#refund-sign-message-block").hidden).toBe(true);
  });

  it("follows later panel edits until the donor types here", () => {
    const { root } = mount({ signedIn: true });
    type($<HTMLInputElement>(root, "#refund-txid"), FIXTURE.txid);
    type($<HTMLInputElement>(root, "#refund-vout"), "1");
    expect($<HTMLInputElement>(root, "#refund-sign-txid").value).toBe(FIXTURE.txid);
    expect($<HTMLTextAreaElement>(root, "#refund-sign-message").value).toBe(FIXTURE.message);
    type($<HTMLInputElement>(root, "#refund-sign-txid"), "ab".repeat(32));
    type($<HTMLInputElement>(root, "#refund-txid"), "cd".repeat(32));
    expect($<HTMLInputElement>(root, "#refund-sign-txid").value).toBe("ab".repeat(32));
  });

  it("opening the disclosure picks up the panel's values", () => {
    const { root } = mount({ signedIn: true });
    $<HTMLInputElement>(root, "#refund-txid").value = FIXTURE.txid;
    $<HTMLInputElement>(root, "#refund-vout").value = "1";
    const d = $<HTMLDetailsElement>(root, "#signed-refund");
    d.open = true;
    d.dispatchEvent(new Event("toggle"));
    expect($<HTMLInputElement>(root, "#refund-sign-txid").value).toBe(FIXTURE.txid);
  });
});

describe("message changes after a signature is entered", () => {
  for (const [label, change] of [
    ["vout edited", (root: HTMLElement) => type($<HTMLInputElement>(root, "#refund-sign-vout"), "2")],
    ["txid edited", (root: HTMLElement) => type($<HTMLInputElement>(root, "#refund-sign-txid"), "ab".repeat(32))],
    ["panel prefill changed", (root: HTMLElement) => type($<HTMLInputElement>(root, "#refund-vout"), "3")],
  ] as const) {
    it(`${label}: clears the signature and says "The message changed. Sign the new message."`, () => {
      const { root } = mount({ signedIn: true, panelTxid: FIXTURE.txid, panelVout: "1" });
      const sig = $<HTMLTextAreaElement>(root, "#refund-sign-signature");
      type(sig, FIXTURE.signature);
      change(root);
      expect(sig.value).toBe("");
      expect(inlineErrors(root)).toEqual({
        "refund-sign-signature-error": "The message changed. Sign the new message.",
      });
      type(sig, FIXTURE.signature);
      expect(inlineErrors(root)).toEqual({});
    });
  }

  it("no signature yet: nothing to clear, no notice", () => {
    const { root } = mount({ signedIn: true, panelTxid: FIXTURE.txid, panelVout: "1" });
    type($<HTMLInputElement>(root, "#refund-sign-vout"), "2");
    expect(inlineErrors(root)).toEqual({});
  });

  it("same message (e.g. retyping the same vout): signature kept", () => {
    const { root } = mount({ signedIn: true, panelTxid: FIXTURE.txid, panelVout: "1" });
    const sig = $<HTMLTextAreaElement>(root, "#refund-sign-signature");
    type(sig, FIXTURE.signature);
    type($<HTMLInputElement>(root, "#refund-sign-vout"), " 1");
    expect(sig.value).toBe(FIXTURE.signature);
  });
});

describe("empty fields: inline errors, focus on the first empty one", () => {
  it("all empty: four lines, focus the txid", async () => {
    const { root } = mount({ signedIn: true });
    type($<HTMLInputElement>(root, "#refund-sign-vout"), "");
    expect(await submit(root)).toBe("");
    expect(inlineErrors(root)).toEqual({
      "refund-sign-outpoint-error": "Enter the funding txid and vout.",
      "refund-sign-from-error": "Enter the address you sent from.",
      "refund-sign-signature-error": "Paste the signature from your wallet.",
      "refund-sign-to-error": "Enter a refund address.",
    });
    expect(document.activeElement?.id).toBe("refund-sign-txid");
    expect(fetchCalls).toHaveLength(0);
  });

  it("txid set, vout empty: focus the vout", async () => {
    const { root } = mount({ signedIn: true });
    fillAll(root);
    $<HTMLInputElement>(root, "#refund-sign-vout").value = "";
    await submit(root);
    expect(inlineErrors(root)).toEqual({ "refund-sign-outpoint-error": "Enter the funding txid and vout." });
    expect(document.activeElement?.id).toBe("refund-sign-vout");
  });

  for (const [field, id, errId, text] of [
    ["address", "refund-sign-from", "refund-sign-from-error", "Enter the address you sent from."],
    ["signature", "refund-sign-signature", "refund-sign-signature-error", "Paste the signature from your wallet."],
    ["refund address", "refund-sign-to", "refund-sign-to-error", "Enter a refund address."],
  ] as const) {
    it(`only the ${field} empty: its line, focus it, nothing sent`, async () => {
      const { root } = mount({ signedIn: true });
      fillAll(root);
      $<HTMLInputElement>(root, `#${id}`).value = "";
      await submit(root);
      expect(inlineErrors(root)).toEqual({ [errId]: text });
      expect(document.activeElement?.id).toBe(id);
      expect(fetchCalls).toHaveLength(0);
    });
  }

  it("signature and refund address empty: both lines, focus the signature", async () => {
    const { root } = mount({ signedIn: true });
    fillAll(root, "");
    $<HTMLInputElement>(root, "#refund-sign-to").value = "";
    await submit(root);
    expect(Object.keys(inlineErrors(root))).toEqual(["refund-sign-signature-error", "refund-sign-to-error"]);
    expect(document.activeElement?.id).toBe("refund-sign-signature");
  });
});

describe("validation and sending", () => {
  it("validates the sending address on input: P2WSH tb1q, taproot and mainnet are refused", () => {
    const { root } = mount({ signedIn: true });
    const from = $<HTMLInputElement>(root, "#refund-sign-from");
    const err = $<HTMLElement>(root, "#refund-sign-from-error");
    for (const bad of [P2WSH_TB, P2TR_TB, P2WPKH_BC, "hello"]) {
      type(from, bad);
      expect(err.hidden).toBe(false);
      expect(err.textContent).toBe("This address type can't sign a refund message.");
    }
    type(from, FIXTURE.address);
    expect(err.hidden).toBe(true);
  });

  it("a P2WSH sending address is not sent; its line shows and it gets focus", async () => {
    const { root } = mount({ signedIn: true });
    fillAll(root);
    type($<HTMLInputElement>(root, "#refund-sign-from"), P2WSH_TB);
    await submit(root);
    expect(inlineErrors(root)).toEqual({ "refund-sign-from-error": "This address type can't sign a refund message." });
    expect(document.activeElement?.id).toBe("refund-sign-from");
    expect(fetchCalls).toHaveLength(0);
  });

  it("Copy writes the exact message and shows Copied.; a new message hides it", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    const { root } = mount({ signedIn: true });
    fillOutpoint(root);
    const copied = $<HTMLElement>(root, "#refund-sign-copied");
    expect(copied.hidden).toBe(true);
    $<HTMLButtonElement>(root, "#refund-sign-copy").click();
    await new Promise((r) => setTimeout(r, 0));
    expect(writeText).toHaveBeenCalledWith(FIXTURE.message);
    expect(copied.hidden).toBe(false);
    expect(copied.textContent).toBe("Copied.");
    fillOutpoint(root, FIXTURE.txid, "2");
    expect(copied.hidden).toBe(true);
  });

  it("a failed copy shows no Copied.", async () => {
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: { writeText: vi.fn(async () => Promise.reject(new Error("denied"))) },
    });
    const { root } = mount({ signedIn: true });
    fillOutpoint(root);
    $<HTMLButtonElement>(root, "#refund-sign-copy").click();
    await new Promise((r) => setTimeout(r, 0));
    expect($<HTMLElement>(root, "#refund-sign-copied").hidden).toBe(true);
  });

  it("sends the fixture: outpoint (lowercased txid), refund address, vin_address and signature_b64", async () => {
    const { root, onRegistered } = mount({ signedIn: true });
    fillAll(root);
    type($<HTMLInputElement>(root, "#refund-sign-txid"), FIXTURE.txid.toUpperCase());
    type($<HTMLTextAreaElement>(root, "#refund-sign-signature"), FIXTURE.signature);
    const text = await submit(root);
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]!.url).toMatch(/\/refunds\/register$/);
    expect(fetchCalls[0]!.body).toEqual({
      proposal_id: FIXTURE.proposalId,
      txid: FIXTURE.txid,
      vout: FIXTURE.vout,
      refund_address: REFUND_TO,
      vin_address: FIXTURE.address,
      signature_b64: FIXTURE.signature,
    });
    expect(text).toBe("Refund address registered for this gift.");
    expect(onRegistered).toHaveBeenCalled();
  });

  for (const h of [27, 30, 31, 34, 39, 42]) {
    it(`header ${h} is sent`, async () => {
      const { root } = mount({ signedIn: true });
      fillAll(root, withHeader(FIXTURE.signature, h));
      await submit(root);
      expect(fetchCalls).toHaveLength(1);
    });
  }

  for (const [label, sig] of [
    ["header 35", withHeader(FIXTURE.signature, 35)],
    ["header 38", withHeader(FIXTURE.signature, 38)],
    ["header 43", withHeader(FIXTURE.signature, 43)],
    ["header 255", withHeader(FIXTURE.signature, 255)],
    ["header 0 (raw)", withHeader(FIXTURE.signature, 0)],
    ["64 bytes", withHeader(FIXTURE.signature, 31, 64)],
    ["BIP-322-sized", withHeader(FIXTURE.signature, 2, 107)],
    ["not base64", "%%%"],
  ] as const) {
    it(`${label}: unsupported-format line under the signature, focus, nothing sent`, async () => {
      const { root } = mount({ signedIn: true });
      fillAll(root, sig);
      await submit(root);
      expect(inlineErrors(root)).toEqual({
        "refund-sign-signature-error":
          "This wallet's signature format isn't supported yet. Electrum and Sparrow can sign this message.",
      });
      expect(document.activeElement?.id).toBe("refund-sign-signature");
      expect(fetchCalls).toHaveLength(0);
    });
  }

  it("a refund address on the other network is not sent", async () => {
    const { root } = mount({ signedIn: true });
    fillAll(root);
    type($<HTMLInputElement>(root, "#refund-sign-to"), P2WPKH_BC);
    const err = $<HTMLElement>(root, "#refund-sign-to-error");
    expect(err.hidden).toBe(false);
    expect(err.textContent).toMatch(/mainnet/);
    await submit(root);
    expect(document.activeElement?.id).toBe("refund-sign-to");
    expect(fetchCalls).toHaveLength(0);
  });

  for (const [label, status, body, expected] of [
    [
      "bad signature",
      403,
      { error: "invalid refund signature", code: "refund_bind_required", note: "SERVER NOTE A" },
      "That signature doesn't match this address and message. Sign the exact message above with the address you sent from.",
    ],
    [
      "not a funding input",
      403,
      { error: "vin_address is not a funding input", code: "refund_bind_required", note: "SERVER NOTE B" },
      "That address didn't send this gift.",
    ],
    ["other 403", 403, { error: "not your contribution", note: "SERVER NOTE C" }, REFUND_SIGN_COPY.failed],
    ["502", 502, { error: "could not load funding transaction", code: "refund_bind_required" }, REFUND_SIGN_COPY.failed],
    ["500 html", 500, "<html>oops</html>", REFUND_SIGN_COPY.failed],
  ] as const) {
    it(`${label}: mapped copy, no server text on the page`, async () => {
      reply = { status, body };
      const { root } = mount({ signedIn: true });
      fillAll(root);
      expect(await submit(root)).toBe(expected);
      const page = document.body.textContent || "";
      for (const server of [
        "SERVER NOTE",
        "not your contribution",
        "could not load",
        "oops",
        "invalid refund signature",
        "funding input",
      ]) {
        expect(page).not.toContain(server);
      }
    });
  }

  it("package_error: the generic line (not the note), and the status list refreshes", async () => {
    reply = { status: 502, body: { package_error: true, note: "SERVER PACKAGE NOTE" } };
    const { root, onRegistered } = mount({ signedIn: true });
    fillAll(root);
    expect(await submit(root)).toBe("Couldn't register this refund. Try again in a few minutes.");
    expect(document.body.textContent).not.toContain("SERVER PACKAGE NOTE");
    expect(onRegistered).toHaveBeenCalled();
  });

  it("network failure: the generic line", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("offline"))));
    const { root } = mount({ signedIn: true });
    fillAll(root);
    expect(await submit(root)).toBe("Couldn't register this refund. Try again in a few minutes.");
  });
});

// ---------------------------------------------------------------------------
// Real page: refundRegisterHtml + bindRefundAndBallot.

describe("proposal page", () => {
  const USER = { id: FIXTURE.userId, username: "donor" } as unknown as AuthUser;

  function proposal(status: string): Proposal {
    return {
      id: FIXTURE.proposalId,
      path: "proposals/listed/PLEBLY-2026-001.md",
      title: "Refund page",
      status,
      proposal_type: "bounty",
      tags: [],
      target_sats: 1_500_000,
      escrow_address: REFUND_TO,
      escrow_index: null,
      submission_fee_txid: "ab".repeat(32),
      created_at: "2026-10-01T00:00:00Z",
      milestones: [],
      balance_sats: 0,
      endowment_funded: false,
      body: "## Summary\n\nBody.",
    } as unknown as Proposal;
  }

  beforeAll(async () => {
    await import("./proposal-page");
  }, 30_000);

  async function paint(status: string, user: AuthUser | null): Promise<HTMLElement> {
    vi.resetModules();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
    document.body.innerHTML = `<div id="app"></div>`;
    const { renderProposalPage } = await import("./proposal-page");
    void renderProposalPage(proposal(status).path, (inner) => inner, user, () => undefined, proposal(status));
    const app = document.querySelector<HTMLElement>("#app")!;
    await vi.waitFor(
      () => {
        if (!app.querySelector(".proposal-onchain")) throw new Error(`not painted: ${app.textContent?.slice(0, 200)}`);
      },
      { timeout: 5000 },
    );
    await vi.waitFor(
      () => {
        if (status === "refunding" && !app.querySelector("#refund-register-form")) throw new Error("no refund form");
      },
      { timeout: 5000 },
    );
    await new Promise((r) => setTimeout(r, 50));
    return app;
  }

  it("refunding + signed in: the disclosure sits under the refund panel and prefills from it", async () => {
    const app = await paint("refunding", USER);
    const sec = app.querySelector<HTMLElement>("#signed-refund")!;
    expect(sec).toBeTruthy();
    expect(sec.closest("#refund-panel")).toBeNull();
    expect(app.querySelector("#refund-panel")!.nextElementSibling).toBe(sec);
    await vi.waitFor(() => {
      type(app.querySelector<HTMLInputElement>("#refund-txid")!, FIXTURE.txid);
      type(app.querySelector<HTMLInputElement>("#refund-vout")!, "1");
      if (app.querySelector<HTMLTextAreaElement>("#refund-sign-message")!.value !== FIXTURE.message) {
        throw new Error("not bound");
      }
    });
    expect(app.querySelector<HTMLInputElement>("#refund-sign-txid")!.value).toBe(FIXTURE.txid);
  });

  it("refunding + signed out: only the sign-in line", async () => {
    const app = await paint("refunding", null);
    const sec = app.querySelector<HTMLElement>(`#${REFUND_SIGN_ANCHOR}`)!;
    expect(sec.querySelector("#refund-sign-signedout")?.textContent).toBe("Sign in to get the message to sign.");
    expect(sec.querySelectorAll("input, textarea").length).toBe(0);
  });

  it("not refunding: no disclosure", async () => {
    const app = await paint("listed", USER);
    expect(app.querySelector(`#${REFUND_SIGN_ANCHOR}`)).toBeNull();
    expect(app.textContent).not.toContain("Refund by signing a message");
  });
});
