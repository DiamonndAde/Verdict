/**
 * Drives the real app in Chromium: loads it, runs the live demo flow (create → accept →
 * settle → receipt) and the fraud panel, capturing screenshots for review. Also fails loudly
 * on any console error, so it doubles as an end-to-end smoke test of the frontend.
 *
 *   node scripts/screenshots.mjs [baseUrl]
 */
import { chromium } from "playwright";
import * as fs from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:5173";
const OUT = "docs/screenshots";
fs.mkdirSync(OUT, { recursive: true });

const shot = async (page, name) => {
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`  captured ${name}.png`);
};

const consoleErrors = [];

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 2 });
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

  console.log(`loading ${BASE}?demo=1`);
  await page.goto(`${BASE}/?demo=1`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await shot(page, "01-home");

  // Predicate builder
  await page.getByText("Create a challenge").click();
  await page.waitForTimeout(900);
  await shot(page, "02-predicate-builder");

  // Live demo flow: create + accept on devnet, land on the settle screen.
  await page.goto(`${BASE}/?demo=1`, { waitUntil: "networkidle" });
  await page.getByText("Watch a live settlement").click();
  console.log("  waiting for create+accept on devnet…");
  await page.waitForURL("**/c/**", { timeout: 60000 });
  await page.waitForTimeout(2500);
  await shot(page, "03-fight-card");

  // Settle → cascade → receipt
  await page.getByText("Settle by proof").click();
  console.log("  settling on devnet…");
  await page.waitForTimeout(2500);
  await shot(page, "04-verification-cascade");
  // Wait for the receipt to appear (poll picks up Settled state).
  await page.waitForSelector("text=SETTLEMENT RECEIPT", { timeout: 60000 });
  await page.waitForTimeout(2000);
  await shot(page, "05-receipt");

  // Re-verify cascade on the receipt
  await page.getByText("Re-verify now").click();
  await page.waitForTimeout(3000);
  await shot(page, "06-receipt-reverify");

  // Fraud panel
  const forge = page.getByText("Forge the proof");
  await forge.scrollIntoViewIfNeeded();
  await forge.click();
  await page.waitForTimeout(3000);
  await shot(page, "07-fraud-rejected");

  await browser.close();

  if (consoleErrors.length) {
    console.error(`\n✗ ${consoleErrors.length} console error(s):`);
    for (const e of consoleErrors.slice(0, 10)) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log("\n✓ flows drove cleanly, no console errors");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
