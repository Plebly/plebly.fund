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
    expect(fetchMock).toHaveBeenLastCalledWith("https://api.test/donations?limit=40&offset=0");
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
