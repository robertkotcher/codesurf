# CodeSurf.io

A visual GitHub pull request review canvas.

## Canvas review

Paste a PR URL to start immediately. The app displays a preparation spinner while it imports the change and creates logical review chunks; no editor/sidebar/voice workspace or pace setup appears. The central card shows one chunk, with additions/removals, exact source lines, and one-sentence overviews over blurred multi-line edits. Eye buttons reveal and re-mask code. Adjacent Previous/Next header buttons move through chunks while the next chunk is prefetched.

Parser-resolved callers appear on the left and callees on the right, connected to the changed block or visible call site. Unchanged context cards are muted; related code changed in the same chunk is explicitly labeled. Deleted methods use the preceding snapshot. Ambiguous/heuristic relationships use dashed connectors. Context is paginated in groups of 24; long functions show a source excerpt until the full function is requested. `POST /api/reviews/:id/canvas` rechecks the user, repository, head, and applied cursor before exposing source.

The dotted canvas supports background drag, native scrolling, zoom, and fit. Account-menu dialogs retain My PRs, Saved PRs, connected repositories, and final GitHub review submission. The older editor/chat modules remain available in source for reference; the default page loads only the new canvas UI.

## Run locally

```
npm ci
npm run dev
```

Open http://localhost:5179. Local server secrets live in the ignored `.env.local` file (mode 600); use `.env.example` for the required variable names. Never put GitHub secrets, session keys, or OpenAI keys into frontend code.

The legacy demo-plan API is local-only. The current canvas uses the connected GitHub account; production has no demo sign-in bypass.

## GitHub connection

Public GitHub App: https://github.com/apps/codesurf-io

Each user signs in with GitHub and installs the app on repositories they choose. These are distinct GitHub consent steps; installation is not restricted to the app owner's account. Organization owners may need to approve access. Repository Contents and mandatory Metadata stay read-only. Publishing reviews requires Pull requests: read and write (pending owner approval of the GitHub App permission update). Existing installations must accept the update and users may need to sign in again. Callback URLs are exact matches for `https://codesurf.io/auth/github/callback` and `http://localhost:5179/auth/github/callback`. Webhooks are disabled.

Tokens stay in encrypted, authenticated HTTP-only cookies. OAuth uses state and PKCE. GitHub user tokens are used for repository reads so both the app's and user's permissions apply. API endpoints never accept a caller-provided GitHub token. The server refreshes expired user tokens where possible.

## Reviewing

Paste a PR URL or choose an assigned/review-requested PR. Select one or more current-code lines to ask a question. Answers stream into the right panel. Citations and labeled fenced snippets open related files beside the current editor. Unrelated lines become muted. Up to three columns can be open, each with file tabs.

Source requests use the PR head commit, including fork repositories. When new commits arrive, reopen the PR; stale head references are refused. PR imports currently include up to 300 changed files. Repository-wide search includes unchanged source at the immutable PR head. The server streams a GitHub archive into an in-memory text index, never extracts or executes source, and partitions its short-lived cache by credential and commit. Each request rechecks repository access. OpenAI can search, read numbered code blocks, and follow calls/imports over up to six model rounds and 16 tool calls. Citations open related files in columns, with multiple relevant ranges highlighted in the same file.

Search safety limits: 60 MB compressed archive, 300 MB expanded archive, 80 MB indexed text, 150,000 archive entries, and 200 KB per indexed file. Binary files, dependency/build directories, lockfiles, environment files, private-key files and source maps are excluded. Exclusion counts are visible; exceeding archive limits returns an error rather than claiming a complete search. Indexes expire after five minutes and may rebuild on Vercel cold starts. Search is lexical, guided by model tool calls, and is not an exhaustive semantic index. Review snapshots are persisted in PostgreSQL as described below.

Binary and >500 KB files are not rendered.

## OpenAI

OpenAI project: CodeSurf.io (`proj_8BfrbL1VzeoaPyX3oR10huII`). Model: `gpt-6.1-sol`, configurable by `OPENAI_MODEL`. Uses the Responses API with streaming and `store: false`. Code context is sent to OpenAI when asking a question and when choosing the next review chunk. API key is project-scoped, restricted to Responses, and expires **November 8, 2026**; rotate the server secret before expiry.

## Deployment

Vercel team: Actually Useful Things (`actually-useful-things`). Project: `codesurf`. Framework preset: Express, with Vercel native automatic bundling (no separate frontend build required). Production URL: https://codesurf.io. Temporary deployment alias: https://codesurf-alpha.vercel.app. OAuth callbacks support the custom domain, localhost, and the temporary production alias; exact allowed origins are configured with APP_ALTERNATE_URLS.

Domain bought at Namecheap for $34.98 on October 9, 2026. Registration ends October 9, 2027. Auto-renew disabled; free domain privacy enabled. Nameservers: `ns1.vercel-dns.com`, `ns2.vercel-dns.com`.

```
vercel project inspect --non-interactive
npm test
vercel deploy --prod --yes --scope actually-useful-things
```

Tests cover session encryption/tampering/expiry, PR URL validation, path traversal, diff line numbers, unauthenticated access, OAuth state and PKCE, cross-origin writes, and commit-pinned GitHub source fetching. Live API and browser verification are recorded in the task conversation.

## Current limits

Conversation state is held in the browser until reset or reload. Citations are generated by the model and should be checked against the linked code. Rate limiting currently operates per server instance; durable account quotas and billing are needed before a broader public rollout.

## Git deployment

Private source repository: https://github.com/robertkotcher/codesurf. The repository is connected to the Vercel `codesurf` project. Push to `main` for a production deployment. Other branches and pull requests receive Vercel preview deployments. GitHub Actions runs the test suite on pushes and pull requests. Production secrets are configured in Vercel, never committed.

PostgreSQL stores GitHub profiles and persistent review snapshots. Repository data comes from GitHub, sessions use encrypted cookies, and conversations live in browser memory.

## Reviews

Use the + on a diff line, or select a range and choose Comment on these lines. Draft comments and a general summary are editable in Review. Submit as Comment, Approve, or Request changes. Asking the assistant to leave a comment produces an editable draft; Publish review sends it to GitHub as the signed-in user. AI tools cannot directly publish. The server validates diff coordinates, checks the head has not moved, and posts a commit-pinned review through the user's GitHub token. Unchanged code can be discussed in a general PR review, since GitHub inline reviews require diff lines. Drafts live in browser memory and are cleared when switching PRs or reloading.

Visual answers use compact source blocks arranged in call order. Callee declarations align with the caller's exact source line; related models and templates are labeled separately. Source ranges and call sites are checked against the immutable repository snapshot. This is source exploration, not a runtime trace. Relevant lines use a narrow purple gutter without changing code formatting. Explorer and conversation collapse after an answer; a line marker reopens the short, anchored conversation. Full file opens the original source.

PR review now uses CodeMirror 6's unified merge editor, with Lucide file/folder icons. The review begins at the PR merge-base (not the moving base branch), applies immutable text edits in explained steps, and supports stepping backward. AI groups edit IDs and explains them; it never writes the replacement source. All edit IDs must occur once, deterministic replay must equal every available head document, and the browser checks SHA-256 hashes at completion. Each contiguous edit stays intact in one transformation, including full function additions and deletions. Incremental steps include only a title and explanation; line notes are not requested. The embedded review tree tracks cumulative file presence, with change statuses relative to the preceding step; navigation and explanations share the right panel. File creation, deletion and rename presence is tracked separately. Intermediate states are explanatory, not executable commits. Questions inspect the immutable PR head and are labeled accordingly.

The current snapshot budget is 1.2 MB of serialized before/after source, with 500 KB per text file and GitHub's 3,000 changed-file limit. Binary, non-UTF-8, oversized, inaccessible and partial imports are explicitly flagged and prevent a complete reconstruction claim. Verification covers changed UTF-8 file contents and file presence/renames; it does not certify Git modes/submodules or program behavior. AI selects each next chunk from the remaining immutable edit IDs, with a title and short explanation; no line notes are requested. One step is prefetched while the user reads. Invalid selections, API failures and timeouts fall back to a deterministic edit. Progress counts added plus removed lines across available text files; unavailable files are separate. Reviews now persist in PostgreSQL and resume at the furthest reviewed step for the same user, PR and head commit.

Run `npm run build` after changing `browser/review-editor.js`. Its bundled public asset is checked in so Express deployments work with standard defaults.

## Tabbed exploration chats

The far-left chat panel supports independent tabs with separate history and drafts. Select a line or drag across lines in the review editor to open an inline question; submitting creates a new focused chat. **New** creates a general PR chat, and each tab can be deleted (stopping its active answer). Tabs remain in browser memory until reload or switching PRs. Search/read progress updates and answer text stream over SSE; private model reasoning is not exposed. Intermediate selections are sent as quoted source with their transformation number, never as final-head line coordinates. The review footer contains step navigation and the high-level summary; default line-explanation markers are removed.


## Local PostgreSQL

Run `docker compose up -d --wait`, set `DATABASE_URL=postgresql://codesurf:codesurf@localhost:55433/codesurf` in `.env.local`, then run `npm run db:migrate` and restart the app. The `github_users` table stores GitHub ID, login, name, avatar URL, and last update time on sign-in. Tokens remain in encrypted cookies. The local database volume persists across container restarts. Production works without DATABASE_URL; configure it and run migrations before enabling profile persistence there.

The header account menu uses the GitHub avatar and provides My pull requests, review actions, and Sign out. Signed-out users see Sign in with GitHub. No avatar uploads or settings are required.

## Home and direct PR links

Signed-in visits to `/` show a compact, filterable list of open pull requests assigned to the user across connected GitHub App repositories. PRs are grouped alphabetically by repository and sorted newest-updated first within each group. The default window is the past 14 days of updates; Show more pull requests fetches older assigned PRs on demand, and Show fewer restores the recent window. Repository and PR lists are paginated through GitHub. My pull requests returns to this overview. A URL such as `/robertkotcher/test-app/pull/2` opens that PR automatically; opening a PR updates the address, and browser Back/Forward restores the overview or linked PR. Static assets use absolute paths so direct-link refreshes work. No modal is opened by default for signed-in users.

Follow the calls opens a horizontally scrollable call canvas at the PR head. Expand declaration callers to the left, select body lines to expand callees to the right, and ask about any line in a new chat. Branches can be collapsed or removed. Source matching is heuristic and may include ambiguous names or miss dynamic calls.

Give me sample input appears for selections inside functions with parameters. Its data canvas shows editable illustrative input JSON, declared fields, and call argument shapes. Direct references, object fields, JSON serialization, and simple numeric transformations can be previewed; other runtime values remain unknown. Callee input previews carry resolved argument values forward. Repository code is never executed.

Function graph mode keeps the exact selected review-step function instead of relocating it by PR-head line number. It automatically opens all indexed callers in a left-hand stack and connects call sites to the selected declaration. Exit graph mode restores the existing review view. Caller cards use the displayed review snapshot: merge-base plus the applied transformations. Head exploration uses the PR head.

On PR load, `/api/call-index` preloads function metadata and call edges for the head; review analysis also warms the merge-base index. The browser overlays transformed files onto the base index and re-resolves edges for the current step. JavaScript/TypeScript and Python use Lezer syntax trees; other supported source extensions use a labeled heuristic fallback. Named relative JS/TS imports are resolved, while ambiguous names remain candidates; dynamic dispatch is not a resolved runtime call stack. The repository snapshot and syntax index are cached per credential/commit in the server process, and the browser retains the compact index and fetched source. No AI request is used for graph navigation. Cold instances rebuild the index; durable indexing on repository pushes is a future step.

## Persistent incremental reviews

Production uses the Neon `codesurf-reviews` Postgres database. Run `npm run db:migrate` against the target DATABASE_URL before deployment; migrations are idempotent and additive. `review_sessions` stores private before/after source, immutable edit IDs, generated steps, and the furthest reviewed cursor. Records expire after seven days of inactivity and are purged when creating reviews. Access is scoped to the signed-in GitHub login; every review request rechecks PR access and the head commit. New commits create a fresh review. Tokens are never stored in this table.

`POST /api/reviews` creates or resumes a snapshot without AI work. `POST /api/reviews/:id/next` chooses a single next chunk, validates its IDs, and saves it with a compare-and-swap update so concurrent requests cannot append duplicate steps. `POST /api/reviews/:id/progress` records advancement before another chunk can be generated. The browser automatically displays the first chunk, prefetches one ahead, supports Back, and checks full reconstruction at completion. Source import limits remain unchanged.


## Saved pull requests

The editor header bookmark saves a PR to the signed-in account. The account menu opens Saved pull requests in a dialog. Icons use the installed Lucide library.

`003_saved_pull_requests.sql` adds persistent, account-scoped bookmarks with cached GitHub metadata. `GET /api/saved-prs` returns saved items immediately. Opening the panel refreshes live GitHub status in batches of 20 through `POST /api/saved-prs/refresh`; open and closed-unmerged PRs precede merged PRs. Unavailable repositories retain their last known status and are labeled accordingly. `POST /api/saved-prs` saves or removes a bookmark, with same-origin protection and server-side owner scoping. Saves do not expire with review sessions and contain metadata rather than source or tokens.
