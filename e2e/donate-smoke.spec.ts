import { expect, test } from "@playwright/test";

/**
 * Smoke for Donate #15–#18: click Donate must sync-insert #donate-modal
 * on document.body (visible), even while /claims is still loading.
 *
 * Listing: PLEBLY-2026-001 → /p/plebly-2026-001
 * Env: PLEBLY_BASE_URL (default https://plebly.fund)
 */
const LISTING_PATH = "/p/plebly-2026-001";
const DONATE_BTN = "#donate-open, [data-open-donate]";
const DONATE_MODAL = "#donate-modal";
/** Slow claim-status / catalog must not flake this smoke. */
const BUTTON_WAIT_MS = 60_000;

test.describe("Donate modal smoke", () => {
  test("clicking Donate opens #donate-modal on document.body", async ({
    page,
  }) => {
    await page.goto(LISTING_PATH, { waitUntil: "domcontentloaded" });

    const donate = page.locator(DONATE_BTN).first();
    await donate.waitFor({ state: "visible", timeout: BUTTON_WAIT_MS });
    await donate.click();

    const modal = page.locator(DONATE_MODAL);
    await expect(modal).toBeAttached({ timeout: 10_000 });
    await expect(modal).toBeVisible({ timeout: 10_000 });

    const parentIsBody = await modal.evaluate(
      (el) => el.parentElement === document.body,
    );
    expect(
      parentIsBody,
      "#donate-modal should be a direct child of document.body (survives proposal re-renders)",
    ).toBe(true);
  });
});
