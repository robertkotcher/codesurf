// Capture a screenshot of a running app with the interacted element marked.
// Uses the locally installed Chrome (or CODESURF_CHROME) through playwright-core,
// so no browser download is needed.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

/**
 * steps: [{goto}, {fill, value}, {click}, {hover}, {press, key}, {select, value}, {wait}, {waitFor}]
 * highlight: selectors to measure (after the steps run, before `then` steps).
 * then: steps that run after measuring (e.g. the submit that the highlight marks),
 *       followed by an optional second screenshot `after`.
 */
export async function shoot({ url, steps = [], highlight = [], labels = [], out, viewport = { width: 1280, height: 800 }, fullPage = false, then = [], after }) {
  if (!url) throw new Error("--url is required.");
  if (!out) throw new Error("--out is required.");
  const launch = { headless: true };
  if (process.env.CODESURF_CHROME) launch.executablePath = process.env.CODESURF_CHROME;
  else launch.channel = "chrome";
  let browser;
  try { browser = await chromium.launch(launch); }
  catch (error) { throw new Error("Cannot start Chrome. Install Google Chrome or set CODESURF_CHROME to a Chromium executable.\n" + error.message); }
  try {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 2 });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    const run = async (list) => {
      for (const step of list) {
        if (step.goto) await page.goto(new URL(step.goto, url).href, { waitUntil: "networkidle" });
        else if (step.fill) await page.locator(step.fill).first().fill(String(step.value ?? ""));
        else if (step.click) await page.locator(step.click).first().click();
        else if (step.hover) await page.locator(step.hover).first().hover();
        else if (step.press) await page.locator(step.press).first().press(step.key || "Enter");
        else if (step.select) await page.locator(step.select).first().selectOption(String(step.value));
        else if (step.waitFor) await page.locator(step.waitFor).first().waitFor({ timeout: 10000 });
        else if (step.wait) await page.waitForTimeout(Math.min(Number(step.wait) || 0, 10000));
        else throw new Error("Unknown step: " + JSON.stringify(step));
      }
    };
    await run(steps);
    const highlights = [];
    for (const [i, selector] of highlight.entries()) {
      const box = await page.locator(selector).first().boundingBox();
      if (!box) throw new Error(`Highlight selector not visible: ${selector}`);
      const scroll = fullPage ? await page.evaluate(() => ({ x: scrollX, y: scrollY })) : { x: 0, y: 0 };
      highlights.push({ x: Math.round(box.x + scroll.x), y: Math.round(box.y + scroll.y), width: Math.round(box.width), height: Math.round(box.height), ...(labels[i] ? { label: labels[i] } : {}), selector });
    }
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    await page.screenshot({ path: out, fullPage });
    const size = fullPage ? await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight })) : viewport;
    const result = { image: out, url: page.url(), viewport: size, highlights, errors };
    if (then.length) {
      await run(then);
      await page.waitForLoadState("networkidle").catch(() => {});
      if (after) {
        await page.screenshot({ path: after, fullPage });
        result.after = { image: after, url: page.url(), viewport: fullPage ? await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight })) : viewport };
      }
    }
    return result;
  } finally {
    await browser.close();
  }
}
