import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return { ...actual, WORKERS_API: "https://api.test/" };
});

import {
  donationRowCopy,
  donationTargetHref,
  fetchPublicDonations,
  renderDonations,
  type PublicDonation,
} from "./donations-page";

const d = (over: Partial<PublicDonation> = {}): PublicDonation => ({
  id: "don-1",
  amount_sats: 12_345,
  target_type: "project",
  target_id: "PLEBLY-2026-003",
  target_label: "Relay hardening",
  donated_at: "2026-10-07T12:00:00Z",
  anonymous: false,
  donor_display: "alice",
  ...over,
});

const fetchMock = vi.fn();
/** Ledger fetches only (the page also reads /endowment for the endowment wording). */
const donationCalls = () =>
  fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => u.includes("/donations"));

const reply = (body: unknown, status = 200) =>
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }),
  );
const shell = (inner: string) => `<main data-shell>${inner}</main>`;
const app = () => document.querySelector<HTMLDivElement>("#app")!;

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  document.body.innerHTML = `<div id="app"></div>`;
  history.replaceState(null, "", "/donations");
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("donationRowCopy", () => {
  it("shows @handle (no double @), formatted sats and the target label", () => {
    expect(donationRowCopy(d())).toEqual({
      donor: "@alice",
      amount: "12,345 sats",
      target: "Relay hardening",
    });
    expect(donationRowCopy(d({ donor_display: "@bob" })).donor).toBe("@bob");
  });

  it("anonymous wins over a display name; a missing name is also Anonymous", () => {
    expect(donationRowCopy(d({ anonymous: true })).donor).toBe("Anonymous");
    expect(donationRowCopy(d({ donor_display: null })).donor).toBe("Anonymous");
    expect(donationRowCopy(d({ donor_display: "" })).donor).toBe("Anonymous");
  });

  it("falls back from label to id to 'a project'", () => {
    expect(donationRowCopy(d({ target_label: "" })).target).toBe("PLEBLY-2026-003");
    expect(donationRowCopy(d({ target_label: "", target_id: "" })).target).toBe("a project");
  });
});

describe("donationTargetHref", () => {
  it("endowment gifts link to /endowment; project gifts to the stable proposal path", () => {
    expect(donationTargetHref(d({ target_type: "endowment", target_id: "endowment" }))).toBe("/endowment");
    expect(donationTargetHref(d())).toBe("/p/plebly-2026-003");
  });
});

describe("fetchPublicDonations", () => {
  it("calls /donations on the API without a double slash, default page size 40", async () => {
    reply({ donations: [d()], total: 1 });
    const out = await fetchPublicDonations();
    expect(fetchMock).toHaveBeenCalledWith("https://api.test/donations?limit=40&offset=0");
    expect(out).toEqual({ donations: [d()], total: 1 });
  });

  it("normalises a malformed body: non-array donations and a bad total", async () => {
    reply({ donations: "nope", total: "-3" });
    expect(await fetchPublicDonations({ limit: 5, offset: 10 })).toEqual({ donations: [], total: 0 });
    expect(fetchMock).toHaveBeenCalledWith("https://api.test/donations?limit=5&offset=10");
    reply({ total: 7.9 });
    expect(await fetchPublicDonations()).toEqual({ donations: [], total: 7 });
  });

  it("throws with the status on a non-2xx response", async () => {
    reply({ error: "boom" }, 503);
    await expect(fetchPublicDonations()).rejects.toThrow("Could not load donations (503)");
  });
});

describe("renderDonations", () => {
  it("renders one row per donation with escaped donor, label and id", async () => {
    reply({
      donations: [
        d(),
        d({ id: 'x"><b>', donor_display: "<img src=x onerror=alert(1)>", target_label: "<script>t</script>" }),
      ],
      total: 2,
    });
    await renderDonations(shell);
    expect(app().querySelector("[data-shell]")).not.toBeNull();
    const rows = app().querySelectorAll(".donations-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent!.replace(/\s+/g, " ")).toContain("@alice donated 12,345 sats to Relay hardening");
    expect(app().querySelector("img")).toBeNull();
    expect(app().querySelector("script")).toBeNull();
    expect(app().querySelector("b")).toBeNull();
    expect(rows[1]!.getAttribute("data-donation-id")).toBe('x"><b>');
    expect(rows[1]!.querySelector(".donations-target")!.textContent).toBe("<script>t</script>");
    expect(app().querySelector(".lede")!.textContent).toContain("(2)");
    expect(app().querySelector(".donations-pager")).toBeNull();
  });

  it("shows the empty state when there are no donations", async () => {
    reply({ donations: [], total: 0 });
    await renderDonations(shell);
    expect(app().querySelector(".empty-state-title")!.textContent).toBe("No confirmed donations yet");
    expect(app().querySelector(".lede")!.textContent).not.toContain("(");
  });

  it("pages by 40: page 2 of 3 fetches offset 40 and links both ways", async () => {
    history.replaceState(null, "", "/donations?page=2");
    reply({ donations: [d()], total: 81 });
    await renderDonations(shell);
    expect(fetchMock).toHaveBeenCalledWith("https://api.test/donations?limit=40&offset=40");
    const pager = app().querySelector(".donations-pager")!;
    expect(pager.textContent).toContain("Page 2 of 3");
    const links = [...pager.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(links).toEqual([expect.stringMatching(/\/donations\?page=1$/), expect.stringMatching(/\/donations\?page=3$/)]);
  });

  it("first and last pages disable the edge link; a negative page clamps to 1", async () => {
    history.replaceState(null, "", "/donations?page=-4");
    reply({ donations: [d()], total: 41 });
    await renderDonations(shell);
    expect(donationCalls().at(-1)).toBe("https://api.test/donations?limit=40&offset=0");
    let pager = app().querySelector(".donations-pager")!;
    expect(pager.textContent).toContain("Page 1 of 2");
    expect([...pager.querySelectorAll("a")].map((a) => a.textContent)).toEqual(["Older →"]);

    history.replaceState(null, "", "/donations?page=2");
    reply({ donations: [d()], total: 41 });
    await renderDonations(shell);
    pager = app().querySelector(".donations-pager")!;
    expect([...pager.querySelectorAll("a")].map((a) => a.textContent)).toEqual(["← Newer"]);
  });

  it("shows a calm error (no stack, no status) when the ledger can't load", async () => {
    reply({ error: "down" }, 500);
    await renderDonations(shell);
    expect(app().textContent).toContain("Could not load the donations ledger right now.");
    expect(app().querySelector(".donations-list")).toBeNull();
    expect(app().textContent).not.toContain("500");
  });
});

describe("shared escrow and the endowment wording", () => {
  const SHARED_ROW = d({
    id: "s1",
    target_type: "shared_escrow",
    target_id: "shared-escrow",
    target_label: "Shared escrow (001–008)",
    anonymous: true,
  });
  const OWN = {
    address: "tb1qhj27cegpek02g8g4peps0x7gqs0svvs888svyz",
    configured: true,
    give_address_usable: true,
    balance_shared_with_escrow: false,
    balance_sats: 1,
    balance_unavailable: false,
    total_given_sats: 1,
    goal_sats: 0,
  };
  const LEGACY = { address: OWN.address, configured: true, display_balance_sats: 148_106, goal_sats: 0 };

  function route(donations: PublicDonation[], endowment: unknown, endowmentStatus = 200) {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("/donations")) {
        return new Response(JSON.stringify({ donations, total: donations.length }), { status: 200 });
      }
      if (String(url).endsWith("/endowment")) {
        return new Response(JSON.stringify(endowment), { status: endowmentStatus });
      }
      return new Response("not mocked", { status: 599 });
    });
  }
  const lede = () => app().querySelector(".lede")!.textContent;

  it("donationTargetHref: shared escrow and unknown types have no link", () => {
    expect(donationTargetHref(SHARED_ROW)).toBeNull();
    expect(donationTargetHref(d({ target_type: "other" as PublicDonation["target_type"] }))).toBeNull();
    expect(donationTargetHref(d({ target_type: "endowment", target_id: "endowment" }))).toBe("/endowment");
  });

  it.each([
    ["the current live API (no shared flag)", LEGACY, 200],
    ["balance_shared_with_escrow: true", { ...OWN, balance_shared_with_escrow: true, address: null, give_address_usable: false }, 200],
    ["give_address_usable: false", { ...OWN, give_address_usable: false }, 200],
    ["a failed /endowment read", { error: "down" }, 502],
  ])("%s: no endowment wording or link", async (_label, endowment, status) => {
    route([], endowment, status);
    await renderDonations(shell);
    expect(lede()).toBe("Confirmed gifts to projects.");
    expect(app().textContent).not.toContain("endowment");
    expect(app().querySelector('a[href$="/endowment"]')).toBeNull();
    expect(app().textContent).toContain("Fund a project.");
  });

  it.each([
    ["a network error", () => Promise.reject(new TypeError("Failed to fetch"))],
    ["a non-JSON body", async () => new Response("<html>oops</html>", { status: 200 })],
  ])("/endowment %s: no endowment wording or link", async (_label, endowmentReply) => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes("/donations")
        ? new Response(JSON.stringify({ donations: [], total: 0 }), { status: 200 })
        : endowmentReply(),
    );
    await renderDonations(shell);
    expect(lede()).toBe("Confirmed gifts to projects.");
    expect(app().querySelector('a[href$="/endowment"]')).toBeNull();
  });

  it("own address: the endowment wording and link come back", async () => {
    route([], OWN);
    await renderDonations(shell);
    expect(lede()).toBe("Confirmed gifts to projects and the endowment.");
    expect(app().querySelector('a[href$="/endowment"]')!.textContent).toBe("give to the endowment");
  });

  it("with rows: lede carries the total; a shared-escrow row is plain text, not /endowment", async () => {
    route([SHARED_ROW, d()], LEGACY);
    await renderDonations(shell);
    expect(lede()).toBe("Confirmed gifts to projects (2).");
    const rows = app().querySelectorAll(".donations-row");
    const target = rows[0]!.querySelector(".donations-target")!;
    expect(target.tagName).toBe("SPAN");
    expect(target.textContent).toBe("Shared escrow (001–008)");
    expect(app().querySelector('a[href$="/endowment"]')).toBeNull();
    expect(rows[1]!.querySelector("a.donations-target")).not.toBeNull();
  });

  it("own address with rows: lede names the endowment with the total", async () => {
    route([d()], OWN);
    await renderDonations(shell);
    expect(lede()).toBe("Confirmed gifts to projects and the endowment (1).");
  });
});
