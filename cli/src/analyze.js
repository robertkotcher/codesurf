import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { analyze as analyzeTypeScript } from "./typescript.js";

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
function sourceFiles(root) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (
      entry.isDirectory() &&
      !entry.name.startsWith(".") &&
      !ignored.has(entry.name)
    )
      files.push(...sourceFiles(path.join(root, entry.name)));
    else if (entry.isFile() && /\.(?:[cm]?[jt]sx?|pyi?|pyw)$/.test(entry.name))
      files.push(path.join(root, entry.name));
  }
  return files;
}

function pythonRuntime() {
  const pythonOverride =
    process.env.CODESURF_PYTHON || process.env.CODETRAIL_PYTHON;
  const candidates = new Set(pythonOverride ? [pythonOverride] : ["python3"]);
  if (!pythonOverride)
    for (const dir of (process.env.PATH || "").split(path.delimiter)) {
      try {
        for (const name of fs.readdirSync(dir))
          if (/^python3\.\d+$/.test(name)) candidates.add(path.join(dir, name));
      } catch {}
    }
  const available = [];
  for (const executable of candidates) {
    try {
      const version = JSON.parse(
        execFileSync(
          executable,
          [
            "-I",
            "-S",
            "-c",
            "import sys,json;print(json.dumps(list(sys.version_info[:3])))",
          ],
          {
            encoding: "utf8",
            timeout: 5000,
            stdio: ["ignore", "pipe", "ignore"],
          },
        ),
      );
      if (version[0] === 3 && version[1] >= 10)
        available.push({ executable, version });
    } catch {}
  }
  available.sort(
    (a, b) => b.version[1] - a.version[1] || b.version[2] - a.version[2],
  );
  if (!available.length)
    throw new Error(
      "Python source requires Python 3.10+ on PATH. Set CODESURF_PYTHON to the interpreter that supports your project's syntax.",
    );
  return available[0];
}

export function analyze(
  roots,
  question,
  { entry, depth = 4, limit = 36, catalog = false } = {},
) {
  roots = roots.map((r) => fs.realpathSync(r));
  const files = roots.flatMap(sourceFiles),
    pythonFiles = files.filter((f) => /\.py[wi]?$/.test(f));
  const jsFiles = files.filter(
    (f) => /\.[cm]?[jt]sx?$/.test(f) && !f.endsWith(".d.ts"),
  );
  if (!pythonFiles.length && !jsFiles.length)
    throw new Error("No Python, JavaScript, or TypeScript source files found.");
  const js = jsFiles.length
    ? analyzeTypeScript(roots, question, { depth, limit, catalog: true })
    : null;
  let py = null;
  if (pythonFiles.length) {
    const runtime = pythonRuntime();
    py = JSON.parse(
      execFileSync(
        runtime.executable,
        [
          "-I",
          "-S",
          fileURLToPath(new URL("./python_index.py", import.meta.url)),
        ],
        {
          input: JSON.stringify({ roots, files: pythonFiles }),
          encoding: "utf8",
          maxBuffer: 128 * 1024 * 1024,
          timeout: 120000,
        },
      ),
    );
    py.runtime = `${runtime.executable} (${runtime.version.join(".")})`;
  }
  const definitions = [...(js?.definitions || []), ...(py?.definitions || [])];
  const sources = { ...js?.sources, ...py?.sources };
  const diagnostics = [...(js?.diagnostics || []), ...(py?.diagnostics || [])];
  if (!definitions.length)
    throw new Error(
      "No traceable function definitions found." +
        (diagnostics.length ? "\n" + diagnostics.join("\n") : ""),
    );
  if (py)
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
            "*.py",
            "*.pyi",
            "*.pyw",
          ],
          { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
        );
        let file;
        for (const line of diff.split("\n")) {
          if (line.startsWith("+++ b/")) file = path.join(root, line.slice(6));
          const match = /^@@ .* \+(\d+)(?:,(\d+))? @@/.exec(line);
          if (match)
            for (const n of py.definitions.filter((n) => n.absolute === file))
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
    const data = js?.getSymbolData(selectedFiles) || {
      symbolRefs: {},
      symbolDefinitions: {},
    };
    for (const file of selectedFiles)
      if (py?.symbolRefs[file]) data.symbolRefs[file] = py.symbolRefs[file];
    Object.assign(data.symbolDefinitions, py?.symbolDefinitions);
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
    languages: [
      ...(js ? ["JavaScript", "TypeScript"] : []),
      ...(py ? ["Python"] : []),
    ],
    parsers: {
      ...(js ? { typescript: js.parserVersion } : {}),
      ...(py ? { python: py.runtime } : {}),
    },
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
    note: "Static source relationships, not runtime observations. Dynamic dispatch, framework callbacks, and Python/Node HTTP or process boundaries are not inferred. Syntax diagnostics are reported explicitly.",
  };
}
