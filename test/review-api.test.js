import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { seal } from "../lib.js";
const root = await mkdtemp(path.join(os.tmpdir(), "codesurf-review-api-"));
Object.assign(process.env, {
  NODE_ENV: "test",
  CODESURF_LOCAL: "0",
  CODESURF_REVIEW_DIR: path.join(root, "reviews"),
  CODESURF_RUN_DIR: path.join(root, "runs"),
  SESSION_SECRET: "review-api-secret-".repeat(4),
  APP_URL: "http://localhost:5179",
  OPENAI_API_KEY: "test-not-a-real-key",
});
const realFetch = globalThis.fetch;
let modelCalls = 0,
  head = "head-a";
globalThis.fetch = async (url, options = {}) => {
  const u = String(url);
  if (u.startsWith("https://api.github.com/")) {
    assert.equal(options.headers.Authorization, "Bearer test-github-token");
    if (u.includes("/files?"))
      return Response.json([
        {
          filename: "checkout.js",
          status: "modified",
          additions: 1,
          deletions: 1,
          patch: "@@ -1 +1 @@\n-old\n+new",
        },
      ]);
    return Response.json({
      html_url: "https://github.com/acme/shop/pull/7",
      title: "Reject empty carts",
      body: "Validate checkout",
      head: { sha: head, repo: { full_name: "acme/shop" } },
      base: { sha: "base-a" },
    });
  }
  if (u === "https://api.openai.com/v1/responses") {
    modelCalls++;
    const body = JSON.parse(options.body);
    assert.equal(body.text.format.type, "json_schema");
    assert.equal(body.text.format.strict, true);
    assert.ok(body.input[0].content.includes("f1h1"));
    return Response.json({
      status: "completed",
      output: [
        {
          content: [
            {
              type: "output_text",
              text: JSON.stringify({
                changes: [
                  {
                    title: "Reject empty carts",
                    description: "Show an error for empty carts.",
                    instructions: "Try an empty cart.",
                    expected: "Checkout shows an error.",
                    hunkIds: ["f1h1"],
                  },
                ],
                excluded: [],
              }),
            },
          ],
        },
      ],
    });
  }
  return realFetch(url, options);
};
const { default: app } = await import("../server.js");
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = "http://127.0.0.1:" + server.address().port;
const headers = (login = "alice") => ({
  Cookie:
    "codesurf_session=" +
    seal(
      {
        user: { login },
        token: "test-github-token",
        tokenExp: Date.now() + 600000,
        exp: Date.now() + 600000,
      },
      process.env.SESSION_SECRET,
    ),
});
const post = (url, body, login = "alice", origin = process.env.APP_URL) =>
  realFetch(base + url, {
    method: "POST",
    headers: {
      ...headers(login),
      Origin: origin,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
test.after(async () => {
  globalThis.fetch = realFetch;
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await rm(root, { recursive: true, force: true });
});
test("review routes persist a commit-bound plan without launching a VM and reject cross-account access", async () => {
  const first = await post("/api/reviews", {
    url: "https://github.com/acme/shop/pull/7",
  });
  assert.ok([200, 202].includes(first.status));
  let review = await first.json();
  for (let i = 0; i < 100 && review.status === "loading"; i++) {
    await new Promise((r) => setTimeout(r, 10));
    review = await (
      await realFetch(base + "/api/reviews/" + review.id, {
        headers: headers(),
      })
    ).json();
  }
  assert.equal(review.status, "ready");
  assert.equal(review.changes.length, 1);
  assert.equal(review.files[0].path, "checkout.js");
  assert.equal(modelCalls, 1);
  assert.equal(review.owner, undefined);
  const states = await realFetch(base + "/api/reviews/" + review.id + "/runs", {
    headers: headers(),
  });
  assert.deepEqual(await states.json(), { runs: {} });
  assert.equal(
    (
      await realFetch(base + "/api/reviews/" + review.id + "/runs", {
        headers: headers("bob"),
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await realFetch(base + "/api/reviews/" + review.id, {
        headers: headers("bob"),
      })
    ).status,
    404,
  );
  await post("/api/reviews", { url: "https://github.com/acme/shop/pull/7" });
  assert.equal(modelCalls, 1);
  assert.deepEqual(
    (await (await realFetch(base + "/api/runs", { headers: headers() })).json())
      .items,
    [],
  );
  assert.equal(
    (await realFetch(base + "/review/github/acme/shop/pr/7")).status,
    200,
  );
  assert.equal(
    (
      await post("/api/reviews", {
        url: "https://evil.example/acme/shop/pull/7",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await post(
        "/api/reviews",
        { url: "https://github.com/acme/shop/pull/7" },
        "alice",
        "https://evil.example",
      )
    ).status,
    403,
  );
  head = "head-b";
  const stale = await post("/api/reviews", {
    url: "https://github.com/acme/shop/pull/7",
    reviewId: review.id,
  });
  const old = await stale.json();
  assert.equal(old.id, review.id);
  assert.equal(old.updateAvailable, true);
  assert.equal(modelCalls, 1);
  const start = await post(
    `/api/reviews/${review.id}/changes/change-1/run`,
    {},
  );
  assert.equal(start.status, 412);
  const shared = await post(
    "/api/reviews",
    { url: "https://github.com/acme/shop/pull/7", reviewId: review.id },
    "bob",
  );
  assert.ok([200, 202].includes(shared.status));
  const ownReview = await shared.json();
  assert.notEqual(ownReview.id, review.id);
  assert.equal(ownReview.owner, undefined);
});
