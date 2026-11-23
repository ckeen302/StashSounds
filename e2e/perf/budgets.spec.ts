import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Budgets live in packages/contracts/limits.json (performance). Ticket 123 adds time to first sound;
// ticket 135 points these checks at the loop item page.
const limits = JSON.parse(readFileSync(join(import.meta.dirname, "../../packages/contracts/limits.json"), "utf8"));
const budget = limits.performance as { itemPageLcpMs: number; itemPageCls: number; scriptBeforeAudioBytes: number };

for (const path of ["/"]) {
  test(`${path} stays inside the page budgets`, async ({ page }) => {
    let scriptBytes = 0;
    page.on("response", async (res) => {
      if (res.request().resourceType() === "script") {
        // responseBodySize is the encoded (compressed) size on the wire.
        scriptBytes += (await res.request().sizes()).responseBodySize;
      }
    });
    await page.goto(path, { waitUntil: "networkidle" });
    const { lcp, cls } = await page.evaluate(
      () =>
        new Promise<{ lcp: number; cls: number }>((resolve) => {
          let lcp = 0;
          let cls = 0;
          new PerformanceObserver((l) => l.getEntries().forEach((e) => (lcp = e.startTime))).observe({ type: "largest-contentful-paint", buffered: true });
          new PerformanceObserver((l) =>
            l.getEntries().forEach((e) => {
              const shift = e as PerformanceEntry & { value: number; hadRecentInput: boolean };
              if (!shift.hadRecentInput) cls += shift.value;
            }),
          ).observe({ type: "layout-shift", buffered: true });
          setTimeout(() => resolve({ lcp, cls }), 500);
        }),
    );
    expect(lcp, "largest contentful paint (ms)").toBeLessThan(budget.itemPageLcpMs);
    expect(cls, "cumulative layout shift").toBeLessThan(budget.itemPageCls);
    expect(scriptBytes, "compressed script bytes before audio").toBeLessThan(budget.scriptBeforeAudioBytes);
  });
}
