# CodeSurf

CodeSurf helps people learn unfamiliar code. Ask your coding agent a question about a repository. It investigates, writes a small tour, and CodeSurf opens a local viewer with the answer drawn as source cards and arrows. From there you can hover for types, click any symbol to open its definition, see screenshots of the app when UI is involved, and ask follow-up questions that draw new views.

Supports **TypeScript, JavaScript/Node.js, Python, and Ruby** for types and definitions; tours can show any language.

## Install and run (local)

Requires Node.js 22.12+, Google Chrome for screenshots, and a signed-in [Claude Code](https://claude.com/claude-code) CLI for follow-up questions.

```sh
npm install -g https://codesurf.io/downloads/codesurf-latest.tgz
codesurf setup
codesurf example
```

Or tell your agent: "Set up CodeSurf by following https://codesurf.io/llms.txt".

Then ask your agent to "surf" a question, for example: "surf: what happens when a session expires?" See [cli/README.md](cli/README.md) for commands and the architecture.

## Contribute

Issues and pull requests are welcome. Small, focused changes are easiest to review; include what changed and how you checked it. Please open an issue before a large architectural change.

```sh
git clone https://github.com/robertkotcher/codesurf.git
cd codesurf
npm ci
npm ci --prefix cli
npm test --prefix cli
node cli/src/cli.js example
```

If you do not have write access, fork the repository and open a pull request from your fork. All changes to `main` go through pull requests and CI; direct pushes, force pushes, and branch deletion are disabled, including for administrators.

Project layout:

| Directory | Purpose |
| --- | --- |
| `cli/src/` | CLI, local server, tour resolver, symbols, follow-ups, screenshots |
| `cli/viewer/` | Browser viewer |
| `cli/skill/` | Agent skill and tour format |
| `cli/test/` | Resolver, symbol, server and screenshot tests |
| `public/` | Documentation website and screenshots |
| `scripts/build-docs.mjs` | Validate the website's content security policy |

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
