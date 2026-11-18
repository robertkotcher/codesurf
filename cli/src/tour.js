// Resolve an agent-authored tour against the real repository, merge code
// cards per file, and validate every reference. The output is what the
// viewer renders, so anything that reaches it has been checked here.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import ts from "typescript";

export const SCHEMA_VERSION = 2;
const KINDS = new Set(["call", "event", "return", "success", "failure", "data"]);
const ID = /^[A-Za-z0-9_-]+$/;
const LANGUAGES = {
  ".ts": "typescript", ".tsx": "typescript", ".mts": "typescript", ".cts": "typescript",
  ".js": "javascript", ".jsx": "javascript", ".mjs": "javascript", ".cjs": "javascript",
  ".py": "python", ".pyi": "python", ".rb": "ruby", ".json": "json", ".sh": "bash",
  ".css": "css", ".html": "xml", ".xml": "xml", ".go": "go", ".rs": "rust", ".java": "java",
  ".kt": "kotlin", ".swift": "swift", ".c": "c", ".h": "c", ".cpp": "cpp", ".cs": "csharp",
  ".php": "php", ".sql": "sql", ".yml": "yaml", ".yaml": "yaml", ".md": "markdown",
};
export const languageOf = (file) => LANGUAGES[path.extname(file).toLowerCase()] || "plaintext";
export const hash = (text) => crypto.createHash("sha256").update(text).digest("hex").slice(0, 16);

class TourError extends Error {
  constructor(problems) {
    super("Tour has " + problems.length + " problem" + (problems.length === 1 ? "" : "s") + ":\n- " + problems.join("\n- "));
    this.problems = problems;
  }
}

/** Resolve a repository-relative path, refusing anything outside the root. */
export function repoPath(root, file) {
  const absolute = path.resolve(root, file);
  const relative = path.relative(root, absolute);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error(`Path is outside the repository: ${file}`);
  return absolute;
}

export function readSource(root, file, ref) {
  if (ref) {
    try {
      return execFileSync("git", ["-C", root, "show", `${ref}:${path.relative(root, repoPath(root, file)).split(path.sep).join("/")}`],
        { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      throw new Error(`Cannot read ${file} at ${ref}: ${error.stderr?.toString().trim() || error.message}`);
    }
  }
  return fs.readFileSync(repoPath(root, file), "utf8");
}

export const splitLines = (source) => {
  const lines = source.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  return lines;
};

/** Find the line span of a named declaration ("name" or "Class.method"). */
export function findSymbol(source, language, symbol) {
  const parts = symbol.split(".");
  const lines = splitLines(source);
  if (language === "typescript" || language === "javascript") {
    const file = ts.createSourceFile("x.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const matches = [];
    const nameOf = (node) => {
      if (node.name && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) || ts.isPrivateIdentifier(node.name))) return node.name.text;
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) return node.name.text;
      return undefined;
    };
    const visit = (node, trail) => {
      const name = nameOf(node);
      const declaration = ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isMethodDeclaration(node) ||
        ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node) ||
        ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node) || ts.isPropertyAssignment(node) ||
        ts.isGetAccessor(node) || ts.isSetAccessor(node) || ts.isConstructorDeclaration(node) || ts.isModuleDeclaration(node);
      const label = ts.isConstructorDeclaration(node) ? "constructor" : name;
      const next = declaration && label ? [...trail, label] : trail;
      if (declaration && label && next.slice(-parts.length).join(".") === symbol) {
        // Variable declarations span their whole statement so `export const x = ...` is included.
        const target = ts.isVariableDeclaration(node) ? node.parent.parent : node;
        const start = file.getLineAndCharacterOfPosition(target.getStart(file)).line + 1;
        const end = file.getLineAndCharacterOfPosition(target.getEnd()).line + 1;
        matches.push([start, end]);
      }
      ts.forEachChild(node, (child) => visit(child, next));
    };
    visit(file, []);
    return matches;
  }
  const indent = (text) => text.match(/^\s*/)[0].length;
  const matches = [];
  const name = parts.at(-1);
  const pattern = language === "python"
    ? new RegExp(`^\\s*(?:async\\s+def|def|class)\\s+${escape(name)}\\b`)
    : language === "ruby"
      ? new RegExp(`^\\s*(?:def\\s+(?:self\\.)?|class\\s+|module\\s+)${escape(name)}\\b`)
      : new RegExp(`\\b(?:function|def|fn|func|class|struct|interface|type)\\s+${escape(name)}\\b`);
  for (let i = 0; i < lines.length; i++) {
    if (!pattern.test(lines[i])) continue;
    const base = indent(lines[i]);
    let end = i;
    if (language === "ruby") {
      for (let j = i + 1; j < lines.length; j++)
        if (indent(lines[j]) === base && /^\s*end\b/.test(lines[j])) { end = j; break; }
    } else if (language === "python") {
      for (let j = i + 1; j < lines.length; j++) {
        if (!lines[j].trim() || lines[j].trim().startsWith("#")) continue;
        if (indent(lines[j]) <= base && !/^\s*[)\]}]/.test(lines[j])) break;
        end = j;
      }
    } else {
      let depth = 0, opened = false;
      for (let j = i; j < lines.length; j++) {
        for (const c of lines[j]) { if (c === "{") { depth++; opened = true; } else if (c === "}") depth--; }
        end = j;
        if (opened && depth <= 0) break;
      }
    }
    // Include decorators directly above Python definitions.
    let start = i;
    while (language === "python" && start > 0 && /^\s*@/.test(lines[start - 1])) start--;
    matches.push([start + 1, end + 1]);
  }
  return matches;
}
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const isRange = (value) => Array.isArray(value) && value.length === 2 && value.every(Number.isInteger) && value[0] >= 1 && value[0] <= value[1];
const mergeRanges = (ranges) => {
  const sorted = ranges.map((r) => [...r]).sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const range of sorted) {
    const last = out.at(-1);
    if (last && range[0] <= last[1] + 1) last[1] = Math.max(last[1], range[1]);
    else out.push(range);
  }
  return out;
};

/**
 * Resolve a v2 tour. `root` is the repository; `baseDir` is where relative
 * screenshot paths in the tour JSON live. Returns { tour, assets } where
 * assets maps asset names to absolute image paths to copy.
 */
export function resolveTour(input, { root, baseDir = root }) {
  const problems = [];
  const fail = (message) => { problems.push(message); };
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TourError(["Tour must be a JSON object."]);
  const allowed = new Set(["schemaVersion", "title", "question", "answer", "revision", "review", "files", "cards", "connections", "steps"]);
  for (const key of Object.keys(input)) if (!allowed.has(key)) fail(`Unknown top-level property "${key}".`);
  if (input.schemaVersion !== SCHEMA_VERSION) fail(`schemaVersion must be ${SCHEMA_VERSION}.`);
  if (typeof input.title !== "string" || !input.title.trim()) fail("title is required.");
  for (const key of ["question", "answer", "revision"])
    if (input[key] !== undefined && typeof input[key] !== "string") fail(`${key} must be a string.`);
  if (input.review !== undefined) {
    try {
      const url = new URL(input.review.url);
      if (url.protocol !== "https:" || url.username || url.password) throw new Error();
    } catch { fail("review.url must be an HTTPS pull request URL without credentials."); }
  }
  for (const key of ["files", "cards", "steps"])
    if (!Array.isArray(input[key]) || !input[key].length) fail(`${key} must be a non-empty array.`);
  if (input.connections !== undefined && !Array.isArray(input.connections)) fail("connections must be an array.");
  if (problems.length) throw new TourError(problems);

  const ids = (items, label) => {
    const map = new Map();
    for (const [i, item] of items.entries()) {
      if (!item || typeof item.id !== "string" || !ID.test(item.id)) { fail(`${label}[${i}] needs an id of letters, digits, _ or -.`); continue; }
      if (map.has(item.id)) fail(`Duplicate ${label} id "${item.id}".`);
      map.set(item.id, item);
    }
    return map;
  };

  // Files: read real source from disk (or git) unless the agent supplied it.
  const files = new Map();
  for (const [id, file] of ids(input.files, "files")) {
    if (typeof file.path !== "string") { fail(`File ${id} needs a repository-relative path.`); continue; }
    let source = file.source, startLine = file.startLine ?? 1;
    try {
      if (source === undefined) { source = readSource(root, file.path, file.ref); startLine = 1; }
      else if (typeof source !== "string") throw new Error("source must be a string");
    } catch (error) { fail(`File ${id}: ${error.message}`); continue; }
    const lines = splitLines(source);
    files.set(id, {
      id, path: file.path.split(path.sep).join("/"), language: file.language || languageOf(file.path), source, startLine,
      endLine: startLine + Math.max(lines.length, 1) - 1, lines,
      ...(file.ref ? { ref: file.ref } : {}), ...(file.revision ? { revision: file.revision } : {}),
      ...(file.sourceUrl ? { sourceUrl: file.sourceUrl } : {}),
      // Hash only working-tree snapshots, so the viewer can tell when the file changed later.
      ...(file.source === undefined && !file.ref ? { hash: hash(source) } : {}),
    });
  }

  const lineText = (file, line) => file.lines[line - file.startLine] ?? "";
  const assets = new Map();
  const rawCards = ids(input.cards, "cards");
  const cardInfo = new Map(); // original id -> { merged, kind, file }
  const codeGroups = new Map();
  const cards = [];
  for (const [id, card] of rawCards) {
    const kind = card.kind || "code";
    if (kind === "code") {
      const file = files.get(card.file);
      if (!file) { fail(`Card ${id} refers to unknown file "${card.file}".`); continue; }
      let range = card.range;
      if (card.symbol !== undefined) {
        const found = findSymbol(file.source, file.language, card.symbol).map(([a, b]) => [a + file.startLine - 1, b + file.startLine - 1]);
        if (!found.length) { fail(`Card ${id}: symbol "${card.symbol}" was not found in ${file.path}.`); continue; }
        if (found.length > 1 && !range) { fail(`Card ${id}: symbol "${card.symbol}" matches ${found.length} places in ${file.path} (lines ${found.map((r) => r[0]).join(", ")}). Use Class.method or a range.`); continue; }
        range = range || found[0];
      }
      if (!isRange(range)) { fail(`Card ${id} needs a symbol or a range [first, last].`); continue; }
      if (range[0] < file.startLine || range[1] > file.endLine) { fail(`Card ${id}: range ${range} is outside ${file.path} (lines ${file.startLine}-${file.endLine}).`); continue; }
      const relevant = card.relevant ?? [range];
      if (!Array.isArray(relevant) || !relevant.every(isRange)) { fail(`Card ${id}: relevant must be an array of [first, last] ranges.`); continue; }
      for (const r of relevant) if (r[0] < range[0] || r[1] > range[1]) fail(`Card ${id}: relevant range ${r} is outside its range ${range}.`);
      if (card.diff !== undefined && !["before", "after"].includes(card.diff)) fail(`Card ${id}: diff must be "before" or "after".`);
      const groupKey = file.id + "|" + (card.diff || "");
      let group = codeGroups.get(groupKey);
      if (!group) {
        group = { id, kind: "code", file: file.id, title: file.path, ranges: [], relevant: [], sections: [], changedLines: new Set(), ...(card.diff ? { diff: card.diff } : {}) };
        codeGroups.set(groupKey, group);
        cards.push(group);
      }
      group.ranges.push(range);
      group.relevant.push(...relevant);
      group.sections.push({ title: card.title || card.symbol || `Lines ${range[0]}-${range[1]}`, line: range[0], relevant, original: id });
      for (const line of card.changedLines || []) group.changedLines.add(line);
      cardInfo.set(id, { merged: group.id, kind, file });
    } else if (kind === "screenshot") {
      if (typeof card.image !== "string") { fail(`Screenshot card ${id} needs an image path.`); continue; }
      const absolute = path.resolve(baseDir, card.image);
      if (!fs.existsSync(absolute)) { fail(`Screenshot card ${id}: image not found at ${absolute}.`); continue; }
      const viewport = card.viewport;
      if (!viewport || !Number.isFinite(viewport.width) || !Number.isFinite(viewport.height)) { fail(`Screenshot card ${id} needs viewport {width, height} (codesurf shot prints it).`); continue; }
      const highlights = card.highlights || [];
      if (!Array.isArray(highlights) || highlights.some((h) => ![h?.x, h?.y, h?.width, h?.height].every(Number.isFinite)))
        { fail(`Screenshot card ${id}: highlights must be {x, y, width, height, label?} in page pixels.`); continue; }
      const asset = hash(fs.readFileSync(absolute).toString("base64")) + path.extname(absolute).toLowerCase();
      assets.set(asset, absolute);
      cards.push({ id, kind, title: card.title || "Screenshot", image: asset, viewport: { width: viewport.width, height: viewport.height },
        highlights: highlights.map((h) => ({ x: h.x, y: h.y, width: h.width, height: h.height, ...(h.label ? { label: String(h.label) } : {}) })),
        ...(card.url ? { url: String(card.url) } : {}), ...(card.caption ? { caption: String(card.caption) } : {}) });
      cardInfo.set(id, { merged: id, kind });
    } else if (kind === "note") {
      if (typeof card.body !== "string") { fail(`Note card ${id} needs a markdown body.`); continue; }
      cards.push({ id, kind, title: card.title || "", body: card.body });
      cardInfo.set(id, { merged: id, kind });
    } else fail(`Card ${id}: unknown kind "${kind}". Use code, screenshot or note.`);
  }
  for (const group of cards.filter((c) => c.kind === "code")) {
    const ranges = mergeRanges(group.ranges);
    group.range = [ranges[0][0], ranges.at(-1)[1]];
    group.relevant = mergeRanges(group.relevant);
    group.sections = group.sections.sort((a, b) => a.line - b.line);
    group.changedLines = [...group.changedLines].sort((a, b) => a - b);
    if (!group.changedLines.length) delete group.changedLines;
    delete group.ranges;
  }

  // References: remap original card ids to merged cards and check lines.
  const reference = (ref, where, { lines = false } = {}) => {
    if (!ref || typeof ref.card !== "string") { fail(`${where}: needs a card id.`); return null; }
    const info = cardInfo.get(ref.card);
    if (!info) { fail(`${where}: unknown card "${ref.card}".`); return null; }
    const out = { card: info.merged };
    if (info.kind === "code") {
      let span = ref.lines ?? (ref.line !== undefined ? [ref.line, ref.line] : undefined);
      if (span === undefined) { fail(`${where}: code references need ${lines ? "lines [first, last]" : "a line"}.`); return null; }
      if (!isRange(span)) { fail(`${where}: invalid line reference ${JSON.stringify(span)}.`); return null; }
      if (span[0] < info.file.startLine || span[1] > info.file.endLine) { fail(`${where}: lines ${span} are outside ${info.file.path}.`); return null; }
      if (ref.text !== undefined) {
        const found = splitLines(info.file.source).slice(span[0] - info.file.startLine, span[1] - info.file.startLine + 1).some((l) => l.includes(ref.text));
        if (!found) fail(`${where}: expected "${ref.text}" on ${info.file.path}:${span[0]}${span[1] !== span[0] ? "-" + span[1] : ""}, found "${lineText(info.file, span[0]).trim()}".`);
      }
      if (lines) out.lines = span; else out.line = span[0];
    } else if (info.kind === "screenshot" && ref.highlight !== undefined) {
      const card = cards.find((c) => c.id === info.merged);
      if (!Number.isInteger(ref.highlight) || !card.highlights[ref.highlight]) fail(`${where}: screenshot ${ref.card} has no highlight ${ref.highlight}.`);
      out.highlight = ref.highlight;
    }
    return out;
  };

  const connections = [];
  const originals = new Map(); // connection id -> original card ids of its ends
  const firstStep = new Map(); // original card id -> step that first shows it
  const seenAt = (id, step) => { if (!firstStep.has(id)) firstStep.set(id, step); };
  for (const [id, edge] of ids(input.connections || [], "connections")) {
    if (!KINDS.has(edge.kind)) fail(`Connection ${id}: kind must be one of ${[...KINDS].join(", ")}.`);
    const from = reference(edge.from, `Connection ${id} from`), to = reference(edge.to, `Connection ${id} to`);
    if (from && to) { connections.push({ id, from, to, label: String(edge.label || ""), kind: edge.kind }); originals.set(id, [edge.from.card, edge.to.card]); }
  }
  // Every line an arrow touches stays visible in its card.
  for (const edge of connections)
    for (const end of [edge.from, edge.to]) {
      const card = cards.find((c) => c.id === end.card);
      if (card.kind === "code" && end.line !== undefined) {
        card.range = [Math.min(card.range[0], end.line), Math.max(card.range[1], end.line)];
      }
    }

  const steps = [];
  const visible = new Set(), shown = new Set();
  const byId = new Map(connections.map((c) => [c.id, c]));
  for (const [i, step] of input.steps.entries()) {
    const where = `Step ${i + 1}`;
    if (typeof step?.title !== "string") { fail(`${where}: title is required.`); continue; }
    let explanation = step.explanation;
    if (typeof explanation === "string") explanation = [{ text: explanation }];
    if (!Array.isArray(explanation)) { fail(`${where}: explanation must be text segments.`); continue; }
    const reveal = [];
    for (const id of step.revealCards || []) {
      seenAt(id, i);
      const info = cardInfo.get(id);
      if (!info) { fail(`${where}: unknown card "${id}" in revealCards.`); continue; }
      if (!visible.has(info.merged)) { visible.add(info.merged); reveal.push(info.merged); }
    }
    const segments = explanation.map((part, j) => {
      if (typeof part?.text !== "string") { fail(`${where}: explanation[${j}] needs text.`); return { text: "" }; }
      if (!part.target) return { text: part.text };
      const target = reference(part.target, `${where} explanation "${part.text}"`, { lines: true });
      return target ? { text: part.text, target } : { text: part.text };
    });
    const focus = step.focus ? reference(step.focus, `${where} focus`, { lines: true }) : null;
    for (const ref of [step.focus, ...explanation.map((p) => p?.target)]) if (ref?.card) seenAt(ref.card, i);
    // Referenced cards are revealed automatically so authors cannot point at hidden code.
    for (const target of [focus, ...segments.map((s) => s.target)].filter(Boolean))
      if (!visible.has(target.card)) { visible.add(target.card); reveal.push(target.card); }
    const revealConnections = [];
    for (const id of step.revealConnections || []) {
      const edge = byId.get(id);
      if (!edge) { fail(`${where}: unknown connection "${id}".`); continue; }
      for (const end of [edge.from, edge.to])
        if (!visible.has(end.card)) { visible.add(end.card); reveal.push(end.card); }
      if (!shown.has(id)) { shown.add(id); revealConnections.push(id); originals.get(id)?.forEach((o) => seenAt(o, i)); }
    }
    steps.push({ title: step.title, explanation: segments, revealCards: reveal, revealConnections, ...(focus ? { focus } : {}) });
  }
  // Introduce leftover connections as soon as both of their cards are visible.
  const seen = new Set();
  for (const [i, step] of steps.entries()) {
    step.revealCards.forEach((id) => seen.add(id));
    for (const edge of connections)
      if (!shown.has(edge.id) && seen.has(edge.from.card) && seen.has(edge.to.card)) { shown.add(edge.id); step.revealConnections.push(edge.id); originals.get(edge.id)?.forEach((o) => seenAt(o, i)); }
  }
  // Sections of a merged card stay folded until the step that introduces them.
  for (const card of cards.filter((c) => c.kind === "code")) {
    card.sections = card.sections.map(({ original, ...section }) => ({ ...section, step: firstStep.get(original) ?? 0 }))
      .filter((s, i, all) => i === 0 || s.line !== all[i - 1].line || (all[i - 1].relevant.push(...s.relevant), all[i - 1].step = Math.min(all[i - 1].step, s.step), false));
  }
  for (const card of cards) if (!visible.has(card.id)) fail(`Card ${card.id} is never shown. Reveal or reference it in a step.`);
  if (problems.length) throw new TourError(problems);

  const out = {
    schemaVersion: SCHEMA_VERSION, title: input.title.trim(),
    ...(input.question ? { question: input.question } : {}), ...(input.answer ? { answer: input.answer } : {}),
    ...(input.revision ? { revision: input.revision } : {}),
    ...(input.review ? { review: { url: input.review.url, ...(input.review.example === true ? { example: true } : {}) } } : {}),
    files: [...files.values()].filter((f) => cards.some((c) => c.file === f.id)).map(({ lines, ...file }) => file),
    cards, connections, steps,
  };
  return { tour: out, assets };
}
