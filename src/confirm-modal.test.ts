import { afterEach, describe, expect, it } from "vitest";
import { confirmAction, promptText } from "./confirm-modal";

describe("confirmAction", () => {
  afterEach(() => {
    document.querySelectorAll(".confirm-modal").forEach((el) => el.remove());
  });

  it("resolves true when confirm is clicked", async () => {
    const pending = confirmAction({
      title: "Delete comment",
      body: "Remove it?",
      confirmLabel: "Delete",
      danger: true,
    });
    const modal = document.querySelector(".confirm-modal");
    expect(modal).toBeTruthy();
    expect(modal?.textContent).toContain("Delete comment");
    document
      .querySelector<HTMLButtonElement>("[data-confirm-ok]")
      ?.click();
    await expect(pending).resolves.toBe(true);
    expect(document.querySelector(".confirm-modal")).toBeNull();
  });

  it("resolves false when cancel is clicked", async () => {
    const pending = confirmAction({
      title: "Hide comment",
      body: "Hide it?",
    });
    document
      .querySelectorAll<HTMLButtonElement>("[data-confirm-cancel]")[1]
      ?.click();
    await expect(pending).resolves.toBe(false);
  });
});

describe("promptText", () => {
  afterEach(() => {
    document.querySelectorAll(".confirm-modal").forEach((el) => el.remove());
  });

  it("resolves trimmed value on confirm", async () => {
    const pending = promptText({
      title: "Refund address",
      body: "Set address",
      defaultValue: "  tb1qabc  ",
    });
    document
      .querySelector<HTMLButtonElement>("[data-confirm-ok]")
      ?.click();
    await expect(pending).resolves.toBe("tb1qabc");
  });

  it("resolves null on cancel", async () => {
    const pending = promptText({
      title: "Refund address",
      body: "Set address",
    });
    document
      .querySelectorAll<HTMLButtonElement>("[data-confirm-cancel]")[1]
      ?.click();
    await expect(pending).resolves.toBeNull();
  });
});
