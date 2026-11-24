import { expect, test } from "@playwright/test";

// Approved screenshots are committed baselines. A change that moves pixels fails until someone
// accepts the new image on purpose with `pnpm visual:update` in the same change.
const screens = [
  { name: "home", path: "/" },
  { name: "gallery", path: "/dev/gallery" },
];

for (const s of screens) {
  test(`${s.name} matches its baseline`, async ({ page }) => {
    await page.goto(s.path);
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot(`${s.name}.png`, { fullPage: true });
  });
}
