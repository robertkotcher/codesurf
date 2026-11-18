import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";

process.env.CODESURF_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "codesurf-home-"));
const store = await import("../src/store.js");
const { createServer } = await import("../src/server.js");
const { resolveTour } = await import("../src/tour.js");
const { markdown, parseRef } = await import("../viewer/markdown.js");

const demo = new URL("../examples/demo-shop/", import.meta.url).pathname;
const app = createServer({ port: 0, token: "secret-token" });
const port = await app.listen();
test.after(() => app.server.close());
const project = store.ensureProject(demo, { exact: true });
const { tour, assets } = resolveTour(JSON.parse(fs.readFileSync(path.join(demo, "tour.json"), "utf8")), { root: demo, baseDir: demo });
const tourId = store.saveTour(project, tour, assets);

// fetch() cannot set Host, so use http.request for the rebinding check.
const request = (pathname, { host = `127.0.0.1:${port}`, cookie = "cs_token=secret-token", method = "GET", origin } = {}) => new Promise((resolve, reject) => {
  const req = http.request({ host: "127.0.0.1", port, path: pathname, method, headers: { Host: host, ...(cookie ? { Cookie: cookie } : {}), ...(origin ? { Origin: origin } : {}) } }, (res) => {
    let body = ""; res.on("data", (c) => body += c); res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
  });
  req.on("error", reject);
  req.end();
});

test("rejects other hosts, missing tokens and cross-origin posts", async () => {
  assert.equal((await request("/api/projects", { host: "evil.example:80" })).status, 421);
  assert.equal((await request("/api/projects", { cookie: null })).status, 401);
  assert.equal((await request("/", { cookie: null })).status, 403);
  assert.equal((await request("/api/ask", { method: "POST", origin: "https://evil.example" })).status, 403);
  const login = await request("/?project=x&token=secret-token", { cookie: null });
  assert.equal(login.status, 302);
  assert.match(login.headers["set-cookie"][0], /HttpOnly; SameSite=Strict/);
  assert.equal(login.headers.location, "/?project=x");
});

test("serves tours, files, symbols and screenshots for signed-in requests", async () => {
  const saved = JSON.parse((await request(`/api/tour?project=${project.id}&id=${tourId}`)).body);
  assert.equal(saved.tour.title, tour.title);
  assert.deepEqual(saved.stale, []);
  const file = JSON.parse((await request(`/api/file?project=${project.id}&path=inventory.mjs`)).body);
  assert.match(file.source, /export function reserve/);
  const hover = JSON.parse((await request(`/api/hover?project=${project.id}&path=checkout.mjs&line=9&column=26`)).body);
  assert.match(hover.signature, /charge\(amount: any, token: any\)/);
  const image = await request(`/api/asset?project=${project.id}&name=${tour.cards[0].image}`);
  assert.equal(image.status, 200);
  assert.equal(image.headers["content-type"], "image/png");
  assert.equal((await request(`/api/file?project=${project.id}&path=../../package.json`)).status, 404);
  assert.equal((await request(`/api/file?project=${project.id}&path=.env`)).status, 403);
});

test("saving the same tour twice reuses it", () => {
  assert.equal(store.saveTour(project, tour, assets), tourId);
});

test("markdown escapes HTML and only links https and code references", () => {
  const html = markdown("<img src=x onerror=alert(1)> [a](javascript:alert(1)) [b](https://example.com) [c](cs:src/a.ts#L3-L9) `x<y`");
  assert.doesNotMatch(html, /<img|javascript:/);
  assert.match(html, /href="https:\/\/example\.com"/);
  assert.match(html, /data-ref="src\/a\.ts#L3-L9"/);
  assert.match(html, /<code>x&lt;y<\/code>/);
  assert.deepEqual(parseRef("src/a.ts#L3-L9"), { path: "src/a.ts", lines: [3, 9] });
  assert.deepEqual(parseRef("src/a.ts:4"), { path: "src/a.ts", lines: [4, 4] });
});
