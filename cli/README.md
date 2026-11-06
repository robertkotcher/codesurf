# CodeSurf

Ask a natural-language question about a repository and explore the answer as a left-to-right graph of source snippets. Edges start at the actual call lines and end at function definitions.

Requires Node 22.12+, the Codex CLI, and `codex login`. Python repositories additionally need a Python 3.10+ interpreter that understands their syntax. The first desktop launch downloads Electron. The default investigation uses your Codex account and sends the source it reads to the configured model service. `--static` uses local compiler analysis only.

```sh
npm install -g https://codesurf.io/downloads/codesurf-cli-0.1.0.tgz
# If needed, install Codex and let the human sign in once.
npm install -g @openai/codex
codex login
codesurf /path/to/repo "What happens when a session expires?"
```

Any agent with shell access can run the last command using the existing Codex login. For a headless environment, add `--no-open --out ./artifacts/trace.html`; this writes HTML plus a JSON source snapshot without starting a desktop window.

Source development: run `npm ci` and `npm link` from this `cli/` directory. `npm run demo` traces the bundled illustrative source under `examples/auth-refresh`; it does not execute those HTTP requests.

The window has a natural-language input; enter another scenario and press Trace to replace the graph. Any agent with shell access can use the same CLI. The CLI exits after launching its separate 1080 × 760 window.

## Explore

- Read from left to right: question/response card, entry, calls, then implementations. The overview is a graph element with its own lane and an arrow to the entry (or its collapsed folder); it pans and zooms with the code instead of floating over it.
- Nested yellow regions come only from repository-relative folders, such as `src → lib → api`. Outer folders are slightly darker; inner folders become lighter. The LLM does not classify or group files.
- Click a folder label to collapse or reopen it. Siblings stay independent, and calls involving hidden code attach to the collapsed folder boundary. Internal connections within the same closed folder are suppressed.
- Each source file appears exactly once. Excerpts from multiple functions in that file are merged in source-line order without duplicate rows; same-file calls loop back to the appropriate definition in the same panel.
- Hover a line to highlight its incoming ancestry and downstream calls transitively, including their code. A specific call line focuses that call instead of unrelated sibling calls. Click a line or its number to pin the path; hover can temporarily preview another path, then restore the pin. Click the pinned line again or press Escape to clear it. Edges are muted by default, and unrelated code and edges fade further while focusing. This follows the selected static call graph; it does not assert runtime branch execution.
- Short snippets show the lines selected for the scenario. Cards start compact, with unwrapped code and native horizontal scrolling. Drag a card's lower-right corner to resize it, or use its ↵ Wrap toggle. Folder bounds and edges update as cards resize or scroll.
- Edges touch the left or right boundary of the code row. Filled triangle arrowheads stop at the card boundary; there are no inline markers that can wrap onto another line.
- Clicking a token opens only a question panel, near its source card. Ask about local behavior or an external API; the read-only agent can inspect repository source and search/read the internet as appropriate. Concise tool activity appears immediately, and the actual user-facing answer streams as it is generated. Detailed internal reasoning and raw command output are not displayed.
- Keep multiple panels open. Each maintains its own conversation, can be moved or closed, and fades when inactive. Answers and panel positions are saved locally for that report, including across reloads. A new trace is a separate report with its own question history. Token questions require the desktop window; saved HTML still supports folder and code exploration.
- Interior omitted lines appear only as faint, non-interactive marks. The top and bottom controls reveal 8 more file lines and fill the context between the existing excerpt bounds. Expansion relays out the graph and reconnects edges. Snippets can extend beyond a function into the rest of its file.
- Drag empty canvas to pan; scroll to zoom; Fit shows the whole graph. Keyboard: focus the canvas, then +/−, 0, or arrow keys.
- The info button explains assumptions and branches omitted for your scenario. Parameter-specific reasoning is an explanation from source, not proof from running the application.

Reports are self-contained HTML snapshots plus JSON at `~/.codesurf/reports/`. Saved HTML supports graph exploration in a browser; asking a new question requires the desktop window. Reports embed source files and local paths, so keep them private like your repository.

## Options

```sh
codesurf ~/app "What happens when the user submits an empty title?" --no-open --out ./empty-title.html
codesurf ~/app "Trace a checkout" --repo ~/backend --limit 15
codesurf ~/app "login" --static --entry src/api/login.ts#POST --depth 4
```

`--repo` adds a repository root. `--limit` caps initially selected functions (default 36). `--entry` optionally fixes the entry; natural-language selection does not require it. `--static` skips Codex and uses keyword-based entry selection and a bounded call traversal; `--depth` applies to that traversal. `--no-open` writes a report without starting Electron. `CODESURF_CODEX` can select a Codex executable when it is not on PATH.

## Implementation

`src/analyze.js` dispatches by language and combines mixed repositories. `src/typescript.js` indexes JavaScript/TypeScript with the TypeScript 6 compiler API, including Node ESM/CommonJS and each repository's import aliases. `src/python_index.py` uses the selected Python interpreter's standard-library AST and token positions, without importing or running repository code. It resolves ordinary and relative imports, aliases, package/src layouts, async functions, lexical functions, and statically identifiable class methods. It stores complete indexed source files for context expansion and definitions for navigation. Green gutters indicate staged/unstaged additions and edits relative to Git HEAD; deleted lines are not shown.

`src/planner.js` runs `codex exec` in a read-only sandbox with structured JSON output. The investigator searches and reads source, chooses the scenario's entry, relevant functions, source lines, assumptions, and omitted calls. CodeSurf validates IDs and line bounds, and requires a compiler-verified call path from the entry to every initially selected function. It rejects invented locations and disconnected plans instead of drawing unsupported edges. Investigations time out after five minutes; errors remain visible rather than silently falling back to keyword matching.

`src/graph.js` merges functions into file panels while retaining function-level relationships for cycle-safe path focus. `src/layout.js` builds the nested folder geometry from paths, independently of LLM output. `src/viewer.js` renders compact code cards and row-side edges. `src/chats.js` manages anchored, locally persisted question panels. `src/inspect.js` and `src/stream.js` use the Codex app-server protocol for real answer deltas and brief activity notifications with repository and web tools. `src/window.cjs` hosts a sandboxed Electron window and validates selected tokens against the saved source before sending context to the model; `src/preload.cjs` exposes narrow trace, inspection, and progress methods. The desktop invokes the CLI for each new trace. `src/report.js` writes safely escaped self-contained snapshots.

## Limits

This is source-based reasoning, not runtime tracing. No application requests execute. Conditions may depend on unknown data, and LLM conclusions can be wrong. Review assumptions and original source. Dynamic dispatch, framework callbacks, and cross-service HTTP links are not reliably reconstructed; unsupported links are not invented. Multiple roots do not imply a connection. Python, TypeScript, and JavaScript/Node repositories are supported, including mixed roots. Python dynamic imports, monkey-patching, metaclasses, and unproven instance dispatch remain boundaries; Python dependency declarations are not bundled, but external-token questions/documentation still work. Token questions may explain external code from installed declaration context and live references; they do not execute it. Manual context expansion can reveal branches outside the original scenario. Large repositories use more time, report size, and memory.

```sh
npm test
npm run demo
```

The trace planner follows the [official Codex non-interactive mode documentation](https://learn.chatgpt.com/docs/non-interactive-mode); token questions use the [Codex app-server streaming protocol](https://learn.chatgpt.com/docs/app-server).

## Language versions

CodeSurf reads source; it does not require the target application's Node runtime or execute its scripts. It accepts `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.py`, `.pyi`, and `.pyw` files. JavaScript/TypeScript parsing uses the bundled TypeScript 6.0.3 compiler API (the native TypeScript 7 package has a different API); this does not change the target repository's dependencies or compiler. Newer unsupported syntax produces explicit parser diagnostics rather than a claim of a complete trace.

For Python, CodeSurf discovers versioned Python 3 executables on PATH, chooses the newest available interpreter (minimum 3.10), and parses using that interpreter's grammar. Use a matching interpreter for version-specific syntax—for example, Python 3.12+ for PEP 695 type parameters. Override selection for a project:

```sh
CODESURF_PYTHON=/path/to/project/.venv/bin/python codesurf ~/python-project "Trace a request with an empty title"
```

Virtual environments, dependency directories, caches, and build output are skipped. Python syntax/encoding errors identify the file and selected parser version in the terminal and report info panel. Successfully parsed files remain available; an all-unparseable repository fails explicitly. Mixed Python/Node repositories do not automatically imply verified HTTP or subprocess edges between languages.
