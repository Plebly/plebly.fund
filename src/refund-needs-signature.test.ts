/**
 * Refund panel → "Refund by signing a message":
 * - `/refunds/register` answering `code: "refund_requires_signature"` shows the
 *   fixed line and opens the `#signed-refund` disclosure (fund#100);
 * - a `/refunds/status` row with `refund_needs_signature: true` never shows a
 *   registered state; it shows the fixed line, whose link opens the disclosure.
 * Other codes and unflagged rows are unchanged.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "./auth";
import {
  REFUND_REQUIRES_SIGNATURE,
  REFUND_SIGNATURE_COPY,
  SIGNED_REFUND_ANCHOR,
  openSignedRefund,
  rowNeedsSignature,
  signatureLineHtml,
} from "./refund-needs-signature";
import type { Proposal } from "./types";

const REGISTER_LINE =
  'Refunds for this gift need a signed message. Use "Refund by signing a message" below.';
const ROW_LINE =
  'This refund address needs a signed message before it can be paid. Use "Refund by signing a message" below.';
const TXID_A = "4f".repeat(32);
const TXID_B = "5a".repeat(32);
const REFUND_TO = "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx";

describe("copy and helpers", () => {
  it("lines are exact, the code and anchor are fixed", () => {
    expect(REFUND_SIGNATURE_COPY).toEqual({ registerNeedsSignature: REGISTER_LINE, rowNeedsSignature: ROW_LINE });
    expect(REFUND_REQUIRES_SIGNATURE).toBe("refund_requires_signature");
    expect(SIGNED_REFUND_ANCHOR).toBe("signed-refund");
  });

  it("the line's HTML reads exactly as the copy and links the quoted name to #signed-refund", () => {
    for (const line of [REGISTER_LINE, ROW_LINE]) {
      const el = document.createElement("p");
      el.innerHTML = signatureLineHtml(line);
      expect(el.textContent).toBe(line);
      const links = el.querySelectorAll("a");
      expect(links).toHaveLength(1);
      expect(links[0]!.getAttribute("href")).toBe("#signed-refund");
      expect(links[0]!.textContent).toBe("Refund by signing a message");
    }
  });

  it("only an explicit true flags a row", () => {
    expect(rowNeedsSignature({ refund_needs_signature: true })).toBe(true);
    for (const v of [false, "true", 1, null, undefined]) expect(rowNeedsSignature({ refund_needs_signature: v })).toBe(false);
  });

  it("openSignedRefund opens the disclosure; false when it isn't on the page", () => {
    document.body.innerHTML = `<details id="signed-refund"><summary>x</summary></details>`;
    expect(openSignedRefund(document)).toBe(true);
    expect(document.querySelector<HTMLDetailsElement>("#signed-refund")!.open).toBe(true);
    document.body.innerHTML = "";
    expect(openSignedRefund(document)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Real page: refunding proposal, signed in.

type StatusRow = {
  txid: string;
  vout: number;
  amount_sats: number;
  status: string;
  refund_address?: string | null;
  refund_needs_signature?: unknown;
};
type StatusBody = {
  linked: boolean;
  needs_address: number;
  registered: number;
  paid: number;
  contributions: StatusRow[];
};

let statusBody: StatusBody = { linked: false, needs_address: 0, registered: 0, paid: 0, contributions: [] };
let registerReply: { status: number; body: unknown } = { status: 200, body: { ok: true } };

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (/\/refunds\/status\//.test(url)) return Response.json(statusBody);
      if (/\/refunds\/register$/.test(url)) return Response.json(registerReply.body, { status: registerReply.status });
      return new Response("{}", { status: 404 });
    }),
  );
}

const USER = { id: "github:9", username: "donor" } as unknown as AuthUser;

function proposal(): Proposal {
  return {
    id: "PLEBLY-2026-001",
    path: "proposals/listed/PLEBLY-2026-001.md",
    title: "Refund page",
    status: "refunding",
    proposal_type: "bounty",
    tags: [],
    target_sats: 1_500_000,
    escrow_address: "tb1qhj27cegpek02g8g4peps0x7gqs0svvs888svyz",
    escrow_index: null,
    submission_fee_txid: "ab".repeat(32),
    created_at: "2026-10-01T00:00:00Z",
    milestones: [],
    balance_sats: 0,
    endowment_funded: false,
    body: "## Summary\n\nBody.",
  } as unknown as Proposal;
}

/** Paints the page; `withDisclosure` adds fund#100's `<details id="signed-refund">` under the panel. */
async function paint(withDisclosure = true): Promise<HTMLElement> {
  vi.resetModules();
  stubFetch();
  document.body.innerHTML = `<div id="app"></div>`;
  const { renderProposalPage } = await import("./proposal-page");
  const p = proposal();
  void renderProposalPage(p.path, (inner) => inner, USER, () => undefined, p);
  const app = document.querySelector<HTMLElement>("#app")!;
  await vi.waitFor(
    () => {
      if (!app.querySelector("#refund-panel")) throw new Error("no refund panel");
    },
    { timeout: 5000 },
  );
  if (withDisclosure) {
    app
      .querySelector("#refund-panel")!
      .insertAdjacentHTML(
        "afterend",
        `<details class="refund-sign" id="signed-refund"><summary>Sent without signing in? Refund by signing a message</summary></details>`,
      );
  }
  return app;
}

async function statusShown(app: HTMLElement): Promise<void> {
  await vi.waitFor(
    () => {
      if (app.querySelector<HTMLElement>("#refund-status")!.hidden) throw new Error("status not loaded");
    },
    { timeout: 5000 },
  );
}

async function register(app: HTMLElement): Promise<HTMLElement> {
  await vi.waitFor(
    () => {
      if (!app.querySelector("#refund-submit")) throw new Error("no submit");
    },
    { timeout: 5000 },
  );
  await new Promise((r) => setTimeout(r, 50));
  (app.querySelector("#refund-txid") as HTMLInputElement).value = TXID_A;
  (app.querySelector("#refund-vout") as HTMLInputElement).value = "1";
  (app.querySelector("#refund-address") as HTMLInputElement).value = REFUND_TO;
  app.querySelector<HTMLButtonElement>("#refund-submit")!.click();
  const msg = app.querySelector<HTMLElement>("#refund-msg")!;
  await vi.waitFor(() => {
    if (msg.hidden) throw new Error("no message yet");
  });
  return msg;
}

beforeAll(async () => {
  await import("./proposal-page");
}, 30_000);
beforeEach(() => {
  statusBody = { linked: false, needs_address: 0, registered: 0, paid: 0, contributions: [] };
  registerReply = { status: 200, body: { ok: true } };
  history.replaceState(null, "", "/p/PLEBLY-2026-001");
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("register answers refund_requires_signature", () => {
  it("shows the fixed line (no server text) and opens the disclosure", async () => {
    registerReply = {
      status: 403,
      body: { error: "refund_requires_signature", code: "refund_requires_signature", note: "SERVER NOTE" },
    };
    const app = await paint();
    const details = app.querySelector<HTMLDetailsElement>("#signed-refund")!;
    expect(details.open).toBe(false);
    const msg = await register(app);
    expect(msg.textContent).toBe(REGISTER_LINE);
    expect(msg.querySelector("a")?.getAttribute("href")).toBe("#signed-refund");
    expect(details.open).toBe(true);
    expect(app.textContent).not.toContain("SERVER NOTE");
  });

  it("with a signature error under that code: still the fixed line, never the error text", async () => {
    registerReply = {
      status: 403,
      body: { error: "invalid refund signature", code: "refund_requires_signature", note: "SERVER NOTE" },
    };
    const app = await paint();
    const msg = await register(app);
    expect(msg.textContent).toBe(REGISTER_LINE);
    expect(app.textContent).not.toContain("invalid refund signature");
  });

  it("before fund#100 (no disclosure on the page): the line still shows, nothing throws", async () => {
    registerReply = { status: 403, body: { code: "refund_requires_signature", note: "SERVER NOTE" } };
    const app = await paint(false);
    const msg = await register(app);
    expect(msg.textContent).toBe(REGISTER_LINE);
  });
});

describe("other register answers are unchanged", () => {
  for (const [label, body, shown] of [
    ["refund_bind_required", { error: "refund_bind_required", code: "refund_bind_required", note: "Bind note." }, "Bind note."],
    ["no code", { error: "not your contribution" }, "not your contribution"],
  ] as const) {
    it(`${label}: the panel's existing message, the disclosure stays closed`, async () => {
      registerReply = { status: 403, body };
      const app = await paint();
      const msg = await register(app);
      expect(msg.textContent).toBe(shown);
      expect(msg.textContent).not.toContain("signed message");
      expect(app.querySelector<HTMLDetailsElement>("#signed-refund")!.open).toBe(false);
    });
  }

  it("success is unchanged", async () => {
    const app = await paint();
    const msg = await register(app);
    expect(msg.textContent).toBe("Refund address registered — track under Account → Funds.");
  });
});

describe("refund status rows", () => {
  const flagged: StatusRow = {
    txid: TXID_A,
    vout: 1,
    amount_sats: 50_000,
    status: "registered",
    refund_address: REFUND_TO,
    refund_needs_signature: true,
  };
  const plain: StatusRow = { txid: TXID_B, vout: 0, amount_sats: 20_000, status: "registered", refund_address: REFUND_TO };

  it("a flagged row never shows the registered state: the line instead, no address, not counted", async () => {
    statusBody = { linked: true, needs_address: 0, registered: 1, paid: 0, contributions: [flagged] };
    const app = await paint();
    await statusShown(app);
    const li = app.querySelector<HTMLElement>("#refund-status-list li")!;
    expect(li.textContent).toBe(`${TXID_A.slice(0, 12)}…:1${ROW_LINE}`);
    expect(li.querySelector(".refund-needs-signature")?.textContent).toBe(ROW_LINE);
    expect(li.textContent).not.toContain("registered");
    expect(li.textContent).not.toContain(REFUND_TO.slice(0, 12));
    expect(app.querySelector("#refund-status-body")?.textContent).not.toMatch(/registered/);
    expect(app.querySelector<HTMLElement>("#refund-register-form")!.hidden).toBe(false);
  });

  it("the row's link opens the disclosure", async () => {
    statusBody = { linked: true, needs_address: 0, registered: 1, paid: 0, contributions: [flagged] };
    const app = await paint();
    await statusShown(app);
    const details = app.querySelector<HTMLDetailsElement>("#signed-refund")!;
    expect(details.open).toBe(false);
    const link = app.querySelector<HTMLAnchorElement>("#refund-status-list a[href='#signed-refund']")!;
    link.click();
    expect(details.open).toBe(true);
  });

  it("an unflagged row is unchanged", async () => {
    statusBody = { linked: true, needs_address: 0, registered: 1, paid: 0, contributions: [plain] };
    const app = await paint();
    await statusShown(app);
    const li = app.querySelector<HTMLElement>("#refund-status-list li")!;
    expect(li.textContent).toBe(`${TXID_B.slice(0, 12)}…:0 · registered · ${REFUND_TO.slice(0, 12)}…`);
    expect(li.textContent).not.toContain("signed message");
    expect(app.querySelector("#refund-status-body")?.textContent).toBe("1 registered.");
    expect(app.querySelector<HTMLElement>("#refund-register-form")!.hidden).toBe(true);
  });

  it("mixed: only the unflagged row counts as registered", async () => {
    statusBody = { linked: true, needs_address: 0, registered: 2, paid: 0, contributions: [flagged, plain] };
    const app = await paint();
    await statusShown(app);
    const items = [...app.querySelectorAll<HTMLElement>("#refund-status-list li")].map((l) => l.textContent);
    expect(items).toEqual([
      `${TXID_A.slice(0, 12)}…:1${ROW_LINE}`,
      `${TXID_B.slice(0, 12)}…:0 · registered · ${REFUND_TO.slice(0, 12)}…`,
    ]);
    expect(app.querySelector("#refund-status-body")?.textContent).toBe("1 registered.");
    expect(app.querySelector<HTMLElement>("#refund-register-form")!.hidden).toBe(false);
  });

  it('a non-true flag ("true", 1) is not flagged', async () => {
    statusBody = {
      linked: true,
      needs_address: 0,
      registered: 2,
      paid: 0,
      contributions: [
        { ...plain, refund_needs_signature: "true" },
        { ...plain, vout: 1, refund_needs_signature: 1 },
      ],
    };
    const app = await paint();
    await statusShown(app);
    expect(app.querySelector("#refund-status-list")?.textContent).not.toContain("signed message");
    expect(app.querySelector("#refund-status-body")?.textContent).toBe("2 registered.");
  });
});
