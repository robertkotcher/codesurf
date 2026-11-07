import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { JSDOM, VirtualConsole } from "jsdom";
import { buildFileGraph, pathFocus, lineOnPath } from "../src/graph.js";
import { writeReport } from "../src/report.js";

const sources = {
  "src/api/client.ts": [
    "function entry() {",
    "  const result = refresh();",
    "  noise();",
    "  return result;",
    "}",
    "function refresh() {",
    "  return prepare();",
    "}",
    "function prepare() {",
    "  return save();",
    "}",
    "function noise() { return 0; }",
  ],
  "src/model/store.ts": ["function save() {", "  return true;", "}"],
};
function trace() {
  const fn = (id, name, file, start, end, level, calls) => ({
    id,
    name,
    file,
    absolute: "/fixture/" + file,
    start,
    end,
    level,
    calls,
    changed: [],
    lines: sources[file].slice(start - 1, end),
    relevantLines: Array.from({ length: end - start + 1 }, (_, i) => start + i),
  });
  const call = (target, line) => ({
    target,
    line,
    column: 2,
    label: target,
    length: target.length,
    kind: "resolved",
  });
  return [
    fn("entry", "entry", "src/api/client.ts", 1, 5, 0, [
      call("refresh", 2),
      call("noise", 3),
    ]),
    fn("refresh", "refresh", "src/api/client.ts", 6, 8, 1, [
      call("prepare", 7),
    ]),
    fn("prepare", "prepare", "src/api/client.ts", 9, 11, 2, [call("save", 10)]),
    fn("noise", "noise", "src/api/client.ts", 12, 12, 1, []),
    fn("save", "save", "src/model/store.ts", 1, 3, 3, []),
  ];
}
test("each file has one panel and keeps all function calls, including same-file relationships", () => {
  const graph = buildFileGraph(trace(), sources);
  assert.equal(graph.panels.size, 2);
  const panel = graph.panels.get("file:src/api/client.ts");
  assert.equal(panel.members.length, 4);
  assert.equal(panel.level, 0);
  assert.equal(panel.end, 12);
  assert.equal(graph.edges.length, 4);
  assert.equal(
    graph.edges.filter(
      (e) =>
        graph.panelForFunction.get(e.from) === graph.panelForFunction.get(e.to),
    ).length,
    3,
  );
});
test("line focus follows callers and transitive callees without unrelated sibling branches", () => {
  const graph = buildFileGraph(trace(), sources),
    focus = pathFocus(graph, { file: "src/api/client.ts", line: 6 });
  assert.deepEqual([...focus.functions].sort(), [
    "entry",
    "prepare",
    "refresh",
    "save",
  ]);
  assert.equal(focus.edgeIds.size, 3);
  assert.ok(lineOnPath(graph, focus, "src/model/store.ts", 2));
  assert.ok(lineOnPath(graph, focus, "src/api/client.ts", 7));
  assert.ok(!lineOnPath(graph, focus, "src/api/client.ts", 3));
  assert.ok(!lineOnPath(graph, focus, "src/api/client.ts", 12));
  const noise = pathFocus(graph, { file: "src/api/client.ts", line: 3 });
  assert.deepEqual([...noise.functions].sort(), ["entry", "noise"]);
  assert.equal(noise.edgeIds.size, 1);
});
test("recursive calls terminate and stay in the focused path", () => {
  const nodes = trace();
  nodes
    .at(-1)
    .calls.push({
      target: "refresh",
      line: 2,
      column: 2,
      label: "refresh",
      length: 7,
    });
  const graph = buildFileGraph(nodes, sources),
    focus = pathFocus(graph, { file: "src/api/client.ts", line: 6 });
  assert.equal(focus.edgeIds.size, 4);
  assert.ok(!focus.functions.has("noise"));
});
test("merged file panels render loop arrows, transitive hover focus, pinned focus, and reset", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codesurf-focus-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const out = path.join(dir, "report.html"),
    nodes = trace();
  writeReport(
    {
      roots: ["/fixture"],
      question: "Trace a refresh",
      entry: "entry",
      nodes,
      definitions: nodes,
      sources,
      summary: "Refreshes and saves a value.",
    },
    out,
  );
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
    frame = () =>
      new Promise((resolve) => dom.window.requestAnimationFrame(resolve));
  for (const id of [...d.querySelectorAll('[data-function-toggle][aria-expanded="false"]')].map(b => b.dataset.functionToggle)) d.querySelector(`[data-function-toggle="${id}"]`).click();
  await frame();
  assert.equal(d.querySelectorAll(".node").length, 2);
  assert.equal(d.querySelectorAll(".self-loop").length, 3);
  assert.equal(
    d.querySelectorAll('[data-file="src/api/client.ts"][data-line="7"]').length,
    1,
  );
  const row = d.querySelector('[data-file="src/api/client.ts"][data-line="6"]');
  row.dispatchEvent(
    new dom.window.MouseEvent("pointerover", { bubbles: true }),
  );
  assert.equal(d.querySelectorAll(".edge.path-active[data-edge-id]").length, 3);
  assert.ok(
    d
      .querySelector('[data-file="src/model/store.ts"][data-line="2"]')
      .classList.contains("path-active"),
  );
  assert.ok(
    d
      .querySelector('[data-file="src/api/client.ts"][data-line="12"]')
      .classList.contains("path-muted"),
  );
  row.querySelector(".line-pin").click();
  row.dispatchEvent(new dom.window.MouseEvent("pointerout", { bubbles: true }));
  assert.equal(d.querySelectorAll(".edge.path-active[data-edge-id]").length, 3);
  const noise = d.querySelector(
    '[data-file="src/api/client.ts"][data-line="3"]',
  );
  noise.dispatchEvent(
    new dom.window.MouseEvent("pointerover", { bubbles: true }),
  );
  assert.equal(d.querySelectorAll(".edge.path-active[data-edge-id]").length, 1);
  noise.dispatchEvent(
    new dom.window.MouseEvent("pointerout", { bubbles: true }),
  );
  assert.equal(d.querySelectorAll(".edge.path-active[data-edge-id]").length, 3);
  d.dispatchEvent(
    new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  assert.equal(d.querySelectorAll(".path-muted").length, 0);
  assert.equal(d.querySelectorAll(".edge.path-active").length, 0);
  d.querySelector('[data-folder="src/api"]').click();
  await frame();
  assert.equal(d.querySelectorAll(".self-loop").length, 0);
  assert.ok(d.querySelector('[data-from-folder="src/api"]'));
  assert.deepEqual(errors, []);
});
