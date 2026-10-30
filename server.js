import { cloudEnabled, recoverCloudWorkers } from "./cloud.js";
import express from "express";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { seal, unseal, parseSource } from "./lib.js";
import {
  createRun,
  getRun,
  listRuns,
  publicRun,
  runEvents,
  runPath,
  events,
  runtimeStatus,
  controlRun,
  browserAction,
  shutdownRuns,
} from "./runs.js";

const app = express(),
  env = process.env,
  root = path.dirname(fileURLToPath(import.meta.url));
const wrap = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
const local = (req) =>
  env.CODESURF_LOCAL === "1" &&
  !env.VERCEL &&
  env.NODE_ENV !== "production" &&
  ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress);
const sampleAllowed = (req) =>
  local(req) ||
  (env.CODESURF_DEMO_USERS || "")
    .split(",")
    .includes(
      (req.auth || unseal(cookies(req).codesurf_session, env.SESSION_SECRET))
        ?.user?.login,
    );
const origin = (req) =>
  [
    env.APP_URL || "http://localhost:5179",
    ...(env.APP_ALTERNATE_URLS || "").split(",").filter(Boolean),
  ].find((url) => new URL(url).host === req.get("host")) ||
  env.APP_URL ||
  "http://localhost:5179";
const cookies = (req) =>
  Object.fromEntries(
    (req.headers.cookie || "")
      .split(";")
      .map((s) => s.trim().split("="))
      .filter((parts) => parts.length === 2),
  );
const cookieOptions = (req) => ({
  httpOnly: true,
  secure: origin(req).startsWith("https:"),
  sameSite: "lax",
  path: "/",
});
const setSession = (req, res, value) =>
  res.cookie("codesurf_session", seal(value, env.SESSION_SECRET), {
    ...cookieOptions(req),
    maxAge: 7 * 864e5,
  });
const problem = (message, status) =>
  Object.assign(new Error(message), { status });
app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; media-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://github.com",
  );
  if (req.path.startsWith("/api/") || req.path.startsWith("/auth/"))
    res.setHeader("Cache-Control", "no-store");
  next();
});
async function github(token, url, options = {}) {
  const response = await fetch("https://api.github.com" + url, {
    headers: {
      Authorization: "Bearer " + token,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: AbortSignal.timeout(20000),
    ...options,
  });
  if (!response.ok)
    throw problem(
      response.status === 401
        ? "Your GitHub session expired. Sign in again."
        : response.status === 404
          ? "Repository unavailable. Check CodeSurf’s GitHub repository access."
          : response.status === 403
            ? "GitHub denied access or its API limit was reached."
            : "GitHub could not complete this request.",
      response.status === 401 ? 401 : response.status === 404 ? 404 : 502,
    );
  return response.json();
}
app.get(
  "/auth/github",
  wrap(async (req, res) => {
    if (
      !env.GITHUB_CLIENT_ID ||
      !env.GITHUB_CLIENT_SECRET ||
      !env.SESSION_SECRET
    )
      throw problem("GitHub sign-in has not been configured.", 503);
    const state = crypto.randomBytes(32).toString("hex"),
      verifier = crypto.randomBytes(48).toString("base64url");
    res.cookie(
      "codesurf_oauth",
      seal(
        { state, verifier, origin: origin(req), exp: Date.now() + 600000 },
        env.SESSION_SECRET,
      ),
      { ...cookieOptions(req), maxAge: 600000 },
    );
    const query = new URLSearchParams({
      client_id: env.GITHUB_CLIENT_ID,
      redirect_uri: origin(req) + "/auth/github/callback",
      state,
      code_challenge: crypto
        .createHash("sha256")
        .update(verifier)
        .digest("base64url"),
      code_challenge_method: "S256",
    });
    res.redirect("https://github.com/login/oauth/authorize?" + query);
  }),
);
app.get(
  "/auth/github/callback",
  wrap(async (req, res) => {
    const saved = unseal(cookies(req).codesurf_oauth, env.SESSION_SECRET);
    res.clearCookie("codesurf_oauth", cookieOptions(req));
    if (
      !saved ||
      saved.origin !== origin(req) ||
      typeof req.query.state !== "string" ||
      saved.state !== req.query.state ||
      typeof req.query.code !== "string"
    )
      throw problem("Sign-in expired. Return to CodeSurf and try again.", 400);
    const response = await fetch(
      "https://github.com/login/oauth/access_token",
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          client_id: env.GITHUB_CLIENT_ID,
          client_secret: env.GITHUB_CLIENT_SECRET,
          code: req.query.code,
          redirect_uri: origin(req) + "/auth/github/callback",
          code_verifier: saved.verifier,
        }),
        signal: AbortSignal.timeout(20000),
      },
    );
    const token = await response.json();
    if (!token.access_token)
      throw problem("GitHub did not authorize sign-in.", 401);
    const user = await github(token.access_token, "/user"),
      allow = (env.ALLOWED_GITHUB_USERS || "").split(",").filter(Boolean);
    if (allow.length && !allow.includes(user.login))
      throw problem("This account does not have access to CodeSurf.", 403);
    setSession(req, res, {
      token: token.access_token,
      refresh: token.refresh_token,
      tokenExp: Date.now() + (token.expires_in || 28800) * 1000,
      exp: Date.now() + 7 * 864e5,
      user: { login: user.login, name: user.name },
    });
    res.redirect("/");
  }),
);
app.post("/auth/logout", (req, res) => {
  if (req.headers.origin !== origin(req)) return res.sendStatus(403);
  res.clearCookie("codesurf_session", cookieOptions(req));
  res.json({ ok: true });
});
app.get(
  "/api/status",
  wrap(async (req, res) =>
    res.json({
      runtime: await runtimeStatus(),
      agent: !!env.OPENAI_API_KEY,
      local: local(req),
      sample: sampleAllowed(req),
      installUrl:
        "https://github.com/apps/" +
        (env.GITHUB_APP_SLUG || "codesurf-io") +
        "/installations/new",
    }),
  ),
);
app.use(
  "/api",
  wrap(async (req, res, next) => {
    if (req.method === "POST" && req.headers.origin !== origin(req))
      return res.sendStatus(403);
    let session = unseal(cookies(req).codesurf_session, env.SESSION_SECRET);
    if (!session) {
      if (!local(req)) throw problem("Sign in with GitHub to continue.", 401);
      session = { user: { login: "local" }, local: true };
    }
    if (session.tokenExp < Date.now() + 60000 && session.refresh) {
      const response = await fetch(
        "https://github.com/login/oauth/access_token",
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            client_id: env.GITHUB_CLIENT_ID,
            client_secret: env.GITHUB_CLIENT_SECRET,
            grant_type: "refresh_token",
            refresh_token: session.refresh,
          }),
          signal: AbortSignal.timeout(20000),
        },
      );
      const token = await response.json();
      if (!token.access_token)
        throw problem("Your GitHub session expired. Sign in again.", 401);
      session = {
        ...session,
        token: token.access_token,
        refresh: token.refresh_token,
        tokenExp: Date.now() + token.expires_in * 1000,
      };
      setSession(req, res, session);
    }
    req.auth = session;
    next();
  }),
);
app.get("/api/me", (req, res) =>
  res.json({
    user: req.auth.local ? null : req.auth.user,
    local: !!req.auth.local,
  }),
);
app.get(
  "/api/repositories",
  wrap(async (req, res) => {
    if (req.auth.local)
      throw problem("Connect GitHub to choose a repository.", 401);
    const items = [];
    for (let page = 1; page <= 50; page++) {
      const batch = await github(
        req.auth.token,
        `/user/installations?per_page=100&page=${page}`,
      );
      for (const installation of batch.installations) {
        for (let n = 1; n <= 50; n++) {
          const repos = await github(
            req.auth.token,
            `/user/installations/${installation.id}/repositories?per_page=100&page=${n}`,
          );
          items.push(
            ...repos.repositories.map((repo) => ({ name: repo.full_name })),
          );
          if (repos.repositories.length < 100) break;
        }
      }
      if (batch.installations.length < 100) break;
    }
    res.json({ items: items.sort((a, b) => a.name.localeCompare(b.name)) });
  }),
);
app.get(
  "/api/pulls",
  wrap(async (req, res) => {
    if (req.auth.local)
      throw problem("Connect GitHub to choose a pull request.", 401);
    const repo = req.query.repo;
    if (
      typeof repo !== "string" ||
      !/^[-\w]+\/[.\w-]+$/.test(repo) ||
      repo.split("/").some((part) => part === "." || part === "..")
    )
      throw problem("Choose a GitHub repository.", 400);
    const page = Math.max(1, Math.min(100, Number(req.query.page) || 1)),
      items = await github(
        req.auth.token,
        `/repos/${repo}/pulls?state=open&sort=updated&per_page=30&page=${page}`,
      );
    res.json({
      items: items.map((pr) => ({
        title: pr.title,
        number: pr.number,
        url: pr.html_url,
      })),
      more: items.length === 30,
    });
  }),
);
app.get(
  "/api/runs",
  wrap(async (req, res) =>
    res.json({ items: await listRuns(req.auth.user.login) }),
  ),
);
app.post(
  "/api/runs",
  wrap(async (req, res) => {
    let source;
    if (req.body.demo) {
      if (!sampleAllowed(req))
        throw problem("The sample is not available for this account.", 403);
      source = {
        repo: "codesurf/sample-newsletter",
        title: "Validate newsletter email addresses",
        demo: true,
        head: "sample",
      };
    } else {
      if (req.auth.local)
        throw problem("Sign in with GitHub to run a repository.", 401);
      let p;
      try {
        p = parseSource(req.body.url);
      } catch (error) {
        throw problem(error.message, 400);
      }
      const name = p.owner + "/" + p.repo;
      if (p.number) {
        const pr = await github(
          req.auth.token,
          `/repos/${name}/pulls/${p.number}`,
        );
        source = {
          url: pr.html_url,
          repo: pr.head.repo?.full_name,
          baseRepo: name,
          head: pr.head.sha,
          number: p.number,
          title: pr.title,
        };
        if (!source.repo)
          throw problem("The PR source repository is unavailable.", 404);
      } else {
        const commits = await github(
            req.auth.token,
            `/repos/${name}/commits?per_page=1`,
          ),
          commit = commits[0];
        if (!commit)
          throw problem("This repository has no commits to run.", 400);
        source = {
          url: commit.html_url,
          repo: name,
          baseRepo: name,
          head: commit.sha,
          title: commit.commit.message.split("\n")[0],
          number: null,
        };
      }
    }
    if (
      req.body.goal !== undefined &&
      (typeof req.body.goal !== "string" || req.body.goal.length > 3000)
    )
      throw problem("Keep the test focus under 3,000 characters.", 400);
    res.status(202).json(
      await createRun(req.auth.user.login, source, req.body.goal, {
        token: req.auth.token,
      }),
    );
  }),
);
app.get(
  "/api/runs/:id",
  wrap(async (req, res) =>
    res.json(publicRun(await getRun(req.auth.user.login, req.params.id))),
  ),
);
app.post(
  "/api/runs/:id/control",
  wrap(async (req, res) =>
    res.json(
      await controlRun(req.auth.user.login, req.params.id, req.body.action),
    ),
  ),
);
app.post(
  "/api/runs/:id/browser",
  wrap(async (req, res) =>
    res.json(await browserAction(req.auth.user.login, req.params.id, req.body)),
  ),
);
app.get(
  "/api/runs/:id/events",
  wrap(async (req, res) => {
    const run = await getRun(req.auth.user.login, req.params.id),
      after = Number(req.headers["last-event-id"] || req.query.after) || 0;
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    let pending = [],
      replaying = true;
    const send = (event) => {
      if (res.destroyed) return;
      if (replaying) {
        pending.push(event);
        return;
      }
      res.write(
        `${event.id ? "id: " + event.id + "\n" : ""}data: ${JSON.stringify(event)}\n\n`,
      );
    };
    events.on(run.id, send);
    const stored = await runEvents(run.id);
    for (const event of stored)
      if (event.id > after)
        res.write(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`);
    replaying = false;
    const max = stored.at(-1)?.id || 0;
    for (const event of pending) if (!event.id || event.id > max) send(event);
    pending = [];
    res.write(
      "data: " +
        JSON.stringify({
          type: "state",
          run: publicRun(await getRun(req.auth.user.login, run.id)),
        }) +
        "\n\n",
    );
    const heartbeat = setInterval(() => res.write(": keepalive\n\n"), 15000);
    req.on("close", () => {
      clearInterval(heartbeat);
      events.off(run.id, send);
    });
  }),
);
app.get(
  "/api/runs/:id/artifacts/:file",
  wrap(async (req, res) => {
    const run = await getRun(req.auth.user.login, req.params.id),
      file = req.params.file;
    if (
      !/^[\w-]+\.(png|webm|zip|json|log)$/.test(file) ||
      !["screen.png", "report.json", ...run.artifacts].includes(file)
    )
      throw problem("Artifact not found.", 404);
    if (file === "screen.png") res.setHeader("Cache-Control", "no-store");
    if (req.query.download === "1")
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="' + file + '"',
      );
    res.sendFile(runPath(run.id, file), { dotfiles: "allow" });
  }),
);
app.get(
  "/api/runs/:id/logs",
  wrap(async (req, res) => {
    await getRun(req.auth.user.login, req.params.id);
    const items = await runEvents(req.params.id);
    res.type("text/plain");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="codesurf-logs.txt"',
    );
    res.send(
      items
        .filter((item) => item.type === "log" || item.type === "activity")
        .map((item) => `[${item.time}] ${item.source || "agent"}: ${item.text}`)
        .join("\n"),
    );
  }),
);
app.use(express.static(path.join(root, "public")));
app.get("/runs/:id", (req, res) =>
  res.sendFile(path.join(root, "public/index.html")),
);
app.get("/github/:owner/:repo/pull/:number", (req, res) =>
  res.redirect(
    "/?pr=" +
      encodeURIComponent(
        "https://github.com/" +
          req.params.owner +
          "/" +
          req.params.repo +
          "/pull/" +
          req.params.number,
      ),
  ),
);
app.use((error, req, res, _next) => {
  if (res.headersSent) return res.end();
  res.status(error.status || 500).json({
    error: error.status
      ? error.message
      : "The request failed. Check the controller logs and retry.",
  });
  if (!error.status) console.error(error.message);
});
if (!env.VERCEL && env.NODE_ENV !== "test") {
  if (cloudEnabled()) await recoverCloudWorkers();
  const server = app.listen(Number(env.PORT || 5179), "127.0.0.1", () =>
    console.log("CodeSurf: " + (env.APP_URL || "http://localhost:5179")),
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, async () => {
      server.close();
      await shutdownRuns();
      process.exit();
    });
}
export default app;
