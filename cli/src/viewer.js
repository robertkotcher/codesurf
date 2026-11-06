/* The report is a source snapshot. All repository text is escaped before entering markup. */
const $ = (id) => document.getElementById(id);
const esc = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const definitions = new Map(
  [
    ...(report.definitions || report.nodes),
    ...Object.values(report.symbolDefinitions || {}),
  ].map((n) => [n.id, n]),
);
const collapsedFolders = new Set();
const sizes = new Map();
const wrapping = new Set();
const scrolls = new Map();
let folderLayout = null;
let overviewPosition = null;
const nodes = new Map(report.nodes.map((n) => [n.id, n]));
const graph = buildFileGraph([...nodes.values()], report.sources);
const panels = graph.panels;
let hoveredLine = null,
  pinnedLine = null;
const ranges = new Map();
const expandedFunctions = new Set();
const positions = new Map();
let scale = 1,
  tx = 0,
  ty = 0;
let graphWidth = 1,
  graphHeight = 1,
  drag = null,
  busy = false,
  framePending = false;

$("run-title").textContent = report.title || report.question || "New run";
$("run-title").title = report.title || report.question || "New run";
$("repo").textContent = report.roots.map((r) => r.split("/").pop()).join(" + ");
$("summary").textContent =
  report.summary ||
  (nodes.size
    ? `Start with ${nodes.get(report.entry)?.name || "the first function"}, the piece of code where this flow begins, and follow the arrows to see which pieces it asks to do work. Open a function with ▸ to read its steps, or click ⓘ for a plain-language explanation.`
    : "");
document.title = "CodeSurf" + (report.title ? " · " + report.title : "");
$("welcome").hidden = nodes.size > 0;
const sections = [
  ["Parser diagnostics", report.diagnostics || []],
  ["Assumptions", report.assumptions || []],
  ["Left out of this scenario", report.omitted || []],
];
$("info-content").innerHTML =
  `<p>${esc(report.note || "Type a scenario to investigate this repository.")}</p>` +
  sections
    .map(
      ([label, items]) =>
        `<h3>${label}</h3><ul>${items.map((s) => `<li>${esc(s)}</li>`).join("") || "<li>None specified.</li>"}</ul>`,
    )
    .join("");

function source(n) {
  return (
    report.sources?.[n.file] ||
    Array(n.start - 1)
      .fill("")
      .concat(n.lines)
  );
}
function callKey(c) {
  return `${c.line}:${c.column ?? 0}:${c.target}`;
}
function allCalls(n) {
  const map = new Map();
  // Expanding outside this definition also makes calls in the surrounding file navigable.
  for (const d of definitions.values())
    if (d.file === n.file) for (const c of d.calls) map.set(callKey(c), c);
  for (const c of n.calls) map.set(callKey(c), c);
  return [...map.values()];
}
function shown(panel) {
  if (ranges.has(panel.id))
    return [...ranges.get(panel.id)].sort((a, b) => a - b);
  const set = new Set();
  for (const fn of panel.members) {
    // Relevance chooses functions; show their complete bodies for readable context.
    for (let line = fn.start; line <= fn.end; line++) set.add(line);
  }
  const ordered = [...set].sort((a, b) => a - b);
  for (let i = 1; i < ordered.length; i++)
    if (ordered[i] - ordered[i - 1] <= 9)
      for (let line = ordered[i - 1] + 1; line < ordered[i]; line++) set.add(line);
  return [...set]
    .filter((l) => l > 0 && l <= source(panel).length)
    .sort((a, b) => a - b);
}
function highlighted(line, n, number) {
  const pattern =
    /(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\/\/.*$|[\p{L}_$][\p{L}\p{N}_$]*|\d+(?:\.\d+)?|[^\s])/gu;
  const refs = report.symbolRefs?.[n.file] || [];
  const calls = allCalls(n).filter((c) => c.line === number);
  let result = "",
    at = 0;
  for (const match of line.matchAll(pattern)) {
    const text = match[0],
      column = match.index;
    const ref = refs.find((r) => r.line === number && r.column === column);
    const call = calls.find((c) => c.column === column && c.target);
    const target = ref?.target || call?.target;
    const kind = /^['"`]/.test(text)
      ? "str"
      : /^(?:export|async|await|function|return|const|let|if|else|try|catch|throw|new|import|from|null|true|false|Number|String|def|class|elif|except|raise|with|as|None|True|False|match|case|yield|lambda|module|end|do|unless|elsif|rescue|ensure|nil|self|begin|super)$/.test(
            text,
          )
        ? "kw"
        : "";
    result += esc(line.slice(at, column));
    result += `<button class="token ${kind} ${target ? "call-link" : ""}" data-token="${column}" data-token-line="${number}" data-token-node="${esc((n.members.find((fn) => number >= fn.start && number <= fn.end) || n.members[0]).id)}" ${target ? `data-target="${esc(target)}"` : ""} aria-label="Actions for ${esc(text)}">${esc(text)}</button>`;
    at = column + text.length;
  }
  return result + esc(line.slice(at));
}
function lineHTML(n, l) {
  const calls = allCalls(n).filter((c) => c.line === l);
  const fn = n.members.find(fn => fn.start === l);
  const info = fn ? `<button class="function-info" data-function-info="${esc(fn.id)}" aria-label="About ${esc(fn.name)}">ⓘ</button><button class="function-toggle" data-function-toggle="${esc(fn.id)}" aria-expanded="${expandedFunctions.has(fn.id)}" aria-label="${expandedFunctions.has(fn.id) ? "Collapse" : "Expand"} ${esc(fn.name)}">${expandedFunctions.has(fn.id) ? "▾" : "▸"}</button>` : "";
  return `<div class="line ${calls.some((c) => definitions.has(c.target)) ? "hit" : ""} ${n.changed.includes(l) ? "changed" : ""}" data-line="${l}" data-file="${esc(n.file)}"><span class="function-controls">${info}</span><span class="ln"><button class="line-pin" type="button" aria-label="Pin execution path at ${esc(n.file)} line ${l}" aria-pressed="false">${l}</button></span><span class="source-text">${highlighted(source(n)[l - 1] || "", n, l)}</span></div>`;
}
function snippet(n) {
  const lines = shown(n);
  let html = "";
  let previous = null;
  lines.forEach((l, i) => {
    const hidden = n.members.some(fn => !expandedFunctions.has(fn.id) && l > fn.start && l <= fn.end);
    if (hidden) return;
    const collapsedBetween = n.members.some(fn => !expandedFunctions.has(fn.id) && previous >= fn.start && previous <= fn.end);
    if (previous !== null && l > previous + 1 && !collapsedBetween)
      html += `<button class="fold" data-gap="${esc(n.id)}" data-from="${lines[i - 1] + 1}" data-to="${l - 1}">Show ${l - lines[i - 1] - 1} hidden lines (${lines[i - 1] + 1}–${l - 1})</button>`;
    html += lineHTML(n, l);
    previous = l;
  });
  return html;
}
function render() {
  document.querySelectorAll(".node").forEach((card) => {
    const snippet = card.querySelector(".snippet");
    scrolls.set(card.dataset.nodeId, {
      left: snippet.scrollLeft,
      top: snippet.scrollTop,
    });
  });
  sizeObserver.disconnect();
  $("map").innerHTML = [...panels.values()]
    .map((n, i) => {
      const lines = shown(n),
        hasGaps = lines.length < lines.at(-1) - lines[0] + 1,
        local = n.calls.filter(
          (c) => nodes.has(c.target) && !c.excluded,
        ).length;
      return `<article data-node-id="${esc(n.id)}" style="width:${sizes.get(n.id)?.width || 340}px;height:auto" class="node ${n.members.some((fn) => fn.id === report.entry) ? "selected" : ""}" id="node-${n.id}" aria-label="${esc(n.name)} in ${esc(n.file)}"><div class="node-head"><div class="node-title"><button data-select="${n.id}">${esc(n.name)}</button></div><div class="path">${esc(n.file)}:${n.start}–${n.end}</div></div><div class="context"><button data-above="${n.id}" ${lines[0] <= 1 ? "disabled" : ""}>↑ ${Math.min(20, lines[0] - 1) > 0 ? `Show ${Math.min(20, lines[0] - 1)} line${Math.min(20, lines[0] - 1) === 1 ? "" : "s"} above` : "No lines above"}</button></div><div class="snippet ${wrapping.has(n.id) ? "wrap" : ""}">${snippet(n)}</div><div class="context"><button data-below="${n.id}" ${lines.at(-1) >= source(n).length ? "disabled" : ""}>↓ ${Math.min(20, source(n).length - lines.at(-1)) > 0 ? `Show ${Math.min(20, source(n).length - lines.at(-1))} line${Math.min(20, source(n).length - lines.at(-1)) === 1 ? "" : "s"} below` : "No lines below"}</button></div><div class="node-foot"><button data-wrap="${esc(n.id)}" aria-pressed="${wrapping.has(n.id)}" aria-label="Toggle line wrapping for ${esc(n.name)}">↵ Wrap</button><a href="vscode://file/${encodeURI(n.absolute).replaceAll("#", "%23")}:${n.start}">Editor ↗</a></div></article>`;
    })
    .join("");
  document.querySelectorAll(".node").forEach((card) => {
    const snippet = card.querySelector(".snippet"),
      saved = scrolls.get(card.dataset.nodeId);
    if (saved) {
      snippet.scrollLeft = saved.left;
      snippet.scrollTop = saved.top;
    }
    snippet.addEventListener("scroll", scheduleEdges);
    sizes.set(card.dataset.nodeId, {width: card.offsetWidth || 340, height: card.offsetHeight || 280});
    sizeObserver.observe(card);
  });
  layout();
  const entryPanelId = graph.panelForFunction.get(report.entry);
  if (entryPanelId && !scrolls.has(entryPanelId)) {
    const card = $("node-" + entryPanelId),
      snippet = card.querySelector(".snippet"),
      row = card.querySelector(
        `[data-line="${nodes.get(report.entry).start}"]`,
      );
    if (row?.getBoundingClientRect().height) {
      snippet.scrollTop +=
        row.getBoundingClientRect().top - snippet.getBoundingClientRect().top;
      scrolls.set(entryPanelId, { left: 0, top: snippet.scrollTop });
      scheduleEdges();
    }
  }
}
const sizeObserver = new ResizeObserver((entries) => {
  let changed = false;
  for (const entry of entries) {
    const card = entry.target,
      id = card.dataset.nodeId;
    if (!id) continue;
    const width = card.offsetWidth,
      height = card.offsetHeight;
    if (!width || !height) continue;
    const old = sizes.get(id) || { width: 340, height: 280 };
    if (Math.abs(width - old.width) > 1 || Math.abs(height - old.height) > 1) {
      sizes.set(id, { width, height });
      changed = true;
    }
  }
  if (changed) layout();
});
function layout() {
  folderLayout = layoutFolders([...panels.values()], sizes, collapsedFolders);
  const overview = $("trace-overview");
  overview.hidden = !nodes.size;
  overviewPosition = null;
  if (nodes.size) {
    // Reserve a separate left-hand lane, outside every repository folder.
    const offset = 430;
    for (const position of folderLayout.nodePositions.values())
      position.x += offset;
    for (const folder of folderLayout.folders) folder.x += offset;
    folderLayout.width += offset;
    const entryPanel = graph.panelForFunction.get(report.entry);
    const entryFolder = folderLayout.hiddenBy.get(entryPanel);
    const entry = entryFolder
      ? folderLayout.folders.find((folder) => folder.key === entryFolder)
      : folderLayout.nodePositions.get(entryPanel);
    const height = overview.offsetHeight || 300;
    const center = entry
      ? entry.y + (entryFolder ? entry.height / 2 : 95)
      : 180;
    overviewPosition = {
      x: 30,
      y: Math.max(30, center - height / 2),
      width: 350,
      height,
    };
    overview.style.left = overviewPosition.x + "px";
    overview.style.top = overviewPosition.y + "px";
    folderLayout.height = Math.max(
      folderLayout.height,
      overviewPosition.y + height + 40,
    );
  }
  positions.clear();
  for (const [id, p] of folderLayout.nodePositions) positions.set(id, p);
  for (const n of panels.values()) {
    const card = $("node-" + n.id),
      p = positions.get(n.id);
    card.hidden = !p;
    if (p) {
      card.style.left = p.x + "px";
      card.style.top = p.y + "px";
    }
  }
  $("regions").innerHTML = folderLayout.folders
    .map(
      (f) =>
        `<section class="folder ${f.collapsed ? "collapsed" : ""}" data-folder-box="${esc(f.key)}" style="left:${f.x}px;top:${f.y}px;width:${f.width}px;height:${f.height}px;background:hsl(46 90% ${Math.min(99, 91 + f.depth * 1.8)}%)"><button class="folder-label" data-folder="${esc(f.key)}" aria-expanded="${!f.collapsed}" aria-label="${f.collapsed ? "Expand" : "Collapse"} folder ${esc(f.key)}">${f.collapsed ? "▸" : "▾"} ${esc(f.name)}${f.collapsed ? ` <small>${f.count} ${f.count === 1 ? "file" : "files"}</small>` : ""}</button></section>`,
    )
    .join("");
  graphWidth = folderLayout.width + 100;
  graphHeight = folderLayout.height;
  $("world").style.width = graphWidth + "px";
  $("world").style.height = graphHeight + "px";
  const svg = document.querySelector(".edges");
  svg.setAttribute("width", graphWidth);
  svg.setAttribute("height", graphHeight);
  positionChats();
  scheduleEdges();
}
function endpoint(id) {
  const panelId = graph.panelForFunction.get(id) || id;
  const folder = folderLayout.hiddenBy.get(panelId);
  if (folder) {
    const box = folderLayout.folders.find((f) => f.key === folder);
    return { ...box, key: "folder:" + folder, folder };
  }
  const p = positions.get(panelId);
  return p ? { ...p, key: "node:" + panelId, id: panelId } : null;
}
function rowPoint(end, line, side) {
  const owner = panels.get(end.id)?.members.find(fn => line >= fn.start && line <= fn.end);
  if (owner && !expandedFunctions.has(owner.id)) line = owner.start;
  if (end.folder)
    return {
      x: end.x + (side === "right" ? end.width : 0),
      y: end.y + end.height / 2,
    };
  const card = $("node-" + end.id),
    row = card.querySelector(`[data-line="${line}"]`),
    snippet = card.querySelector(".snippet");
  const r = row?.getBoundingClientRect(),
    clip = snippet.getBoundingClientRect(),
    w = $("world").getBoundingClientRect();
  const fallback =
    end.y + 95 + Math.max(0, shown(panels.get(end.id)).indexOf(line)) * 19;
  const y = r?.height
    ? (Math.max(
        clip.top + 3 * scale,
        Math.min(clip.bottom - 3 * scale, r.top + r.height / 2),
      ) -
        w.top) /
      scale
    : fallback;
  return { x: end.x + (side === "right" ? end.width : 0), y };
}
function drawEdges() {
  if (!folderLayout) return;
  let html = "";
  const entry = nodes.has(report.entry) && endpoint(report.entry);
  if (overviewPosition && entry) {
    const from = {
      x: overviewPosition.x + overviewPosition.width,
      y: overviewPosition.y + overviewPosition.height / 2,
    };
    const to = rowPoint(entry, nodes.get(report.entry).start, "left");
    html += `<path class="edge overview-edge" data-from="overview" data-to="${esc(report.entry)}" ${entry.folder ? `data-to-folder="${esc(entry.folder)}"` : ""} d="M${from.x},${from.y} C${from.x + 65},${from.y} ${to.x - 65},${to.y} ${to.x},${to.y}" marker-end="url(#arrow)"/>`;
  }
  const records = new Map();
  let loop = 0;
  for (const edge of graph.edges) {
    const n = nodes.get(edge.from),
      target = nodes.get(edge.to),
      a = endpoint(edge.from),
      b = endpoint(edge.to);
    if (!a || !b || (a.folder && a.key === b.key)) continue;
    const panel = panels.get(graph.panelForFunction.get(n.id));
    if (!a.folder && !shown(panel).includes(edge.line)) continue;
    const key = a.folder
      ? a.key + ":" + b.key + ":" + (b.folder ? "" : edge.to)
      : edge.id;
    if (records.has(key)) {
      records.get(key).ids.push(edge.id);
      continue;
    }

    const self = a.key === b.key;
    const sameColumn = Math.abs(a.x - b.x) < 50,
      forward = b.x + b.width / 2 >= a.x + a.width / 2;
    const fromSide = self || sameColumn ? "right" : forward ? "right" : "left",
      toSide = self || sameColumn ? "right" : forward ? "left" : "right";
    const from = rowPoint(a, edge.line, fromSide),
      to = rowPoint(b, target.start, toSide);
    const bend = self
      ? 70 + (loop++ % 4) * 16
      : Math.max(55, Math.min(140, Math.abs(to.x - from.x) * 0.45));
    const equalY = self && Math.abs(from.y - to.y) < 4;
    const d = `M${from.x},${from.y} C${from.x + (fromSide === "right" ? bend : -bend)},${from.y - (equalY ? 35 : 0)} ${to.x + (toSide === "right" ? bend : -bend)},${to.y + (equalY ? 35 : 0)} ${to.x},${to.y}`;
    records.set(key, { edge, a, b, self, fromSide, toSide, d, ids: [edge.id] });
  }
  for (const {
    edge,
    a,
    b,
    self,
    fromSide,
    toSide,
    d,
    ids,
  } of records.values()) {
    html += `<path class="edge ${self ? "self-loop" : ""}" data-edge-id="${esc(edge.id)}" data-edge-ids="${esc(JSON.stringify(ids))}" data-from="${esc(edge.from)}" data-to="${esc(edge.to)}" data-from-line="${edge.line}" data-from-column="${edge.column || 0}" data-from-side="${fromSide}" data-to-side="${toSide}" ${a.folder ? `data-from-folder="${esc(a.folder)}"` : ""} ${b.folder ? `data-to-folder="${esc(b.folder)}"` : ""} d="${d}" marker-end="url(#arrow)"/>`;
  }
  $("edges").innerHTML = html;
  applyFocus();
}
function applyFocus() {
  const focus = pathFocus(graph, hoveredLine || pinnedLine);
  document.querySelectorAll(".line[data-file]").forEach((row) => {
    const line = Number(row.dataset.line),
      file = row.dataset.file,
      active = !focus || lineOnPath(graph, focus, file, line);
    row.classList.toggle("path-active", Boolean(focus && active));
    row.classList.toggle("path-muted", Boolean(focus && !active));
    const pinned = pinnedLine?.file === file && pinnedLine.line === line;
    row.classList.toggle(
      "path-origin",
      Boolean(
        pinned || (hoveredLine?.file === file && hoveredLine.line === line),
      ),
    );
    row
      .querySelector(".line-pin")
      ?.setAttribute("aria-pressed", String(Boolean(pinned)));
  });
  document.querySelectorAll(".edge").forEach((edge) => {
    const active =
      focus &&
      (edge.classList.contains("overview-edge")
        ? focus.functions.has(report.entry)
        : JSON.parse(edge.dataset.edgeIds || "[]").some((id) =>
            focus.edgeIds.has(id),
          ));
    edge.classList.toggle("path-active", Boolean(active));
    edge.classList.toggle("path-muted", Boolean(focus && !active));
  });
}
function scheduleEdges() {
  if (framePending) return;
  framePending = true;
  requestAnimationFrame(() => {
    framePending = false;
    drawEdges();
  });
}
function transform() {
  $("world").style.transform = `translate(${tx}px,${ty}px) scale(${scale})`;
  $("zoom").textContent = Math.round(scale * 100) + "%";
  positionChats();
  scheduleEdges();
}
function bounds() {
  const b = $("viewport").getBoundingClientRect();
  return {
    width: b.width || 1000,
    height: b.height || 600,
    left: b.left,
    top: b.top,
  };
}
function fit() {
  const b = bounds();
  scale = Math.max(
    0.08,
    Math.min(1, (b.width - 55) / graphWidth, (b.height - 70) / graphHeight),
  );
  tx = (b.width - graphWidth * scale) / 2;
  ty = 50 + (b.height - 60 - graphHeight * scale) / 2;
  transform();
}
function zoom(factor, x, y) {
  const b = bounds();
  x ??= b.width / 2;
  y ??= b.height / 2;
  const next = Math.max(0.08, Math.min(2.5, scale * factor));
  tx = x - ((x - tx) * next) / scale;
  ty = y - ((y - ty) * next) / scale;
  scale = next;
  transform();
}
function expandRange(id, from, to) {
  const n = panels.get(id),
    set = new Set(shown(n));
  for (let l = Math.max(1, from); l <= Math.min(source(n).length, to); l++)
    set.add(l);
  ranges.set(id, set);
  render();
}
/*__CHATS__*/
document.addEventListener("pointerover", (e) => {
  const row = e.target.closest?.(".line[data-file]");
  if (!row || e.relatedTarget?.closest?.(".line") === row) return;
  hoveredLine = { file: row.dataset.file, line: Number(row.dataset.line) };
  applyFocus();
});
document.addEventListener("pointerout", (e) => {
  const row = e.target.closest?.(".line[data-file]");
  if (row && e.relatedTarget?.closest?.(".line") !== row) {
    hoveredLine = null;
    applyFocus();
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    pinnedLine = null;
    hoveredLine = null;
    applyFocus();
  }
});
document.addEventListener("click", (e) => {
  const toggle = e.target.closest("[data-function-toggle]");
  if (toggle) {
    const id = toggle.dataset.functionToggle;
    expandedFunctions.has(id) ? expandedFunctions.delete(id) : expandedFunctions.add(id);
    render(); return;
  }
  const info = e.target.closest("[data-function-info]");
  if (info) {
    const fn = nodes.get(info.dataset.functionInfo);
    document.querySelector(".function-tooltip")?.remove();
    const tooltip = document.createElement("div");
    tooltip.className = "function-tooltip";
    tooltip.setAttribute("role", "tooltip");
    const names = [...new Set(fn.calls.map(c => definitions.get(c.target)?.name).filter(Boolean))];
    tooltip.textContent = fn.description || fn.reason || (names.length ? `${fn.name} coordinates calls to ${names.join(", ")}.` : `${fn.name} computes its result using the operations in its body.`);
    const shapes = document.createElement("div");
    shapes.className = "function-shapes";
    const inputs = fn.inputs?.length ? fn.inputs.map(p => `${p.rest ? "..." : ""}${p.name}${p.optional ? "?" : ""}: ${p.type}${p.inferred ? " (inferred)" : ""}`).join("\n") : fn.inputs ? "No arguments" : "Not available in this snapshot";
    for (const [label, text] of [["Inputs", inputs], ["Returns", fn.output ? `${fn.output.type}${fn.output.inferred ? " (inferred)" : ""}` : "Not available in this snapshot"]]) {
      const heading = document.createElement("strong"); heading.textContent = label;
      const code = document.createElement("pre"); code.textContent = text;
      shapes.append(heading, code);
    }
    tooltip.append(shapes);
    const rect = info.getBoundingClientRect();
    tooltip.style.left = Math.min(rect.left, window.innerWidth - 330) + "px";
    tooltip.style.top = rect.bottom + 8 + "px";
    document.body.append(tooltip); return;
  }
  document.querySelector(".function-tooltip")?.remove();
  const token = e.target.closest("[data-token]"),
    folder = e.target.closest("[data-folder]"),
    wrap = e.target.closest("[data-wrap]"),
    gap = e.target.closest("[data-gap]"),
    above = e.target.closest("[data-above]"),
    below = e.target.closest("[data-below]"),
    select = e.target.closest("[data-select]"),
    example = e.target.closest("[data-example]");
  const row = e.target.closest(".line[data-file]");
  if (row) {
    const selection = {
      file: row.dataset.file,
      line: Number(row.dataset.line),
    };
    pinnedLine =
      token ||
      pinnedLine?.file !== selection.file ||
      pinnedLine?.line !== selection.line
        ? selection
        : null;
    hoveredLine = null;
    applyFocus();
  }
  if (token) {
    openChat(token);
    return;
  }
  if (row) {
    const panel = [...panels.values()].find(p => p.file === row.dataset.file);
    const line = Number(row.dataset.line);
    const fn = panel.members.find(fn => line >= fn.start && line <= fn.end) || panel.members[0];
    const text = source(panel)[line - 1] || "";
    if (text.trim()) openChat({dataset:{tokenNode:fn.id, tokenLine:String(line), token:"0"},textContent:text}, true);
    return;
  }
  if (!e.target.closest(".chat")) activateChat(null);
  if (folder) {
    const key = folder.dataset.folder;
    collapsedFolders.has(key)
      ? collapsedFolders.delete(key)
      : collapsedFolders.add(key);
    layout();
    return;
  }
  if (wrap) {
    const id = wrap.dataset.wrap;
    wrapping.has(id) ? wrapping.delete(id) : wrapping.add(id);
    render();
    return;
  }
  if (gap) {
    expandRange(gap.dataset.gap, Number(gap.dataset.from), Number(gap.dataset.to));
  } else if (above) {
    const id = above.dataset.above,
      lines = shown(panels.get(id));
    expandRange(id, lines[0] - 20, lines[0] - 1);
  } else if (below) {
    const id = below.dataset.below,
      lines = shown(panels.get(id));
    expandRange(id, lines.at(-1) + 1, lines.at(-1) + 20);
  } else if (select) {
    const panel = panels.get(select.dataset.select);
    const fn =
      panel.members.find((fn) => fn.id === report.entry) || panel.members[0];
    pinnedLine = { file: panel.file, line: fn.start };
    hoveredLine = null;
    applyFocus();

  }
  if (!e.target.closest(".chat")) activateChat(null);
});
$("minus").onclick = () => zoom(1 / 1.2);
$("plus").onclick = () => zoom(1.2);
$("fit").onclick = fit;
$("info-button").onclick = () => {
  $("info").hidden = !$("info").hidden;
};
$("close-info").onclick = () => {
  $("info").hidden = true;
};
$("viewport").addEventListener(
  "wheel",
  (e) => {
    if (e.target.closest(".chat")) return;
    e.preventDefault();
    if (e.shiftKey) {
      tx -= e.deltaX;
      ty -= e.deltaY;
      transform();
    } else {
      const b = bounds();
      zoom(Math.exp(-e.deltaY * 0.002), e.clientX - b.left, e.clientY - b.top);
    }
  },
  { passive: false },
);
$("viewport").addEventListener("pointerdown", (e) => {
  if (
    e.target.closest(".node,.overview,.welcome,.chat,.folder-label") ||
    e.button !== 0
  )
    return;
  drag = { x: e.clientX, y: e.clientY, tx, ty };
  $("viewport").setPointerCapture?.(e.pointerId);
  $("viewport").classList.add("dragging");
});
$("viewport").addEventListener("pointermove", (e) => {
  if (!drag) return;
  tx = drag.tx + e.clientX - drag.x;
  ty = drag.ty + e.clientY - drag.y;
  transform();
});
function endDrag() {
  drag = null;
  $("viewport").classList.remove("dragging");
}
$("viewport").addEventListener("pointerup", endDrag);
$("viewport").addEventListener("pointercancel", endDrag);
$("viewport").addEventListener("keydown", (e) => {
  if (e.target !== $("viewport")) return;
  if (e.key === "+" || e.key === "=") zoom(1.2);
  else if (e.key === "-") zoom(1 / 1.2);
  else if (e.key === "0") fit();
  else if (e.key.startsWith("Arrow")) {
    tx += e.key === "ArrowLeft" ? 40 : e.key === "ArrowRight" ? -40 : 0;
    ty += e.key === "ArrowUp" ? 40 : e.key === "ArrowDown" ? -40 : 0;
    transform();
  } else return;
  e.preventDefault();
});
restoreChats();
initializeOverviewChat();
new ResizeObserver(() => layout()).observe($("trace-overview"));
new ResizeObserver(() => {
  layout();
  fit();
}).observe($("viewport"));
render();
fit();
