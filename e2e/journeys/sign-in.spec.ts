import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Ticket 133: /login (email link, Google, Discord), the handle claim, and signed-out like, follow
// and download, which open the sign-in dialog and finish after sign-in.
//
// The first block needs no Supabase: provider sign-in only builds an authorize URL, which is
// intercepted here, and a signed-out visitor never calls Auth. The second block signs up for real
// against the local stack (pnpm dev) and reads the link from its Mailpit inbox.

const SUPABASE = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const MAILPIT = process.env.STASH_MAILPIT_URL ?? "http://127.0.0.1:54324";

/** A toast in the notifications stack (Radix also copies its text into an announcer, so scope to the list). */
const toastWith = (page: Page, text: string) => page.getByRole("region", { name: /Notifications/ }).getByRole("listitem").filter({ hasText: text });
const toasts = (page: Page) => page.getByRole("region", { name: /Notifications/ }).getByRole("listitem");

/** The browser's pending sign-in action (apps/web/src/app/_auth/intent-store.ts). */
const INTENT_KEY = "stash.intent";
const NONCE = /[0-9a-f]{32}/;

/** Proves the page is hydrated (a client handler ran) before asserting that something did not happen. */
async function hydrated(page: Page) {
  await page.getByRole("button", { name: "Show a toast" }).click();
  await expect(page.getByRole("region", { name: /Notifications/ }).getByRole("listitem").filter({ hasText: "Saved to your library" })).toBeVisible();
}

const axe = async (page: Page) => (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations.map((v) => `${v.id}: ${v.help}`);

/** Stops the browser at Supabase's authorize page and returns where it was sent. */
async function catchAuthorize(page: Page): Promise<() => Promise<URL>> {
  let resolve: (u: URL) => void;
  const sent = new Promise<URL>((r) => (resolve = r));
  await page.route("**/auth/v1/authorize**", (route) => {
    resolve(new URL(route.request().url()));
    return route.fulfill({ status: 200, contentType: "text/html", body: "<title>Provider</title>" });
  });
  return () => sent;
}

/** The `next` the provider would send the browser back with, read from redirect_to. */
const nextOf = (authorize: URL) => new URL(authorize.searchParams.get("redirect_to")!).searchParams.get("next");

test.describe("signed out", () => {
  test("/login offers an email link, Google and Discord, and passes the accessibility scan", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { level: 1, name: "Sign in to Stash" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Email" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Email me a link" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue with Discord" })).toBeVisible();
    expect(await axe(page)).toEqual([]);
  });

  test("a link that did not work says so and what to do", async ({ page }) => {
    await page.goto("/login?error=signin_failed");
    await expect(page.getByRole("main").getByRole("alert")).toHaveText("That sign-in did not finish. The link may have expired. Ask for a new one.");
  });

  test("an empty or malformed email gets the action's message under the field", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("textbox", { name: "Email" }).fill("not an email");
    await page.getByRole("button", { name: "Email me a link" }).click();
    const field = page.getByRole("textbox", { name: "Email" });
    await expect(field).toHaveAttribute("aria-invalid", "true");
    // The message is tied to the field, so a screen reader hears it with the field.
    const id = await field.getAttribute("aria-describedby");
    await expect(page.locator(`[id="${id}"]`)).not.toBeEmpty();
  });

  for (const [name, provider] of [
    ["Google", "google"],
    ["Discord", "discord"],
  ] as const) {
    test(`Continue with ${name} goes to Supabase's authorize URL and comes back to next`, async ({ page }) => {
      const sent = await catchAuthorize(page);
      await page.goto("/login?next=%2Flibrary");
      await page.getByRole("button", { name: `Continue with ${name}` }).click();
      const url = await sent();
      expect(url.origin + url.pathname).toBe(`${new URL(SUPABASE).origin}/auth/v1/authorize`);
      expect(url.searchParams.get("provider")).toBe(provider);
      expect(new URL(url.searchParams.get("redirect_to")!).pathname).toBe("/api/auth/callback");
      expect(nextOf(url)).toBe("/library");
      expect(url.searchParams.get("code_challenge_method")?.toLowerCase()).toBe("s256");
    });
  }

  test("a hostile next is replaced by home before it reaches the link", async ({ page }) => {
    const sent = await catchAuthorize(page);
    await page.goto(`/login?next=${encodeURIComponent("//evil.example/steal")}`);
    await page.getByRole("button", { name: "Continue with Google" }).click();
    expect(nextOf(await sent())).toBe("/");
  });

  for (const [kind, press, title, next] of [
    ["like", (p: Page) => p.getByRole("button", { name: "Like Dusty soul chops" }).click(), "Sign in to like this", "/dev/player?do=like%3Ak3j9x0a2b1%3A"],
    ["download", (p: Page) => p.getByRole("button", { name: "Download Dusty soul chops" }).click(), "Sign in to download", "/dev/player?do=download%3Ak3j9x0a2b1%3A"],
    ["follow", (p: Page) => p.getByRole("button", { name: "Follow @nova" }).click(), "Sign in to follow", "/dev/player?do=follow%3Anova%3A"],
  ] as const) {
    test(`a signed-out ${kind} opens the sign-in dialog, which remembers it`, async ({ page }) => {
      const sent = await catchAuthorize(page);
      await page.goto("/dev/player");
      await press(page);
      const dialog = page.getByRole("dialog", { name: title });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("textbox", { name: "Email" })).toBeFocused();
      expect(await axe(page)).toEqual([]);
      // Nothing ran: the like is not pressed (the page behind the modal is hidden from the tree).
      await expect(page.getByRole("button", { name: "Like Dusty soul chops", includeHidden: true })).toHaveAttribute("aria-pressed", "false");

      // Opening the dialog stored the pending action, for about 15 minutes.
      const stored = JSON.parse((await page.evaluate((k) => localStorage.getItem(k), INTENT_KEY))!);
      expect(stored.kind).toBe(kind);
      expect(stored.expiresAt - Date.now()).toBeGreaterThan(14 * 60 * 1000);

      await dialog.getByRole("button", { name: "Continue with Google" }).click();
      // next carries that record's nonce, which only this browser has, so a bare or copied link runs nothing.
      const back = nextOf(await sent())!;
      expect(back.startsWith(next)).toBe(true);
      const nonce = back.slice(next.length);
      expect(nonce).toMatch(new RegExp(`^${NONCE.source}$`));
      expect(nonce).toBe(stored.nonce);
    });
  }

  test("Escape closes the dialog and focus goes back to the action", async ({ page }) => {
    await page.goto("/dev/player");
    const like = page.getByRole("button", { name: "Like Dusty soul chops" });
    await like.click();
    await expect(page.getByRole("dialog", { name: "Sign in to like this" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(like).toBeFocused();
  });

  test("a do parameter does nothing for a visitor", async ({ page }) => {
    await page.goto("/dev/player?do=like%3Ak3j9x0a2b1%3A0123456789abcdef0123456789abcdef");
    await hydrated(page);
    await expect(toastWith(page, "Liked")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Like Dusty soul chops" })).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByRole("dialog")).toBeHidden();
  });

  test("at 380 the sign-in screen fits and its controls are 40 px targets", async ({ page }) => {
    await page.setViewportSize({ width: 380, height: 800 });
    await page.goto("/login");
    expect(await page.locator("#content").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    for (const name of ["Email me a link", "Continue with Google", "Continue with Discord"]) {
      expect((await page.getByRole("button", { name }).boundingBox())?.height).toBeGreaterThanOrEqual(40);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Against the local Supabase stack and its Mailpit inbox.

async function reachable(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
}

const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** The newest sign-in link Mailpit holds for this address. */
async function signInLink(email: string): Promise<string> {
  let link: string | undefined;
  await expect
    .poll(
      async () => {
        const list = (await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`)).json()) as { messages?: { ID: string }[] };
        const id = list.messages?.[0]?.ID;
        if (!id) return false;
        const msg = (await (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json()) as { Text?: string; HTML?: string };
        link = /https?:\/\/[^\s"'<>]+\/auth\/v1\/verify[^\s"'<>]+/.exec(`${msg.Text ?? ""} ${msg.HTML ?? ""}`)?.[0]?.replace(/&amp;/g, "&");
        return Boolean(link);
      },
      { timeout: 15000 },
    )
    .toBe(true);
  return link!;
}

/** Asks for a link from wherever the sign-in panel is showing, then opens it. */
async function signUpByEmail(page: Page, scope: ReturnType<Page["locator"]> | Page, email: string) {
  await scope.getByRole("textbox", { name: "Email" }).fill(email);
  await scope.getByRole("button", { name: "Email me a link" }).click();
  await expect(scope.getByText("Check your inbox")).toBeVisible();
  await expect(scope.getByText(email)).toBeVisible();
  await page.goto(await signInLink(email));
}

async function claim(page: Page, handle: string) {
  await expect(page.getByRole("heading", { level: 1, name: "Choose your handle" })).toBeVisible();
  await page.getByRole("textbox", { name: "Handle" }).fill(handle);
  await page.getByRole("button", { name: "Claim handle" }).click();
}

test.describe("with the local Supabase stack", () => {
  test.beforeAll(async () => {
    const up = (await reachable(`${SUPABASE}/auth/v1/health`)) && (await reachable(`${MAILPIT}/api/v1/info`));
    // CI must run these (docs/requests/133-e2e-supabase.md); a missing stack there is a failure.
    if (!up && process.env.CI) throw new Error(`The sign-in journeys need Supabase at ${SUPABASE} and Mailpit at ${MAILPIT}.`);
    test.skip(!up, "Needs the local Supabase stack and Mailpit: run pnpm dev first.");
  });

  test("sign up by email link, claim a handle, land on home", async ({ page }) => {
    const id = unique();
    await page.goto("/login");
    await signUpByEmail(page, page, `producer-${id}@example.com`);
    // A new user chooses a handle before anything else.
    await expect(page).toHaveURL(/\/login/);
    const handle = page.getByRole("textbox", { name: "Handle" });
    await handle.fill(`New_${id}`);
    await expect(handle).toHaveValue(`new_${id}`);
    await page.getByRole("button", { name: "Claim handle" }).click();
    await expect(page).toHaveURL("/");
    await expect(page.getByRole("button", { name: `Account, @new_${id}` })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Profile" })).toHaveAttribute("href", `/u/new_${id}`);
    // A member is sent on from /login.
    await page.goto("/login?next=%2Flibrary");
    await expect(page).toHaveURL("/library");
  });

  test("the claim shows reserved, malformed and taken handles under the field", async ({ page, browser }) => {
    const id = unique();
    // Someone else holds this one.
    const other = await browser.newPage();
    await other.goto("/login");
    await signUpByEmail(other, other, `first-${id}@example.com`);
    await claim(other, `taken_${id}`);
    await expect(other).toHaveURL("/");
    await other.close();

    await page.goto("/login");
    await signUpByEmail(page, page, `second-${id}@example.com`);
    const field = page.getByRole("textbox", { name: "Handle" });
    const message = async () => page.locator(`[id="${await field.getAttribute("aria-describedby")}"]`);
    for (const [value, text] of [
      ["admin", "That handle is taken."],
      ["ab", "Handles are 3 to 24 characters: a to z, 0 to 9 and underscore."],
      [`taken_${id}`, "That handle is taken."],
    ] as const) {
      await claim(page, value);
      await expect(field).toHaveAttribute("aria-invalid", "true");
      await expect(await message()).toHaveText(text);
    }
    expect(await axe(page)).toEqual([]);
  });

  test("a signed-out like completes after sign-up and the claim", async ({ page }) => {
    const id = unique();
    await page.goto("/dev/player");
    await page.getByRole("button", { name: "Like Dusty soul chops" }).click();
    const dialog = page.getByRole("dialog", { name: "Sign in to like this" });
    await signUpByEmail(page, dialog, `liker-${id}@example.com`);
    await claim(page, `liker_${id}`);
    await expect(page).toHaveURL("/dev/player");
    await expect(toastWith(page, "Liked Dusty soul chops")).toBeVisible();
    // Only the like ran: no other kind's action fired with it.
    await expect(toasts(page)).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Like Dusty soul chops" })).toHaveAttribute("aria-pressed", "true");
    // It ran once: a reload does not like it again.
    await page.reload();
    await expect(page.getByRole("list", { name: "Fixture loops" })).toBeVisible();
    await page.waitForTimeout(1000); // Long enough for a stray replay to raise its toast.
    await expect(toastWith(page, "Liked Dusty soul chops")).toHaveCount(0);
  });

  test("follow and download complete after an existing member signs in", async ({ page, context }) => {
    const id = unique();
    const email = `member-${id}@example.com`;
    await page.goto("/login");
    await signUpByEmail(page, page, email);
    await claim(page, `member_${id}`);
    await expect(page).toHaveURL("/");
    await context.clearCookies();

    for (const [press, title, toast] of [
      [() => page.getByRole("button", { name: "Follow @nova" }).click(), "Sign in to follow", "Following @nova"],
      [() => page.getByRole("button", { name: "Download Midnight keys" }).click(), "Sign in to download", "Downloading Midnight keys"],
    ] as const) {
      await page.goto("/dev/player");
      await press();
      await signUpByEmail(page, page.getByRole("dialog", { name: title }), email);
      await expect(page).toHaveURL("/dev/player");
      await expect(toastWith(page, toast)).toBeVisible();
      await context.clearCookies();
    }
  });

  test("a member's bare or forged do link runs nothing", async ({ page }) => {
    const id = unique();
    await page.goto("/login");
    await signUpByEmail(page, page, `clicker-${id}@example.com`);
    await claim(page, `clicker_${id}`);
    await expect(page).toHaveURL("/");
    for (const link of ["/dev/player?do=follow%3Anova", "/dev/player?do=follow%3Anova%3A0123456789abcdef0123456789abcdef"]) {
      await page.goto(link);
      await hydrated(page);
      await expect(toastWith(page, "Following")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Follow @nova" })).toBeVisible();
    }
  });

  test("a stored intent runs only for its own kind and target, once", async ({ page }) => {
    const id = unique();
    await page.goto("/login");
    await signUpByEmail(page, page, `kinds-${id}@example.com`);
    await claim(page, `kinds_${id}`);
    await expect(page).toHaveURL("/");
    const nonce = "abcdef0123456789abcdef0123456789";
    await page.evaluate(
      ([k, n]) => localStorage.setItem(k!, JSON.stringify({ kind: "like", target: "k3j9x0a2b1", nonce: n, expiresAt: Date.now() + 600000 })),
      [INTENT_KEY, nonce],
    );
    // The right nonce under another kind, or another target: nothing.
    for (const link of [`/dev/player?do=follow%3Anova%3A${nonce}`, `/dev/player?do=like%3Ak3j9x0a2b2%3A${nonce}`]) {
      await page.goto(link);
      await hydrated(page);
      await expect(toastWith(page, "Following")).toHaveCount(0);
      await expect(toastWith(page, "Liked")).toHaveCount(0);
    }
    // Its own kind and target: the like runs once, alone.
    await page.goto(`/dev/player?do=like%3Ak3j9x0a2b1%3A${nonce}`);
    await expect(toastWith(page, "Liked Dusty soul chops")).toBeVisible();
    await expect(toasts(page)).toHaveCount(1);
    await expect(page).toHaveURL("/dev/player");
    expect(await page.evaluate((k) => localStorage.getItem(k), INTENT_KEY)).toBeNull();
  });

  test("a member sent to /login with a hostile next lands on this site", async ({ page, baseURL }) => {
    const id = unique();
    await page.goto("/login");
    await signUpByEmail(page, page, `hostile-${id}@example.com`);
    await claim(page, `hostile_${id}`);
    await expect(page).toHaveURL("/");
    for (const next of ["//evil.example/steal", "https://evil.example/", "/\\evil.example"]) {
      await page.goto(`/login?next=${encodeURIComponent(next)}`);
      await expect(page).toHaveURL(`${baseURL}/`);
    }
  });

  test("on the claim screen the top bar does not offer to sign in", async ({ page }) => {
    await page.goto("/login");
    await signUpByEmail(page, page, `claimbar-${unique()}@example.com`);
    await expect(page.getByRole("heading", { level: 1, name: "Choose your handle" })).toBeVisible();
    await expect(page.getByRole("banner").getByRole("link", { name: "Sign in" })).toHaveCount(0);
  });

  test("sign out from the account menu", async ({ page }) => {
    const id = unique();
    await page.goto("/login");
    await signUpByEmail(page, page, `leaver-${id}@example.com`);
    await claim(page, `leaver_${id}`);
    await page.getByRole("button", { name: `Account, @leaver_${id}` }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page.getByRole("banner").getByRole("link", { name: "Sign in" })).toBeVisible();
  });
});
