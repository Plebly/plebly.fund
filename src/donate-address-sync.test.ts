/**
 * Donate modal: one function moves the displayed address, copy target, QR and
 * bitcoin: (BIP21) link together (Review). Before: bindOnchainDonate closed
 * over the address it was first bound with, so after syncDonateModalEscrow
 * switched the modal to another address the QR, the wallet link (on any
 * amount change) and Copy kept the old one, and every re-open stacked another
 * set of listeners with its own address. No valid address → all hidden.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Proposal } from "./types";

const A = "tb1qf8agl2750ezeuwt7ys5ghzmul9wutls0cs9jyt";
const B = "tb1q3ujq9473rc9smza7djsm8snmaxv9ccqwzn447x98r97pyr2c6ljqawv6qx";
const C = "tb1qhj27cegpek02g8g4peps0x7gqs0svvs888svyz";

/** Every QR payload rendered, and per-call control over when it resolves. */
let qrPayloads: string[] = [];
let qrDelay: (uri: string) => number = () => 0;
let clipboard: string[] = [];

beforeEach(() => {
  vi.resetModules();
  qrPayloads = [];
  qrDelay = () => 0;
  clipboard = [];
  vi.doMock("qrcode", () => ({
    default: {
      toDataURL: vi.fn(async (uri: string) => {
        qrPayloads.push(uri);
        const ms = qrDelay(uri);
        if (ms) await new Promise((r) => setTimeout(r, ms));
        return `data:image/png;base64,${btoa(uri)}`;
      }),
    },
  }));
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn(async (t: string) => void clipboard.push(t)) },
  });
});
afterEach(() => {
  vi.doUnmock("qrcode");
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

function proposal(addr: string): Proposal {
  return {
    id: "PLEBLY-KNOTS-SIZE-VALUE-SPAM", path: "proposals/listed/PLEBLY-KNOTS-SIZE-VALUE-SPAM.md", title: "Knots",
    status: "listed", proposal_type: "bounty", target_sats: 1_500_000, escrow_address: addr,
    submission_fee_txid: null, escrow_index: null, milestones: [], body: "",
  } as unknown as Proposal;
}

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const qrUriOf = (img: HTMLImageElement) => {
  const src = img.getAttribute("src") || "";
  return src ? atob(src.replace("data:image/png;base64,", "")) : "";
};

async function mount(addr: string) {
  const ui = await import("./proposal-ui");
  document.body.innerHTML = ui.donateModalHtml(proposal(addr), { signedIn: false });
  await ui.bindDonatePanel(document, { address: addr, proposalId: "X", proposalPath: "proposals/listed/x.md", signedIn: false });
  return ui;
}

/** All four targets show exactly `addr` (QR once it has rendered). */
async function expectAllShow(addr: string, amountBtc?: string) {
  const uri = `bitcoin:${addr}${amountBtc ? `?amount=${amountBtc}` : ""}`;
  const code = $("#donate-address");
  expect(code.hidden).toBe(false);
  expect((code.textContent || "").replace(/\s/g, "")).toBe(addr);
  expect($("#donate-copy").hidden).toBe(false);
  expect($("#donate-copy").getAttribute("data-copy")).toBe(addr);
  const wallet = $<HTMLAnchorElement>("#donate-wallet");
  expect(wallet.hidden).toBe(false);
  expect(wallet.getAttribute("href")).toBe(uri);
  expect(document.querySelector("#donate-paused")).toBeNull();
  for (const el of pausedControls()) expect(isShown(el)).toBe(true);
  const qr = $<HTMLImageElement>("#donate-qr");
  await vi.waitFor(() => expect(qrUriOf(qr)).toBe(uri));
  expect(isShown(qr)).toBe(true);
  expect(document.querySelector("[data-qr-placeholder]")).toBeNull();
  // Unchunked, byte-exact URI: no whitespace, no markup.
  for (const u of [wallet.getAttribute("href")!, qrUriOf(qr)]) expect(u).not.toMatch(/\s|\u00a0|</);
}

function expectAllHidden() {
  const code = $("#donate-address");
  expect(code.hidden).toBe(true);
  expect(code.textContent).toBe("");
  expect(code.hasAttribute("title")).toBe(false);
  expect($("#donate-copy").hidden).toBe(true);
  expect($("#donate-copy").hasAttribute("data-copy")).toBe(false);
  const wallet = $<HTMLAnchorElement>("#donate-wallet");
  expect(wallet.hidden).toBe(true);
  expect(wallet.hasAttribute("href")).toBe(false);
  const qr = $<HTMLImageElement>("#donate-qr");
  expect(qr.hidden).toBe(true);
  expect(qr.hasAttribute("src")).toBe(false);
  expect(document.querySelector("[data-qr-placeholder]")).toBeNull();
  // The paused line sits where the address was; amount box and presets are gone.
  const paused = document.querySelector<HTMLElement>("#donate-paused");
  expect(paused?.textContent).toBe(PAUSED);
  expect(paused && isShown(paused)).toBe(true);
  expect(paused?.nextElementSibling).toBe(code);
  for (const el of pausedControls()) expect(isShown(el)).toBe(false);
  expect($(".donate-explorer-link").hidden).toBe(true);
  expect($(".donate-explorer-link").hasAttribute("href")).toBe(false);
}

const PAUSED = "Donations are paused for this proposal right now.";
/**
 * Visible within the on-chain pane: neither it nor an ancestor up to the pane
 * carries `hidden` (the modal / pay step are closed in these unit tests).
 */
function isShown(el: Element): boolean {
  for (let n: Element | null = el; n && !n.matches(".donate-pane-onchain"); n = n.parentElement) {
    if ((n as HTMLElement).hidden) return false;
  }
  return true;
}
/** Amount box, presets and the QR box: only shown with a payable address. */
function pausedControls(): HTMLElement[] {
  return [
    $("#donate-amount"),
    ...document.querySelectorAll<HTMLElement>('.donate-preset[data-rail="onchain"]'),
    $(".donate-pane-onchain .donate-qr-wrap"),
  ];
}

function typeAmount(sats: number) {
  const input = $<HTMLInputElement>("#donate-amount");
  input.value = String(sats);
  input.dispatchEvent(new Event("input"));
}

describe("address change moves all four together", () => {
  it("A → B: displayed address, copy target, wallet link and QR all become B", async () => {
    const ui = await mount(A);
    await expectAllShow(A);
    ui.syncDonateModalEscrow(B, document);
    await expectAllShow(B);
    expect(qrPayloads.at(-1)).toBe(`bitcoin:${B}`);
  });

  it("while the new address's QR renders, the old QR is not on screen", async () => {
    qrDelay = (uri) => (uri.includes(B) ? 60 : 0);
    const ui = await mount(A);
    await expectAllShow(A);
    ui.syncDonateModalEscrow(B, document);
    // B's QR is still rendering: the image must be empty, never A's code.
    const qr = $<HTMLImageElement>("#donate-qr");
    expect(qr.hasAttribute("src")).toBe(false);
    expect(qr.getAttribute("data-qr-address")).toBeNull();
    await expectAllShow(B);
  });

  it("an amount typed after the change uses the new address, never the bound one", async () => {
    const ui = await mount(A);
    ui.syncDonateModalEscrow(B, document);
    typeAmount(5_000);
    await expectAllShow(B, "0.00005");
    const after = qrPayloads.slice(qrPayloads.indexOf(`bitcoin:${B}`));
    expect(after.every((u) => u.includes(B))).toBe(true);
  });

  it("the amount survives an address change (C keeps ?amount=)", async () => {
    const ui = await mount(A);
    typeAmount(5_000);
    ui.syncDonateModalEscrow(C, document);
    await expectAllShow(C, "0.00005");
  });

  it("Copy copies the current address, not the bound one", async () => {
    const ui = await mount(A);
    ui.syncDonateModalEscrow(B, document);
    await vi.waitFor(() => {
      $("#donate-copy").click();
      expect(clipboard.length).toBeGreaterThan(0);
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(clipboard.every((c) => c === B)).toBe(true);
  });
});

describe("no valid address: everything hidden, nothing stale", () => {
  for (const [label, bad] of [
    ["empty", ""],
    ["whitespace", "   "],
    ["wrong network (mainnet on signet)", "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq"],
    ["not an address", "not-an-address"],
  ] as const) {
    it(`A → ${label}: address, copy, wallet, QR and explorer hidden and cleared`, async () => {
      const ui = await mount(A);
      await expectAllShow(A);
      ui.syncDonateModalEscrow(bad, document);
      expectAllHidden();
      // A late amount change can't bring the old address back.
      typeAmount(5_000);
      await new Promise((r) => setTimeout(r, 10));
      expectAllHidden();
      expect(document.body.innerHTML).not.toContain(A);
    });
  }

  it("hidden → valid again shows all four with the new address", async () => {
    const ui = await mount(A);
    ui.syncDonateModalEscrow("", document);
    ui.syncDonateModalEscrow(B, document);
    await expectAllShow(B);
  });

  it("a slow QR render for the old address never lands after the change", async () => {
    qrDelay = (uri) => (uri.includes(A) ? 60 : 0);
    const ui = await mount(A);
    ui.syncDonateModalEscrow(B, document);
    await expectAllShow(B);
    await new Promise((r) => setTimeout(r, 100));
    expect(qrUriOf($<HTMLImageElement>("#donate-qr"))).toBe(`bitcoin:${B}`);
  });

  it("a slow QR render never lands after the address was cleared", async () => {
    qrDelay = () => 60;
    const ui = await mount(A);
    ui.syncDonateModalEscrow("", document);
    await new Promise((r) => setTimeout(r, 100));
    expectAllHidden();
  });
});

describe("re-open (each Donate open re-binds the panel)", () => {
  it("re-open with a new address: no stale QR, wallet or copy, even after typing an amount", async () => {
    const ui = await mount(A);
    await expectAllShow(A);
    const modal = $("#donate-modal");
    modal.hidden = true; // closed
    // What open() does on the next click: bind again with the current address.
    await ui.bindDonatePanel(document, { address: B, proposalId: "X", proposalPath: "proposals/listed/x.md", signedIn: false });
    modal.hidden = false;
    await expectAllShow(B);
    qrPayloads = [];
    typeAmount(7_000);
    await expectAllShow(B, "0.00007");
    expect(qrPayloads.length).toBeGreaterThan(0);
    expect(qrPayloads.every((u) => u === `bitcoin:${B}?amount=0.00007`)).toBe(true);
  });

  it("re-open with the same address does not stack listeners (one QR render per amount change)", async () => {
    const ui = await mount(A);
    await ui.bindDonatePanel(document, { address: A, proposalId: "X", proposalPath: "proposals/listed/x.md", signedIn: false });
    await ui.bindDonatePanel(document, { address: A, proposalId: "X", proposalPath: "proposals/listed/x.md", signedIn: false });
    await expectAllShow(A);
    qrPayloads = [];
    typeAmount(1_000);
    await new Promise((r) => setTimeout(r, 20));
    expect(qrPayloads).toEqual([`bitcoin:${A}?amount=0.00001`]);
  });
});

describe("paused while the modal is open (UI UX)", () => {
  it("valid → invalid → valid: paused line and hidden controls, then line gone and controls back on the new address", async () => {
    const ui = await mount(A);
    await expectAllShow(A);
    expect(pausedControls().length).toBeGreaterThan(2); // amount, ≥1 preset, QR box
    ui.syncDonateModalEscrow("bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq", document);
    expectAllHidden();
    expect(document.querySelectorAll("#donate-paused")).toHaveLength(1);
    // Paused twice still shows one line.
    ui.syncDonateModalEscrow("", document);
    expect(document.querySelectorAll("#donate-paused")).toHaveLength(1);
    ui.syncDonateModalEscrow(B, document);
    await expectAllShow(B);
    typeAmount(2_000);
    await expectAllShow(B, "0.00002");
  });

  it("restores only what pausing hid (an already-hidden watch hint stays hidden)", async () => {
    const ui = await mount(A);
    await expectAllShow(A);
    $("#donate-watch-hint").hidden = true; // e.g. replaced by a confirm status
    ui.syncDonateModalEscrow("", document);
    ui.syncDonateModalEscrow(A, document);
    await expectAllShow(A);
    expect($("#donate-watch-hint").hidden).toBe(true);
  });
});

describe("QR placeholder while a new QR renders (UI UX nit)", () => {
  it("'Loading QR…' fills the QR box before the render and is replaced by the image after", async () => {
    qrDelay = (uri) => (uri.includes(B) ? 60 : 0);
    const ui = await mount(A);
    await expectAllShow(A);
    ui.syncDonateModalEscrow(B, document);
    const qr = $<HTMLImageElement>("#donate-qr");
    const ph = document.querySelector<HTMLElement>("[data-qr-placeholder]");
    expect(ph?.textContent).toBe("Loading QR…");
    expect(ph && isShown(ph)).toBe(true);
    expect(ph?.parentElement).toBe(qr.parentElement); // same box as the image
    expect(ph?.classList.contains("donate-qr-placeholder")).toBe(true);
    // No empty / broken <img> on screen meanwhile.
    expect(qr.hidden).toBe(true);
    expect(qr.hasAttribute("src")).toBe(false);
    await expectAllShow(B); // image shown, placeholder gone
  });

  it("first paint: placeholder until the first QR lands", async () => {
    qrDelay = () => 60;
    const ui = await import("./proposal-ui");
    document.body.innerHTML = ui.donateModalHtml(proposal(A), { signedIn: false });
    const bound = ui.bindDonatePanel(document, { address: A, proposalId: "X", proposalPath: "proposals/listed/x.md", signedIn: false });
    await vi.waitFor(() => expect(document.querySelector("[data-qr-placeholder]")?.textContent).toBe("Loading QR…"));
    expect($<HTMLImageElement>("#donate-qr").hidden).toBe(true);
    await bound;
    await expectAllShow(A);
  });

  it("same-address amount change keeps the current image (no placeholder flash)", async () => {
    const ui = await mount(A);
    await expectAllShow(A);
    qrDelay = () => 60;
    typeAmount(3_000);
    expect(document.querySelector("[data-qr-placeholder]")).toBeNull();
    expect(isShown($("#donate-qr"))).toBe(true);
    expect(qrUriOf($<HTMLImageElement>("#donate-qr"))).toBe(`bitcoin:${A}`);
    await expectAllShow(A, "0.00003");
    void ui;
  });
});
