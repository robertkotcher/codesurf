# CodeSurf

CodeSurf helps people learn unfamiliar code through an interactive source graph. Give your coding agent a repository and a question; it opens an Electron window with the relevant code, call paths, and chats for follow-up questions.

Supports **TypeScript, JavaScript/Node.js, Python, and Ruby**. See [codesurf.io](https://codesurf.io) for screenshots and release notes.

## Install and run

Requires Node.js 22.12+ and a graphical desktop. AI tracing and chat use your signed-in [Codex CLI](https://learn.chatgpt.com/docs/codex/cli); offline examples work without sign-in.

```sh
npm install -g https://codesurf.io/downloads/codesurf-cli-latest.tgz
codesurf /path/to/repo "What happens when a session expires?"

# Try an offline example
codesurf --demo
```

Python and Ruby projects need an installed interpreter that supports their syntax. Select one with `CODESURF_PYTHON` or `CODESURF_RUBY`. macOS is tested; Windows and Linux support is still being verified.

Quit CodeSurf before updating, then rerun the install command with `--prefer-online`.

## Explore a graph

- Follow the code from left to right; expand hidden lines only when needed.
- Use per-file undo/redo to reverse line visibility changes.
- Click a symbol or line to ask a question; use the eye button to reveal its definition.
- Ask a chat to visualize another flow to open a new graph tab.
- Scroll to zoom, drag the canvas to pan, and resize code cards horizontally.

Electron opens by default. For an HTML export:

```sh
codesurf /path/to/repo "Trace login" --html-only --out ./login.html
codesurf --help
```

## Contribute

Issues and pull requests are welcome. Small, focused changes are easiest to review; include what changed and how you checked it. Please open an issue before a large architectural change.

```sh
git clone https://github.com/robertkotcher/codesurf.git
cd codesurf
npm ci
npm ci --prefix cli
npm test --prefix cli
node cli/src/cli.js --demo
```

If you do not have write access, fork the repository and open a pull request from your fork. All changes to `main` go through pull requests and CI; direct pushes, force pushes, and branch deletion are disabled, including for administrators.

Project layout:

| Directory | Purpose |
| --- | --- |
| `cli/src/` | CLI, Electron app, source graph, and chat |
| `cli/src/languages/` | Independent language adapters and their [contract](cli/src/languages/README.md) |
| `cli/test/` | Parser, viewer, and integration tests |
| `public/` | Documentation website and screenshots |
| `scripts/build-docs.mjs` | Build and validate the downloadable release |

Run the checks before opening a PR:

```sh
npm test
npm test --prefix cli
npm run build
```

Language changes should include fixtures for source locations, resolution, ambiguous calls, invalid syntax, and mixed-language repositories. Never execute target-project code during indexing. Avoid private source code or credentials in fixtures and screenshots.

The repository also retains an earlier web review application; its setup is documented in [the legacy guide](docs/legacy-web-app.md). It is separate from the current desktop CLI.

## Limits and privacy

CodeSurf uses static analysis, so dynamic dispatch and framework-generated behavior may be missed. AI investigation can send repository source to the configured model provider. Reports include source snapshots; review them before sharing.

[MIT license](LICENSE).
