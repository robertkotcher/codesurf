import test from "node:test";
import assert from "node:assert/strict";
import { REVIEW_PROMPT, createReviewPrompt, createCommentEntry } from "../review-prompt.js";

const tour = {
  title: "Fix the checkout guard",
  question: "Review https://github.com/example/shop/pull/42",
  revision: "head-sha",
  review: { url: "https://github.com/example/shop/pull/42" },
  files: [{ id: "source", path: "checkout.py", revision: "file-sha", sourceUrl: "https://github.com/example/shop/blob/file-sha/checkout.py" }],
  cards: [{ id: "guard", file: "source", diff: "after" }],
  steps: [{ title: "Reject invalid quantities", focus: { card: "guard", lines: [40, 43] } }],
};

test("the instruction template is fixed while tour context is deterministic data", () => {
  assert.equal(createReviewPrompt(tour), createReviewPrompt(structuredClone(tour)));
  assert.ok(createReviewPrompt(tour).startsWith(REVIEW_PROMPT + "\n\nTour context\n"));
  const other = { ...tour, title: "Another tour", revision: "other-sha" };
  assert.ok(createReviewPrompt(other).startsWith(REVIEW_PROMPT + "\n\nTour context\n"));
  assert.match(createReviewPrompt(tour), /pull\/42/);
  assert.match(REVIEW_PROMPT, /Ignore entries with an empty comment/);
});

test("step comments include exact file revision, diff side and source location", () => {
  const entry = createCommentEntry(tour, 0, "guard", 42);
  assert.match(entry, /Step: 1\/1 "Reject invalid quantities"/);
  assert.match(entry, /File: "checkout.py"\nLines: 42\nRevision: "file-sha"/);
  assert.match(entry, /Diff side: after/);
  assert.match(entry, /checkout.py#L42/);
  assert.ok(entry.endsWith("Comment: "));
});

test("missing source metadata stays explicit and does not invent a PR", () => {
  const data = structuredClone(tour);
  data.files[0] = { id: "source", path: "checkout.py" };
  delete data.revision;
  assert.match(createCommentEntry(data, 0, "guard", 40), /Revision: "Not specified"/);
  assert.ok(!createCommentEntry(data, 0, "guard", 40).includes("Source:"));
});
