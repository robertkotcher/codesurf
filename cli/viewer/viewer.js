import hljs from "highlight.js/lib/common";
import { markdown, parseRef } from "./markdown.js";
import { createReviewPrompt, createCommentEntry } from "./review-prompt.js";

const $ = (id) => document.getElementById(id);
const svgNS = "http://www.w3.org/2000/svg";
const COLORS = { call: "#4f87bb", event: "#4f87bb", return: "#4f9469", success: "#4f9469", failure: "#c0606b", data: "#8a6bbf", definition: "#8796a3" };
const WIDTH = { code: 600, note: 340, screenshot: 560 };
const GAP_X = 150, GAP_Y = 46;
const params = new URLSearchParams(location.search);
let projectId = params.get("project");

// Tour state
let saved, tour, files, cards, stepIndex = 0, exploring = false;
let visibleCards = new Set(), visibleConnections = new Set(), currentTargets = [];
let expanded = new Set();
// Exploration state: code the reader opened by following definitions or links.
let exploredCards = [], exploredEdges = [], exploreParents = new Map(), trail = [], exploreCount = 0;
const positions = new Map();
// Canvas state
let scale = 1, panX = 0, panY = 0, cardNodes = new Map(), rowNodes = new Map(), foldNodes = new Map(), ringNodes = new Map();
let drawing = false;

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const svg = (tag, attributes) => {
  const node = document.createElementNS(svgNS, tag);
  for (const [k, v] of Object.entries(attributes)) node.setAttribute(k, v);
  return node;
};
async function api(path, options) {
  const res = await fetch(path, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || res.statusText);
  return body;
}
const q = (obj) => new URLSearchParams({ project: projectId, ...obj }).toString();

/* ---------- Canvas transform ---------- */
function transform() {
  $("world").style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
  $("zoom").textContent = Math.round(scale * 100) + "%";
  hidePopover();
}
function zoomAt(next, x, y) {
  next = Math.max(.12, Math.min(2.5, next));
  panX = x - (x - panX) * next / scale;
  panY = y - (y - panY) * next / scale;
  scale = next;
  transform();
}
function fit() {
  const nodes = [...cardNodes.values()];
  if (!nodes.length) return;
  const left = Math.min(...nodes.map((n) => n.offsetLeft)), top = Math.min(...nodes.map((n) => n.offsetTop));
  const right = Math.max(...nodes.map((n) => n.offsetLeft + n.offsetWidth)), bottom = Math.max(...nodes.map((n) => n.offsetTop + n.offsetHeight));
  const area = $("viewport");
  scale = Math.max(.12, Math.min(1, (area.clientWidth - 60) / (right - left), (area.clientHeight - 60) / (bottom - top)));
  panX = (area.clientWidth - (right - left) * scale) / 2 - left * scale;
  panY = (area.clientHeight - (bottom - top) * scale) / 2 - top * scale;
  transform();
}
function focusTarget(target) {
  const card = cardNodes.get(target.card);
  if (!card) return;
  const area = $("viewport");
  let y = card.offsetTop;
  const row = target.lines && (rowNodes.get(target.card)?.get(target.lines[0]) || foldNodes.get(target.card)?.get(target.lines[0]));
  if (row?.getClientRects().length) y = card.offsetTop + (row.getBoundingClientRect().top - card.getBoundingClientRect().top) / scale;
  if (!target.lines) {
    // Whole cards (screenshots, notes) fit entirely in view.
    scale = Math.min(1, (area.clientWidth - 80) / card.offsetWidth, (area.clientHeight - 60) / card.offsetHeight);
    panX = (area.clientWidth - card.offsetWidth * scale) / 2 - card.offsetLeft * scale;
    panY = (area.clientHeight - card.offsetHeight * scale) / 2 - card.offsetTop * scale;
    return transform();
  }
  if (area.clientWidth < 520) {
    // Phones: keep code readable and start at the card's left edge; drag to see more.
    scale = .72;
    panX = 8 - card.offsetLeft * scale;
    panY = 40 - y * scale;
    return transform();
  }
  scale = Math.min(1, Math.max(.4, (area.clientWidth - 80) / (card.offsetWidth + 40)));
  panX = (area.clientWidth - card.offsetWidth * scale) / 2 - card.offsetLeft * scale;
  panY = 110 - y * scale;
  transform();
}

/* ---------- Cards ---------- */
const fileOf = (card) => files.get(card.file);
const symbolsEnabled = (file) => Boolean(file.hash) && !saved.stale.includes(file.id);
function shownRange(card) {
  const extra = card.explored || [];
  return [Math.min(card.range[0], ...extra.map((r) => r[0]), card.from ?? Infinity), Math.max(card.range[1], ...extra.map((r) => r[1]), card.to ?? -Infinity)];
}
const revealedSections = (card) => (card.sections || []).filter((s) => exploring || !(s.step > stepIndex));
function isRelevant(card, line) {
  const inside = (r) => line >= r[0] && line <= r[1];
  const relevant = card.sections?.some((s) => s.relevant) ? revealedSections(card).flatMap((s) => s.relevant || []) : card.relevant || [];
  return relevant.some(inside) || (card.explored || []).some(inside) ||
    currentTargets.some((t) => t.card === card.id && t.lines && inside(t.lines));
}
function highlightRows(file) {
  if (file.rows) return file.rows;
  let html = null;
  try { html = hljs.getLanguage(file.language) ? hljs.highlight(file.source, { language: file.language, ignoreIllegals: true }).value : null; } catch {}
  const stack = [];
  // Close and reopen multiline token spans so each row stays independent.
  file.rows = html?.split(/\r?\n/).map((row) => {
    const prefix = stack.join("");
    for (const m of row.matchAll(/<span\b[^>]*>|<\/span>/g)) m[0].startsWith("</") ? stack.pop() : stack.push(m[0]);
    return prefix + row + "</span>".repeat(stack.length);
  });
  file.lines = file.source.split(/\r?\n/);
  return file.rows;
}
function codeRow(card, file, line) {
  const row = el("div", "code-row");
  row.dataset.line = line;
  if (!isRelevant(card, line)) row.classList.add("muted");
  if ((card.explored || []).some((r) => line >= r[0] && line <= r[1]) && !(card.relevant || []).some((r) => line >= r[0] && line <= r[1])) row.classList.add("explored-line");
  if (card.changedLines?.includes(line)) row.classList.add("changed-" + card.diff);
  const number = el("span", "line-number", String(line));
  const code = el("span", "source-text");
  const html = highlightRows(file)?.[line - file.startLine];
  if (html !== undefined) code.innerHTML = html; else code.textContent = file.lines[line - file.startLine] ?? "";
  row.append(number, code);
  if (tour.review) {
    const button = el("button", "line-comment", "+");
    button.type = "button";
    button.title = "Add review comment";
    button.onclick = () => addLineComment(card, line);
    row.prepend(button);
  }
  rowNodes.get(card.id).set(line, row);
  return row;
}
function renderCode(card, node) {
  const file = fileOf(card);
  const header = el("header", "card-header");
  header.append(el("span", "file-path", file.path));
  if (card.diff) header.append(el("span", "card-title", card.diff === "before" ? "Before" : "After"));
  if (file.ref) header.append(el("span", "meta", "@ " + file.ref.slice(0, 10)));
  if (saved.stale.includes(file.id)) header.append(el("span", "meta stale", "changed on disk since this tour"));
  if (file.external) header.append(el("span", "meta", "external"));
  if (card.isExplored) {
    const close = el("button", "close", "×");
    close.title = "Remove";
    close.onclick = (e) => { e.stopPropagation(); removeExplored(card.id); };
    header.append(close);
  }
  const scroller = el("div", "code-scroll");
  const content = el("div", "code-content");
  scroller.append(content);
  node.append(header, scroller);
  if (symbolsEnabled(file)) node.classList.add("symbols");
  rowNodes.set(card.id, new Map());
  foldNodes.set(card.id, new Map());
  highlightRows(file);
  const [first, last] = shownRange(card);
  const sections = new Map(revealedSections(card).map((s) => [s.line, s.title]));
  const more = (direction) => {
    const button = el("button", "more", direction < 0 ? `↑ ${Math.min(20, first - file.startLine)} more lines` : `↓ ${Math.min(20, file.endLine - last)} more lines`);
    button.onclick = () => {
      if (direction < 0) card.from = Math.max(file.startLine, first - 20); else card.to = Math.min(file.endLine, last + 20);
      render({ keepView: true });
    };
    return button;
  };
  if (first > file.startLine) content.append(more(-1));
  for (let line = first; line <= last;) {
    if (isRelevant(card, line) || sections.has(line)) {
      if (sections.has(line) && (card.sections || []).length > 1) content.append(el("div", "section-label", sections.get(line)));
      content.append(codeRow(card, file, line++));
      continue;
    }
    const start = line;
    while (line <= last && !isRelevant(card, line) && !sections.has(line)) line++;
    const end = line - 1;
    if (end - start + 1 <= 6) { for (let i = start; i <= end; i++) content.append(codeRow(card, file, i)); continue; }
    const key = card.id + ":" + start + ":" + end;
    const fold = el("details", "fold");
    const summary = el("summary", "", `${end - start + 1} lines hidden (${start}–${end})`);
    fold.append(summary);
    fold.open = expanded.has(key);
    fold.ontoggle = () => { fold.open ? expanded.add(key) : expanded.delete(key); scheduleDraw(); };
    for (let i = start; i <= end; i++) { fold.append(codeRow(card, file, i)); foldNodes.get(card.id).set(i, summary); }
    content.append(fold);
  }
  if (last < file.endLine) content.append(more(1));
}
function renderScreenshot(card, node) {
  const header = el("header", "card-header");
  header.append(el("span", "card-title", card.title));
  if (card.url) header.append(el("span", "meta", card.url.replace(/^https?:\/\//, "")));
  const shot = el("div", "shot");
  const img = el("img");
  img.alt = card.title;
  img.src = "/api/asset?" + q({ name: card.image });
  img.onload = scheduleDraw;
  const overlay = svg("svg", { viewBox: `0 0 ${card.viewport.width} ${card.viewport.height}`, preserveAspectRatio: "none" });
  const rings = [];
  card.highlights.forEach((h, i) => {
    const pad = 10;
    const ring = svg("ellipse", { class: "ring", cx: h.x + h.width / 2, cy: h.y + h.height / 2, rx: h.width / 2 + pad * 1.6, ry: h.height / 2 + pad });
    overlay.append(ring);
    rings.push(ring);
    if (h.label) {
      const label = svg("text", { class: "ring-label", x: h.x + h.width / 2, y: h.y - pad - 8, "text-anchor": "middle" });
      label.textContent = h.label;
      overlay.append(label);
    }
    if (currentTargets.some((t) => t.card === card.id && t.highlight === i)) ring.classList.add("active");
  });
  ringNodes.set(card.id, rings);
  shot.append(img, overlay);
  node.append(header, shot);
  if (card.caption) node.append(el("p", "caption", card.caption));
}
function renderNote(card, node) {
  const header = el("header", "card-header");
  header.append(el("span", "card-title", card.title));
  const body = el("div", "note-body markdown");
  body.innerHTML = markdown(card.body);
  node.append(header, body);
}
function renderCard(card) {
  const node = el("article", "card " + card.kind + (card.isExplored ? " explored" : ""));
  node.dataset.card = card.id;
  node.style.width = WIDTH[card.kind] + "px";
  if (card.kind === "code") renderCode(card, node);
  else if (card.kind === "screenshot") renderScreenshot(card, node);
  else renderNote(card, node);
  cardNodes.set(card.id, node);
  $("cards").append(node);
}

/* ---------- Layout ---------- */
function allEdges() {
  return [...tour.connections.filter((c) => visibleConnections.has(c.id)), ...exploredEdges];
}
function layout() {
  const order = [...new Set([...visibleCards, ...exploredCards.map((c) => c.id)])];
  const column = new Map();
  const edges = allEdges();
  for (const id of order) {
    let col = 0;
    if (exploreParents.has(id)) col = (column.get(exploreParents.get(id)) ?? 0) + 1;
    else for (const e of edges)
      if (e.to.card === id && e.from.card !== id && column.has(e.from.card)) col = Math.max(col, column.get(e.from.card) + 1);
    column.set(id, col);
  }
  const widths = [], bottoms = [];
  for (const id of order) { const c = column.get(id); widths[c] = Math.max(widths[c] || 0, cardNodes.get(id)?.offsetWidth || 0); }
  const xs = [];
  for (let i = 0, x = 40; i < widths.length; i++) { xs[i] = x; x += (widths[i] || 0) + GAP_X; }
  for (const id of order) {
    const node = cardNodes.get(id);
    if (!node) continue;
    const c = column.get(id);
    const manual = positions.get(id);
    const x = manual?.x ?? xs[c], y = manual?.y ?? (bottoms[c] ?? 40);
    node.style.left = x + "px";
    node.style.top = y + "px";
    bottoms[c] = Math.max(bottoms[c] ?? 40, y + node.offsetHeight + GAP_Y);
  }
}

/* ---------- Edges ---------- */
function anchor(end, side) {
  const node = cardNodes.get(end.card);
  if (!node) return null;
  const card = cards.get(end.card);
  const box = node.getBoundingClientRect();
  const x = node.offsetLeft + (side === "right" ? node.offsetWidth : 0);
  if (card.kind === "code" && end.line !== undefined) {
    let row = rowNodes.get(end.card)?.get(end.line);
    if (!row?.getClientRects().length) row = foldNodes.get(end.card)?.get(end.line);
    if (!row?.getClientRects().length) return null;
    const r = row.getBoundingClientRect();
    return { x, y: node.offsetTop + (r.top - box.top + r.height / 2) / scale, row: rowNodes.get(end.card)?.get(end.line) };
  }
  if (card.kind === "screenshot" && end.highlight !== undefined) {
    const ring = ringNodes.get(end.card)?.[end.highlight];
    if (!ring) return null;
    const r = ring.getBoundingClientRect();
    if (!r.width) return null;
    return { x: node.offsetLeft + ((side === "right" ? r.right : r.left) - box.left) / scale, y: node.offsetTop + (r.top - box.top + r.height / 2) / scale };
  }
  return { x, y: node.offsetTop + 16 };
}
function drawEdges() {
  const layer = $("edges");
  layer.replaceChildren();
  const defs = svg("defs", {});
  for (const [kind, color] of Object.entries(COLORS)) {
    const marker = svg("marker", { id: "arrow-" + kind, viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: "auto-start-reverse" });
    marker.append(svg("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: color }));
    defs.append(marker);
  }
  layer.append(defs);
  document.querySelectorAll(".code-row[class*='flow-']").forEach((row) => row.className = row.className.replace(/\bflow-\w+/g, ""));
  for (const edge of allEdges()) {
    const fromNode = cardNodes.get(edge.from.card), toNode = cardNodes.get(edge.to.card);
    if (!fromNode || !toNode) continue;
    const fromCenter = fromNode.offsetLeft + fromNode.offsetWidth / 2, toCenter = toNode.offsetLeft + toNode.offsetWidth / 2;
    let sides, loop = false;
    if (toNode.offsetLeft > fromNode.offsetLeft + fromNode.offsetWidth - 20) sides = ["right", "left"];
    else if (toNode.offsetLeft + toNode.offsetWidth < fromNode.offsetLeft + 20) sides = ["left", "right"];
    else { sides = ["right", "right"]; loop = true; }
    const a = anchor(edge.from, sides[0]), b = anchor(edge.to, sides[1]);
    if (!a || !b) continue;
    let d, mid;
    if (loop) {
      const out = Math.max(a.x, b.x) + 50 + Math.min(80, Math.abs(b.y - a.y) / 8);
      d = `M ${a.x} ${a.y} C ${out} ${a.y}, ${out} ${b.y}, ${b.x + 2} ${b.y}`;
      mid = { x: (a.x + 3 * out + 3 * out + b.x) / 8, y: (a.y + 3 * a.y + 3 * b.y + b.y) / 8 };
    } else {
      const dir = sides[0] === "right" ? 1 : -1;
      const dx = Math.max(50, Math.abs(b.x - a.x) / 2) * dir;
      d = `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x - 2 * dir} ${b.y}`;
      mid = { x: (a.x + 3 * (a.x + dx) + 3 * (b.x - dx) + b.x) / 8, y: (a.y + 3 * a.y + 3 * b.y + b.y) / 8 };
    }
    const color = COLORS[edge.kind] || COLORS.call;
    layer.append(svg("path", { class: "edge-path " + edge.kind, d, stroke: color, "marker-end": `url(#arrow-${edge.kind in COLORS ? edge.kind : "call"})` }));
    if (edge.label) {
      const label = svg("text", { class: "edge-label", x: mid.x, y: mid.y - 6, fill: color, "text-anchor": "middle" });
      label.textContent = edge.label;
      layer.append(label);
    }
    a.row?.classList.add("flow-" + edge.kind);
  }
}
function scheduleDraw() {
  if (drawing) return;
  drawing = true;
  requestAnimationFrame(() => { drawing = false; layout(); drawEdges(); });
}

/* ---------- Steps ---------- */
function render({ keepView = false, fitAll = false } = {}) {
  visibleCards = new Set();
  visibleConnections = new Set();
  const shown = exploring ? tour.steps : tour.steps.slice(0, stepIndex + 1);
  for (const step of shown) {
    step.revealCards.forEach((id) => visibleCards.add(id));
    step.revealConnections.forEach((id) => visibleConnections.add(id));
  }
  const step = tour.steps[stepIndex];
  currentTargets = exploring ? [] : [step.focus, ...step.explanation.map((p) => p.target)].filter(Boolean);
  for (const edge of tour.connections) if (visibleConnections.has(edge.id))
    for (const end of [edge.from, edge.to]) if (end.line !== undefined) currentTargets.push({ card: end.card, lines: [end.line, end.line] });
    else if (end.highlight !== undefined && !exploring && step.focus?.card === end.card) currentTargets.push(end);
  for (const edge of exploredEdges) currentTargets.push({ card: edge.from.card, lines: [edge.from.line, edge.from.line] });
  $("cards").replaceChildren();
  cardNodes = new Map(); rowNodes = new Map(); foldNodes = new Map(); ringNodes = new Map();
  for (const id of visibleCards) renderCard(cards.get(id));
  for (const card of exploredCards) if (!visibleCards.has(card.id)) renderCard(card);
  layout();
  renderStepText(step);
  renderTimeline();
  if (!$("step-code").hidden) renderStepCode();
  if (!exploring && step.focus?.lines)
    for (let line = step.focus.lines[0]; line <= step.focus.lines[1]; line++) rowNodes.get(step.focus.card)?.get(line)?.classList.add("selected");
  if (!exploring && step.focus?.highlight !== undefined) ringNodes.get(step.focus.card)?.[step.focus.highlight]?.classList.add("active");
  if (!keepView) { if (fitAll || exploring) fit(); else if (step.focus) focusTarget(step.focus); else fit(); }
  drawEdges();
  $("trail-back").hidden = !trail.length;
  $("clear-explored").hidden = !exploredCards.length && !exploredEdges.length;
}
function targetLink(part) {
  const link = el("a", "", part.text);
  link.href = "#";
  const set = (on) => {
    if (part.target.lines) for (let l = part.target.lines[0]; l <= part.target.lines[1]; l++) rowNodes.get(part.target.card)?.get(l)?.classList.toggle("referenced", on);
    if (part.target.highlight !== undefined) ringNodes.get(part.target.card)?.[part.target.highlight]?.classList.toggle("active", on);
  };
  link.onmouseenter = link.onfocus = () => set(true);
  link.onmouseleave = link.onblur = () => set(false);
  link.onclick = (e) => { e.preventDefault(); revealFold(part.target); focusTarget(part.target); set(true); };
  return link;
}
function revealFold(target) {
  const summary = target.lines && foldNodes.get(target.card)?.get(target.lines[0]);
  if (summary && !summary.parentElement.open) summary.parentElement.open = true;
}
function renderStepText(step) {
  $("explanation").replaceChildren();
  $("progress").textContent = exploring ? "Whole flow" : `Step ${stepIndex + 1} of ${tour.steps.length}`;
  $("step-title").textContent = exploring ? tour.title : step.title;
  if (exploring) $("explanation").textContent = "Everything from the tour is on the canvas. Click any code to follow it, or ask a follow-up below.";
  else for (const part of step.explanation) $("explanation").append(part.target ? targetLink(part) : document.createTextNode(part.text));
  $("back").disabled = exploring || stepIndex === 0;
  $("next").disabled = exploring;
  $("next").textContent = stepIndex === tour.steps.length - 1 ? "Done" : "Next";
  $("exit").disabled = exploring;
  $("restart").hidden = !exploring && stepIndex === 0;
}

/* ---------- Exploring: definitions and links ---------- */
async function openCode(def, origin) {
  let file;
  if (def.external && def.excerpt) {
    const id = `ext:${def.path}:${def.excerpt.startLine}`;
    file = files.get(id);
    if (!file) {
      const lines = def.excerpt.source.split("\n");
      file = { id, path: def.path, language: /\.d\.ts$|\.tsx?$/.test(def.path) ? "typescript" : "javascript", source: def.excerpt.source,
        startLine: def.excerpt.startLine, endLine: def.excerpt.startLine + lines.length - 1, external: true };
      files.set(id, file);
    }
  } else {
    file = [...files.values()].find((f) => f.path === def.path && !f.ref && !f.external && [...cards.values()].some((c) => c.file === f.id && !c.diff));
    file ||= [...files.values()].find((f) => f.path === def.path && f.live);
    if (!file) {
      const data = await api("/api/file?" + q({ path: def.path }));
      const lines = data.source.split(/\r?\n/);
      if (lines.at(-1) === "") lines.pop();
      file = { id: "live:" + def.path, path: def.path, language: data.language, source: data.source, startLine: 1, endLine: Math.max(1, lines.length), hash: data.hash, live: true };
      files.set(file.id, file);
    }
  }
  const full = [Math.max(file.startLine, def.range[0]), Math.min(file.endLine, def.range[1])];
  // Long definitions show their first 40 lines; the rest stays one click away.
  const range = [full[0], Math.min(full[1], Math.max(def.line, full[0]) + 40)];
  let card = [...cards.values()].find((c) => c.kind === "code" && c.file === file.id && !c.diff);
  if (card) {
    card.explored = [...(card.explored || []), range];
    card.to = Math.max(card.to ?? -Infinity, full[1]);
    // A tour card that this step hasn't revealed yet is shown now, as explored.
    if (!visibleCards.has(card.id) && !exploredCards.includes(card)) {
      exploredCards.push(card);
      if (origin) exploreParents.set(card.id, origin.card);
    }
  } else {
    card = { id: "x" + ++exploreCount, kind: "code", file: file.id, range: full, relevant: [], explored: [range], sections: [{ title: def.name, line: range[0] }], isExplored: true };
    cards.set(card.id, card);
    exploredCards.push(card);
    if (origin) exploreParents.set(card.id, origin.card);
  }
  if (origin && !(origin.card === card.id && origin.line === def.line))
    exploredEdges.push({ id: "xe" + exploreCount++, from: { card: origin.card, line: origin.line }, to: { card: card.id, line: def.line }, label: def.name, kind: "definition" });
  trail.push({ panX, panY, scale });
  render({ keepView: true });
  requestAnimationFrame(() => {
    layout(); drawEdges();
    focusTarget({ card: card.id, lines: [def.line, def.line] });
    for (let l = range[0]; l <= range[1]; l++) rowNodes.get(card.id)?.get(l)?.classList.add("flash");
    cardNodes.get(card.id)?.classList.add("pulse");
  });
}
function removeExplored(id) {
  exploredCards = exploredCards.filter((c) => c.id !== id);
  exploredEdges = exploredEdges.filter((e) => e.from.card !== id && e.to.card !== id);
  if (cards.get(id)?.isExplored) cards.delete(id);
  render({ keepView: true });
}
$("clear-explored").onclick = () => {
  for (const c of exploredCards) if (c.isExplored) cards.delete(c.id);
  for (const c of cards.values()) { delete c.explored; delete c.from; delete c.to; }
  exploredCards = []; exploredEdges = []; trail = []; exploreParents = new Map();
  render();
};
$("trail-back").onclick = () => {
  const view = trail.pop();
  if (view) { ({ panX, panY, scale } = view); transform(); }
  $("trail-back").hidden = !trail.length;
};

/* ---------- Hover and click on code ---------- */
let hoverTimer, popoverTimer, hoverKey, lastPointer;
const hoverCache = new Map();
function caretAt(x, y) {
  let node, offset;
  if (document.caretPositionFromPoint) { const p = document.caretPositionFromPoint(x, y); node = p?.offsetNode; offset = p?.offset; }
  else { const r = document.caretRangeFromPoint?.(x, y); node = r?.startContainer; offset = r?.startOffset; }
  const source = node?.parentElement?.closest?.(".source-text") || (node?.classList?.contains("source-text") ? node : null);
  if (!source) return null;
  const range = document.createRange();
  range.setStart(source, 0);
  try { range.setEnd(node, offset); } catch { return null; }
  const column = range.toString().length;
  const text = source.textContent;
  const isWord = (c) => /[\p{L}\p{N}_$]/u.test(c || "");
  let start = column, end = column;
  if (!isWord(text[column]) && isWord(text[column - 1])) start = end = column - 1;
  if (!isWord(text[start])) return null;
  while (isWord(text[start - 1])) start--;
  while (isWord(text[end])) end++;
  const word = text.slice(start, end);
  if (/^\d/.test(word)) return null;
  // Ignore the gap to the right of the text.
  const wordRange = rangeIn(source, start, end);
  const rect = wordRange.getBoundingClientRect();
  if (x < rect.left - 2 || x > rect.right + 2 || y < rect.top - 2 || y > rect.bottom + 2) return null;
  const row = source.closest(".code-row"), cardNode = source.closest(".card");
  return { source, row, card: cardNode.dataset.card, line: Number(row.dataset.line), column: start, word, rect };
}
function rangeIn(element, start, end) {
  const range = document.createRange();
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let position = 0, node, startSet = false;
  while ((node = walker.nextNode())) {
    const length = node.textContent.length;
    if (!startSet && start <= position + length) { range.setStart(node, start - position); startSet = true; }
    if (startSet && end <= position + length) { range.setEnd(node, end - position); return range; }
    position += length;
  }
  return range;
}
function markToken(hit) {
  const mark = $("token-mark");
  if (!hit) { mark.hidden = true; return; }
  const area = $("viewport").getBoundingClientRect();
  Object.assign(mark.style, { left: hit.rect.left - area.left + "px", top: hit.rect.top - area.top + "px", width: hit.rect.width + "px", height: hit.rect.height + "px" });
  mark.hidden = false;
}
function showPopover(rect, content) {
  const pop = $("popover"), area = $("viewport").getBoundingClientRect();
  pop.replaceChildren(...content);
  pop.hidden = false;
  const left = Math.min(Math.max(8, rect.left - area.left), area.width - pop.offsetWidth - 8);
  const below = rect.bottom - area.top + 6;
  pop.style.left = left + "px";
  pop.style.top = (below + pop.offsetHeight > area.height ? rect.top - area.top - pop.offsetHeight - 6 : below) + "px";
}
function hidePopover() { $("popover").hidden = true; markToken(null); hoverKey = null; }
function highlighted(text, language) {
  const pre = el("pre");
  try { pre.innerHTML = hljs.highlight(text, { language: hljs.getLanguage(language) ? language : "typescript", ignoreIllegals: true }).value; }
  catch { pre.textContent = text; }
  return pre;
}
async function hoverAt(hit) {
  const card = cards.get(hit.card), file = fileOf(card);
  if (!symbolsEnabled(file)) return;
  const key = `${file.path}:${hit.line}:${hit.column}`;
  if (hoverKey === key && !$("popover").hidden) return;
  hoverKey = key;
  markToken(hit);
  let info = hoverCache.get(key);
  if (!info) {
    try { info = await api("/api/hover?" + q({ path: file.path, line: hit.line, column: hit.column })); }
    catch (error) { info = { error: error.message }; }
    hoverCache.set(key, info);
  }
  if (hoverKey !== key) return;
  const parts = [];
  if (info.signature) parts.push(highlighted(info.signature, file.language));
  else parts.push(el("div", "doc", info.error || `No type information for ${hit.word}.`));
  const docs = [info.documentation, ...(info.tags || [])].filter(Boolean).join("\n");
  if (docs) parts.push(el("div", "doc", docs));
  const actions = el("div", "actions");
  const go = el("button", "primary", "Go to definition");
  go.onclick = () => goToDefinition(hit);
  const askButton = el("button", "", "Ask about this");
  askButton.onclick = () => { setContext("symbol", { path: file.path, line: hit.line, text: hit.word, signature: info.signature?.slice(0, 300) || "" }, `${hit.word} · ${file.path}:${hit.line}`); hidePopover(); $("ask-input").focus(); };
  actions.append(go, askButton);
  if (info.defined) actions.append(el("span", "where", info.defined));
  parts.push(actions);
  showPopover(hit.rect, parts);
}
async function goToDefinition(hit) {
  const card = cards.get(hit.card), file = fileOf(card);
  if (!symbolsEnabled(file)) {
    showPopover(hit.rect, [el("div", "doc", saved.stale.includes(file.id) ? "This file changed since the tour was made, so its lines no longer match. Ask a follow-up to get a fresh view." : "Definitions are available for code read from the working tree.")]);
    return;
  }
  let found;
  try { found = await api("/api/definition?" + q({ path: file.path, line: hit.line, column: hit.column })); }
  catch (error) { showPopover(hit.rect, [el("div", "doc", error.message)]); return; }
  if (!found.length) { showPopover(hit.rect, [el("div", "doc", `No definition found for ${hit.word}.`)]); return; }
  const self = found.length === 1 && found[0].path === file.path && found[0].line === hit.line;
  if (self) { showPopover(hit.rect, [el("div", "doc", `${hit.word} is defined here.`)]); return; }
  if (found.length === 1) { hidePopover(); return openCode(found[0], { card: hit.card, line: hit.line }); }
  const list = el("div", "choices");
  for (const def of found) {
    const button = el("button", "", `${def.guess ? "≈ " : ""}${def.path}:${def.line}  ${def.container ? def.container + "." : ""}${def.name}`);
    button.onclick = () => { hidePopover(); openCode(def, { card: hit.card, line: hit.line }); };
    list.append(button);
  }
  showPopover(hit.rect, [el("div", "doc", found.some((d) => d.guess) ? "Possible definitions (by name):" : "Definitions:"), list]);
}
const cardsLayer = $("cards");
cardsLayer.addEventListener("pointermove", (event) => {
  lastPointer = { x: event.clientX, y: event.clientY };
  clearTimeout(hoverTimer);
  if (event.buttons) return;
  hoverTimer = setTimeout(() => {
    const hit = caretAt(lastPointer.x, lastPointer.y);
    if (!hit) { if (!$("popover").matches(":hover")) { clearTimeout(popoverTimer); popoverTimer = setTimeout(() => { if (!$("popover").matches(":hover")) hidePopover(); }, 250); } return; }
    clearTimeout(popoverTimer);
    hoverAt(hit);
  }, 220);
});
let downAt;
cardsLayer.addEventListener("pointerdown", (event) => { downAt = { x: event.clientX, y: event.clientY }; });
cardsLayer.addEventListener("click", (event) => {
  if (!downAt || Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y) > 4) return;
  if (!getSelection().isCollapsed) return;
  if (!event.target.closest(".source-text")) return;
  const hit = caretAt(event.clientX, event.clientY);
  if (hit) goToDefinition(hit);
});
$("popover").addEventListener("pointerleave", () => { popoverTimer = setTimeout(hidePopover, 300); });
$("popover").addEventListener("pointerenter", () => clearTimeout(popoverTimer));

// Selecting code adds it as context for the next question.
document.addEventListener("selectionchange", () => {
  const selection = getSelection();
  if (selection.isCollapsed || !selection.rangeCount) return;
  const anchorRow = selection.anchorNode?.parentElement?.closest(".code-row"), focusRow = selection.focusNode?.parentElement?.closest(".code-row");
  if (!anchorRow || !focusRow) return;
  const cardNode = anchorRow.closest(".card");
  if (cardNode !== focusRow.closest(".card")) return;
  const card = cards.get(cardNode.dataset.card), file = fileOf(card);
  const lines = [Number(anchorRow.dataset.line), Number(focusRow.dataset.line)].sort((a, b) => a - b);
  const text = file.source.split(/\r?\n/).slice(lines[0] - file.startLine, lines[1] - file.startLine + 1).join("\n");
  setContext("selection", { path: file.path, lines, text }, `${file.path}:${lines[0]}${lines[1] !== lines[0] ? "-" + lines[1] : ""}`);
});

/* ---------- Follow-up chat ---------- */
let askContext = {};
function setContext(kind, value, label) {
  askContext = { [kind]: value };
  const chip = el("span", "chip");
  chip.append(el("span", "", (kind === "selection" ? "Selection: " : "About: ") + label));
  const remove = el("button", "", "×");
  remove.type = "button";
  remove.onclick = () => { askContext = {}; $("ask-context").replaceChildren(); };
  chip.append(remove);
  $("ask-context").replaceChildren(chip);
}
function bindRefs(container) {
  container.querySelectorAll(".code-ref").forEach((link) => {
    link.onclick = (e) => {
      e.preventDefault();
      const ref = parseRef(link.dataset.ref);
      const lines = ref.lines || [1, 30];
      openCode({ path: ref.path, range: lines, line: lines[0], name: ref.path.split("/").at(-1) }).catch((error) => { $("error").textContent = error.message; });
    };
  });
}
const visibleAnswer = (text) => {
  const i = text.indexOf("```codesurf-tour");
  return i < 0 ? text : text.slice(0, i).trimEnd() + "\n\n*Building a new view…*";
};
function messageNode(message) {
  const node = el("div", "message " + message.role);
  if (message.role === "user") {
    node.textContent = message.text;
    const ctx = message.context?.selection ? `${message.context.selection.path}:${message.context.selection.lines.join("-")}` : message.context?.symbol ? message.context.symbol.text : "";
    if (ctx) node.prepend(el("span", "context", "About " + ctx));
    return node;
  }
  if (message.role === "error") { node.textContent = message.text; return node; }
  const body = el("div", "markdown");
  body.innerHTML = markdown(message.text);
  node.append(body);
  bindRefs(body);
  if (message.tour) {
    const open = el("button", "open-view", "Open new view: " + (message.tourTitle || "follow-up"));
    open.onclick = () => openTab(message.tour, message.tourTitle);
    node.append(open);
  }
  if (message.tourError) node.append(el("div", "activity", "Could not build a new view: " + message.tourError.split("\n")[0]));
  return node;
}
function renderChat() {
  $("messages").replaceChildren(...(saved.chat?.messages || []).map(messageNode));
  $("messages").scrollTop = $("messages").scrollHeight;
}
let asking;
$("ask-form").onsubmit = async (event) => {
  event.preventDefault();
  const question = $("ask-input").value.trim();
  if (!question || asking) return;
  const context = { step: exploring ? null : stepIndex, ...askContext };
  const user = { role: "user", text: question, context };
  saved.chat.messages.push(user);
  $("messages").append(messageNode(user));
  $("ask-input").value = "";
  askContext = {}; $("ask-context").replaceChildren();
  const live = el("div", "message assistant");
  const activity = el("div"), body = el("div", "markdown");
  live.append(activity, body);
  $("messages").append(live);
  activity.append(el("div", "activity", "Reading the repository…"));
  $("messages").scrollTop = $("messages").scrollHeight;
  $("ask-send").disabled = true; $("ask-stop").hidden = false;
  const tourId = saved.id;
  asking = new AbortController();
  let text = "", queued = false;
  const paint = () => { queued = false; body.innerHTML = markdown(visibleAnswer(text)); bindRefs(body); $("messages").scrollTop = $("messages").scrollHeight; };
  try {
    const res = await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, signal: asking.signal,
      body: JSON.stringify({ project: projectId, tour: tourId, question, context }) });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
    const reader = res.body.getReader(), decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let end;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const chunk = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        if (!chunk.startsWith("data: ")) continue;
        const event = JSON.parse(chunk.slice(6));
        if (event.type === "delta") { text += event.text; if (!queued) { queued = true; requestAnimationFrame(paint); } }
        else if (event.type === "activity") { activity.append(el("div", "activity", event.text)); while (activity.children.length > 4) activity.firstChild.remove(); $("messages").scrollTop = $("messages").scrollHeight; }
        else if (event.type === "done") {
          if (saved.id === tourId) { saved.chat.messages.push(event.message); live.replaceWith(messageNode(event.message)); }
          if (event.message.tour) addTab(event.message.tour, event.message.tourTitle);
        } else if (event.type === "error") throw new Error(event.text);
      }
    }
  } catch (error) {
    const message = { role: "error", text: error.name === "AbortError" ? "Stopped." : error.message };
    if (saved.id === tourId) { saved.chat.messages.push(message); live.replaceWith(messageNode(message)); }
  } finally {
    asking = null;
    $("ask-send").disabled = false; $("ask-stop").hidden = true;
  }
};
$("ask-stop").onclick = () => { asking?.abort(); fetch("/api/stop?" + q({ tour: saved.id }), { method: "POST" }); };
$("ask-input").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); $("ask-form").requestSubmit(); }
});

/* ---------- Review comments (PR tours only) ---------- */
const reviewDrafts = new Map();
function setCommentsOpen(open) {
  const visible = Boolean(tour?.review && open);
  document.querySelector(".comments-sidebar").hidden = !visible;
}
function addLineComment(card, line) {
  const field = $("review-prompt");
  field.value = field.value.trimEnd() + "\n" + createCommentEntry(tour, stepIndex, card.id, line);
  reviewDrafts.set(saved.id, field.value);
  setCommentsOpen(true);
  field.focus();
  field.setSelectionRange(field.value.length, field.value.length);
  field.scrollTop = field.scrollHeight;
}
$("review-prompt").addEventListener("input", () => reviewDrafts.set(saved.id, $("review-prompt").value));
$("comments-toggle").onclick = () => setCommentsOpen(document.querySelector(".comments-sidebar").hidden);
$("close-comments").onclick = () => setCommentsOpen(false);
$("copy-comments").onclick = async () => {
  try { await navigator.clipboard.writeText($("review-prompt").value); $("copy-status").textContent = "Copied"; }
  catch { $("review-prompt").select(); $("copy-status").textContent = "Selected. Press Ctrl/⌘+C."; }
};

/* ---------- Answer popup ---------- */
function setAnswerOpen(open) {
  $("answer-dialog").hidden = !open;
  $("answer-button").setAttribute("aria-expanded", String(open));
}
$("answer-button").onclick = () => setAnswerOpen($("answer-dialog").hidden);
$("answer-close").onclick = () => setAnswerOpen(false);
$("answer-body").addEventListener("click", (e) => { if (e.target.closest(".code-ref")) setAnswerOpen(false); });

/* ---------- Timeline and step code ---------- */
let selectedRange = null, rangeAnchor = 0;
const activeRange = () => selectedRange || [stepIndex, stepIndex];
// The code a step talks about: its focus, linked phrases, new arrows' lines and sections it introduces.
function stepRefs(i) {
  const step = tour.steps[i], refs = [];
  const add = (card, lines, why) => { if (cards.get(card)?.kind === "code" && lines) refs.push({ card, lines, why }); };
  for (const t of [step.focus, ...step.explanation.map((p) => p.target)]) if (t) add(t.card, t.lines, "explained");
  for (const id of step.revealConnections) {
    const edge = tour.connections.find((c) => c.id === id);
    for (const end of [edge.from, edge.to]) if (end.line !== undefined) add(end.card, [end.line, end.line], "arrow");
  }
  for (const card of cards.values()) for (const section of card.sections || [])
    if (section.step === i) for (const r of section.relevant || []) add(card.id, r, "introduced");
  return refs;
}
const hasCode = (i) => stepRefs(i).length > 0;
function renderTimeline() {
  const [a, b] = activeRange();
  const bar = $("timeline");
  const dots = tour.steps.map((step, i) => {
    const button = el("button", "tl-dot");
    button.setAttribute("role", "tab");
    button.setAttribute("aria-label", `Step ${i + 1}: ${step.title}`);
    button.title = `${i + 1}. ${step.title}${hasCode(i) ? "" : " (overview)"}\nShift-click to select a range`;
    if (!exploring && i === stepIndex) { button.classList.add("current"); button.setAttribute("aria-selected", "true"); }
    if (exploring || i < stepIndex) button.classList.add("done");
    if (selectedRange && i >= a && i <= b) button.classList.add("in-range");
    if (!hasCode(i)) button.classList.add("no-code");
    button.textContent = String(i + 1);
    button.onclick = (event) => {
      if (event.shiftKey) {
        selectedRange = [Math.min(rangeAnchor, i), Math.max(rangeAnchor, i)];
        setStepCodeOpen(true);
        renderTimeline();
        return;
      }
      selectedRange = null; rangeAnchor = i; stepIndex = i; exploring = false;
      render();
    };
    return button;
  });
  const all = el("button", "tl-dot all" + (exploring ? " current" : ""), "All");
  all.title = "Show the whole flow";
  all.onclick = () => { selectedRange = null; exploring = true; render(); };
  const track = el("div", "tl-track");
  track.append(...dots, all);
  // The rail fills up to the current step.
  track.style.setProperty("--progress-ratio", exploring ? 1 : stepIndex / Math.max(1, tour.steps.length));
  bar.replaceChildren(track);
  $("timeline-title").textContent = exploring ? "Whole flow" : selectedRange && a !== b
    ? `Steps ${a + 1}–${b + 1} selected` : `${stepIndex + 1}. ${tour.steps[stepIndex].title}`;
  track.querySelector(".current")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  $("step-code-toggle").textContent = selectedRange && a !== b ? `Code in steps ${a + 1}–${b + 1}` : "Code in this step";
  $("step-code-toggle").setAttribute("aria-pressed", String(!$("step-code").hidden));
}
function setStepCodeOpen(open) {
  $("step-code").hidden = !open;
  if (open) renderStepCode();
  $("step-code-toggle").setAttribute("aria-pressed", String(open));
}
$("step-code-toggle").onclick = () => setStepCodeOpen($("step-code").hidden);
$("step-code-close").onclick = () => setStepCodeOpen(false);
function renderStepCode() {
  const [a, b] = activeRange();
  $("step-code-title").textContent = a === b ? `Code in step ${a + 1}: ${tour.steps[a].title}` : `Code in steps ${a + 1}–${b + 1}`;
  const body = $("step-code-body");
  body.replaceChildren();
  // Lines discussed before the range count as context, not as new.
  const seen = new Set();
  for (let i = 0; i < a; i++) for (const r of stepRefs(i)) for (let l = r.lines[0]; l <= r.lines[1]; l++) seen.add(r.card + ":" + l);
  let any = false;
  for (let i = a; i <= b; i++) {
    const refs = stepRefs(i);
    if (a !== b || !refs.length) body.append(Object.assign(el("div", "sc-step"), { innerHTML: "" }));
    const heading = body.lastElementChild?.classList.contains("sc-step") ? body.lastElementChild : null;
    if (heading) { heading.textContent = `Step ${i + 1} · ${tour.steps[i].title}`; if (!refs.length) heading.append(el("small", "", "overview, no code")); }
    if (!refs.length) continue;
    any = true;
    const byCard = new Map();
    for (const r of refs) byCard.set(r.card, [...(byCard.get(r.card) || []), r.lines]);
    for (const [cardId, ranges] of byCard) {
      const card = cards.get(cardId), file = fileOf(card);
      highlightRows(file);
      const marked = new Set();
      for (const [x, y] of ranges) for (let l = x; l <= y; l++) marked.add(l);
      // Two lines of context around each hunk.
      const spans = [];
      for (const l of [...marked].sort((p, q) => p - q)) {
        const lo = Math.max(file.startLine, l - 2), hi = Math.min(file.endLine, l + 2), last = spans.at(-1);
        if (last && lo <= last[1] + 1) last[1] = Math.max(last[1], hi); else spans.push([lo, hi]);
      }
      const box = el("div", "sc-file");
      box.append(el("div", "", file.path + (card.diff ? (card.diff === "before" ? "  (before)" : "  (after)") : "")));
      const scroll = el("div", "sc-scroll");
      for (const [lo, hi] of spans) {
        const section = [...(card.sections || [])].reverse().find((s) => s.line <= lo);
        scroll.append(el("div", "sc-hunk", `@@ lines ${lo}–${hi}${section ? " · " + section.title : ""} @@`));
        for (let l = lo; l <= hi; l++) {
          let kind = "ctx";
          if (card.diff && card.changedLines?.includes(l)) kind = card.diff === "before" ? "del" : "add";
          else if (!card.diff && marked.has(l)) kind = seen.has(cardId + ":" + l) ? "ref" : "add";
          const row = el("div", "sc-line " + kind);
          const text = el("span", "t");
          const html = file.rows?.[l - file.startLine];
          if (html !== undefined) text.innerHTML = html; else text.textContent = file.lines[l - file.startLine] ?? "";
          row.append(el("span", "n", String(l)), el("span", "m", kind === "add" ? "+" : kind === "del" ? "−" : kind === "ref" ? "·" : ""), text);
          row.title = kind === "add" ? "First discussed in this step" : kind === "ref" ? "Discussed in an earlier step too" : "Context";
          const step = i;
          row.onclick = () => jumpToLine(step, cardId, l);
          scroll.append(row);
        }
      }
      box.append(scroll);
      body.append(box);
    }
    for (const r of refs) for (let l = r.lines[0]; l <= r.lines[1]; l++) seen.add(r.card + ":" + l);
  }
  if (!any) {
    const next = tour.steps.findIndex((_, i) => i > b && hasCode(i));
    const empty = el("div", "sc-empty");
    empty.append(el("b", "", a === b ? "No code in this step" : "No code in these steps"));
    empty.append(document.createTextNode(a === b ? "It's an overview of how the pieces fit together." : "They give an overview of how the pieces fit together."));
    if (next >= 0) {
      empty.append(document.createTextNode(" Code starts in "));
      const link = el("a", "", `step ${next + 1}: ${tour.steps[next].title}`);
      link.href = "#";
      link.onclick = (e) => { e.preventDefault(); selectedRange = null; rangeAnchor = next; stepIndex = next; exploring = false; render(); };
      empty.append(link, document.createTextNode("."));
    }
    body.replaceChildren(empty);
  }
}
function jumpToLine(step, cardId, line) {
  if (exploring || step !== stepIndex) { stepIndex = step; exploring = false; render({ keepView: true }); }
  requestAnimationFrame(() => {
    revealFold({ card: cardId, lines: [line, line] });
    requestAnimationFrame(() => {
      focusTarget({ card: cardId, lines: [line, line] });
      rowNodes.get(cardId)?.get(line)?.classList.add("flash");
    });
  });
}

/* ---------- Tabs and loading ---------- */
const tabsKey = () => "codesurf.tabs." + projectId;
let tabs = [];
function saveTabs() { try { localStorage.setItem(tabsKey(), JSON.stringify(tabs)); } catch {} }
function addTab(id, title) {
  // A newer version of the same tour replaces the older tab.
  const at = tabs.findIndex((t) => t.id === id || t.title === title);
  const next = { id, title };
  tabs = tabs.filter((t, i) => i === at || (t.id !== id && t.title !== title));
  if (at < 0) tabs.push(next); else tabs[tabs.findIndex((t) => t.id === id || t.title === title)] = next;
  saveTabs(); renderTabs();
}
function openTab(id, title) { addTab(id, title); loadTour(id); }
function renderTabs() {
  const bar = $("tabs");
  bar.hidden = tabs.length < 2;
  bar.replaceChildren(...tabs.map((t) => {
    const tab = el("button", "tab");
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", String(saved?.id === t.id));
    tab.append(el("span", "", t.title));
    tab.title = t.title;
    tab.onclick = () => loadTour(t.id);
    const close = el("button", "close", "×");
    close.title = "Close tab";
    close.onclick = (e) => {
      e.stopPropagation();
      tabs = tabs.filter((x) => x.id !== t.id); saveTabs();
      if (saved?.id === t.id && tabs.length) loadTour(tabs.at(-1).id); else renderTabs();
    };
    tab.append(close);
    return tab;
  }));
}
async function loadTour(id) {
  try {
    saved = await api("/api/tour?" + q({ id }));
  } catch (error) { $("error").textContent = error.message; return; }
  tour = saved.tour;
  files = new Map(tour.files.map((f) => [f.id, { ...f }]));
  for (const f of files.values()) f.endLine ??= f.startLine + f.source.split(/\r?\n/).filter((l, i, a) => i < a.length - 1 || l).length - 1;
  cards = new Map(tour.cards.map((c) => [c.id, structuredClone(c)]));
  stepIndex = 0; exploring = false; expanded = new Set();
  exploredCards = []; exploredEdges = []; exploreParents = new Map(); trail = [];
  positions.clear(); hoverCache.clear();
  addTab(saved.id, tour.title);
  history.replaceState(null, "", "?" + new URLSearchParams({ project: projectId, tour: saved.id }));
  document.title = tour.title + " · CodeSurf";
  $("title").textContent = tour.title;
  $("subtitle").textContent = tour.question || "";
  $("revision").textContent = `${saved.project.name}${tour.revision ? " · " + tour.revision : ""}${saved.stale.length ? " · some files changed since this tour" : ""}`;
  $("answer-button").hidden = !tour.answer;
  $("answer-preview").textContent = tour.answer ? tour.answer.replace(/[*`_]|\[([^\]]+)\]\([^)]*\)/g, "$1") : "";
  $("answer-body").innerHTML = tour.answer ? markdown(tour.answer) : "";
  bindRefs($("answer-body"));
  setAnswerOpen(false);
  selectedRange = null; rangeAnchor = 0;
  $("empty").hidden = true;
  $("error").textContent = "";
  $("comments-toggle").hidden = !tour.review;
  $("review-prompt").value = tour.review ? reviewDrafts.get(saved.id) ?? createReviewPrompt(tour) : "";
  setCommentsOpen(false);
  for (const id of ["back", "next", "exit"]) $(id).disabled = false;
  document.querySelector(".tour-sidebar").hidden = false;
  renderTabs();
  renderChat();
  render();
  requestAnimationFrame(() => render());
}
async function showHome() {
  tour = null;
  $("cards").replaceChildren(); $("edges").replaceChildren(); cardNodes = new Map();
  $("title").textContent = "CodeSurf"; $("subtitle").textContent = "Tours your agent made for your repositories.";
  document.querySelector(".tour-sidebar").hidden = true;
  $("tabs").hidden = true;
  const home = el("div", "home");
  try {
    const projects = await api("/api/projects");
    if (!projects.length) home.append(el("p", "", "No tours yet. Ask your coding agent to \"surf\" a question about a repository."));
    for (const p of projects) {
      home.append(el("h2", "", `${p.name}  ·  ${p.root}`));
      for (const t of p.tours.slice(0, 30)) {
        const link = el("a", "tour-link");
        link.href = "?" + new URLSearchParams({ project: p.id, tour: t.id });
        link.append(el("span", "", t.title), el("small", "", new Date(t.created).toLocaleString()));
        home.append(link);
      }
    }
  } catch (error) { home.append(el("p", "", error.message)); }
  $("empty").replaceChildren(home);
  $("empty").hidden = false;
}

/* ---------- Controls ---------- */
$("next").onclick = () => { selectedRange = null; if (stepIndex < tour.steps.length - 1) stepIndex++; else exploring = true; rangeAnchor = stepIndex; render(); };
$("back").onclick = () => { selectedRange = null; if (stepIndex > 0) stepIndex--; rangeAnchor = stepIndex; render(); };
$("exit").onclick = () => { exploring = true; render(); };
$("restart").onclick = () => { stepIndex = 0; exploring = false; render(); };
$("fit").onclick = fit;
$("home").onclick = () => { history.pushState(null, "", "?"); showHome(); };
$("zoom-in").onclick = () => zoomAt(scale * 1.2, $("viewport").clientWidth / 2, $("viewport").clientHeight / 2);
$("zoom-out").onclick = () => zoomAt(scale / 1.2, $("viewport").clientWidth / 2, $("viewport").clientHeight / 2);
const viewport = $("viewport");
viewport.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || event.target.closest("#popover")) return;
  const header = event.target.closest(".card-header");
  if (header && !event.target.closest("button")) {
    // Drag a card by its header.
    const node = header.closest(".card"), id = node.dataset.card;
    const start = { x: event.clientX, y: event.clientY, left: node.offsetLeft, top: node.offsetTop };
    header.setPointerCapture(event.pointerId);
    header.onpointermove = (move) => {
      positions.set(id, { x: start.left + (move.clientX - start.x) / scale, y: start.top + (move.clientY - start.y) / scale });
      node.style.left = positions.get(id).x + "px"; node.style.top = positions.get(id).y + "px";
      drawEdges();
    };
    header.onlostpointercapture = () => { header.onpointermove = null; };
    return;
  }
  if (event.target.closest(".card")) return;
  hidePopover();
  const x = event.clientX - panX, y = event.clientY - panY;
  viewport.setPointerCapture(event.pointerId);
  viewport.classList.add("panning");
  viewport.onpointermove = (move) => { panX = move.clientX - x; panY = move.clientY - y; transform(); };
});
viewport.onlostpointercapture = () => { viewport.onpointermove = null; viewport.classList.remove("panning"); };
viewport.addEventListener("wheel", (event) => {
  if (event.target.closest("#popover")) return;
  if (event.ctrlKey || event.metaKey) {
    event.preventDefault();
    const rect = viewport.getBoundingClientRect();
    zoomAt(scale * Math.exp(-event.deltaY * .006), event.clientX - rect.left, event.clientY - rect.top);
    return;
  }
  if (event.target.closest(".code-scroll") && Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
  event.preventDefault();
  panX -= event.deltaX; panY -= event.deltaY; transform();
}, { passive: false });
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") { hidePopover(); setAnswerOpen(false); }
  if ((event.key === "c" || event.key === "C") && tour && !event.metaKey && !event.ctrlKey && !event.target.closest("input,textarea,select")) setStepCodeOpen($("step-code").hidden);
  if (!tour || event.target.closest("input,textarea,select")) return;
  if (event.altKey && event.key === "ArrowLeft") { event.preventDefault(); $("trail-back").click(); return; }
  if (event.key === "ArrowRight" && !exploring) { event.preventDefault(); $("next").click(); }
  if (event.key === "ArrowLeft" && !exploring) { event.preventDefault(); $("back").click(); }
});
new ResizeObserver(() => { if (tour) scheduleDraw(); }).observe(viewport);
window.addEventListener("popstate", () => location.reload());

try { tabs = JSON.parse(localStorage.getItem(tabsKey()) || "[]"); } catch { tabs = []; }
if (projectId && params.get("tour")) loadTour(params.get("tour"));
else showHome();
