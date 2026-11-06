import { test } from "node:test";
import assert from "node:assert/strict";
import { layoutFolders } from "../src/layout.js";
const nodes = [
  { id: "a", file: "src/lib/api/client.ts", level: 0 },
  { id: "b", file: "src/lib/api/base.ts", level: 1 },
  { id: "c", file: "src/lib/auth/token.ts", level: 2 },
];
test("nested folders follow paths, contain descendants, and keep siblings independent", () => {
  const result = layoutFolders(nodes, new Map(), new Set());
  assert.deepEqual(result.folders.map((f) => f.key).sort(), [
    "src",
    "src/lib",
    "src/lib/api",
    "src/lib/auth",
  ]);
  for (const f of result.folders) {
    const parent = result.folders.find(
      (p) => p.key === f.key.slice(0, f.key.lastIndexOf("/")),
    );
    if (parent && parent !== f) {
      assert.ok(f.x > parent.x);
      assert.ok(f.y > parent.y);
      assert.ok(f.x + f.width < parent.x + parent.width);
    }
  }
  const collapsed = layoutFolders(nodes, new Map(), new Set(["src/lib/auth"]));
  assert.equal(collapsed.hiddenBy.get("c"), "src/lib/auth");
  assert.ok(collapsed.nodePositions.has("a"));
  assert.ok(collapsed.nodePositions.has("b"));
  assert.ok(!collapsed.nodePositions.has("c"));
  const parent = layoutFolders(
    nodes,
    new Map(),
    new Set(["src/lib", "src/lib/auth"]),
  );
  assert.equal(parent.hiddenBy.get("c"), "src/lib");
  assert.equal(parent.nodePositions.size, 0);
});
test("resizing a card grows the containing folders and preserves column separation", () => {
  const result = layoutFolders(
    nodes,
    new Map([["a", { width: 700, height: 450 }]]),
    new Set(),
  );
  const a = result.nodePositions.get("a"),
    b = result.nodePositions.get("b");
  assert.ok(b.x > a.x + a.width);
  const api = result.folders.find((f) => f.key === "src/lib/api");
  assert.ok(api.width > 700);
  assert.ok(api.height > 450);
});
