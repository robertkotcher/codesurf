# Language adapters

Register adapters in `index.js`; no viewer or graph changes are required. `--languages typescript,python` disables Ruby for a run. The selected runtimes are launched only when matching files exist.

Each adapter exports `{id, names, matches(filename), index({roots, files, question, depth, limit})}`. `index` synchronously returns:

- `definitions`: unique IDs, name, file, absolute, start/end (inclusive, one-based), source lines, calls, changed.
- `sources`: relative file path -> array of original source lines.
- `diagnostics`: readable parser/runtime warnings.
- Optional `symbolRefs`, `symbolDefinitions`, `getSymbolData(files)`, `version`, `inputs`, `output`.

Calls use one-based line and zero-based UTF-16 column, `name`, `kind`, and verified `target` ID. Namespaced IDs prevent cross-language collisions. Never invent edges for ambiguous targets. Do not execute, import or load project code. Use bounded subprocesses with explicit runtimes.

The coordinator validates each result before merging it; an adapter failure becomes a diagnostic rather than preventing another language from indexing. All-invalid repositories fail explicitly. Remove an adapter's import and registration to remove support. Keep syntax/runtime handling inside its adapter.

Before adding an adapter, test source spans, imports/namespaces, calls and ambiguity, malformed syntax, missing runtime, no application execution, parameter shapes, mixed-language roots, disabling the adapter, and existing language regressions. Ruby uses standard-library Ripper with the selected Ruby interpreter, not unstable RubyVM AST APIs.
