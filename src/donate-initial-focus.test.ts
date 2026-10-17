import { afterEach, describe, expect, it } from "vitest";
import { donateModalHtml, focusDonateEntry, visibleDonateAmountInput } from "./proposal-ui";
import type { Proposal } from "./types";

const p = {
  id: "PLEBLY-2026-009",
  path: "proposals/listed/PLEBLY-2026-009.md",
  title: "P9",
  status: "listed",
  escrow_address: "tb1q3ujq9473rc9smza7djsm8snmaxv9ccqwzn447x98r97pyr2c6ljqawv6qx",
  escrow_shared: false,
} as Proposal;

function mount(signedIn = false): HTMLElement {
  document.body.innerHTML = `<button id="open">Donate</button>${donateModalHtml(p, { signedIn })}`;
  const modal = document.getElementById("donate-modal") as HTMLElement;
  modal.hidden = false;
  return modal;
}

function showPayStep(modal: HTMLElement): void {
  modal.querySelectorAll<HTMLElement>(".donate-step").forEach((el) => {
    el.hidden = el.dataset.donateStep !== "pay";
  });
}

describe("Donate modal initial focus", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("focuses the on-chain amount field, not Close, when the pay step is on screen", () => {
    const modal = mount();
    showPayStep(modal);
    focusDonateEntry(modal);
    expect(document.activeElement?.id).toBe("donate-amount");
  });

  it("focuses the Lightning amount when the Lightning rail is the one on screen", () => {
    const modal = mount();
    showPayStep(modal);
    modal.querySelector<HTMLElement>('[data-pane="onchain"]')!.hidden = true;
    modal.querySelector<HTMLElement>('[data-pane="lightning"]')!.hidden = false;
    // Lightning still checking availability: no amount field to type in yet.
    expect(visibleDonateAmountInput(modal)).toBeNull();
    modal.querySelector<HTMLElement>("#donate-ln-ready")!.hidden = false;
    expect(visibleDonateAmountInput(modal)?.id).toBe("donate-ln-amount");
    focusDonateEntry(modal);
    expect(document.activeElement?.id).toBe("donate-ln-amount");
  });

  it("falls back to Close while only the credit step is shown (no amount field yet)", () => {
    const modal = mount(true);
    expect(visibleDonateAmountInput(modal)).toBeNull();
    focusDonateEntry(modal);
    expect(document.activeElement?.id).toBe("donate-close");
  });
});
