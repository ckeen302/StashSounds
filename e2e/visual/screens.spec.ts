import { expect, test } from "@playwright/test";
import { componentSections, sectionSelector, tokenSections } from "../gallery-sections";

// Approved screenshots are committed baselines. A change that moves pixels fails until someone
// accepts the new image on purpose with `pnpm visual:update` in the same change.

test("home matches its baseline", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  await expect(page).toHaveScreenshot("home.png", { fullPage: true });
});

/**
 * The gallery, one screenshot per section. A single full-page image (about 10,000 px tall) let a
 * changed focus ring or a toast in the wrong tone pass under the shared 0.1 percent threshold, so
 * each section is compared on its own and with no pixel allowance: the pinned container renders
 * identically run to run, and any changed state is a changed baseline, accepted on purpose.
 */
const exact = { maxDiffPixels: 0, maxDiffPixelRatio: 0 };

test.describe("gallery", () => {
  for (const id of [...tokenSections, ...componentSections.map((s) => s.id)]) {
    test(`${id} matches its baseline`, async ({ page }) => {
      await page.goto("/dev/gallery");
      await page.evaluate(() => document.fonts.ready);
      const section = page.locator(sectionSelector(id));
      await expect(section).toBeVisible();
      // Canvas waveforms draw after hydration; wait until every canvas has its size.
      await page.waitForFunction(() => [...document.querySelectorAll("canvas")].every((c) => c.width > 0));
      await expect(section).toHaveScreenshot(`gallery-${id}.png`, exact);
    });
  }
});
