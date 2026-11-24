import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Ticket 132: every screen sits in the shared frame, and the player bar keeps showing and
// controlling what the engine plays across client navigation. /dev/player lists the gallery's
// fixture loops through the real engine; their preview URLs are answered here with a fixture file.

const loop = readFileSync(join(import.meta.dirname, "../../fixtures/generated/loops/midnight_keys_140bpm_Am.wav"));

async function serveAudio(page: Page) {
  await page.route("https://media.stash.local/previews/**", (route) =>
    route.fulfill({ status: 200, body: loop, headers: { "content-type": "audio/wav", "access-control-allow-origin": "*" } }),
  );
  // Count audio contexts: the engine makes one for the session and never another.
  await page.addInitScript(() => {
    const w = window as unknown as { AudioContext: typeof AudioContext; __contexts: number };
    const Original = w.AudioContext;
    w.__contexts = 0;
    w.AudioContext = class extends Original {
      constructor(options?: AudioContextOptions) {
        super(options);
        w.__contexts++;
      }
    };
  });
}

const player = (page: Page) => page.getByRole("region", { name: "Player", exact: true });
const elapsed = (page: Page) => player(page).locator("[data-player-elapsed]").first();
const secondsOf = (t: string) => {
  const [m, s] = t.split(":").map(Number);
  return (m ?? 0) * 60 + (s ?? 0);
};

/** Waits until the bar's elapsed time passes `after` seconds, proving the audio clock moves. */
async function expectAdvancing(page: Page, after: number) {
  await expect.poll(async () => secondsOf((await elapsed(page).textContent()) ?? "0:00"), { timeout: 5000 }).toBeGreaterThan(after);
}

/** Waits until the elapsed time reads something other than `from`. The loop wraps, so "later" is not a safe test. */
async function expectChanging(page: Page, from: string) {
  await expect.poll(async () => elapsed(page).textContent(), { timeout: 5000 }).not.toBe(from);
}

/** Polls until two reads 300 ms apart agree, then returns that reading. */
async function stableElapsed(page: Page): Promise<string> {
  let last = await elapsed(page).textContent();
  await expect
    .poll(async () => {
      await page.waitForTimeout(300);
      const now = await elapsed(page).textContent();
      const same = now === last;
      last = now;
      return same;
    })
    .toBe(true);
  return last ?? "";
}

/**
 * Counts React commits through the hook React DevTools uses, which the production build also calls.
 * Position is read per frame, never set as state, so steady playback should commit almost nothing.
 */
async function countCommits(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __commits: number; __REACT_DEVTOOLS_GLOBAL_HOOK__?: unknown };
    w.__commits = 0;
    w.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      renderers: new Map(),
      supportsFiber: true,
      inject: () => 1,
      onScheduleFiberRoot: () => {},
      onCommitFiberRoot: () => {
        w.__commits++;
      },
      onCommitFiberUnmount: () => {},
      onPostCommitFiberRoot: () => {},
      checkDCE: () => {},
    };
  });
}
const commits = (page: Page) => page.evaluate(() => (window as unknown as { __commits: number }).__commits);

test("playback survives client navigation by the rail", async ({ page }) => {
  await serveAudio(page);
  await page.goto("/dev/player");
  await page.getByRole("list", { name: "Fixture loops" }).getByRole("button", { name: "Play Midnight keys" }).click();
  await expect(player(page).getByRole("button", { name: "Pause Midnight keys" })).toBeVisible();
  await expect(player(page).getByRole("link", { name: "Midnight keys" })).toBeVisible();
  await expectAdvancing(page, 0);

  // A marker on window survives only a client-side navigation; one on the bar and the rail survives
  // only if they were not remounted.
  await page.evaluate(() => ((window as unknown as { __stay: number }).__stay = 1));
  await player(page).evaluate((el) => ((el as unknown as { __kept: number }).__kept = 1));
  await page.getByRole("navigation", { name: "Main" }).evaluate((el) => ((el as unknown as { __kept: number }).__kept = 1));
  const nav = page.getByRole("navigation", { name: "Main" });
  await nav.getByRole("link", { name: "Home" }).click();
  await expect(page).toHaveURL("/");
  await nav.getByRole("link", { name: "Browse" }).click();
  await expect(page).toHaveURL("/browse/loops");
  await expect(nav.getByRole("link", { name: "Browse" })).toHaveAttribute("aria-current", "page");
  // And back through history, which the router also handles on the client.
  await page.goBack();
  await page.goBack();
  await expect(page).toHaveURL("/dev/player");
  await expect(page.getByRole("heading", { name: "Player" })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __stay?: number }).__stay)).toBe(1);
  expect(await player(page).evaluate((el) => (el as unknown as { __kept?: number }).__kept)).toBe(1);
  expect(await page.getByRole("navigation", { name: "Main" }).evaluate((el) => (el as unknown as { __kept?: number }).__kept)).toBe(1);

  await expect(player(page).getByRole("button", { name: "Pause Midnight keys" })).toBeVisible();
  await expectChanging(page, (await elapsed(page).textContent()) ?? "");

  // The bar controls the engine: pause holds the time.
  await player(page).getByRole("button", { name: "Pause Midnight keys" }).click();
  await expect(player(page).getByRole("button", { name: "Play Midnight keys" })).toBeVisible();
  const held = await stableElapsed(page);
  await page.waitForTimeout(1200);
  expect(await elapsed(page).textContent()).toBe(held);

  // Resume, then Next: still the one audio context the engine made for the session.
  await player(page).getByRole("button", { name: "Play Midnight keys" }).click();
  await expectChanging(page, held);
  await player(page).getByRole("button", { name: "Next" }).click();
  await expect(player(page).getByRole("button", { name: "Pause Trap bells in F sharp" })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __contexts: number }).__contexts)).toBe(1);
});

test("steady playback does not re-render the app", async ({ page }) => {
  await serveAudio(page);
  await countCommits(page);
  await page.goto("/dev/player");
  await page.getByRole("list", { name: "Fixture loops" }).getByRole("button", { name: "Play Midnight keys" }).click();
  await expect(player(page).getByRole("button", { name: "Pause Midnight keys" })).toBeVisible();
  await expectAdvancing(page, 0);
  const start = await commits(page);
  expect(start).toBeGreaterThan(0); // the hook is live
  await page.waitForTimeout(1000);
  // About 60 frames went by. A handful of commits (a status or duration change) is fine; one per frame is not.
  expect((await commits(page)) - start).toBeLessThanOrEqual(3);
});

test("next and previous move through the list that started playback", async ({ page }) => {
  await serveAudio(page);
  await page.goto("/dev/player");
  await page.getByRole("list", { name: "Fixture loops" }).getByRole("button", { name: "Play Midnight keys" }).click();
  await player(page).getByRole("button", { name: "Next" }).click();
  await expect(player(page).getByRole("link", { name: "Trap bells in F sharp" })).toBeVisible();
  await player(page).getByRole("button", { name: "Previous" }).click();
  await expect(player(page).getByRole("link", { name: "Midnight keys" })).toBeVisible();
});

test("on a phone the tab bar navigates and the mini player opens the full sheet", async ({ page }) => {
  await page.setViewportSize({ width: 380, height: 800 });
  await serveAudio(page);
  await page.goto("/dev/player");
  await expect(page.getByRole("navigation", { name: "Main" })).toBeHidden();
  const tabs = page.getByRole("navigation", { name: "Tabs" });
  await expect(tabs.getByRole("link")).toHaveText(["Home", "Browse", "Upload", "Library", "Profile"]);
  await page.getByRole("list", { name: "Fixture loops" }).getByRole("button", { name: "Play Midnight keys" }).click();
  await expect(player(page).getByRole("button", { name: "Pause Midnight keys" })).toBeVisible();

  await tabs.getByRole("link", { name: "Home" }).click();
  await expect(page).toHaveURL("/");
  await expect(tabs.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
  await expect(player(page).getByRole("button", { name: "Pause Midnight keys" })).toBeVisible();

  // The current tab carries a 2 px marker, not color alone.
  const marker = (name: string) => tabs.getByRole("link", { name }).evaluate((el) => getComputedStyle(el, "::before").height);
  expect(await marker("Home")).toBe("2px");
  expect(await tabs.getByRole("link", { name: "Browse" }).evaluate((el) => getComputedStyle(el, "::before").backgroundColor)).toBe("rgba(0, 0, 0, 0)");

  const open = player(page).getByRole("button", { name: "Open player" });
  expect((await open.boundingBox())?.height).toBeGreaterThanOrEqual(40);
  await open.click();
  const sheet = page.getByRole("dialog", { name: "Midnight keys" });
  await expect(sheet).toBeVisible();
  expect((await sheet.getByRole("link", { name: "@nova" }).boundingBox())?.height).toBeGreaterThanOrEqual(40);
  await expect(sheet.getByRole("heading", { name: "Midnight keys" })).toHaveCSS("-webkit-line-clamp", "2");
  await expect(sheet.getByRole("slider", { name: /^Seek/ })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Pause Midnight keys" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(player(page).getByRole("button", { name: "Open player" })).toBeFocused();
});

test("the volume is remembered across visits", async ({ page }) => {
  await page.goto("/dev/player");
  const volume = player(page).getByRole("slider", { name: "Volume" });
  await expect(volume).toHaveAttribute("aria-valuetext", "80 percent");
  await volume.focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowLeft");
  await expect(volume).toHaveAttribute("aria-valuetext", "60 percent");
  await page.reload();
  await expect(player(page).getByRole("slider", { name: "Volume" })).toHaveAttribute("aria-valuetext", "60 percent");
  // Mute keeps the remembered level to come back to.
  await player(page).getByRole("button", { name: "Mute" }).click();
  await expect(player(page).getByRole("slider", { name: "Volume" })).toHaveAttribute("aria-valuetext", "0 percent");
  await player(page).getByRole("button", { name: "Mute" }).click();
  await expect(player(page).getByRole("slider", { name: "Volume" })).toHaveAttribute("aria-valuetext", "60 percent");
  // And across a reload while muted: unmute returns to 60, not the default.
  await player(page).getByRole("button", { name: "Mute" }).click();
  await page.reload();
  await expect(player(page).getByRole("slider", { name: "Volume" })).toHaveAttribute("aria-valuetext", "0 percent");
  await player(page).getByRole("button", { name: "Mute" }).click();
  await expect(player(page).getByRole("slider", { name: "Volume" })).toHaveAttribute("aria-valuetext", "60 percent");
});

test("a blank stored volume is no value, not silence", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("stash.volume", ""));
  await page.goto("/dev/player");
  await expect(player(page).getByRole("slider", { name: "Volume" })).toHaveAttribute("aria-valuetext", "80 percent");
});

test("the frame has its landmarks, a skip link, and passes the accessibility scan", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
  await expect(page.getByRole("banner")).toBeVisible();
  await expect(page.getByRole("search")).toBeVisible();
  await expect(player(page)).toBeVisible();
  await expect(player(page)).toContainText("Nothing playing");
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");

  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await expect(skip).toHaveCSS("padding", "8px 16px");
  await page.keyboard.press("Enter");
  const content = page.locator("#content");
  await expect(content).toBeFocused();
  await expect(content).toHaveCSS("outline-style", "solid");
  await expect(content).toHaveCSS("outline-width", "2px");

  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
});

test("only the content area scrolls", async ({ page }) => {
  await page.goto("/dev/gallery");
  const docScroll = await page.evaluate(() => document.scrollingElement!.scrollHeight - window.innerHeight);
  expect(docScroll).toBe(0);
  const content = page.locator("#content");
  expect(await content.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  await content.evaluate((el) => el.scrollTo(0, 2000));
  await expect(player(page)).toBeInViewport();
  await expect(page.getByRole("banner")).toBeInViewport();
});

test("the rail collapses to 64 and remembers it", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const rail = page.getByRole("navigation", { name: "Main" });
  expect((await rail.boundingBox())?.width).toBe(232);
  await page.getByRole("button", { name: "Collapse navigation" }).click();
  await expect.poll(async () => (await rail.boundingBox())?.width).toBe(64);
  await expect(rail.getByRole("link", { name: "Home" })).toBeVisible();
  await page.reload();
  await expect.poll(async () => (await rail.boundingBox())?.width).toBe(64);
  await page.getByRole("button", { name: "Expand navigation" }).click();
  await expect.poll(async () => (await rail.boundingBox())?.width).toBe(232);
});

test("at 1024 with the 232 px rail, long titles truncate and nothing overflows", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await serveAudio(page);
  await page.goto("/dev/player");
  expect((await page.getByRole("navigation", { name: "Main" }).boundingBox())?.width).toBe(232);
  const list = page.getByRole("list", { name: "Fixture loops" });
  // Every row keeps a readable title (at least 96 px); the long one ends in an ellipsis.
  const titles = list.getByRole("listitem").getByRole("link");
  for (const width of await titles.evaluateAll((els) => els.map((el) => el.clientWidth))) expect(width).toBeGreaterThanOrEqual(96);
  const title = list.getByRole("link", { name: /^Late night R&B pad/ });
  expect(await title.evaluate((el) => el.scrollWidth > el.clientWidth && getComputedStyle(el).textOverflow === "ellipsis")).toBe(true);
  // Below an 880 px list the tags column is not shown at all, so the title gets the room.
  expect(await list.evaluate((el) => el.getBoundingClientRect().width)).toBeLessThan(880);
  await expect(list.locator("li").first().locator(":scope > div:nth-child(4)")).toBeHidden();
  // Had it shown, no chip would be cut: each shown one sits wholly inside its column.
  const cut = await list.locator("li").evaluateAll((rows) =>
    rows.flatMap((row) => {
      const cell = row.querySelector(":scope > div:nth-child(4)") as HTMLElement | null;
      if (!cell) return [];
      const box = cell.getBoundingClientRect();
      return [...cell.children]
        .map((chip) => chip.getBoundingClientRect())
        .filter((c) => c.width > 0 && c.top < box.bottom && (c.right > box.right + 0.5 || c.left < box.left - 0.5));
    }),
  );
  expect(cut).toEqual([]);
  // And the row's last column (like, download, more) ends inside the row.
  const spill = await list.locator("li").evaluateAll((rows) =>
    rows.filter((row) => (row.lastElementChild as HTMLElement).getBoundingClientRect().right > row.getBoundingClientRect().right + 0.5).length,
  );
  expect(spill).toBe(0);
  const content = page.locator("#content");
  expect(await content.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);

  await list.getByRole("button", { name: /^Play Late night R&B pad/ }).click();
  const barTitle = player(page).getByRole("link", { name: /^Late night R&B pad/ });
  await expect(barTitle).toBeVisible();
  // The link is the tap target; the text inside it is what truncates.
  expect(await barTitle.locator("span").evaluate((el) => el.scrollWidth > el.clientWidth && getComputedStyle(el).textOverflow === "ellipsis")).toBe(true);
  expect(await player(page).evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
});

test("on a wide list the tags column shows", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/dev/player");
  const list = page.getByRole("list", { name: "Fixture loops" });
  expect(await list.evaluate((el) => el.getBoundingClientRect().width)).toBeGreaterThanOrEqual(880);
  await expect(list.locator("li").first().locator(":scope > div:nth-child(4)")).toBeVisible();
  await expect(list.locator("li").first().getByText("soul", { exact: true })).toBeVisible();
});

test.describe("on a touch tablet", () => {
  test.use({ viewport: { width: 800, height: 900 }, hasTouch: true });

  test("the row actions sit clear of the BPM and are 40 px targets", async ({ page }) => {
    await page.goto("/dev/player");
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
    const rows = page.getByRole("list", { name: "Fixture loops" }).locator("li");
    const overlaps = await rows.evaluateAll((els) =>
      els.flatMap((row) => {
        const cells = [...row.children] as HTMLElement[];
        const bpm = cells[5]!.getBoundingClientRect();
        const actions = cells[7]!;
        return [...actions.querySelectorAll("button")]
          .map((b) => b.getBoundingClientRect())
          .filter((b) => b.width < 40 || b.left < bpm.right || b.right > row.getBoundingClientRect().right + 0.5)
          .map((b) => `${row.textContent?.slice(0, 20)}: ${b.left}..${b.right} vs BPM to ${bpm.right}`);
      }),
    );
    expect(overlaps).toEqual([]);
  });
});

test("on a tablet the rail is icons only and the bar fits without the waveform", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await serveAudio(page);
  await page.goto("/dev/player");
  const rail = page.getByRole("navigation", { name: "Main" });
  expect((await rail.boundingBox())?.width).toBe(64);
  await expect(rail.getByRole("button", { name: /navigation$/ })).toBeHidden();
  await page.getByRole("list", { name: "Fixture loops" }).getByRole("button", { name: /^Play Late night R&B pad/ }).click();
  await expect(player(page).getByRole("link", { name: /^Late night R&B pad/ })).toBeVisible();
  expect((await player(page).boundingBox())?.height).toBe(64);
  expect(await player(page).evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await expect(player(page).getByRole("slider", { name: "Volume" })).toBeVisible();
  // No waveform here, so the progress line along the top shows where the loop is.
  await expect(player(page).locator("[data-player-progress]")).toBeVisible();
  // The title and the handle are each a 40 px tap target.
  for (const name of [/^Late night R&B pad/, "@deja_on_keys"]) {
    expect((await player(page).getByRole("link", { name }).boundingBox())?.height).toBeGreaterThanOrEqual(40);
  }

  // The icon-only rail names each destination in a tooltip.
  await rail.getByRole("link", { name: "Library" }).hover();
  await expect(page.getByRole("tooltip", { name: "Library" })).toBeVisible();
});

test("the bar is 72 px on desktop and the mini player 56 on a phone", async ({ page }) => {
  await page.goto("/");
  expect((await player(page).boundingBox())?.height).toBe(72);
  await page.setViewportSize({ width: 380, height: 800 });
  await expect.poll(async () => (await player(page).boundingBox())?.height).toBe(56);
  expect((await page.getByRole("navigation", { name: "Tabs" }).boundingBox())?.height).toBe(56);
  expect((await page.getByRole("banner").boundingBox())?.height).toBe(48);
});

test("on desktop toasts sit 400 px wide, 24 px from the right edge and above the player", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/dev/player");
  await page.getByRole("button", { name: "Show a toast" }).click();
  const toast = page.getByRole("region", { name: /Notifications/ }).getByRole("listitem").first();
  await expect(toast).toBeVisible();
  await page.waitForTimeout(400);
  const box = (await toast.boundingBox())!;
  const bar = (await player(page).boundingBox())!;
  expect(box.width).toBe(400);
  expect(1440 - (box.x + box.width)).toBe(24);
  expect(bar.y - (box.y + box.height)).toBe(24);
});

test("on a phone toasts sit full width, 12 px from the edges, above the mini player", async ({ page }) => {
  await page.setViewportSize({ width: 380, height: 800 });
  await page.goto("/dev/player");
  await page.getByRole("button", { name: "Show a toast" }).click();
  const toast = page.getByRole("region", { name: /Notifications/ }).getByRole("listitem").first();
  await expect(toast).toBeVisible();
  // Let the 160 ms rise settle before measuring.
  await page.waitForTimeout(400);
  const box = (await toast.boundingBox())!;
  const mini = (await player(page).boundingBox())!;
  expect(box.x).toBe(12);
  expect(box.width).toBe(380 - 24);
  expect(mini.y - (box.y + box.height)).toBe(12);
});
