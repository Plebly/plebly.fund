import { afterEach, describe, expect, it } from "vitest";
import {
  endowmentBalanceView,
  ENDOWMENT_BALANCE_UNAVAILABLE,
  ENDOWMENT_SHARED_LINE,
} from "./endowment-balance";
import { endowmentStripHtml } from "./home-page";

const ADDR = "tb1qhj27cegpek02g8g4peps0x7gqs0svvs888svyz";
const own = {
  address: ADDR,
  configured: true,
  give_address_usable: true,
  balance_shared_with_escrow: false,
  balance_sats: 10_586,
  balance_unavailable: false,
  total_given_sats: 20_000,
  goal_sats: 0,
};
const legacy = { address: ADDR, configured: true, display_balance_sats: 148_106, goal_sats: 0 };

afterEach(() => {
  document.body.innerHTML = "";
});

describe("endowmentBalanceView", () => {
  it("missing balance_shared_with_escrow (current live API) is shared/unknown", () => {
    expect(endowmentBalanceView(legacy)).toEqual({ kind: "shared" });
    expect(endowmentBalanceView(null)).toEqual({ kind: "shared" });
  });

  it("own only when the flag is false, the give address usable and present", () => {
    expect(endowmentBalanceView(own)).toEqual({
      kind: "own",
      address: ADDR,
      balance_sats: 10_586,
      total_given_sats: 20_000,
      goal_sats: 0,
    });
    expect(endowmentBalanceView({ ...own, give_address_usable: false }).kind).toBe("shared");
    expect(endowmentBalanceView({ ...own, address: null }).kind).toBe("shared");
    expect(endowmentBalanceView({ ...own, address: "  " }).kind).toBe("shared");
    expect(endowmentBalanceView({ ...own, balance_shared_with_escrow: true }).kind).toBe("shared");
  });

  it("balance_unavailable or a bad number gives a null balance", () => {
    const a = endowmentBalanceView({ ...own, balance_unavailable: true });
    expect(a.kind === "own" && a.balance_sats).toBeNull();
    const b = endowmentBalanceView({ ...own, balance_sats: -5 });
    expect(b.kind === "own" && b.balance_sats).toBeNull();
  });
});

describe("home endowment strip", () => {
  it("current live API: shared line, no amount, no Donate", () => {
    document.body.innerHTML = endowmentStripHtml({
      configured: true,
      balance: endowmentBalanceView(legacy),
    });
    const t = document.body.textContent!;
    expect(t).toContain(ENDOWMENT_SHARED_LINE);
    expect(t).not.toContain("148,106");
    expect(document.body.querySelector(".endowment-meter")).toBeNull();
    expect(document.body.querySelector('a[href*="?donate"]')).toBeNull();
    expect(t).toContain("Funded projects");
  });

  it("own address: Balance, Total given to date and Donate", () => {
    document.body.innerHTML = endowmentStripHtml({
      configured: true,
      balance: endowmentBalanceView(own),
    });
    const t = document.body.textContent!.replace(/\s+/g, " ");
    expect(t).not.toContain(ENDOWMENT_SHARED_LINE);
    expect(t).toContain("Balance");
    expect(t).toContain("10,586 sats");
    expect(t).toContain("Total given to date");
    expect(t).toContain("20,000 sats");
    expect(document.body.querySelector('a[href*="?donate"]')).not.toBeNull();
  });

  it("own address, balance unavailable: the unavailable copy", () => {
    document.body.innerHTML = endowmentStripHtml({
      configured: true,
      balance: endowmentBalanceView({ ...own, balance_unavailable: true }),
    });
    expect(document.body.textContent).toContain("Balance temporarily unavailable");
    expect(document.body.textContent).not.toContain("10,586");
  });

  it("no teaser (fetch failed): no amount and no Donate", () => {
    document.body.innerHTML = endowmentStripHtml(null);
    expect(document.body.querySelector('a[href*="?donate"]')).toBeNull();
    expect(document.body.querySelector(".endowment-figures")).toBeNull();
  });
});

describe("copy", () => {
  it("unavailable copy ends with a period", () => {
    expect(ENDOWMENT_BALANCE_UNAVAILABLE).toBe("Balance temporarily unavailable.");
    document.body.innerHTML = endowmentStripHtml({
      configured: true,
      balance: endowmentBalanceView({ ...own, balance_unavailable: true }),
    });
    expect(document.body.querySelector(".endowment-balance-unavailable")!.textContent).toBe(
      "Balance temporarily unavailable.",
    );
  });
});
