import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { sectionSelector } from "../gallery-sections";

// Keyboard and focus behaviour of the live gallery specimens (design spec, Accessibility: every
// action reachable without a mouse, in a visible and logical focus order). Selectors are scoped to
// the live specimen, since the frozen pictures repeat the same names.

const section = (page: Page, id: string) => page.locator(sectionSelector(id));
const live = (page: Page, id: string, name: string | RegExp = "live") => section(page, id).getByRole("figure", { name });
const focusedText = (page: Page) => page.evaluate(() => document.activeElement?.textContent ?? "");
const focusInside = (page: Page, selector: string) => page.evaluate((s) => Boolean(document.activeElement?.closest(s)), selector);

test.beforeEach(async ({ page }) => {
  await page.goto("/dev/gallery");
  await page.waitForLoadState("networkidle");
});

test("hero waveform seeks with arrows, Shift, Home and End", async ({ page }) => {
  const slider = live(page, "c-wave", /^hero, playing/).getByRole("slider");
  await slider.focus();
  await expect(slider).toHaveAttribute("aria-valuenow", "42");
  await page.keyboard.press("ArrowRight");
  await expect(slider).toHaveAttribute("aria-valuenow", "47");
  await page.keyboard.press("ArrowLeft");
  await expect(slider).toHaveAttribute("aria-valuenow", "42");
  await page.keyboard.press("Shift+ArrowRight");
  await expect(slider).toHaveAttribute("aria-valuenow", "62");
  await page.keyboard.press("End");
  await expect(slider).toHaveAttribute("aria-valuenow", "100");
  await page.keyboard.press("ArrowRight");
  await expect(slider).toHaveAttribute("aria-valuenow", "100");
  await page.keyboard.press("Home");
  await expect(slider).toHaveAttribute("aria-valuenow", "0");
  await expect(slider).toHaveAttribute("aria-valuetext", "0:00 of 0:06");
});

test("confirm dialog takes focus, keeps it, closes on Escape and returns it", async ({ page }) => {
  const trigger = live(page, "c-dialog").getByRole("button", { name: "Open confirm" });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Delete this loop?" });
  await expect(dialog).toBeVisible();
  expect(await focusInside(page, '[role="dialog"]')).toBe(true);
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Tab");
    expect(await focusInside(page, '[role="dialog"]')).toBe(true);
  }
  const axe = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("form dialog submits on Enter and cannot be closed while it saves", async ({ page }) => {
  const trigger = live(page, "c-dialog").getByRole("button", { name: "Open form" });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Edit title" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Title").press("Enter");
  const save = dialog.getByRole("button", { name: "Save" });
  await expect(save).toHaveAttribute("aria-busy", "true");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Close" })).toBeDisabled();
  // The gallery's save resolves after 1.2 s, then the dialog closes and focus goes home.
  await expect(dialog).toBeHidden({ timeout: 5000 });
  await expect(trigger).toBeFocused();
});

test("overflow menu opens from the keyboard, skips the disabled item, does not wrap", async ({ page }) => {
  const trigger = live(page, "c-menu", "live overflow").getByRole("button", { name: "More for Midnight keys" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem")).toHaveCount(5);
  await expect.poll(() => focusedText(page)).toContain("Add to queue");
  await page.keyboard.press("ArrowDown");
  await expect.poll(() => focusedText(page)).toContain("Copy link");
  await page.keyboard.press("ArrowDown");
  await expect.poll(() => focusedText(page)).toContain("Share");
  await page.keyboard.press("ArrowDown");
  await expect.poll(() => focusedText(page)).toContain("Report");
  await page.keyboard.press("ArrowDown");
  await expect.poll(() => focusedText(page)).toContain("Report");
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("tabs move with arrows, Home and End, skipping the disabled tab", async ({ page }) => {
  const tabs = section(page, "c-tabs");
  const tab = (name: RegExp) => tabs.getByRole("tab", { name });
  await tab(/^Loops/).click();
  await page.keyboard.press("ArrowRight");
  await expect(tab(/^One-shots/)).toBeFocused();
  await expect(tab(/^One-shots/)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("End");
  await expect(tab(/^MIDI/)).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(tab(/^Loops/)).toBeFocused();
  await page.keyboard.press("End");
  await page.keyboard.press("Home");
  await expect(tab(/^Loops/)).toBeFocused();
  await expect(tab(/^Presets/)).toBeDisabled();
});

test("tooltip opens on keyboard focus with its shortcut", async ({ page }) => {
  const like = live(page, "c-tooltip").getByRole("button", { name: "Like", exact: true });
  const copy = live(page, "c-tooltip").getByRole("button", { name: "Copy link", exact: true });
  await copy.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(like).toBeFocused();
  // The previous tooltip may still be fading out, so pick this one by its text.
  const tip = page.getByRole("tooltip").filter({ hasText: /^Like/ });
  await expect(tip).toHaveCount(1);
  await expect(tip).toHaveText(/Like\s*L/);
  await page.keyboard.press("Escape");
  await expect(tip).toHaveCount(0);
});

test("a toast with undo appears, announced in the notifications region", async ({ page }) => {
  await live(page, "c-toast").getByRole("button", { name: "With undo" }).click();
  const region = page.getByRole("region", { name: /Notifications/ });
  const toast = region.getByRole("listitem").filter({ hasText: "Removed from likes" });
  await expect(toast).toBeVisible();
  await expect(toast.getByRole("button", { name: "Undo" })).toBeVisible();
  await toast.getByRole("button", { name: "Dismiss" }).click();
  await expect(toast).toBeHidden();
});

test("a live row plays, likes and opens its context menu", async ({ page }) => {
  const rows = live(page, "c-row", /^live/);
  await rows.getByRole("button", { name: "Play Dusty soul chops" }).click();
  await expect(rows.getByRole("button", { name: "Pause Dusty soul chops" })).toBeVisible();
  const like = rows.getByRole("button", { name: "Like Trap bells in F sharp" });
  await like.focus();
  await page.keyboard.press("Enter");
  await expect(like).toHaveAttribute("aria-pressed", "true");
  await rows.getByRole("listitem").nth(1).click({ button: "right", position: { x: 600, y: 20 } });
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toBeHidden();
});
