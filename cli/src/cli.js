#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolveTour, findSymbol, languageOf, readSource, splitLines } from "./tour.js";
import * as store from "./store.js";

const help = `CodeSurf — ask about a repository, explore the answer visually.

  codesurf setup [--force]
      Install the Claude Code skill and check Chrome and Claude Code. Run once after installing.
  codesurf guide
      Print the full agent workflow and tour format (for any coding agent).

  codesurf open <tour.json> [--repo DIR] [--no-browser]
      Check a tour against the repository, save it, and open it in the local viewer.
  codesurf check <tour.json> [--repo DIR]
      Only check the tour. Prints every problem with its exact location.
  codesurf locate <file> <symbol> [--repo DIR]
      Print the line range and source of a function, class, method (Class.method) or variable.
  codesurf shot --url URL [actions] [--highlight SELECTOR [--label TEXT]]... --out FILE.png
      Screenshot a running app with the interacted element circled. Actions run in order:
        --goto PATH  --fill "SELECTOR=VALUE"  --click SELECTOR  --hover SELECTOR  --press "SELECTOR=Key"
        --select "SELECTOR=VALUE"  --wait-for SELECTOR  --wait MS
      Actions after the last --highlight run after measuring; add --after FILE.png to
      capture the result. Also --viewport 1280x800 and --full-page. Prints a screenshot card.
  codesurf example [--no-browser]
      Open the bundled demo tour.
  codesurf serve [--port N]     Run the viewer server in the foreground.
  codesurf status | stop        Show or stop the background server.

The viewer runs at http://127.0.0.1:${process.env.CODESURF_PORT || 4319}. Follow-up questions in the
viewer use your signed-in Claude Code CLI (read-only tools in the repository).
Tour format: ${fileURLToPath(new URL("../skill/tour-format.md", import.meta.url))}
`;

const args = process.argv.slice(2);
const command = args.shift();
const option = (name, fallback) => {
  const i = args.indexOf(name);
  if (i < 0) return fallback;
  const value = args[i + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for ${name}`);
  args.splice(i, 2);
  return value;
};
const flag = (name) => { const i = args.indexOf(name); if (i >= 0) args.splice(i, 1); return i >= 0; };
const cliPath = fileURLToPath(import.meta.url);

async function health(port, token) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health?token=${token}`, { signal: AbortSignal.timeout(1500) });
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

async function ensureServer() {
  const { BUILD, DEFAULT_PORT } = await import("./server.js");
  const info = store.readServer();
  const port = DEFAULT_PORT;
  if (info?.port === port) {
    const status = await health(port, info.token);
    if (status?.authorized && status.build === BUILD) return info;
    if (status?.authorized && status.pid) { try { process.kill(status.pid); } catch {} await waitFor(async () => !(await health(port, info.token))); }
  }
  const existing = await health(port, "x");
  if (existing) throw new Error(`Port ${port} is used by another CodeSurf server. Run \`codesurf stop\` or set CODESURF_PORT.`);
  fs.mkdirSync(store.home(), { recursive: true });
  const log = fs.openSync(path.join(store.home(), "server.log"), "a");
  spawn(process.execPath, [cliPath, "serve", "--port", String(port)], { detached: true, stdio: ["ignore", log, log] }).unref();
  let ready;
  await waitFor(async () => { ready = store.readServer(); return ready?.port === port && (await health(port, ready.token))?.authorized; }, 8000);
  if (!ready) throw new Error("The CodeSurf server did not start. See " + path.join(store.home(), "server.log"));
  return ready;
}
async function waitFor(check, timeout = 4000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await check()) return true; await new Promise((r) => setTimeout(r, 150)); }
  return false;
}
function openBrowser(url) {
  const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  spawn(opener, [url], { detached: true, stdio: "ignore" }).unref();
}

function loadTour(file, repo) {
  const tourPath = path.resolve(file);
  const input = JSON.parse(fs.readFileSync(tourPath, "utf8"));
  const project = store.ensureProject(repo || process.cwd(), { exact: Boolean(repo) });
  return { project, ...resolveTour(input, { root: project.root, baseDir: path.dirname(tourPath) }) };
}

function summary(tour) {
  const code = tour.cards.filter((c) => c.kind === "code");
  return `${tour.steps.length} steps · ${code.length} code card${code.length === 1 ? "" : "s"} (one per file) · ` +
    `${tour.cards.length - code.length} other card${tour.cards.length - code.length === 1 ? "" : "s"} · ${tour.connections.length} connections`;
}

async function openSaved(project, id, noBrowser) {
  const info = await ensureServer();
  const url = `http://127.0.0.1:${info.port}/?project=${project.id}&tour=${id}`;
  if (!noBrowser) openBrowser(url + `&token=${info.token}`);
  console.log(`Opened ${url}`);
}

function setup(force) {
  const ok = (text) => console.log("  ✓ " + text), bad = (text) => console.log("  ✗ " + text);
  console.log("CodeSurf " + JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url))).version + " setup");
  const [major, minor] = process.versions.node.split(".").map(Number);
  major > 22 || (major === 22 && minor >= 12) ? ok(`Node.js ${process.versions.node}`) : bad(`Node.js ${process.versions.node}: CodeSurf needs 22.12 or newer`);
  // Claude Code loads skills from ~/.claude/skills; link ours so updates apply automatically.
  const source = fileURLToPath(new URL("../skill", import.meta.url));
  const target = path.join(os.homedir(), ".claude", "skills", "codesurf");
  let existing = null;
  try { existing = fs.lstatSync(target); } catch {}
  if (existing && !existing.isSymbolicLink() && !force) bad(`${target} already exists and is not CodeSurf's link. Re-run with --force to replace it (the old one is kept as a backup).`);
  else {
    if (existing?.isSymbolicLink()) fs.unlinkSync(target);
    else if (existing) fs.renameSync(target, target + ".backup-" + Date.now());
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.symlinkSync(source, target, "dir");
    ok(`Claude Code skill installed at ${target}`);
  }
  const chrome = process.env.CODESURF_CHROME || ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"].find((p) => fs.existsSync(p));
  chrome ? ok("Google Chrome found (for app screenshots)") : bad("Google Chrome not found: screenshots of the user's app need Chrome, or set CODESURF_CHROME");
  const claude = spawnSync(process.env.CODESURF_CLAUDE || "claude", ["--version"], { encoding: "utf8" });
  claude.status === 0 ? ok(`Claude Code ${claude.stdout.trim().split(" ")[0]} (answers follow-up questions in the viewer)`)
    : bad("Claude Code CLI not found: tours work, but follow-up questions in the viewer need `claude` installed and signed in");
  console.log(`
Next:
  codesurf example          open the demo tour in your browser
Other agents (Codex, Cursor, …): add this line to AGENTS.md or your rules file:
  When I ask you to "surf" code or explain code visually, run \`codesurf guide\` and follow it.`);
}

try {
  if (!command || command === "--help" || command === "-h" || command === "help") console.log(help);
  else if (command === "setup") setup(flag("--force"));
  else if (command === "guide") {
    const skill = fs.readFileSync(new URL("../skill/SKILL.md", import.meta.url), "utf8").replace(/^---[\s\S]*?---\s*/, "");
    console.log(skill.trim() + "\n\n" + fs.readFileSync(new URL("../skill/tour-format.md", import.meta.url), "utf8"));
  }
  else if (command === "--version") console.log(JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url))).version);
  else if (command === "check" || command === "open") {
    const repo = option("--repo"), noBrowser = flag("--no-browser"), file = args.shift();
    if (!file) throw new Error(`Usage: codesurf ${command} <tour.json> [--repo DIR]`);
    const { project, tour, assets } = loadTour(file, repo);
    if (command === "check") console.log(`Valid tour for ${project.root}\n${summary(tour)}`);
    else {
      const id = store.saveTour(project, tour, assets);
      console.log(summary(tour));
      await openSaved(project, id, noBrowser);
    }
  } else if (command === "locate") {
    const root = store.gitRoot(option("--repo", process.cwd())), [file, symbol] = args;
    if (!file || !symbol) throw new Error("Usage: codesurf locate <file> <symbol>");
    const source = readSource(root, file);
    const found = findSymbol(source, languageOf(file), symbol);
    if (!found.length) throw new Error(`${symbol} not found in ${file}`);
    const lines = splitLines(source);
    for (const [a, b] of found) {
      console.log(`${file}:${a}-${b}`);
      for (let i = a; i <= Math.min(b, a + 80); i++) console.log(String(i).padStart(5) + "  " + lines[i - 1]);
      if (b > a + 80) console.log("  …");
    }
  } else if (command === "shot") {
    const { shoot } = await import("./shot.js");
    const config = { steps: [], highlight: [], labels: [], then: [] };
    let target = config.steps;
    const pair = (text, name) => {
      const i = text.lastIndexOf("=");
      if (i < 1) throw new Error(`${name} expects "SELECTOR=VALUE"`);
      return [text.slice(0, i), text.slice(i + 1)];
    };
    while (args.length) {
      const name = args.shift(), value = args[0] && !args[0].startsWith("--") ? args.shift() : undefined;
      const need = () => { if (value === undefined) throw new Error(`Missing value for ${name}`); return value; };
      if (name === "--url") config.url = need();
      else if (name === "--out") config.out = path.resolve(need());
      else if (name === "--after") config.after = path.resolve(need());
      else if (name === "--full-page") { config.fullPage = true; if (value !== undefined) args.unshift(value); }
      else if (name === "--viewport") { const [w, h] = need().split("x").map(Number); config.viewport = { width: w, height: h }; }
      else if (name === "--highlight") { config.highlight.push(need()); config.labels.push(undefined); target = config.then; }
      else if (name === "--label") config.labels[config.labels.length - 1] = need();
      else if (name === "--goto") target.push({ goto: need() });
      else if (name === "--click") target.push({ click: need() });
      else if (name === "--hover") target.push({ hover: need() });
      else if (name === "--wait-for") target.push({ waitFor: need() });
      else if (name === "--wait") target.push({ wait: Number(need()) });
      else if (name === "--fill") { const [s, v] = pair(need(), name); target.push({ fill: s, value: v }); }
      else if (name === "--select") { const [s, v] = pair(need(), name); target.push({ select: s, value: v }); }
      else if (name === "--press") { const [s, k] = pair(need(), name); target.push({ press: s, key: k }); }
      else throw new Error(`Unknown option: ${name}`);
    }
    const result = await shoot(config);
    const card = { id: "screen", kind: "screenshot", title: "TODO: what the user sees", image: result.image, url: result.url, viewport: result.viewport,
      highlights: result.highlights.map(({ selector, ...h }) => h) };
    console.log(JSON.stringify({ card, ...(result.after ? { afterCard: { id: "screen-after", kind: "screenshot", title: "TODO: the result", image: result.after.image, url: result.after.url, viewport: result.after.viewport, highlights: [] } } : {}),
      ...(result.errors.length ? { pageErrors: result.errors } : {}) }, null, 2));
  } else if (command === "example") {
    const noBrowser = flag("--no-browser");
    const root = fileURLToPath(new URL("../examples/demo-shop/", import.meta.url));
    const { project, tour, assets } = loadTour(path.join(root, "tour.json"), root);
    await openSaved(project, store.saveTour(project, tour, assets), noBrowser);
  } else if (command === "serve") {
    const { createServer, DEFAULT_PORT } = await import("./server.js");
    const port = Number(option("--port", DEFAULT_PORT));
    const token = store.readServer()?.token;
    const app = createServer({ port, ...(token ? { token } : {}) });
    await app.listen();
    store.writeServer({ port, token: app.token, pid: process.pid, started: new Date().toISOString() });
    console.log(`CodeSurf viewer: http://127.0.0.1:${port}/?token=${app.token}`);
  } else if (command === "status" || command === "stop") {
    const info = store.readServer(), status = info && await health(info.port, info.token);
    if (!status?.authorized) console.log("CodeSurf server is not running.");
    else if (command === "status") console.log(`Running at http://127.0.0.1:${info.port} (pid ${status.pid}). Projects: ${store.listProjects().map((p) => p.name).join(", ") || "none"}`);
    else { process.kill(status.pid); console.log("Stopped."); }
  } else throw new Error(`Unknown command: ${command}. Run codesurf --help.`);
} catch (error) {
  console.error("CodeSurf: " + (error.message || error));
  process.exitCode = 1;
}
