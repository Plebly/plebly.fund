import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  donationClaimActionHtml,
  donationIsClaimable,
  handleDonationClaimClick,
  parseDonationOutpoint,
} from "./donation-claim";
import type { PublicDonation } from "./donations-page";

const claimContribution = vi.fn();

vi.mock("./funder-credit", () => ({
  claimContribution: (...args: unknown[]) => claimContribution(...args),
  loadStoredCreditPreferences: () => ({
    public_credit: true,
    anonymous: false,
    show_amount: false,
  }),
}));

vi.mock("./router", () => ({
  href: (path: string) => path,
}));

function donation(
  overrides: Partial<PublicDonation> = {},
): PublicDonation {
  return {
    id: "9dc286ae1d77e6bcf7513b4808696596a71347b8434dec3b577cae8bd1a598e1:0",
    amount_sats: 1000,
    target_type: "project",
    target_id: "PLEBLY-2026-001",
    target_label: "Wave A",
    donated_at: "2026-09-20T00:00:00Z",
    anonymous: true,
    donor_display: null,
    claimable: true,
    ...overrides,
  };
}

describe("parseDonationOutpoint", () => {
  it("parses txid:vout ids", () => {
    expect(
      parseDonationOutpoint(
        "9dc286ae1d77e6bcf7513b4808696596a71347b8434dec3b577cae8bd1a598e1:0",
      ),
    ).toEqual({
      txid: "9dc286ae1d77e6bcf7513b4808696596a71347b8434dec3b577cae8bd1a598e1",
      vout: 0,
    });
  });

  it("rejects lightning and anon ids", () => {
    expect(parseDonationOutpoint("ln:swap123")).toBeNull();
    expect(parseDonationOutpoint("anon:t:1")).toBeNull();
  });
});

describe("donationIsClaimable", () => {
  it("is true for unlinked project outpoints", () => {
    expect(donationIsClaimable(donation())).toBe(true);
  });

  it("is false once linked / for endowment / non-outpoint", () => {
    expect(donationIsClaimable(donation({ claimable: false }))).toBe(false);
    expect(
      donationIsClaimable(
        donation({ target_type: "endowment", target_id: "endowment" }),
      ),
    ).toBe(false);
    expect(donationIsClaimable(donation({ id: "ln:abc", claimable: true }))).toBe(
      false,
    );
  });

  it("treats legacy anonymous rows without claimable as claimable", () => {
    expect(
      donationIsClaimable(
        donation({ claimable: undefined, anonymous: true, donor_display: null }),
      ),
    ).toBe(true);
  });
});

describe("donationClaimActionHtml", () => {
  it("shows Claim this donation when signed in", () => {
    const html = donationClaimActionHtml(donation(), { signedIn: true });
    expect(html).toContain("Claim this donation");
    expect(html).toContain('data-claim-donation=');
    expect(html).toContain('data-claim-proposal="PLEBLY-2026-001"');
  });

  it("prompts guests to sign in", () => {
    const html = donationClaimActionHtml(donation(), { signedIn: false });
    expect(html).toContain("Sign in");
    expect(html).not.toContain("data-claim-donation");
  });

  it("hides action when not claimable", () => {
    expect(
      donationClaimActionHtml(donation({ claimable: false }), { signedIn: true }),
    ).toBe("");
  });
});

describe("handleDonationClaimClick", () => {
  beforeEach(() => {
    claimContribution.mockReset();
    claimContribution.mockResolvedValue(undefined);
    document.body.innerHTML = "";
  });

  it("POSTs /contributions/claim for the row outpoint", async () => {
    document.body.innerHTML = `<li data-donation-id="x">
      ${donationClaimActionHtml(donation(), { signedIn: true })}
    </li>`;
    const btn = document.querySelector<HTMLButtonElement>("[data-claim-donation]")!;
    const ev = { target: btn } as unknown as Event;
    const ok = await handleDonationClaimClick(ev);
    expect(ok).toBe(true);
    expect(claimContribution).toHaveBeenCalledWith({
      proposal_id: "PLEBLY-2026-001",
      txid: "9dc286ae1d77e6bcf7513b4808696596a71347b8434dec3b577cae8bd1a598e1",
      vout: 0,
      public_credit: true,
      anonymous: false,
      show_amount: false,
    });
    expect(document.querySelector("[data-claim-donation]")).toBeNull();
    expect(document.querySelector(".donations-claim-msg")?.textContent).toMatch(
      /Credit linked/i,
    );
  });

  it("surfaces API errors without removing the button", async () => {
    claimContribution.mockRejectedValue(new Error("contribution already claimed by another user"));
    document.body.innerHTML = `<li>
      ${donationClaimActionHtml(donation(), { signedIn: true })}
    </li>`;
    const btn = document.querySelector<HTMLButtonElement>("[data-claim-donation]")!;
    await handleDonationClaimClick({ target: btn } as unknown as Event);
    expect(btn.disabled).toBe(false);
    expect(document.querySelector(".donations-claim-msg")?.textContent).toMatch(
      /already claimed/i,
    );
  });
});
