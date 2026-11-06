#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { analyze } from "./analyze.js";
import { planTrace } from "./planner.js";
import { writeReport } from "./report.js";

const args = process.argv.slice(2);
if (args.includes("--version")) {
  console.log(JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url))).version);
  process.exit(0);
}
if (args[0] === "--demo") args.splice(0, 1,
  fileURLToPath(new URL("../examples/auth-refresh", import.meta.url)),
  "Trace an authenticated request that gets a 401, refreshes the token, and retries once.",
  "--static", "--entry", "api/client.ts#request");
const help = `CodeSurf — code-backed execution maps

  codesurf <repository> ["natural-language scenario"] [options]

  --repo <path>       Add another repository (repeatable)
  --entry <file#name> Pin the starting function, relative to repository
  --depth <0..12>     Call depth (default: 4)
  --limit <1..150>    Maximum functions (default: 36)
  --out <file.html>   Report destination (JSON saved alongside it)
  --no-open          Save without opening a window
  --languages <ids>  Enable adapters: typescript,python,ruby (comma-separated)
  --static           Skip LLM investigation; use keyword matching

Ruby / Python / TypeScript / JavaScript (Node ESM and CommonJS).
Uses your logged-in Codex CLI to investigate source.
Python: newest Python 3.10+ on PATH, or CODESURF_PYTHON.
Ruby: Ruby with Ripper on PATH, or CODESURF_RUBY; runtime must support project syntax.
--demo opens the bundled offline example. --static works offline.
Example:
  codesurf ~/my-app "What happens when a user submits an empty title?"
`;
if (!args.length || args.includes("--help") || args.includes("-h")) {
  console.log(help);
  process.exit(0);
}
try {
  const roots = [args.shift()],
    words = [];
  while (args[0] && !args[0].startsWith("--")) words.push(args.shift());
  const question = words.join(" ");
  const opts = {};
  let out,
    open = true,
    staticMode = false;
  while (args.length) {
    const flag = args.shift();
    if (flag === "--no-open") {
      open = false;
      continue;
    }
    if (flag === "--static") {
      staticMode = true;
      continue;
    }
    if (!["--repo", "--entry", "--depth", "--limit", "--out", "--languages"].includes(flag))
      throw new Error(`Unknown option: ${flag}`);
    const value = args.shift();
    if (!value || value.startsWith("--"))
      throw new Error(`Missing value for ${flag}`);
    if (flag === "--languages") opts.languages = value.split(",").map(id => id.trim());
    if (flag === "--repo") roots.push(value);
    if (flag === "--entry") opts.entry = value;
    if (flag === "--out") out = path.resolve(value);
    if (flag === "--depth" || flag === "--limit") {
      const n = Number(value),
        min = flag === "--depth" ? 0 : 1,
        max = flag === "--depth" ? 12 : 150;
      if (!Number.isInteger(n) || n < min || n > max)
        throw new Error(`${flag} must be between ${min} and ${max}`);
      opts[flag.slice(2)] = n;
    }
  }
  let report;
  if (!question) {
    if (!open) throw new Error("Supply a question when using --no-open.");
    report = {
      question: "",
      roots: roots.map((r) => fs.realpathSync(r)),
      nodes: [],
      definitions: [],
      sources: {},
      mode: "welcome",
      scanned: 0,
      symbols: 0,
    };
  } else {
    console.log("Indexing source and resolving calls…");
    if (staticMode) report = analyze(roots, question, opts);
    else {
      const index = analyze(roots, question, { ...opts, catalog: true });
      console.log(
        "Asking Codex to investigate your scenario (uses your Codex account)…",
      );
      let lastProgress = 0;
      report = await planTrace(index, {
        entry: opts.entry,
        onProgress: (message) => {
          if (Date.now() - lastProgress > 8000) {
            console.log(message);
            lastProgress = Date.now();
          }
        },
      });
      Object.assign(
        report,
        index.getSymbolData(report.nodes.map((n) => n.file)),
      );
    }
  }
  out ||= path.join(
    os.homedir(),
    ".codesurf",
    "reports",
    `trace-${Date.now()}.html`,
  );
  writeReport(report, out);
  for (const diagnostic of report.diagnostics || [])
    console.error(`Source diagnostic: ${diagnostic}`);
  console.log(
    `${report.scanned} files · ${report.symbols} functions indexed · ${report.nodes.length} in this map\n${out}`,
  );
  if (open) {
    const { default: electron } = await import("electron");
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(
      electron,
      [fileURLToPath(new URL("./window.cjs", import.meta.url)), out],
      { detached: true, stdio: "ignore", env },
    );
    child.on("error", (e) =>
      console.error(
        `Window could not open: ${e.message}. Open the report path above.`,
      ),
    );
    child.unref();
  }
} catch (e) {
  console.error(`CodeSurf: ${e.message}`);
  process.exitCode = 1;
}
