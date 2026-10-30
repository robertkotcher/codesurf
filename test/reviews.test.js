import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
const root = await mkdtemp(path.join(os.tmpdir(), "codesurf-reviews-"));
process.env.CODESURF_REVIEW_DIR = root;
process.env.CODESURF_RUN_DIR = path.join(root, "runs");
const {
  parseFileChanges,
  validateBreakdown,
  ensureReview,
  getReview,
  reviewView,
  reviewId,
  startChangeRun,
} = await import("../reviews.js");
const source = {
  baseRepo: "acme/shop",
  repo: "acme/shop",
  number: 7,
  head: "commit-a",
  base: "base-a",
  title: "Add checkout",
};
const files = [
  {
    filename: "checkout.js",
    status: "modified",
    additions: 2,
    deletions: 1,
    patch:
      "@@ -8,3 +8,4 @@ function checkout\n context\n-old\n+new\n+validation\n last",
  },
  {
    filename: "checkout.test.js",
    status: "added",
    additions: 1,
    deletions: 0,
    patch: "@@ -0,0 +1 @@\n+test checkout",
  },
];
const data = {
  changes: [
    {
      title: "Reject empty carts",
      description: "An empty cart cannot proceed to payment.",
      instructions: "Open checkout with an empty cart and inspect the error.",
      expected: "An empty-cart error appears.",
      hunkIds: ["f1h1", "f2h1"],
    },
  ],
  excluded: [],
};
const ready = async (owner, id) => {
  for (let i = 0; i < 100; i++) {
    const r = await getReview(owner, id);
    if (r.status !== "loading") return r;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw Error("Review did not finish");
};
test.after(() => rm(root, { recursive: true, force: true }));
test("diff rows retain separate old/new line numbers and exact file identities", () => {
  const parsed = parseFileChanges(files);
  assert.deepEqual(
    parsed[0].hunks[0].rows.map((r) => [r.kind, r.old, r.new]),
    [
      ["context", 8, 8],
      ["removed", 9, null],
      ["added", null, 9],
      ["added", null, 10],
      ["context", 10, 11],
    ],
  );
  assert.equal(parsed[1].hunks[0].rows[0].new, 1);
  assert.equal(parsed[1].path, "checkout.test.js");
  assert.equal(
    parseFileChanges([{ filename: "asset.png", status: "modified" }])[0]
      .hunks[0].unavailable,
    true,
  );
});
test("truncated patches retain available code and explicitly mark missing changes", () => {
  const [file] = parseFileChanges([{ ...files[0], additions: 20 }]);
  assert.equal(file.hunks.length, 2);
  assert.ok(file.hunks[0].rows.length);
  assert.equal(file.hunks[1].unavailable, true);
});
test("every diff hunk is accounted for and invented code references are rejected", () => {
  assert.equal(
    validateBreakdown(data, parseFileChanges(files))[0].id,
    "change-1",
  );
  assert.throws(
    () =>
      validateBreakdown(
        { ...data, changes: [{ ...data.changes[0], hunkIds: ["f1h1"] }] },
        parseFileChanges(files),
      ),
    /all changed code/,
  );
  assert.throws(
    () =>
      validateBreakdown(
        { ...data, changes: [{ ...data.changes[0], hunkIds: ["not-real"] }] },
        parseFileChanges(files),
      ),
    /outside/,
  );
});
test("concurrent page opens share one analysis; a saved breakdown is reused", async () => {
  let calls = 0,
    loads = 0;
  const generate = async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 25));
    return data;
  };
  const load = async () => {
    loads++;
    return files;
  };
  const [a, b] = await Promise.all([
    ensureReview("alice", source, load, { generate }),
    ensureReview("alice", source, load, { generate }),
  ]);
  assert.equal(a.id, b.id);
  assert.equal((await ready("alice", a.id)).status, "ready");
  const cached = await ensureReview(
    "alice",
    source,
    () => {
      throw Error("Must use cache");
    },
    {
      generate: () => {
        throw Error("Must not call AI twice");
      },
    },
  );
  assert.equal(cached.changes.length, 1);
  assert.equal(calls, 1);
  assert.equal(loads, 1);
  const view = await reviewView(cached);
  assert.equal(view.owner, undefined);
  assert.equal(view.runIds, undefined);
  await assert.rejects(getReview("bob", a.id), (error) => error.status === 404);
});
test("cache identity changes with head, base and signed-in owner", () => {
  const id = reviewId("alice", source);
  assert.notEqual(reviewId("alice", { ...source, head: "commit-b" }), id);
  assert.notEqual(reviewId("alice", { ...source, base: "base-b" }), id);
  assert.notEqual(reviewId("bob", source), id);
});
test("failed analysis retries only when requested and never presents invented fallback changes", async () => {
  const other = { ...source, number: 8 };
  let calls = 0;
  const generate = async () => {
    calls++;
    throw Error("Model unavailable");
  };
  const first = await ensureReview("alice", other, async () => files, {
    generate,
  });
  const failed = await ready("alice", first.id);
  assert.equal(failed.status, "failed");
  assert.deepEqual(failed.changes, []);
  await ensureReview("alice", other, async () => files, { generate });
  assert.equal(calls, 1);
  const retried = await ensureReview("alice", other, async () => files, {
    retry: true,
    generate: async () => data,
  });
  assert.equal((await ready("alice", retried.id)).status, "ready");
});

test("a pending launch cannot be shared with another account", async () => {
  const plan = await getReview("alice", reviewId("alice", source));
  let entered, release;
  const waiting = new Promise((resolve) => {
    entered = resolve;
  });
  const hold = new Promise((resolve) => {
    release = resolve;
  });
  const alice = startChangeRun("alice", plan.id, "change-1", {
    verifySource: async () => {
      entered();
      await hold;
      throw Object.assign(new Error("PR changed"), { status: 412 });
    },
  });
  const rejectedAlice = assert.rejects(alice, (error) => error.status === 412);
  await waiting;
  await assert.rejects(
    startChangeRun("bob", plan.id, "change-1"),
    (error) => error.status === 404,
  );
  release();
  await rejectedAlice;
});
