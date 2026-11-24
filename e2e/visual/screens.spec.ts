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

/**
 * The frame, region by region (ticket 132): the rail on tablet and desktop (and collapsed on
 * desktop), the top bar, the idle player, and the phone tab bar. The player's other states are the
 * gallery's c-player section, which draws the same component at each width.
 */
test.describe("shell", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);
  });

  test("regions match their baselines", async ({ page }, info) => {
    const phone = info.project.name === "visual-phone";
    await expect(page.getByRole("banner")).toHaveScreenshot("shell-top-bar.png", exact);
    await expect(page.getByRole("region", { name: "Player", exact: true })).toHaveScreenshot("shell-player-idle.png", exact);
    if (phone) {
      await expect(page.getByRole("navigation", { name: "Tabs" })).toHaveScreenshot("shell-tab-bar.png", exact);
    } else {
      await expect(page.getByRole("navigation", { name: "Main" })).toHaveScreenshot("shell-rail.png", exact);
    }
  });

  test("the collapsed rail matches its baseline", async ({ page }, info) => {
    test.skip(info.project.name !== "visual-desktop", "The rail collapses on desktop only; tablet is always icons.");
    await page.getByRole("button", { name: "Collapse navigation" }).click();
    const rail = page.getByRole("navigation", { name: "Main" });
    await expect.poll(async () => (await rail.boundingBox())?.width).toBe(64);
    await expect(rail).toHaveScreenshot("shell-rail-collapsed.png", exact);
  });
});

test.describe("gallery", () => {
  for (const id of [...tokenSections, ...componentSections.map((s) => s.id)]) {
    test(`${id} matches its baseline`, async ({ page }) => {
      await page.goto("/dev/gallery");
      await page.evaluate(() => document.fonts.ready);
      const section = page.locator(sectionSelector(id));
      await expect(section).toBeVisible();
      // The page sits in the shell, where only the content area scrolls, so a section taller than
      // that area would be cut off. Grow the window until the section fits, then bring it into view.
      const chrome = await page.evaluate(() => window.innerHeight - document.getElementById("content")!.clientHeight);
      const height = Math.ceil((await section.boundingBox())!.height);
      const viewport = page.viewportSize()!;
      await page.setViewportSize({ width: viewport.width, height: Math.max(viewport.height, height + chrome + 48) });
      await section.evaluate((el) => el.scrollIntoView({ block: "center" }));
      // Canvas waveforms draw after hydration; wait until every canvas has its size.
      await page.waitForFunction(() => [...document.querySelectorAll("canvas")].every((c) => c.width > 0));
      await expect(section).toHaveScreenshot(`gallery-${id}.png`, exact);
    });
  }
});

/**
 * The loop item page (ticket 135), idle, at each width: the fixture loop served with no database
 * (STASH_DEV_PAGES=1, see e2e/journeys/loop-page.spec.ts). The window grows to fit the whole page,
 * since only the content area scrolls.
 */
test("the loop page matches its baseline", async ({ page }) => {
  await page.route("https://media.stash.local/**", (route) => route.fulfill({ status: 404 }));
  await page.goto("/loop/dusty-soul-chops-k3j9x0a2b1");
  await page.evaluate(() => document.fonts.ready);
  const main = page.getByRole("main");
  const chrome = await page.evaluate(() => window.innerHeight - document.getElementById("content")!.clientHeight);
  const viewport = page.viewportSize()!;
  await page.setViewportSize({ width: viewport.width, height: Math.ceil((await main.boundingBox())!.height) + chrome });
  await page.waitForFunction(() => [...document.querySelectorAll("canvas")].every((c) => c.width > 0));
  await expect(main).toHaveScreenshot("loop-page.png", exact);
});
