import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { languageAdapters, validateIndex } from "./languages/index.js";

const ignored = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  "coverage",
  "vendor",
  "venv",
  "env",
  "__pycache__",
  "site-packages",
]);
function sourceFiles(root, adapters) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (
      entry.isDirectory() &&
      !entry.name.startsWith(".") &&
      !ignored.has(entry.name)
    )
      files.push(...sourceFiles(path.join(root, entry.name), adapters));
    else if (entry.isFile() && adapters.some(adapter => adapter.matches(entry.name)))
      files.push(path.join(root, entry.name));
  }
  return files;
}


export function analyze(
  roots,
  question,
  { entry, depth = 4, limit = 36, catalog = false, languages } = {},
) {
  roots = roots.map((r) => fs.realpathSync(r));
  const adapters = languages ? languages.map(id => {
    const adapter = languageAdapters.find(a => a.id === id);
    if (!adapter) throw new Error(`Unknown language adapter: ${id}`);
    return adapter;
  }) : languageAdapters;
  const files = roots.flatMap(root => sourceFiles(root, adapters));
  if (!files.length) throw new Error("No supported source files found (" + adapters.flatMap(a => a.names).join(", ") + ").");
  const indexes = [], diagnostics = [];
  for (const adapter of adapters) {
    const selected = files.filter(file => adapter.matches(file));
    if (!selected.length) continue;
    try {
      const result = adapter.index({roots,files:selected,question,depth,limit});
      validateIndex(adapter.id, result);
      indexes.push({adapter,result});
      diagnostics.push(...result.diagnostics);
    } catch (error) {
      diagnostics.push(`${adapter.id} adapter: ${error.message}`);
    }
  }
  const definitions = indexes.flatMap(({result}) => result.definitions);
  const sources = Object.assign({}, ...indexes.map(({result}) => result.sources));
  if (!definitions.length)
    throw new Error(
      "No traceable function definitions found." +
        (diagnostics.length ? "\n" + diagnostics.join("\n") : ""),
    );
  for (const {adapter, result} of indexes.filter(({adapter}) => adapter.id !== "typescript"))
    for (const root of roots) {
      try {
        const diff = execFileSync(
          "git",
          [
            "-C",
            root,
            "diff",
            "HEAD",
            "--no-ext-diff",
            "--no-color",
            "--unified=0",
            "--",
            ...files.filter(file => adapter.matches(file) && file.startsWith(root + path.sep)).map(file => path.relative(root,file)),
          ],
          { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
        );
        let file;
        for (const line of diff.split("\n")) {
          if (line.startsWith("+++ b/")) file = path.join(root, line.slice(6));
          const match = /^@@ .* \+(\d+)(?:,(\d+))? @@/.exec(line);
          if (match)
            for (const n of result.definitions.filter((n) => n.absolute === file))
              for (
                let l = Math.max(n.start, Number(match[1]));
                l < Number(match[1]) + Number(match[2] ?? 1) && l <= n.end;
                l++
              )
                n.changed.push(l);
        }
      } catch {}
    }
  function getSymbolData(selectedFiles) {
    const data = {symbolRefs:{},symbolDefinitions:{}};
    for (const {result} of indexes) {
      const symbols = result.getSymbolData?.(selectedFiles) || result;
      for (const file of selectedFiles)
        if (symbols.symbolRefs?.[file]) data.symbolRefs[file] = symbols.symbolRefs[file];
      Object.assign(data.symbolDefinitions,symbols.symbolDefinitions);
    }
    return data;
  }
  const index = {
    roots,
    question,
    definitions,
    sources,
    diagnostics,
    getSymbolData,
    scanned: Object.keys(sources).length,
    symbols: definitions.length,
    depth,
    limit,
    languages: indexes.flatMap(({adapter}) => adapter.names),
    parsers: Object.fromEntries(indexes.map(({adapter,result}) => [adapter.id,result.version || result.parserVersion || "unknown"])),
  };
  if (catalog) return index;
  const terms = question
    .toLowerCase()
    .split(/[^\p{L}\p{N}_$]+/u)
    .filter(
      (t) =>
        t.length > 1 &&
        ![
          "trace",
          "show",
          "what",
          "happens",
          "when",
          "the",
          "user",
          "request",
          "with",
          "and",
          "how",
        ].includes(t),
    );
  const ranked = definitions
    .map((n) => ({
      n,
      score: terms.reduce(
        (s, t) =>
          s +
          (n.name.toLowerCase() === t
            ? 10
            : (n.name + " " + n.file).toLowerCase().includes(t)
              ? 3
              : n.lines.join("\n").toLowerCase().includes(t)
                ? 0.2
                : 0),
        0,
      ),
    }))
    .sort((a, b) => b.score - a.score);
  const seed = entry
    ? definitions.find(
        (n) =>
          `${n.file}#${n.name}` === entry ||
          `${n.absolute}#${n.name}` === entry,
      )
    : ranked[0]?.score > 0
      ? ranked[0].n
      : null;
  if (!seed)
    throw new Error(
      entry
        ? `Entry not found: ${entry}`
        : "No matching entry. Supply --entry relative/file#functionName.",
    );
  const byId = new Map(definitions.map((n) => [n.id, n])),
    selected = new Map(),
    queue = [{ id: seed.id, level: 0 }];
  while (queue.length && selected.size < limit) {
    const { id, level } = queue.shift();
    if (selected.has(id)) continue;
    const n = byId.get(id);
    selected.set(id, { ...n, level });
    if (level < depth)
      for (const c of n.calls)
        if (byId.has(c.target)) queue.push({ id: c.target, level: level + 1 });
  }
  return {
    ...index,
    nodes: [...selected.values()],
    entry: seed.id,
    ...getSymbolData([...selected.values()].map((n) => n.file)),
    mode: "static",
    generated: new Date().toISOString(),
    note: "Static source relationships, not runtime observations. Dynamic dispatch, framework callbacks, and cross-language HTTP or process boundaries are not inferred. Syntax diagnostics are reported explicitly.",
  };
}
