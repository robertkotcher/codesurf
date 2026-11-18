import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { resolveTour, findSymbol } from "../src/tour.js";

const demo = new URL("../examples/demo-shop/", import.meta.url).pathname;
const demoTour = () => JSON.parse(fs.readFileSync(path.join(demo, "tour.json"), "utf8"));
const resolve = (tour, root = demo) => resolveTour(tour, { root, baseDir: root });
const problems = (tour, root) => {
  try { resolve(tour, root); } catch (error) { return error.problems || [error.message]; }
  assert.fail("expected the tour to be rejected");
};

test("bundled demo resolves with one card per file and real source", () => {
  const { tour, assets } = resolve(demoTour());
  const code = tour.cards.filter((c) => c.kind === "code");
  assert.equal(new Set(code.map((c) => c.file)).size, code.length);
  const checkout = code.find((c) => c.file === "checkout");
  assert.deepEqual(checkout.sections.map((s) => s.title), ["checkout", "handleCheckout"]);
  assert.deepEqual(checkout.range, [6, 20]);
  assert.equal(tour.files.find((f) => f.id === "checkout").source, fs.readFileSync(path.join(demo, "checkout.mjs"), "utf8"));
  // Connections that pointed at a merged-away card now point at the merged card.
  assert.equal(tour.connections.find((c) => c.id === "to-handle").to.card, "checkout");
  assert.equal(assets.size, 2);
});

test("symbols resolve to exact declaration lines", () => {
  const source = fs.readFileSync(path.join(demo, "inventory.mjs"), "utf8");
  assert.deepEqual(findSymbol(source, "javascript", "reserve"), [[7, 27]]);
  assert.deepEqual(findSymbol(source, "javascript", "stock"), [[1, 4]]);
  const ts = "class Box {\n  open() {\n    return 1;\n  }\n}\nexport const open = () => 2;\n";
  assert.deepEqual(findSymbol(ts, "typescript", "Box.open"), [[2, 4]]);
  assert.equal(findSymbol(ts, "typescript", "open").length, 2);
  const py = "@cache\ndef load(x):\n    if x:\n        return 1\n\n    return 2\n\nclass A:\n    pass\n";
  assert.deepEqual(findSymbol(py, "python", "load"), [[1, 6]]);
  const rb = "class User\n  def name\n    @name\n  end\nend\n";
  assert.deepEqual(findSymbol(rb, "ruby", "name"), [[2, 4]]);
});

test("text guards catch off-by-one line numbers", () => {
  const tour = demoTour();
  tour.connections[1].from.line = 11;
  const found = problems(tour);
  assert.match(found.join("\n"), /expected "fetch\("\/checkout"" on public\/cart\.js:11, found "method: "POST","/);
});

test("rejects unknown files, symbols, ranges, cards and properties with clear messages", () => {
  const mutations = [
    [(t) => { t.schemaVersion = 1; }, /schemaVersion must be 2/],
    [(t) => { t.extra = true; }, /Unknown top-level property "extra"/],
    [(t) => { t.files[0].path = "missing.js"; }, /File page: .*missing\.js/],
    [(t) => { t.files[0].path = "../outside.js"; }, /outside the repository/],
    [(t) => { t.cards[4].symbol = "nope"; }, /symbol "nope" was not found/],
    [(t) => { t.cards[2].range = [1, 9999]; }, /outside server\.mjs/],
    [(t) => { t.connections[0].to.card = "ghost"; }, /unknown card "ghost"/],
    [(t) => { t.connections[0].from.highlight = 5; }, /no highlight 5/],
    [(t) => { t.cards.push({ id: "lonely", kind: "note", title: "x", body: "y" }); }, /lonely is never shown/],
    [(t) => { t.cards[0].image = "shots/missing.png"; }, /image not found/],
  ];
  for (const [mutate, expected] of mutations) {
    const tour = demoTour();
    mutate(tour);
    assert.match(problems(tour).join("\n"), expected);
  }
});

test("steps reveal referenced cards and leftover connections automatically", () => {
  const tour = {
    schemaVersion: 2, title: "t",
    files: [{ id: "c", path: "checkout.mjs" }, { id: "p", path: "payments.mjs" }],
    cards: [{ id: "a", file: "c", symbol: "checkout" }, { id: "b", file: "p", symbol: "charge" }],
    connections: [{ id: "e", from: { card: "a", line: 9, text: "charge(" }, to: { card: "b", line: 2 }, label: "Charge", kind: "call" }],
    steps: [{ title: "one", explanation: "plain text works", focus: { card: "a", lines: [6, 9] } },
      { title: "two", explanation: [{ text: "charge", target: { card: "b", lines: [2, 7] } }] }],
  };
  const resolved = resolve(tour).tour;
  assert.deepEqual(resolved.steps[0].revealCards, ["a"]);
  assert.deepEqual(resolved.steps[1].revealCards, ["b"]);
  assert.deepEqual(resolved.steps[1].revealConnections, ["e"]);
});

test("files can be read at a git revision for before/after views", () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "codesurf-git-"));
  const git = (...args) => execFileSync("git", ["-C", repo, ...args], { stdio: "pipe" });
  git("init", "-q");
  fs.writeFileSync(path.join(repo, "a.js"), "export function f() {\n  return 1;\n}\n");
  git("add", "."); git("-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-qm", "one");
  fs.writeFileSync(path.join(repo, "a.js"), "export function f() {\n  return 2;\n}\n");
  const { tour } = resolve({
    schemaVersion: 2, title: "diff",
    files: [{ id: "old", path: "a.js", ref: "HEAD" }, { id: "new", path: "a.js" }],
    cards: [{ id: "b", file: "old", symbol: "f", diff: "before", changedLines: [2] }, { id: "n", file: "new", symbol: "f", diff: "after", changedLines: [2] }],
    steps: [{ title: "x", explanation: [{ text: "was 1", target: { card: "b", lines: [2, 2], text: "1" } }, { text: "now 2", target: { card: "n", lines: [2, 2], text: "2" } }] }],
  }, repo);
  assert.equal(tour.cards.length, 2);
  assert.match(tour.files[0].source, /return 1/);
  assert.equal(tour.files[0].hash, undefined);
  assert.ok(tour.files[1].hash);
});
