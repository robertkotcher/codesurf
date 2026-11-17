import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { validateTour } from "../validate.js";
import { checkout } from "../demo-repo/checkout.mjs";

const root = new URL("../../", import.meta.url);
const cli = new URL("public/releases/1.1.0/codesurf.mjs", root);
const example = () => JSON.parse(fs.readFileSync(new URL("../example.json", import.meta.url), "utf8"));
const run = (...args) => spawnSync(process.execPath, [cli.pathname, ...args], { encoding: "utf8" });

test("bundled demo completes payment and returns stock after a decline", async () => {
  await assert.rejects(checkout([{ sku: "tea", quantity: 8 }], "declined"), /Payment declined/);
  const paid = await checkout([{ sku: "tea", quantity: 8 }], "demo-approved");
  assert.equal(paid.status, "paid");
  assert.equal(paid.receipt.amount, 2800);
  await assert.rejects(checkout([{ sku: "tea", quantity: 1 }], "demo-approved"), /Not enough stock/);
});

test("rejects unsupported versions, duplicate IDs, invalid lines and hidden references", () => {
  for (const mutate of [
    (d) => { d.schemaVersion = 2; },
    (d) => { d.cards[1].id = d.cards[0].id; },
    (d) => { d.steps[0].focus.lines = [9000, 9001]; },
    (d) => { d.steps[0].focus.card = "checkout"; },
    (d) => { d.steps[0].revealConnections = ["start"]; },
    (d) => { d.connections[0].from.line = 999; },
    (d) => { d.files[0].sourceUrl = "https://user:secret@example.com/source"; },
  ]) {
    const data = example();
    mutate(data);
    assert.throws(() => validateTour(data));
  }
});

test("rendering embeds source safely and produces an offline HTML with protected output", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codesurf-pack-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const input = path.join(dir, "tour.json"), output = path.join(dir, "tour.html");
  const data = example();
  data.title = '</script><script>globalThis.pwned=true</script>';
  data.files[0].source += '\n// </script><img src=x onerror=alert(1)>\n';
  fs.writeFileSync(input, JSON.stringify(data));
  const result = run(input, "--out", output);
  assert.equal(result.status, 0, result.stderr);
  const html = fs.readFileSync(output, "utf8");
  const embedded = html.match(/<script id="tour-data" type="application\/json">([\s\S]*?)<\/script>/)[1];
  assert.deepEqual(JSON.parse(embedded), data);
  assert.ok(!embedded.includes("</script>"));
  assert.ok(!/<script[^>]+src=|<link[^>]+href=/.test(html));
  assert.equal(fs.statSync(output).mode & 0o777, 0o600);
  assert.equal(run(input, "--out", output).status, 1);
  fs.chmodSync(output, 0o644);
  assert.equal(run(input, "--out", output, "--force").status, 0);
  assert.equal(fs.statSync(output).mode & 0o777, 0o600);
  assert.equal(run(input, "--validate").status, 0);
});

test("single-file download supports the documented example-to-HTML workflow", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codesurf-download-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const standalone = path.join(dir, "codesurf.mjs");
  fs.copyFileSync(cli, standalone);
  const output = spawnSync(process.execPath, [standalone, "--example"], { encoding: "utf8", cwd: dir });
  assert.equal(output.status, 0, output.stderr);
  assert.equal(validateTour(JSON.parse(output.stdout)).steps.length, 6);
  const input = path.join(dir, "tour.json");
  fs.writeFileSync(input, output.stdout);
  const packaged = spawnSync(process.execPath, [standalone, input, "--out", path.join(dir, "demo.html")], { encoding: "utf8", cwd: dir });
  assert.equal(packaged.status, 0, packaged.stderr);
  assert.equal(run(input, "--made-up-option").status, 1);
});

test("supports revision-specific before and after source snapshots", () => {
  const data = {
    schemaVersion: 1, title: "Fix a guard",
    files: [
      { id: "old", path: "guard.py", language: "python", startLine: 40, source: "return amount\n", revision: "before" },
      { id: "new", path: "guard.py", language: "python", startLine: 40, source: "return max(0, amount)\n", revision: "after" },
    ],
    cards: [
      { id: "old", file: "old", title: "Old guard", range: [40, 40], diff: "before", changedLines: [40] },
      { id: "new", file: "new", title: "Fixed guard", range: [40, 40], diff: "after", changedLines: [40] },
    ], connections: [],
    steps: [{ title: "Floor the value", explanation: [{ text: "Keep the amount nonnegative." }],
      revealCards: ["old", "new"], revealConnections: [], focus: { card: "new", lines: [40, 40] } }],
  };
  assert.equal(validateTour(data), data);
});
