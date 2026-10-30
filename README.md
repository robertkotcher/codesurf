# CodeSurf

Run a repository or pull request. Watch an agent get the application running, test the changed behavior, and save the evidence.

The interface has a live browser, agent activity, searchable logs, and a report with checks, reproducible findings, screenshots, video and a Playwright trace. Pause the agent to interact with the same browser, then resume it. Runs and logs survive a controller restart.

## Local hello world

Requirements: Node 22+, Docker Desktop, and a server-side OpenAI API key with Responses/model access.

```sh
npm ci
npm run build
npm run runner:build
CODESURF_LOCAL=1 npm run dev
```

Open http://localhost:5179 and choose **Try a sample run**. This is a real agent run, not a simulated animation: Codex inspects a small repository, discovers `npm start`, launches its server, opens the shared browser and tests a newsletter form with a deliberately missing validation rule.

Put settings in ignored `.env.local`:

```dotenv
APP_URL=http://localhost:5179
OPENAI_API_KEY=
OPENAI_MODEL=gpt-6.1-sol
SESSION_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_APP_SLUG=codesurf-io
```

Use at least 32 random characters for SESSION_SECRET. GitHub credentials are optional for the local sample. `CODESURF_LOCAL=1` enables the sample and local run history only on a loopback connection outside production. Real repositories and PRs require GitHub sign-in. A repository link runs its latest default-branch commit and tests that commit’s diff; a PR link runs the PR head and tests the complete PR diff.

## How it works

- The controller downloads the exact PR head snapshot and diff using the signed-in user's GitHub access. GitHub credentials are never copied to the workspace.
- Every run gets a fresh Docker container with Node, Python, Ruby, build tools, Chromium, Playwright and Codex CLI. The agent can install more dependencies and configure disposable services. No framework-specific startup recipe is required.
- Codex runs non-interactively with shell tools and a browser command helper. Application servers run independently so pausing the agent doesn't pause the site.
- The controller streams activity and terminal/server/browser/network logs using server-sent events. A low-frame-rate screenshot feed displays the same Playwright page the agent controls. Pausing enables mouse, keyboard and scroll interaction.
- Real video and trace capture start before the agent opens the app. On completion, evidence is copied out and the container is destroyed. Findings are local reports; nothing is posted to GitHub.
- The OpenAI key stays in the controller. A per-run, bounded Responses proxy supplies model access without giving the workspace the real API key.
- The agent must not fix application code to make tests pass. Source edits relative to the initial snapshot mark the result blocked; a run that never opened the app cannot pass.

Run data lives in ignored `.codesurf/runs/<id>/`: `run.json`, append-only `events.jsonl`, `report.json`, screenshots, `video.webm`, and `trace.zip`. Reopen a run to see its saved report, logs and recording. Incomplete runs become blocked when the controller restarts. Stop and shutdown destroy active containers. Default limits: two concurrent workspaces, one per user, 4 GB RAM, two CPUs, 15 minutes, 100 model requests, a 100 MB compressed repository archive, and a 2 MB diff.

## Production

The Vercel frontend proxies `/api` and `/auth` to `https://runner.codesurf.io`, a persistent Google Compute Engine controller. Each run creates a separate temporary VM from a prebuilt image, without a service account or cloud credentials. A Docker container inside that VM runs the checked-out app and agent. Worker SSH host keys are verified using Compute guest attributes. Browser traffic and the bounded model proxy use SSH tunnels; worker ports are not publicly exposed.

Logs and browser screenshots stream through the controller over HTTPS using server-sent events. Video, trace, screenshots and reports persist on the controller disk and are backed up to a private Cloud Storage bucket after each run. The temporary VM is deleted afterward; Compute Engine also deletes it after 30 minutes if the controller becomes unavailable. Cloud runs default to ten per user per day, two concurrent, one active per user. A new VM takes additional time to boot before app setup begins.

Project: `codesurf-prod-20261030`, region `us-central1`, controller `codesurf-controller`, bucket `codesurf-prod-20261030-evidence`. Infrastructure scripts are in `infra/`. Rebuild the worker image when `runner/` changes; deploy the controller code when server files change. A Vercel-only deployment updates the frontend, not the controller.

Cloud controller environment:

```dotenv
NODE_ENV=production
APP_URL=https://codesurf.io
CODESURF_RUNTIME=gce
CODESURF_GCP_PROJECT=codesurf-prod-20261030
CODESURF_GCP_ZONE=us-central1-a
CODESURF_GCP_SUBNET=codesurf-us
CODESURF_GCP_IMAGE=codesurf-runner-v1
CODESURF_SSH_KEY=/var/lib/codesurf/ssh/worker
CODESURF_RUN_DIR=/var/lib/codesurf/runs
CODESURF_GCS_BUCKET=codesurf-prod-20261030-evidence
```

Set the same server-side GitHub and OpenAI settings as local development. Secrets live in `/etc/codesurf.env` on the controller and never in the frontend or worker image. `/api` remains owner scoped; storage is private. `CODESURF_DEMO_USERS` optionally permits specific signed-in accounts to run the sample in production.

The old diff editor, call graph, voice system, incremental AI breakdowns, bookmarks and review publishing were removed from the application. Existing production database contents are untouched; this version needs no database or migrations. GitHub OAuth uses state, PKCE and encrypted HTTP-only cookies; PR runs remain scoped to the signed-in account. Repository installations are managed on GitHub.

## Verification

```sh
npm test
npm run build
```

The tests cover account isolation, same-origin writes, artifact path validation, saved event streams, interrupted-run recovery, session encryption and report validation. The Docker sample provides the end-to-end check of startup, browser interaction and artifact capture.
