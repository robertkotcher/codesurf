import hljs from "highlight.js/lib/common";
import "highlight.js/styles/github.css";
import { validateTour } from "./validate.js";

const $ = (id) => document.getElementById(id);
const svgNS = "http://www.w3.org/2000/svg";
const colors = { call: "#528cbd", event: "#528cbd", return: "#54996e", success: "#54996e", failure: "#c36570" };
let tour, files, cardNodes, rowNodes;
let stepIndex = 0;
let exploring = false;
let scale = 1, panX = 0, panY = 0;
let visibleCards = new Set(), visibleConnections = new Set();
let expanded = new Set();
let currentTargets = [];
let drawing = false;

function el(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function svg(tag, attributes) {
  const node = document.createElementNS(svgNS, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  return node;
}
function transform() {
  $("world").style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
  $("zoom").textContent = Math.round(scale * 100) + "%";
}
function zoomAt(next, x, y) {
  next = Math.max(.15, Math.min(2.5, next));
  panX = x - (x - panX) * next / scale;
  panY = y - (y - panY) * next / scale;
  scale = next;
  transform();
}
function fit() {
  const nodes = [...visibleCards].map((id) => cardNodes.get(id)).filter(Boolean);
  if (!nodes.length) return;
  const left = Math.min(...nodes.map((n) => n.offsetLeft));
  const top = Math.min(...nodes.map((n) => n.offsetTop));
  const right = Math.max(...nodes.map((n) => n.offsetLeft + n.offsetWidth));
  const bottom = Math.max(...nodes.map((n) => n.offsetTop + n.offsetHeight));
  const area = $("viewport");
  scale = Math.max(.15, Math.min(1, (area.clientWidth - 60) / (right - left), (area.clientHeight - 60) / (bottom - top)));
  panX = (area.clientWidth - (right - left) * scale) / 2 - left * scale;
  panY = (area.clientHeight - (bottom - top) * scale) / 2 - top * scale;
  transform();
}
function focusTarget(target, keepScale = false) {
  const card = cardNodes.get(target.card);
  const row = rowNodes.get(target.card)?.get(target.lines[0]);
  if (!row || !card) return;
  const rect = row.getBoundingClientRect(), cardRect = card.getBoundingClientRect();
  const y = card.offsetTop + (rect.top - cardRect.top) / scale;
  if (!keepScale) scale = Math.min(1, Math.max(.45, ($("viewport").clientWidth - 80) / card.offsetWidth));
  panX = ($("viewport").clientWidth - card.offsetWidth * scale) / 2 - card.offsetLeft * scale;
  panY = 90 - y * scale;
  transform();
}
function highlightTarget(target, enabled) {
  for (let line = target.lines[0]; line <= target.lines[1]; line++)
    rowNodes.get(target.card)?.get(line)?.classList.toggle("referenced", enabled);
}
function sourceLink(file, line) {
  if (!file.sourceUrl) return null;
  const url = new URL(file.sourceUrl);
  if (line) url.hash = "L" + line;
  return url.href;
}
function link(text, href) {
  const node = el("a", "", text);
  node.href = href;
  node.target = "_blank";
  node.rel = "noopener noreferrer";
  return node;
}
function isRelevant(card, line) {
  const ranges = card.relevant || [card.range];
  return ranges.some(([first, last]) => line >= first && line <= last) ||
    currentTargets.some((target) => target.card === card.id && line >= target.lines[0] && line <= target.lines[1]);
}
function codeRow(card, line, html, text) {
  const row = el("div", "code-row");
  row.dataset.line = line;
  row.classList.toggle("muted", !isRelevant(card, line));
  if (card.changedLines?.includes(line)) row.classList.add("changed-" + card.diff);
  const file = files.get(card.file);
  const href = sourceLink(file, line);
  const number = href ? link(String(line), href) : el("span", "", line);
  number.className = "line-number";
  const code = el("span", "source-text");
  if (html === undefined) code.textContent = text;
  else code.innerHTML = html;
  row.append(number, code);
  rowNodes.get(card.id).set(line, row);
  return row;
}
function renderCard(card) {
  const node = el("article", "card");
  node.dataset.card = card.id;
  const file = files.get(card.file);
  const header = el("header", "card-header");
  const href = sourceLink(file);
  const path = href ? link(file.path, href) : el("span", "", file.path);
  path.className = "file-path";
  const title = el("h3", "", card.title);
  if (card.diff) title.append(el("span", "diff-label", card.diff === "before" ? "Before" : "After"));
  header.append(path, title);
  const scroller = el("div", "code-scroll");
  const content = el("div", "code-content");
  scroller.append(content);
  node.append(header, scroller);
  cardNodes.set(card.id, node);
  rowNodes.set(card.id, new Map());
  const lines = file.source.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  let highlighted;
  try {
    highlighted = hljs.highlight(file.source, { language: file.language, ignoreIllegals: true }).value;
  } catch { highlighted = null; }
  // Close and reopen multiline token spans so each row remains independent.
  let stack = [];
  const htmlRows = highlighted?.split(/\r?\n/).map((html) => {
    const prefix = stack.join("");
    for (const match of html.matchAll(/<span\b[^>]*>|<\/span>/g)) {
      if (match[0].startsWith("</")) stack.pop();
      else stack.push(match[0]);
    }
    return prefix + html + "</span>".repeat(stack.length);
  });
  for (let line = card.range[0]; line <= card.range[1];) {
    if (isRelevant(card, line)) {
      content.append(codeRow(card, line, htmlRows?.[line - (file.startLine || 1)], lines[line - (file.startLine || 1)]));
      line++;
      continue;
    }
    const start = line;
    while (line <= card.range[1] && !isRelevant(card, line)) line++;
    const end = line - 1;
    let parent = content;
    if (end - start + 1 > 10) {
      const key = card.id + ":" + start + ":" + end;
      const fold = el("details", "fold");
      const names = (card.outlines || []).filter(({ lines: range }) => range[0] >= start && range[0] <= end).map((item) => item.name);
      fold.append(el("summary", "", `Lines ${start}–${end} · ${end - start + 1} lines${names.length ? " · " + names.join(", ") : ""}`));
      fold.open = expanded.has(key);
      fold.ontoggle = () => {
        fold.open ? expanded.add(key) : expanded.delete(key);
        scheduleEdges();
      };
      content.append(fold);
      parent = fold;
    }
    for (let i = start; i <= end; i++)
      parent.append(codeRow(card, i, htmlRows?.[i - (file.startLine || 1)], lines[i - (file.startLine || 1)]));
  }
  $("cards").append(node);
}
function arrangeCards() {
  const columns = [30, 820], bottoms = [30, 30];
  for (const [index, card] of tour.cards.entries()) {
    if (!visibleCards.has(card.id)) continue;
    const node = cardNodes.get(card.id);
    const column = index % 2;
    node.style.left = (card.x ?? columns[column]) + "px";
    node.style.top = (card.y ?? bottoms[column]) + "px";
    bottoms[column] = Math.max(bottoms[column], node.offsetTop + node.offsetHeight + 50);
  }
}
function scheduleEdges() {
  if (drawing) return;
  drawing = true;
  requestAnimationFrame(() => {
    drawing = false;
    arrangeCards();
    drawEdges();
  });
}
function drawEdges() {
  const layer = $("edges");
  layer.replaceChildren();
  const defs = svg("defs", {});
  for (const [kind, color] of Object.entries(colors)) {
    const marker = svg("marker", { id: "arrow-" + kind, viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: "auto-start-reverse" });
    marker.append(svg("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: color }));
    defs.append(marker);
  }
  layer.append(defs);
  for (const edge of tour.connections) {
    if (!visibleConnections.has(edge.id)) continue;
    const fromCard = cardNodes.get(edge.from.card), toCard = cardNodes.get(edge.to.card);
    const fromRow = rowNodes.get(edge.from.card)?.get(edge.from.line);
    const toRow = rowNodes.get(edge.to.card)?.get(edge.to.line);
    if (!fromRow?.getClientRects().length || !toRow?.getClientRects().length) continue;
    const a = fromCard.getBoundingClientRect(), b = toCard.getBoundingClientRect();
    const ar = fromRow.getBoundingClientRect(), br = toRow.getBoundingClientRect();
    const forward = toCard.offsetLeft > fromCard.offsetLeft;
    const sameColumn = Math.abs(toCard.offsetLeft - fromCard.offsetLeft) < 100;
    const x1 = fromCard.offsetLeft + (forward || sameColumn ? fromCard.offsetWidth : 0);
    const x2 = toCard.offsetLeft + (forward ? 0 : toCard.offsetWidth);
    const y1 = fromCard.offsetTop + (ar.top - a.top + ar.height / 2) / scale;
    const y2 = toCard.offsetTop + (br.top - b.top + br.height / 2) / scale;
    const middle = sameColumn ? Math.max(x1, x2) + 45 : (x1 + x2) / 2;
    const color = colors[edge.kind];
    layer.append(svg("path", { class: "edge-path", d: `M ${x1} ${y1} H ${middle} V ${y2} H ${x2}`, stroke: color, "marker-end": `url(#arrow-${edge.kind})` }));
    const label = svg("text", { class: "edge-label", x: middle + 5, y: (y1 + y2) / 2 - 5, fill: color });
    label.textContent = edge.label;
    layer.append(label);
    fromRow.classList.add("flow-" + edge.kind);
  }
}
function showStep({ fitAll = false } = {}) {
  if (!tour) return;
  visibleCards = new Set();
  visibleConnections = new Set();
  const shown = exploring ? tour.steps : tour.steps.slice(0, stepIndex + 1);
  for (const step of shown) {
    step.revealCards.forEach((id) => visibleCards.add(id));
    step.revealConnections.forEach((id) => visibleConnections.add(id));
  }
  const step = tour.steps[stepIndex];
  currentTargets = exploring ? [] : [step.focus, ...step.explanation.flatMap((part) => part.target ? [part.target] : [])];
  for (const edge of tour.connections) {
    if (visibleConnections.has(edge.id)) {
      currentTargets.push({ card: edge.from.card, lines: [edge.from.line, edge.from.line] });
      currentTargets.push({ card: edge.to.card, lines: [edge.to.line, edge.to.line] });
    }
  }
  $("cards").replaceChildren();
  cardNodes = new Map();
  rowNodes = new Map();
  for (const card of tour.cards) if (visibleCards.has(card.id)) renderCard(card);
  arrangeCards();
  $("explanation").replaceChildren();
  $("progress").textContent = exploring ? "Explore the complete flow" : `${stepIndex + 1} / ${tour.steps.length}`;
  $("step-title").textContent = exploring ? tour.title : step.title;
  if (exploring) $("explanation").textContent = "All code cards and connections are visible. Expand folded code or restart the guided tour.";
  else {
    for (const part of step.explanation) {
      if (!part.target) { $("explanation").append(document.createTextNode(part.text)); continue; }
      const reference = el("a", "", part.text);
      reference.href = "#card-" + part.target.card;
      reference.onmouseenter = reference.onfocus = () => highlightTarget(part.target, true);
      reference.onmouseleave = reference.onblur = () => highlightTarget(part.target, false);
      reference.onclick = (event) => { event.preventDefault(); focusTarget(part.target); highlightTarget(part.target, true); };
      $("explanation").append(reference);
    }
    for (let line = step.focus.lines[0]; line <= step.focus.lines[1]; line++)
      rowNodes.get(step.focus.card)?.get(line)?.classList.add("selected");
  }
  $("back").disabled = exploring || stepIndex === 0;
  $("next").disabled = exploring;
  $("next").textContent = stepIndex === tour.steps.length - 1 ? "Done" : "Next";
  $("exit").disabled = exploring;
  $("restart").hidden = !exploring && stepIndex === 0;
  if (fitAll || exploring) fit();
  else focusTarget(step.focus);
  drawEdges();
}
function loadTour(data) {
  validateTour(data);
  tour = data;
  files = new Map(tour.files.map((file) => [file.id, file]));
  stepIndex = 0;
  exploring = false;
  expanded = new Set();
  $("title").textContent = tour.title;
  document.title = tour.title + " · CodeSurf";
  $("subtitle").textContent = tour.question || "Follow the tour. Click hidden lines to expand. Drag the background to pan.";
  $("revision").textContent = tour.revision ? "Revision " + tour.revision : "Local source snapshot";
  $("empty").hidden = true;
  $("error").textContent = "";
  showStep();
}
$("file").onchange = async (event) => {
  try {
    const file = event.target.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) throw new Error("Tour exceeds the 10 MB limit.");
    loadTour(JSON.parse(await file.text()));
  } catch (error) { $("error").textContent = error.message; }
  event.target.value = "";
};
$("next").onclick = () => {
  if (stepIndex < tour.steps.length - 1) stepIndex++;
  else exploring = true;
  showStep();
};
$("back").onclick = () => { if (stepIndex > 0) stepIndex--; showStep(); };
$("exit").onclick = () => { exploring = true; showStep(); };
$("restart").onclick = () => { stepIndex = 0; exploring = false; expanded.clear(); showStep(); };
$("fit").onclick = fit;
$("zoom-in").onclick = () => zoomAt(scale * 1.2, $("viewport").clientWidth / 2, $("viewport").clientHeight / 2);
$("zoom-out").onclick = () => zoomAt(scale / 1.2, $("viewport").clientWidth / 2, $("viewport").clientHeight / 2);
const viewport = $("viewport");
viewport.onpointerdown = (event) => {
  if (event.button !== 0 || event.target.closest(".card")) return;
  const x = event.clientX - panX, y = event.clientY - panY;
  viewport.setPointerCapture(event.pointerId);
  viewport.classList.add("panning");
  viewport.onpointermove = (move) => { panX = move.clientX - x; panY = move.clientY - y; transform(); };
};
viewport.onlostpointercapture = () => { viewport.onpointermove = null; viewport.classList.remove("panning"); };
viewport.addEventListener("wheel", (event) => {
  if (event.target.closest(".card")) return;
  event.preventDefault();
  if (event.ctrlKey || event.metaKey) {
    const rect = viewport.getBoundingClientRect();
    zoomAt(scale * Math.exp(-event.deltaY * .005), event.clientX - rect.left, event.clientY - rect.top);
  } else { panX -= event.deltaX; panY -= event.deltaY; transform(); }
}, { passive: false });
document.addEventListener("keydown", (event) => {
  if (!tour || event.target.closest("input,button,a,summary")) return;
  if (event.key === "ArrowRight" && !exploring) { event.preventDefault(); $("next").click(); }
  if (event.key === "ArrowLeft" && !exploring) { event.preventDefault(); $("back").click(); }
});
new ResizeObserver(() => { if (tour) scheduleEdges(); }).observe(viewport);
document.fonts.ready.then(() => { if (tour) scheduleEdges(); });
try {
  const embedded = JSON.parse($("tour-data").textContent);
  if (embedded) loadTour(embedded);
} catch (error) { $("error").textContent = error.message; }
