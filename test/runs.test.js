import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import crypto from "node:crypto";
import { seal } from "../lib.js";
const directory = await mkdtemp(path.join(os.tmpdir(), "codesurf-tests-"));
process.env.NODE_ENV = "test";
process.env.CODESURF_LOCAL = "0";
process.env.CODESURF_RUN_DIR = path.join(directory, ".codesurf/runs");
process.env.APP_URL = "http://localhost:5179";
process.env.SESSION_SECRET = "test-session-".repeat(5);
const {
  validateReport,
  agentPrompt,
  getRun,
  listRuns,
  runPath,
  artifactName,
  createRun,
} = await import("../runs.js");
const { default: app } = await import("../server.js");
const selectedChange = {
  id: "change-1",
  title: "Reject empty signups",
  instructions: "Submit an empty signup form.",
  expected: "An error appears without creating a signup.",
};
const id = crypto.randomUUID(),
  run = {
    id,
    owner: "alice",
    status: "passed",
    phase: "Complete",
    created: new Date().toISOString(),
    source: {
      repo: "acme/site",
      title: "Improve signup",
      testChange: selectedChange,
    },
    artifacts: ["screen.png"],
    report: null,
  };
await mkdir(path.dirname(runPath(id)), { recursive: true });
await writeFile(runPath(id), JSON.stringify(run));
await writeFile(runPath(id, "screen.png"), "test-image");
await writeFile(
  runPath(id, "events.jsonl"),
  JSON.stringify({
    id: 1,
    type: "log",
    source: "server",
    text: "Private app log",
    time: new Date().toISOString(),
  }) + "\n",
);
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const origin = "http://127.0.0.1:" + server.address().port;
const headers = (login) => ({
  Cookie:
    "codesurf_session=" +
    seal(
      {
        user: { login },
        exp: Date.now() + 600000,
        tokenExp: Date.now() + 600000,
      },
      process.env.SESSION_SECRET,
    ),
});
const post = (route, body, login = "alice", extra = {}) =>
  fetch(origin + route, {
    method: "POST",
    headers: {
      ...headers(login),
      Origin: process.env.APP_URL,
      "content-type": "application/json",
      ...extra,
    },
    body: JSON.stringify(body),
  });
const get = (route, login = "alice") =>
  fetch(origin + route, { headers: headers(login) });
test.after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
});
test("run manifests, logs, screenshots and event streams are owner scoped", async () => {
  for (const suffix of ["", "/logs", "/artifacts/screen.png", "/events"]) {
    const response = await get("/api/runs/" + id + suffix, "bob");
    assert.equal(response.status, 404);
  }
  const response = await get("/api/runs/" + id);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).owner, undefined);
  assert.equal((await get("/api/runs/" + id + "/logs")).status, 200);
  assert.equal(
    await (await get("/api/runs/" + id + "/artifacts/screen.png")).text(),
    "test-image",
  );
  assert.deepEqual((await (await get("/api/runs", "bob")).json()).items, []);
  assert.equal((await listRuns("alice")).length, 1);
  assert.equal((await fetch(origin + "/api/runs")).status, 401);
});
test("mutations require same-origin and cannot control another owner or a finished run", async () => {
  assert.equal(
    (
      await post("/api/runs/" + id + "/control", { action: "stop" }, "alice", {
        Origin: "https://evil.example",
      })
    ).status,
    403,
  );
  assert.equal(
    (await post("/api/runs/" + id + "/control", { action: "stop" }, "bob"))
      .status,
    404,
  );
  assert.equal(
    (await post("/api/runs/" + id + "/control", { action: "pause" })).status,
    409,
  );
  assert.equal(
    (
      await post("/api/runs/" + id + "/browser", {
        action: "tap",
        args: [1, 1],
      })
    ).status,
    409,
  );
  assert.equal((await post("/api/runs", { demo: true })).status, 403);
  assert.equal(
    (await post("/api/runs", { url: "https://evil.example/repo/pull/1" }))
      .status,
    400,
  );
});
test("artifact names cannot read manifests, arbitrary files or another run", async () => {
  for (const name of [
    "run.json",
    "events.jsonl",
    "../report.json",
    "nested/screen.png",
    ".env",
    "app.js",
  ])
    assert.equal(artifactName(name), false);
  for (const name of [
    "screen.png",
    "checkout-error.png",
    "video.webm",
    "trace.zip",
    "report.json",
    "server.log",
  ])
    assert.equal(artifactName(name), true);
  for (const name of [
    "run.json",
    "events.jsonl",
    "missing.png",
    "..%2Frun.json",
  ])
    assert.equal(
      (await get("/api/runs/" + id + "/artifacts/" + name)).status,
      404,
    );
  assert.equal((await get("/api/runs/not-an-id")).status, 404);
});
test("stream replays saved events and sends a current manifest", async () => {
  const controller = new AbortController();
  const response = await fetch(origin + "/api/runs/" + id + "/events", {
    headers: headers("alice"),
    signal: controller.signal,
  });
  assert.equal(response.headers.get("content-type"), "text/event-stream");
  const reader = response.body.getReader();
  let text = "";
  while (!text.includes('"run":'))
    text += new TextDecoder().decode((await reader.read()).value);
  assert.match(text, /Private app log/);
  assert.match(text, /"status":"passed"/);
  assert.doesNotMatch(text, /"owner"/);
  controller.abort();
});
test("a restarted controller marks abandoned work blocked instead of showing it running forever", async () => {
  const abandoned = { ...run, id: crypto.randomUUID(), status: "running" };
  await mkdir(path.dirname(runPath(abandoned.id)));
  await writeFile(runPath(abandoned.id), JSON.stringify(abandoned));
  const restored = await getRun("alice", abandoned.id);
  assert.equal(restored.status, "blocked");
  assert.match(restored.summary, /restarted/);
});
test("report validation refuses invalid or fabricated statuses", () => {
  const report = {
    outcome: "failed",
    summary: "Malformed emails are accepted.",
    startup: "npm start",
    tests: [
      {
        title: "Invalid email",
        status: "failed",
        detail: "Accepted",
        evidence: ["invalid-email.png"],
      },
    ],
    bugs: [
      {
        title: "Missing validation",
        severity: "medium",
        steps: ["Enter not-an-email"],
        expected: "Error",
        actual: "Success",
        evidence: ["invalid-email.png"],
      },
    ],
  };
  assert.equal(validateReport(report), report);
  for (const invalid of [
    null,
    {},
    { ...report, outcome: "probably okay" },
    { ...report, tests: [{ title: "Test", status: "maybe" }] },
    { ...report, bugs: [{ title: "Bug", steps: "unknown" }] },
  ])
    assert.throws(() => validateReport(invalid));
});
test("the startup prompt delegates repository discovery and requires the recorded browser and unchanged app source", () => {
  const prompt = agentPrompt({ ...run, goal: "Check the form" });
  assert.match(prompt, /NO required startup recipe/);
  assert.match(prompt, /never hide failures/i);
  assert.match(prompt, /shared, recorded browser/);
  assert.match(prompt, /Do not invent evidence/);
  assert.match(prompt, /Check the form/);
});

test("concurrent startup requests reserve one workspace and release it on failure", async () => {
  const previous = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const first = createRun("burst-user", run.source, "");
    await assert.rejects(
      createRun("burst-user", run.source, ""),
      (error) => error.status === 409,
    );
    await assert.rejects(first, (error) => error.status === 503);
    await assert.rejects(
      createRun("burst-user", run.source, ""),
      (error) => error.status === 503,
    );
  } finally {
    if (previous !== undefined) process.env.OPENAI_API_KEY = previous;
  }
});

test("daily quota failures are distinguishable from temporary workspace capacity", async () => {
  const runtime = process.env.CODESURF_RUNTIME,
    daily = process.env.CODESURF_DAILY_RUNS;
  process.env.CODESURF_RUNTIME = "gce";
  process.env.CODESURF_DAILY_RUNS = "0";
  try {
    await assert.rejects(
      createRun(
        "quota-test",
        { repo: "sample/site", head: "test", testChange: selectedChange },
        "",
      ),
      (error) => error.status === 429 && error.code === "DAILY_LIMIT",
    );
  } finally {
    if (runtime === undefined) delete process.env.CODESURF_RUNTIME;
    else process.env.CODESURF_RUNTIME = runtime;
    if (daily === undefined) delete process.env.CODESURF_DAILY_RUNS;
    else process.env.CODESURF_DAILY_RUNS = daily;
  }
});

test("runs require one extracted change instead of falling back to testing the whole PR", async () => {
  const source = { repo: "acme/site", head: "test" };
  await assert.rejects(
    createRun("unscoped", source, "Test the PR"),
    (error) => error.status === 400,
  );
  assert.throws(
    () => agentPrompt({ source, goal: "Test the PR" }),
    /Select one extracted/,
  );
  assert.deepEqual(await listRuns("unscoped"), []);
});
