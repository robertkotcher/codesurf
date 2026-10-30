import test from "node:test";
import assert from "node:assert/strict";
import { seal, unseal, parseSource } from "../lib.js";
test("encrypted sessions authenticate contents and expire", () => {
  const key = "a".repeat(64),
    v = { token: "private", exp: Date.now() + 10000 };
  const s = seal(v, key);
  assert(!s.includes("private"));
  assert.deepEqual(unseal(s, key), v);
  assert.equal(unseal(s, "b".repeat(64)), null);
  assert.equal(unseal(s.slice(0, -3) + "abc", key), null);
  assert.equal(unseal(seal({ ...v, exp: 0 }, key), key), null);
});
test("repository and PR links are pinned to trusted GitHub URL shapes", () => {
  assert.deepEqual(parseSource("https://github.com/acme/platform"), {
    owner: "acme",
    repo: "platform",
    number: null,
  });
  assert.deepEqual(parseSource("https://github.com/acme/platform/pull/42"), {
    owner: "acme",
    repo: "platform",
    number: 42,
  });
  for (const s of [
    "https://evil.com/acme/repo/pull/1",
    "https://github.com.evil.com/a/b/pull/1",
    "http://github.com/a/b/pull/1",
    "https://x:y@github.com/a/b/pull/1",
    "https://github.com/a/b/issues/1",
    "https://github.com/a/b/pull/0",
    "https://github.com:444/a/b",
    "https://github.com/a/b/pull/9999999999999999999999",
  ])
    assert.throws(() => parseSource(s));
});
