import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Phase 0 smoke. Ticket 190 adds the loop journey: sign up, upload, publish, search, play, like,
// follow, download. Every journey ends with the accessibility scan below.

async function expectNoSeriousA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

test("health route returns the contract shape", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.ok()).toBe(true);
  expect(await res.json()).toMatchObject({ ok: true });
});

test("home renders the wordmark", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("stash", { exact: true })).toBeVisible();
  await expectNoSeriousA11yViolations(page);
});

test("the gallery renders every token and is not indexed", async ({ page }) => {
  await page.goto("/dev/gallery");
  await expect(page.getByRole("heading", { name: "Gallery" })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  for (const token of ["accent", "type-loop", "type-kit", "border-strong"]) await expect(page.getByText(token, { exact: true })).toBeVisible();
  await expectNoSeriousA11yViolations(page);
});

test("pages refuse to be framed", async ({ request }) => {
  const res = await request.get("/");
  expect(res.headers()["x-frame-options"]).toBe("DENY");
});
