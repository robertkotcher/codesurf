// Local CodeSurf server: serves the viewer, real source, symbol lookups and
// follow-up answers. It listens on 127.0.0.1 only, checks the Host header
// (against DNS rebinding) and requires a per-install token cookie that is
// SameSite=Strict (against other sites calling it).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import * as store from "./store.js";
import { hover, definitions } from "./symbols.js";
import { readSource, languageOf, hash, repoPath } from "./tour.js";
import { ask } from "./ask.js";

const VIEWER = fileURLToPath(new URL("../viewer/", import.meta.url));
const HLJS = path.dirname(fileURLToPath(import.meta.resolve("highlight.js/package.json")));
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".json": "application/json" };
const SECRET = /(^|\/)(\.env[^/]*|[^/]*\.pem|id_[a-z0-9]+|[^/]*\.key)$/i;
// Changes to CodeSurf's own code restart the background server on the next `codesurf open`.
export const BUILD = hash(["src", "viewer", "skill"].flatMap((dir) => {
  const base = fileURLToPath(new URL("../" + dir + "/", import.meta.url));
  return fs.readdirSync(base).map((f) => f + fs.statSync(path.join(base, f)).mtimeMs);
}).join("|"));
export const DEFAULT_PORT = Number(process.env.CODESURF_PORT || 4319);

function send(res, status, body, type = "application/json") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(type === "application/json" ? JSON.stringify(body) : body);
}
function serveFile(res, file, base) {
  const resolved = path.resolve(base, file);
  if (!resolved.startsWith(base) || !fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) return send(res, 404, { error: "Not found" });
  res.writeHead(200, { "Content-Type": TYPES[path.extname(resolved)] || "application/octet-stream", "Cache-Control": "no-cache",
    "X-Content-Type-Options": "nosniff",
    ...(resolved.endsWith(".html") ? { "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" } : {}) });
  fs.createReadStream(resolved).pipe(res);
}
const body = (req) => new Promise((resolve, reject) => {
  let data = "";
  req.on("data", (c) => { data += c; if (data.length > 1e6) { reject(new Error("Request too large")); req.destroy(); } });
  req.on("end", () => { try { resolve(JSON.parse(data || "{}")); } catch { reject(new Error("Invalid JSON")); } });
});
let bundled;
// Bundle the viewer once per server process (highlight.js ships CommonJS).
async function bundle() {
  if (bundled) return bundled;
  const { build } = await import("esbuild");
  const result = await build({ entryPoints: [path.join(VIEWER, "viewer.js")], bundle: true, format: "iife", platform: "browser",
    target: "es2022", write: false, minify: false, sourcemap: "inline", logLevel: "silent" });
  const css = fs.readFileSync(path.join(HLJS, "styles/github.css"), "utf8") + "\n" + fs.readFileSync(path.join(VIEWER, "viewer.css"), "utf8");
  bundled = { js: result.outputFiles[0].text, css };
  return bundled;
}
const cookie = (req, name) => (req.headers.cookie || "").split(/;\s*/).find((c) => c.startsWith(name + "="))?.slice(name.length + 1);

export function createServer({ port = DEFAULT_PORT, token = crypto.randomBytes(24).toString("hex") } = {}) {
  const running = new Map();
  const server = http.createServer(async (req, res) => {
    const actual = server.address().port;
    const hosts = new Set([`127.0.0.1:${actual}`, `localhost:${actual}`]);
    try {
      if (!hosts.has(req.headers.host)) return send(res, 421, { error: "Unexpected host" });
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (url.pathname === "/api/health") return send(res, 200, { ok: true, version: 2, build: BUILD, pid: process.pid, authorized: url.searchParams.get("token") === token });
      if (url.searchParams.has("token")) {
        if (url.searchParams.get("token") !== token) return send(res, 403, { error: "Invalid token" });
        url.searchParams.delete("token");
        res.writeHead(302, { "Set-Cookie": `cs_token=${token}; HttpOnly; SameSite=Strict; Path=/`, Location: url.pathname + url.search });
        return res.end();
      }
      const authorized = cookie(req, "cs_token") === token;
      if (url.pathname === "/" || url.pathname === "/index.html") {
        if (!authorized) return send(res, 403, "Open CodeSurf with `codesurf open` or `codesurf serve` to get a signed-in link.", "text/plain; charset=utf-8");
        return serveFile(res, "index.html", VIEWER);
      }
      if (url.pathname === "/app/bundle.js" || url.pathname === "/app/bundle.css") {
        const built = await bundle();
        return send(res, 200, url.pathname.endsWith(".js") ? built.js : built.css, url.pathname.endsWith(".js") ? TYPES[".js"] : TYPES[".css"]);
      }
      if (!url.pathname.startsWith("/api/")) return send(res, 404, { error: "Not found" });
      if (!authorized) return send(res, 401, { error: "Not signed in to this CodeSurf server. Reopen it with `codesurf open`." });
      if (req.method === "POST" && req.headers.origin && !hosts.has(req.headers.origin.replace(/^https?:\/\//, ""))) return send(res, 403, { error: "Cross-origin request" });

      const q = url.searchParams;
      const project = () => store.getProject(q.get("project"));
      switch (url.pathname) {
        case "/api/projects": return send(res, 200, store.listProjects().map((p) => ({ ...p, tours: store.listTours(p) })));
        case "/api/tours": return send(res, 200, store.listTours(project()));
        case "/api/tour": {
          const p = project(), saved = store.getTour(p, q.get("id"));
          // Flag files that changed on disk since the tour was made.
          const stale = saved.tour.files.filter((f) => {
            if (!f.hash) return false;
            try { return hash(fs.readFileSync(repoPath(p.root, f.path), "utf8")) !== f.hash; } catch { return true; }
          }).map((f) => f.id);
          return send(res, 200, { ...saved, stale, chat: store.getChat(p, saved.id), project: { id: p.id, name: p.name } });
        }
        case "/api/file": {
          const p = project(), file = q.get("path");
          if (SECRET.test(file)) return send(res, 403, { error: "CodeSurf does not open secret files." });
          const source = readSource(p.root, file, q.get("ref") || undefined);
          return send(res, 200, { path: file, language: languageOf(file), source, hash: hash(source) });
        }
        case "/api/hover": {
          const p = project();
          return send(res, 200, hover(p.root, q.get("path"), Number(q.get("line")), Number(q.get("column"))) || {});
        }
        case "/api/definition": {
          const p = project();
          return send(res, 200, definitions(p.root, q.get("path"), Number(q.get("line")), Number(q.get("column"))));
        }
        case "/api/asset": return serveFile(res, path.basename(store.assetPath(project(), q.get("name"))), path.dirname(store.assetPath(project(), q.get("name"))));
        case "/api/stop": {
          if (req.method !== "POST") break;
          running.get(q.get("tour"))?.abort();
          return send(res, 200, { ok: true });
        }
        case "/api/ask": {
          if (req.method !== "POST") break;
          const input = await body(req);
          const p = store.getProject(input.project), saved = store.getTour(p, input.tour);
          const question = String(input.question || "").trim().slice(0, 4000);
          if (!question) return send(res, 400, { error: "Ask a question." });
          if (running.has(saved.id)) return send(res, 409, { error: "Already answering a question in this tab." });
          const chat = store.getChat(p, saved.id);
          chat.messages.push({ role: "user", text: question, context: input.context || null, at: new Date().toISOString() });
          store.saveChat(p, saved.id, chat);
          res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
          const emit = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);
          const controller = new AbortController();
          running.set(saved.id, controller);
          req.on("close", () => { if (!res.writableEnded) controller.abort(); });
          try {
            const answer = await ask({ project: p, saved, chat, question, context: input.context, onEvent: emit, signal: controller.signal });
            chat.sessionId = answer.sessionId;
            const message = { role: "assistant", text: answer.text, at: new Date().toISOString() };
            if (answer.tour) {
              message.tour = store.saveTour(p, answer.tour, answer.assets, { parent: saved.id });
              message.tourTitle = answer.tour.title;
            }
            if (answer.tourError) message.tourError = answer.tourError;
            chat.messages.push(message);
            store.saveChat(p, saved.id, chat);
            emit({ type: "done", message });
          } catch (error) {
            chat.messages.push({ role: "error", text: error.message, at: new Date().toISOString() });
            store.saveChat(p, saved.id, chat);
            emit({ type: "error", text: error.message });
          } finally {
            running.delete(saved.id);
            res.end();
          }
          return;
        }
      }
      send(res, 404, { error: "Not found" });
    } catch (error) {
      if (res.headersSent) return res.end();
      send(res, /Unknown|outside|not found|ENOENT/i.test(error.message) ? 404 : 500, { error: error.message.replace(/ENOENT: no such file or directory, open /, "File not found: ") });
    }
  });
  return { server, token, port, listen: () => new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server.address().port));
  }) };
}
