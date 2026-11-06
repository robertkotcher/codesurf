import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { JSDOM, VirtualConsole } from "jsdom";
import { analyze } from "../src/analyze.js";
import { applyPlan } from "../src/planner.js";
import { writeReport } from "../src/report.js";

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codesurf-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(
    path.join(root, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } }),
  );
  fs.writeFileSync(
    path.join(root, "src/service.ts"),
    "export const lookup = (id: string) => id.trim();\n",
  );
  fs.writeFileSync(
    path.join(root, "src/route.ts"),
    `import { lookup as find } from '@/service';
export function POST() {
  const payload = '</script><img src=x onerror=alert(1)>';
  const padding = 1;
  const other = 2;
  const result = find('hello');
  return result;
}
`,
  );
  return root;
}

test("resolves aliased imports, preserves line numbers, bounds traversal, and marks external calls", (t) => {
  const root = fixture(t);
  const r = analyze([root], "Trace POST", { entry: "src/route.ts#POST" });
  assert.equal(r.nodes.length, 2);
  assert.equal(r.nodes[0].calls[0].target, r.nodes[1].id);
  assert.equal(r.nodes[0].calls[0].line, 6);
  assert.equal(r.nodes[1].calls[0].kind, "boundary");
  assert.equal(analyze([root], "POST", { depth: 0 }).nodes.length, 1);
  assert.throws(
    () => analyze([root], "nonexistent-symbol"),
    /No matching entry/,
  );
});

test("Git highlights staged and unstaged additions against HEAD", (t) => {
  const root = fixture(t);
  const git = (...args) =>
    execFileSync("git", ["-C", root, ...args], { stdio: "pipe" });
  git("init");
  git("add", ".");
  git(
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "-m",
    "fixture",
  );
  fs.writeFileSync(
    path.join(root, "src/service.ts"),
    "export const lookup = (id: string) => id.toUpperCase();\n",
  );
  git("add", ".");
  assert.deepEqual(analyze([root], "lookup").nodes[0].changed, [1]);
});

test("graph expands source, anchors edges to row sides, opens token questions, and zooms safely", async (t) => {
  const root = fixture(t),
    out = path.join(root, "report.html");
  execFileSync(process.execPath, [
    "src/cli.js",
    root,
    "POST",
    "--depth",
    "4",
    "--static",
    "--out",
    out,
    "--no-open",
  ]);
  const errors = [],
    console = new VirtualConsole();
  console.on("jsdomError", (e) => errors.push(e.message));
  const dom = new JSDOM(fs.readFileSync(out, "utf8"), {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole: console,
    beforeParse(window) {
      window.ResizeObserver = class {
        observe() {}
        disconnect() {}
      };
    },
  });
  t.after(() => dom.window.close());
  const d = dom.window.document;
  const nextFrame = () =>
    new Promise((resolve) => dom.window.requestAnimationFrame(resolve));
  await nextFrame();
  assert.equal(d.querySelectorAll("article").length, 2);
  assert.equal(d.querySelectorAll("img").length, 0);
  d.querySelector("[data-below]").click();
  assert.match(d.querySelector(".snippet").textContent, /<\/script><img/);
  assert.equal(d.querySelectorAll("img").length, 0);
  const link = [...d.querySelectorAll("[data-token]")].find(
    (button) =>
      button.textContent === "find" && button.dataset.tokenLine === "6",
  );
  link.click();
  assert.equal(d.querySelectorAll(".chat").length, 1);
  assert.equal(d.querySelector("#token-definition"), null);
  const cards = [...d.querySelectorAll("article")];
  assert.ok(parseFloat(cards[1].style.left) > parseFloat(cards[0].style.left));
  const edge = d.querySelector(".edge[data-from-line]");
  assert.equal(edge.dataset.fromLine, "6");
  assert.equal(edge.dataset.fromSide, "right");
  assert.equal(edge.dataset.toSide, "left");
  assert.equal(cards[0].querySelector("[data-line-port]"), null);
  const coords = edge
    .getAttribute("d")
    .match(/-?\d+(?:\.\d+)?/g)
    .map(Number);
  assert.equal(
    coords[0],
    parseFloat(cards[0].style.left) + parseFloat(cards[0].style.width),
  );
  assert.equal(coords.at(-2), parseFloat(cards[1].style.left));
  d.querySelector("[data-wrap]").click();
  assert.ok(d.querySelector(".snippet.wrap"));
  const before = d.querySelector("#world").style.transform;
  d.querySelector("#plus").click();
  assert.notEqual(d.querySelector("#world").style.transform, before);
  d.querySelector("#minus").click();
  const numbers = (s) => s.match(/-?\d+(?:\.\d+)?/g).map(Number);
  numbers(before).forEach((n, i) =>
    assert.ok(
      Math.abs(numbers(d.querySelector("#world").style.transform)[i] - n) <
        1e-8,
    ),
  );
  // Expanding above the function includes its imports, without executing source markup.
  d.querySelector("[data-above]").click();
  assert.match(
    cards[0].textContent + d.querySelector("article").textContent,
    /import/,
  );
  assert.deepEqual(errors, []);
});

test("LLM plan validates selected code, rejects invented lines, and preserves omitted branches", (t) => {
  const root = fixture(t),
    index = analyze([root], "Explain the request", { catalog: true });
  const entry = index.definitions.find((n) => n.name === "POST");
  const lookup = index.definitions.find((n) => n.name === "lookup");
  const plan = {
    entryId: entry.id,
    title: "Find a value",
    summary: "Trims the value.",
    assumptions: [],
    omitted: [],
    steps: [
      {
        id: entry.id,
        reason: "Handles request",
        lines: [2, 6, 7],
        skipCalls: [],
      },
      { id: lookup.id, reason: "Trims input", lines: [1], skipCalls: [] },
    ],
  };
  const report = applyPlan(index, plan);
  assert.equal(report.nodes[1].level, 1);
  assert.equal(report.mode, "llm");
  assert.equal(report.groups, undefined);
  assert.deepEqual(report.nodes[0].relevantLines, [2, 6, 7]);
  assert.throws(
    () =>
      applyPlan(index, {
        ...plan,
        steps: [{ ...plan.steps[0], lines: [900] }],
      }),
    /invalid source lines/,
  );
  assert.throws(
    () =>
      applyPlan(index, {
        ...plan,
        steps: [
          { ...plan.steps[0], skipCalls: [{ line: 6, reason: "Irrelevant" }] },
          plan.steps[1],
        ],
      }),
    /without a verified path/,
  );
  assert.throws(
    () =>
      applyPlan(index, {
        ...plan,
        steps: [{ ...plan.steps[0], id: "invented" }],
      }),
    /unknown/,
  );
});

test("question form submits natural language through the desktop bridge", async (t) => {
  const root = fixture(t),
    out = path.join(root, "welcome.html");
  // Welcome generation needs no source analysis or LLM; disable desktop opening via a generated static report fixture.
  execFileSync(process.execPath, [
    "src/cli.js",
    root,
    "POST",
    "--static",
    "--out",
    out,
    "--no-open",
  ]);
  let question;
  const dom = new JSDOM(fs.readFileSync(out, "utf8"), {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    beforeParse(window) {
      window.ResizeObserver = class {
        observe() {}
        disconnect() {}
      };
      window.codesurf = {
        trace: async (value) => {
          question = value;
        },
        onProgress: () => {},
      };
    },
  });
  t.after(() => dom.window.close());
  dom.window.document.querySelector("#question-input").value =
    "What happens if someone sends an empty value?";
  dom.window.document
    .querySelector("#ask")
    .dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
  await Promise.resolve();
  assert.equal(question, "What happens if someone sends an empty value?");
});

test("token questions stream into independent persistent panels and fade on click-away", async (t) => {
  const root = fixture(t),
    out = path.join(root, "report.html");
  execFileSync(process.execPath, [
    "src/cli.js",
    root,
    "POST",
    "--static",
    "--out",
    out,
    "--no-open",
  ]);
  const pending = [];
  let onInspect;
  const dom = new JSDOM(fs.readFileSync(out, "utf8"), {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    url: "http://codesurf.test/",
    beforeParse(w) {
      w.ResizeObserver = class {
        observe() {}
        disconnect() {}
      };
      w.codesurf = {
        onProgress: () => {},
        onInspect: (callback) => {
          onInspect = callback;
        },
        inspect: (selection) =>
          new Promise((resolve) => pending.push({ selection, resolve })),
      };
    },
  });
  t.after(() => dom.window.close());
  const d = dom.window.document;
  const token = [...d.querySelectorAll("[data-token]")].find(
    (b) => b.textContent === "find" && b.dataset.tokenLine === "6",
  );
  token.click();
  const first = d.querySelector(".chat");
  first.querySelector("input").value = "What does this do?";
  first
    .querySelector("form")
    .dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
  onInspect({
    requestId: pending[0].selection.requestId,
    type: "progress",
    message: "Reading repository source…",
  });
  assert.match(
    first.querySelector(".chat-progress").textContent,
    /Reading repository/,
  );
  onInspect({
    requestId: pending[0].selection.requestId,
    type: "delta",
    text: "It looks ",
  });
  onInspect({
    requestId: pending[0].selection.requestId,
    type: "delta",
    text: "up a value.",
  });
  assert.match(first.textContent, /It looks up a value/);
  token.click();
  const second = d.querySelectorAll(".chat")[1];
  assert.ok(first.classList.contains("inactive"));
  second.querySelector("input").value = "What about empty input?";
  second
    .querySelector("form")
    .dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
  onInspect({
    requestId: pending[1].selection.requestId,
    type: "delta",
    text: "Empty input stays empty.",
  });
  assert.match(second.textContent, /Empty input stays empty/);
  assert.doesNotMatch(first.textContent, /Empty input stays empty/);
  for (const p of pending) {
    onInspect({
      requestId: p.selection.requestId,
      type: "done",
      answer: "[Reference](https://example.com/docs)",
    });
    p.resolve({ answer: "[Reference](https://example.com/docs)" });
  }
  await new Promise((resolve) => dom.window.requestAnimationFrame(resolve));
  assert.equal(d.querySelectorAll(".chat").length, 2);
  assert.equal(first.querySelector("a").href, "https://example.com/docs");
  d.querySelector("#viewport").click();
  assert.ok(
    [...d.querySelectorAll(".chat")].every((c) =>
      c.classList.contains("inactive"),
    ),
  );
  assert.ok(dom.window.localStorage.length > 0);
});

test("middle gaps are muted non-interactive markers and only context controls expand source", (t) => {
  const root = fixture(t),
    out = path.join(root, "report.html");
  execFileSync(process.execPath, [
    "src/cli.js",
    root,
    "POST",
    "--static",
    "--out",
    out,
    "--no-open",
  ]);
  const report = JSON.parse(
    fs.readFileSync(out.replace(".html", ".json"), "utf8"),
  );
  report.nodes[0].relevantLines = [2, 6, 7];
  report.groups = [
    {
      id: "boundary",
      label: "Request entry",
      description: "Fixture role",
      files: ["src/route.ts"],
    },
    {
      id: "values",
      label: "Value handling",
      description: "Fixture role",
      files: ["src/service.ts"],
    },
  ];
  for (const n of report.nodes)
    n.groupId = n.file === "src/route.ts" ? "boundary" : "values";
  writeReport(report, out);
  const dom = new JSDOM(fs.readFileSync(out, "utf8"), {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    beforeParse(w) {
      w.ResizeObserver = class {
        observe() {}
        disconnect() {}
      };
    },
  });
  t.after(() => dom.window.close());
  const d = dom.window.document;
  assert.equal(d.querySelectorAll("[data-gap], [data-expand]").length, 0);
  assert.ok(d.querySelector(".fold"));
  assert.equal(d.querySelectorAll(".folder").length, 1);
  assert.match(d.querySelector(".folder").textContent, /src/);
  assert.equal(d.querySelector(".fold").tagName, "DIV");
  d.querySelector("[data-below]").click();
  assert.match(
    d.querySelector("article .snippet").textContent,
    /const padding/,
  );
});

test("question and response live in the graph, reserve their own lane, and connect to a collapsed entry folder", async (t) => {
  const root = fixture(t),
    out = path.join(root, "overview.html");
  const report = analyze([root], "What happens when the user sends a value?", {
    entry: "src/route.ts#POST",
  });
  report.title = "Follow the request";
  report.summary = "The handler looks up and normalizes the value.";
  writeReport(report, out);
  const errors = [],
    vc = new VirtualConsole();
  vc.on("jsdomError", (e) => errors.push(e.message));
  const dom = new JSDOM(fs.readFileSync(out, "utf8"), {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(w) {
      w.ResizeObserver = class {
        observe() {}
        disconnect() {}
      };
    },
  });
  t.after(() => dom.window.close());
  const d = dom.window.document,
    nextFrame = () =>
      new Promise((resolve) => dom.window.requestAnimationFrame(resolve));
  await nextFrame();
  const overview = d.querySelector("#trace-overview");
  assert.equal(overview.parentElement.id, "world");
  assert.equal(d.querySelector(".summary"), null);
  assert.equal(
    d.querySelector("#overview-question").textContent,
    report.question,
  );
  assert.equal(d.querySelector("#summary").textContent, report.summary);
  const overviewRight = parseFloat(overview.style.left) + 350;
  for (const element of d.querySelectorAll(".node,.folder"))
    assert.ok(parseFloat(element.style.left) > overviewRight);
  assert.equal(d.querySelector(".overview-edge").dataset.to, report.entry);
  const before = d.querySelector("#world").style.transform;
  d.querySelector("#plus").click();
  assert.notEqual(d.querySelector("#world").style.transform, before);
  d.querySelector('[data-folder="src"]').click();
  await nextFrame();
  assert.equal(d.querySelector(".overview-edge").dataset.toFolder, "src");
  assert.equal(d.querySelectorAll(".node:not([hidden])").length, 0);
  assert.deepEqual(errors, []);
});
