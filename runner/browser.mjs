import http from "node:http";
import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { chromium } from "playwright";

const port = 3780;
if (process.argv[2] !== "serve") {
  const [action, ...args] = process.argv.slice(2);
  const response = await fetch(`http://127.0.0.1:${port}/action`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, args }),
  });
  const result = await response.text();
  console.log(result);
  if (!response.ok) process.exitCode = 1;
} else {
  const browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    recordVideo: { dir: "/artifacts", size: { width: 1280, height: 800 } },
  });
  await context.tracing.start({
    screenshots: true,
    snapshots: true,
    sources: false,
  });
  const page = await context.newPage();
  let opened = false,
    finished = false,
    busy = false,
    serverOffset = 0;
  const log = (source, text) =>
    console.log(JSON.stringify({ source, text: String(text).slice(0, 16000) }));
  page.on("console", (msg) => log("browser", `[${msg.type()}] ${msg.text()}`));
  page.on("pageerror", (error) => log("browser", `ERROR ${error.message}`));
  page.on("response", (response) => {
    if (response.status() >= 400)
      log("network", `${response.status()} ${response.url()}`);
  });
  page.on("requestfailed", (request) =>
    log("network", `${request.failure()?.errorText} ${request.url()}`),
  );
  const screenshot = async () => {
    if (opened && !finished) {
      const bytes = await page.screenshot({ type: "png" });
      await writeFile("/artifacts/screen.png", bytes);
      return bytes;
    }
  };
  const snapshot = async () => ({
    url: page.url(),
    title: await page.title(),
    text: (await page.locator("body").innerText()).slice(0, 20000),
    controls: await page
      .locator('a,button,input,select,textarea,[role="button"]')
      .evaluateAll((els) =>
        els
          .filter((el) => el.getBoundingClientRect().width > 0)
          .slice(0, 100)
          .map((el) => ({
            tag: el.tagName.toLowerCase(),
            id: el.id,
            name: el.getAttribute("aria-label") || el.getAttribute("name"),
            text: el.textContent?.trim().slice(0, 120),
            placeholder: el.getAttribute("placeholder"),
            type: el.getAttribute("type"),
          })),
      ),
  });
  async function action({ action, args = [] }) {
    if (finished) throw new Error("This browser session has ended.");
    switch (action) {
      case "open": {
        const url = new URL(args[0]);
        if (
          !["http:", "https:"].includes(url.protocol) ||
          !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
        )
          throw new Error("Open the application on localhost.");
        await page.goto(url.href, {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });
        opened = true;
        log("activity", "Opened " + url.href);
        break;
      }
      case "click":
        await page.locator(args[0]).click({ timeout: 10000 });
        break;
      case "fill":
        await page.locator(args[0]).fill(args[1] || "", { timeout: 10000 });
        break;
      case "press":
        await page.locator(args[0]).press(args[1], { timeout: 10000 });
        break;
      case "scroll":
        await page.mouse.wheel(0, Number(args[0]) || 500);
        break;
      case "evaluate":
        return { result: await page.evaluate(args[0]) };
      case "screenshot": {
        const name = args[0] || "evidence.png";
        if (!/^[\w-]+\.png$/.test(name) || name === "screen.png")
          throw new Error(
            "Use an evidence filename such as checkout-error.png.",
          );
        await page.screenshot({ path: "/artifacts/" + name, fullPage: true });
        log("activity", "Saved " + name);
        return { file: name };
      }
      case "tap":
        await page.mouse.click(Number(args[0]), Number(args[1]));
        break;
      case "type":
        await page.keyboard.insertText(String(args[0]).slice(0, 4000));
        break;
      case "key":
        await page.keyboard.press(String(args[0]));
        break;
      case "snapshot":
        break;
      default:
        throw new Error("Unknown browser action.");
    }
    await screenshot();
    return snapshot();
  }
  const loop = setInterval(async () => {
    if (busy || finished) return;
    busy = true;
    try {
      await screenshot();
      let text = await readFile("/artifacts/server.log", "utf8").catch(
        () => "",
      );
      if (text.length > serverOffset) {
        log("server", text.slice(serverOffset));
        serverOffset = text.length;
      }
    } catch {
    } finally {
      busy = false;
    }
  }, 800);
  const server = http.createServer(async (req, res) => {
    try {
      if (req.url === "/screen") {
        const data = await readFile("/artifacts/screen.png");
        res.setHeader("content-type", "image/png");
        return res.end(data);
      }
      if (req.url === "/status")
        return res.end(JSON.stringify({ opened, url: page.url(), finished }));
      if (req.method !== "POST") {
        res.statusCode = 404;
        return res.end();
      }
      let raw = "";
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 100000) throw new Error("Request too large.");
      }
      const body = JSON.parse(raw || "{}");
      if (req.url === "/pause" || req.url === "/resume") {
        const pid = Number(await readFile("/tmp/codesurf-agent.pid", "utf8"));
        if (!Number.isInteger(pid) || pid < 2)
          throw new Error("Agent is not running.");
        process.kill(-pid, req.url === "/pause" ? "SIGSTOP" : "SIGCONT");
        return res.end("{}");
      }
      if (req.url === "/finish") {
        clearInterval(loop);
        await screenshot();
        finished = true;
        await context.tracing.stop({ path: "/artifacts/trace.zip" });
        const video = page.video();
        await context.close();
        await browser.close();
        if (video) {
          const original = await video.path();
          const { rename } = await import("node:fs/promises");
          await rename(original, "/artifacts/video.webm");
        }
        return res.end(JSON.stringify({ opened }));
      }
      if (req.url !== "/action") {
        res.statusCode = 404;
        return res.end();
      }
      const result = await action(body);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(result));
    } catch (error) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: error.message }));
    }
  });
  server.listen(port, "0.0.0.0", () => log("system", "Browser ready"));
}
