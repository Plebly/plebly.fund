import { describe, expect, it } from "vitest";
import {
  notificationTargetHref,
  notificationTypeLabel,
} from "./notify-labels";

describe("notificationTypeLabel", () => {
  it("flags missing refund address on bond_refundable", () => {
    expect(
      notificationTypeLabel("bond_refundable", { needs_address: true }),
    ).toContain("set refund address");
    expect(
      notificationTypeLabel("bond_refundable", {
        needs_refund_address: true,
      }),
    ).toContain("set refund address");
  });

  it("uses Funds copy when address already set", () => {
    expect(notificationTypeLabel("bond_refundable")).toContain("Funds");
  });

  it("uses payload window days for donor review", () => {
    expect(notificationTypeLabel("donor_review_opened")).toContain("7 days");
    expect(
      notificationTypeLabel("donor_review_opened", { window_days: 30 }),
    ).toContain("30 days");
  });
});

describe("notificationTargetHref", () => {
  it("sends bond refund notifications to Funds", () => {
    expect(
      notificationTargetHref({
        type: "bond_refundable",
        proposal_id: "abc",
      }),
    ).toMatch(/\/account\?tab=funds$/);
    expect(
      notificationTargetHref({
        type: "bond_refunded",
        proposal_path: "foo/bar",
      }),
    ).toMatch(/\/account\?tab=funds$/);
  });

  it("sends donation receipts to Account receipts", () => {
    expect(notificationTypeLabel("donation_receipt")).toBe("Donation receipt");
    expect(
      notificationTargetHref({
        type: "donation_receipt",
        proposal_id: "abc",
      }),
    ).toMatch(/\/account\?tab=receipts$/);
  });

  it("routes keyholder money notices to console / election tab", () => {
    expect(notificationTypeLabel("disburse_ready")).toMatch(/Monthly release/);
    expect(notificationTypeLabel("branch_ready")).toMatch(/Bounty branch/);
    expect(notificationTargetHref({ type: "disburse_ready" })).toMatch(
      /\/keyholders$/,
    );
    expect(notificationTargetHref({ type: "branch_ready" })).toMatch(
      /\/keyholders\?tab=branch$/,
    );
    expect(notificationTypeLabel("keyholder_application")).toMatch(/Keyholder/);
    expect(
      notificationTargetHref({ type: "keyholder_application" }),
    ).toMatch(/tab=keyholders/);
  });
});
