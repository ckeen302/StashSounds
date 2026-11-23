import { expect, test } from "@playwright/test";
import { componentSections, sectionSelector } from "../gallery-sections";

// The gallery is where components are reviewed before any screen uses them (playbook: the design
// loop). These checks fail when a section or one of its states goes missing, which the screenshots
// alone cannot prove.

test.beforeEach(async ({ page }) => {
  await page.goto("/dev/gallery");
});

test("every component section is on the gallery, in order", async ({ page }) => {
  const ids = await page.locator('section[aria-labelledby^="c-"]').evaluateAll((els) => els.map((e) => e.getAttribute("aria-labelledby")));
  expect(ids).toEqual(componentSections.map((s) => s.id));
});

for (const s of componentSections) {
  test(`${s.name} shows every state the design spec lists`, async ({ page }) => {
    const section = page.locator(sectionSelector(s.id));
    await expect(section.getByRole("heading", { level: 2 })).toHaveText(s.name);
    const captions = (await section.locator("figcaption").allTextContents()).join(" | ").toLowerCase();
    for (const state of s.states) expect(captions, `${s.id} caption for "${state}"`).toContain(state);
  });
}

test("frozen states carry the attributes that draw them", async ({ page }) => {
  const section = (id: string) => page.locator(sectionSelector(id));
  for (const id of ["c-button", "c-icon-button"]) {
    await expect(section(id).locator("button[data-hover]").first()).toBeVisible();
    await expect(section(id).locator("button[data-focus]").first()).toBeVisible();
    await expect(section(id).locator("button[data-active]").first()).toBeVisible();
    await expect(section(id).locator("button[disabled]").first()).toBeVisible();
  }
  await expect(section("c-button").locator('button[aria-busy="true"]')).toHaveCount(4);
  await expect(section("c-icon-button").locator('button[aria-pressed="true"]')).toHaveCount(2);
  for (const state of ["paused", "loading", "playing", "error"]) {
    await expect(section("c-play").locator(`[data-play-state="${state}"]`).first()).toBeVisible();
  }
  await expect(section("c-input").locator('input[aria-invalid="true"]')).toHaveCount(1);
  await expect(section("c-input").locator("input[disabled]")).toHaveCount(1);
  await expect(section("c-tabs").locator('[role="tab"][data-hover]')).toHaveCount(1);
  await expect(section("c-tabs").locator('[role="tab"][data-focus]')).toHaveCount(1);
  await expect(section("c-tabs").locator('[role="tab"][disabled]')).toHaveCount(1);
  await expect(section("c-menu").locator("[data-highlighted]")).toHaveCount(2);
  await expect(section("c-menu").locator("[data-disabled]").first()).toBeVisible();
  const rows = section("c-row").getByRole("list", { name: "Row states" });
  await expect(rows.locator("li[data-hover]")).toHaveCount(1);
  await expect(rows.locator("li[data-selected]")).toHaveCount(1);
  await expect(rows.locator("li[data-playing]")).toHaveCount(1);
  await expect(rows.locator('[data-play-state="loading"]')).toHaveCount(1);
  await expect(rows.locator('[data-play-state="error"]')).toHaveCount(1);
  await expect(section("c-row").getByRole("status", { name: "Loading sounds" })).toBeVisible();
  // Every specimen but "ready, done" has a current step: active, failed or flagged.
  await expect(section("c-steps").locator('[aria-current="step"]')).toHaveCount(5);
  await expect(section("c-wave").getByRole("img", { name: /loading/i })).toHaveCount(2);
  await expect(section("c-wave").getByRole("img", { name: /unavailable/i })).toHaveCount(2);
});
