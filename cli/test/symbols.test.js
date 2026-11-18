import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { hover, definitions } from "../src/symbols.js";

const demo = new URL("../examples/demo-shop/", import.meta.url).pathname;
const has = (command, args) => { try { execFileSync(command, args, { stdio: "ignore" }); return true; } catch { return false; } };

test("TypeScript service gives types on hover and cross-file definitions", () => {
  const info = hover(demo, "checkout.mjs", 7, 24);
  assert.match(info.signature, /reserve\(cart: any\)/);
  assert.match(info.signature, /total: number/);
  const [def] = definitions(demo, "checkout.mjs", 7, 24);
  assert.deepEqual({ path: def.path, line: def.line, range: def.range }, { path: "inventory.mjs", line: 7, range: [6, 27] });
});

test("library definitions come back as external excerpts", () => {
  const [def] = definitions(demo, "public/cart.js", 10, 26);
  assert.equal(def.external, true);
  assert.match(def.path, /^typescript\/lib\/lib\.dom/);
  assert.match(def.excerpt.source, /declare function fetch/);
});

test("Python definitions resolve through the static index", { skip: !has("python3", ["--version"]) }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codesurf-py-"));
  fs.mkdirSync(path.join(root, "app"));
  fs.writeFileSync(path.join(root, "app/__init__.py"), "");
  fs.writeFileSync(path.join(root, "app/main.py"), "from app.util import greet\n\ndef main(name: str) -> str:\n    return greet(name)\n");
  fs.writeFileSync(path.join(root, "app/util.py"), "def greet(name: str, loud: bool = False) -> str:\n    return name\n");
  const [def] = definitions(root, "app/main.py", 4, 12);
  assert.deepEqual({ path: def.path, line: def.line }, { path: "app/util.py", line: 1 });
  assert.match(hover(root, "app/main.py", 4, 12).signature, /def greet/);
});

test("other languages fall back to name matches", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codesurf-go-"));
  execFileSync("git", ["init", "-q", root]);
  fs.writeFileSync(path.join(root, "main.go"), "package main\n\nfunc helper() int { return 1 }\n\nfunc main() { helper() }\n");
  const [def] = definitions(root, "main.go", 5, 15);
  assert.deepEqual({ path: def.path, line: def.line, guess: def.guess }, { path: "main.go", line: 3, guess: true });
});
