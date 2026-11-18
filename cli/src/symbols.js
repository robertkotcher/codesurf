// Hover and go-to-definition. TypeScript/JavaScript use the TypeScript
// language service (real types). Python and Ruby use CodeSurf's static
// indexers, which never import or execute repository code.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import ts from "typescript";
import python from "./python.js";
import ruby from "./ruby.js";
import { languageOf, repoPath, splitLines } from "./tour.js";

const IGNORED = new Set(["node_modules", ".git", ".next", "dist", "build", "coverage", "vendor", "venv", ".venv", "env", "__pycache__", "site-packages", ".codesurf"]);
const TS_FILE = /\.(?:[cm]?[jt]sx?)$/i;

function walk(root, matches, out = [], limit = 20000) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (out.length >= limit) break;
    if (entry.isDirectory()) {
      if (!entry.name.startsWith(".") && !IGNORED.has(entry.name)) walk(path.join(root, entry.name), matches, out, limit);
    } else if (entry.isFile() && matches(entry.name)) out.push(path.join(root, entry.name));
  }
  return out;
}

const services = new Map();
function typescriptService(root) {
  if (services.has(root)) return services.get(root);
  let options = { allowJs: true, checkJs: false, jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, esModuleInterop: true, resolveJsonModule: true, skipLibCheck: true, noEmit: true };
  let names = [];
  const config = ts.findConfigFile(root, ts.sys.fileExists, "tsconfig.json") || ts.findConfigFile(root, ts.sys.fileExists, "jsconfig.json");
  if (config && path.dirname(config).startsWith(root)) {
    const parsed = ts.parseJsonConfigFileContent(ts.readConfigFile(config, ts.sys.readFile).config, ts.sys, path.dirname(config));
    options = { ...parsed.options, allowJs: true, noEmit: true };
    names = parsed.fileNames;
  }
  if (!names.length) names = walk(root, (name) => TS_FILE.test(name));
  const roots = new Set(names);
  const versions = new Map();
  const host = {
    getScriptFileNames: () => [...roots],
    getScriptVersion: (file) => {
      try { return String(fs.statSync(file).mtimeMs); } catch { return versions.get(file) || "0"; }
    },
    getScriptSnapshot: (file) => fs.existsSync(file) ? ts.ScriptSnapshot.fromString(fs.readFileSync(file, "utf8")) : undefined,
    getCurrentDirectory: () => root,
    getCompilationSettings: () => options,
    getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
    fileExists: ts.sys.fileExists, readFile: ts.sys.readFile, readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists, getDirectories: ts.sys.getDirectories,
  };
  const service = { ls: ts.createLanguageService(host, ts.createDocumentRegistry()), roots };
  services.set(root, service);
  return service;
}

function tsPosition(service, file, line, column) {
  service.roots.add(file);
  const program = service.ls.getProgram();
  const source = program?.getSourceFile(file);
  if (!source) return null;
  const lineStarts = source.getLineStarts();
  if (line < 1 || line > lineStarts.length) return null;
  return { source, position: Math.min(lineStarts[line - 1] + column, source.end) };
}

const display = (root, file) => {
  const relative = path.relative(root, file);
  if (!relative.startsWith("..") && !path.isAbsolute(relative)) return { path: relative.split(path.sep).join("/"), external: relative.split(path.sep).includes("node_modules") };
  const lib = path.dirname(ts.getDefaultLibFilePath({}));
  return { path: file.startsWith(lib) ? "typescript/lib/" + path.relative(lib, file) : path.basename(file), external: true };
};

function tsHover(root, file, line, column) {
  const service = typescriptService(root);
  const at = tsPosition(service, file, line, column);
  if (!at) return null;
  const info = service.ls.getQuickInfoAtPosition(file, at.position);
  if (!info) return null;
  const start = at.source.getLineAndCharacterOfPosition(info.textSpan.start);
  return {
    signature: ts.displayPartsToString(info.displayParts),
    documentation: ts.displayPartsToString(info.documentation),
    tags: (info.tags || []).map((t) => "@" + t.name + (t.text ? " " + ts.displayPartsToString(t.text) : "")),
    kind: info.kind,
    span: { line: start.line + 1, column: start.character, length: info.textSpan.length },
  };
}

function tsDefinitions(root, file, line, column) {
  const service = typescriptService(root);
  const at = tsPosition(service, file, line, column);
  if (!at) return [];
  const found = service.ls.getDefinitionAtPosition(file, at.position) || [];
  const program = service.ls.getProgram();
  return found.slice(0, 8).map((d) => {
    const source = program.getSourceFile(d.fileName);
    const span = d.contextSpan || d.textSpan;
    let first = source.getLineAndCharacterOfPosition(span.start).line + 1;
    const last = source.getLineAndCharacterOfPosition(span.start + span.length).line + 1;
    const nameLine = source.getLineAndCharacterOfPosition(d.textSpan.start).line + 1;
    const where = display(root, d.fileName);
    const lines = splitLines(source.text);
    // Include the doc comment directly above the declaration.
    while (first > 1 && /^\s*(\/\*\*|\*|\/\/|\*\/)/.test(lines[first - 2])) first--;
    // Clicking an import path opens the top of that file.
    const module = d.kind === "script" || d.kind === "module";
    if (module) first = 1;
    return {
      ...where, name: d.name, kind: d.kind, container: d.containerName || "", line: nameLine,
      range: module ? [1, Math.min(lines.length, 40)] : [first, Math.min(last, first + 400)],
      // External files are not readable through the file API, so ship their excerpt.
      ...(where.external ? { excerpt: { startLine: first, source: lines.slice(first - 1, Math.min(last, first + 60)).join("\n") } } : {}),
    };
  });
}

const indexes = new Map();
function indexed(root, language) {
  const key = root + "|" + language;
  if (indexes.has(key)) return indexes.get(key);
  const adapter = language === "python" ? python : ruby;
  const files = walk(root, (name) => adapter.matches(name));
  let result = { symbolRefs: {}, symbolDefinitions: {}, definitions: [] };
  try { if (files.length) result = adapter.index({ roots: [root], files }); }
  catch (error) { result.error = error.message; }
  indexes.set(key, result);
  return result;
}

function indexedLookup(root, relative, language, line, column) {
  const index = indexed(root, language);
  const refs = index.symbolRefs?.[relative] || [];
  const ref = refs.find((r) => r.line === line && column >= r.column && column < r.column + (r.length || r.text.length));
  const byId = (id) => index.symbolDefinitions?.[id] || index.definitions?.find((d) => d.id === id);
  let definition = ref?.target && byId(ref.target);
  if (!definition) {
    // A click on the definition's own name resolves to itself.
    const { word } = wordAt(root, relative, line, column);
    definition = word && [...(index.definitions || []), ...Object.values(index.symbolDefinitions || {})].find((d) => d.file === relative && d.start === line && d.name.split(".").at(-1) === word);
  }
  return definition ? { definition, text: ref?.text } : null;
}

function wordAt(root, relative, line, column) {
  const text = splitLines(fs.readFileSync(repoPath(root, relative), "utf8"))[line - 1] || "";
  const left = text.slice(0, column + 1).match(/[\p{L}\p{N}_$]*$/u)[0];
  const right = text.slice(column + 1).match(/^[\p{L}\p{N}_$]*/u)[0];
  return { word: (left + right) || "", start: column + 1 - left.length };
}

/** Fallback for languages without an index: likely definitions by name. */
function grepDefinitions(root, word) {
  if (!/^[\p{L}_$][\p{L}\p{N}_$]*$/u.test(word)) return [];
  const pattern = `(function|def|class|module|interface|type|struct|enum|const|let|var|fn|func)[[:space:]]+${word}([^[:alnum:]_]|$)`;
  try {
    const out = execFileSync("git", ["-C", root, "grep", "-n", "-I", "-E", "--untracked", pattern], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
    return out.split("\n").filter(Boolean).slice(0, 8).map((row) => {
      const [file, line] = row.split(":");
      return { path: file, external: false, name: word, kind: "match", container: "", line: Number(line), range: [Number(line), Number(line) + 15], guess: true };
    });
  } catch { return []; }
}

export function hover(root, relative, line, column) {
  const file = repoPath(root, relative);
  const language = languageOf(relative);
  if (language === "typescript" || language === "javascript") return tsHover(root, file, line, column);
  if (language === "python" || language === "ruby") {
    const hit = indexedLookup(root, relative, language, line, column);
    if (!hit) return null;
    const d = hit.definition;
    const signature = (d.lines || []).slice(0, 3).join("\n").trim();
    const inputs = (d.inputs || []).map((i) => `${i.name}: ${i.type}${i.optional ? " (optional)" : ""}`);
    return { signature, documentation: d.doc || "", tags: inputs, kind: d.kind || "definition", defined: `${d.file}:${d.start}` };
  }
  return null;
}

export function definitions(root, relative, line, column) {
  const file = repoPath(root, relative);
  const language = languageOf(relative);
  if (language === "typescript" || language === "javascript") {
    const found = tsDefinitions(root, file, line, column);
    if (found.length) return found;
  } else if (language === "python" || language === "ruby") {
    const hit = indexedLookup(root, relative, language, line, column);
    if (hit) {
      const d = hit.definition;
      return [{ path: d.file, external: false, name: d.name, kind: "definition", container: "", line: d.start, range: [d.start, d.end] }];
    }
  }
  return grepDefinitions(root, wordAt(root, relative, line, column).word);
}

/** Drop cached indexes so edits on disk are picked up. TS tracks mtimes itself. */
export function invalidate(root) {
  for (const key of indexes.keys()) if (key.startsWith(root + "|")) indexes.delete(key);
}
