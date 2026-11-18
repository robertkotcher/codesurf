# CodeSurf (local)

Ask your coding agent a question about a repository and explore the answer visually. The agent investigates and writes a small tour file. CodeSurf reads the real source, checks every reference, and opens a local viewer at `http://127.0.0.1:4319` where you can:

- **Follow the tour.** Code cards, labeled arrows and step-by-step explanations, with the direct answer at the top. Code from one file is always a single card, with labeled sections.
- **Explore beyond it.** Hover any identifier for its type (TypeScript language service for JS/TS; static indexes for Python and Ruby). Click it to open its definition on the canvas, with a dashed arrow back to where you clicked. `← Back` and `Clear explored` undo exploring.
- **Read at your pace.** The answer sits in a compact pill in the header; click it for the full text. The timeline along the bottom shows every step; click one to jump back or ahead. **Code in step** (or `C`) shows just the code a step talks about, diff style, with lines first discussed there marked `+`. Shift-click a second step to see the code for a whole range.
- **Ask follow-ups.** Type a question, optionally after selecting code or choosing "Ask about this" on a symbol. A read-only Claude Code session in the repository answers with clickable code references. When a picture helps, it builds a new view that opens in a new tab. Each tab keeps its own conversation.
- **See the UI.** When a flow involves user input, the agent runs the app with dummy data and captures screenshots with the interacted element circled, connected by arrows to the code that handles it.

## Setup

Requires Node.js 22.12+, Google Chrome (for screenshots), and a signed-in [Claude Code](https://claude.com/claude-code) CLI (for follow-ups).

```sh
npm install -g https://codesurf.io/downloads/codesurf-latest.tgz
codesurf setup      # installs the Claude Code skill, checks Chrome and Claude Code
codesurf example    # opens the demo tour
```

Or tell your agent: "Set up CodeSurf by following https://codesurf.io/llms.txt". For agents other than Claude Code, add to AGENTS.md: "When I ask you to surf code, run `codesurf guide` and follow it."

From a checkout: `cd cli && npm install && npm link && codesurf setup`.

Then ask your agent: "surf this repo: what happens when a payment is declined?"

## Commands

```
codesurf open <tour.json> [--repo DIR]     check, save and open a tour
codesurf check <tour.json> [--repo DIR]    check only
codesurf locate <file> <symbol>            print a symbol's exact lines
codesurf shot --url URL [actions] --highlight SEL --out a.png [--after b.png]
codesurf example | serve | status | stop
```

The tour format is documented in [`skill/tour-format.md`](skill/tour-format.md), and the agent workflow in [`skill/SKILL.md`](skill/SKILL.md).

## How it works

| File | Role |
| --- | --- |
| `src/tour.js` | Resolves a tour against the repo: reads files from disk or git, finds symbols, merges cards per file, checks lines and `text` guards. |
| `src/symbols.js` | Hover and go-to-definition: the TypeScript language service, plus the Python/Ruby static indexers (`python_index.py`, `ruby_index.rb`) and a name-match fallback. |
| `src/server.js` | Local server on 127.0.0.1: viewer, source, symbols, screenshots and streamed follow-ups. |
| `src/ask.js` | Runs `claude -p` with only Read/Grep/Glob in the repo, resumes the tab's session, and validates any new tour it returns. |
| `src/shot.js` | Screenshots via playwright-core and the installed Chrome, with measured highlight boxes. |
| `src/store.js` | Tours, screenshots and chats under `~/.codesurf/projects/` (or `CODESURF_HOME`). Nothing is written to your repo. |
| `viewer/` | The browser UI, bundled by the server with esbuild. |

Security: the server only listens on 127.0.0.1, rejects other `Host` headers, and requires a per-install token cookie (`SameSite=Strict`). It refuses paths outside the repository and secret-looking files (`.env`, keys). Repository code is never executed for indexing. Follow-up sessions can only read.

Limits: types and definitions come from static analysis. Dynamic dispatch, framework wiring and cross-service calls may not resolve. If a file changed after a tour was made, its card is marked and symbol lookups are disabled for it.

```sh
npm test
```
