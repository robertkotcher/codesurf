/** Keep execution relationships at function granularity while displaying one card per file. */
export function buildFileGraph(functions, sources = {}) {
  const byFunction = new Map(functions.map((fn) => [fn.id, fn]));
  const panels = new Map(),
    panelForFunction = new Map(),
    edges = [];
  for (const fn of functions) {
    const id = "file:" + fn.file;
    let panel = panels.get(id);
    if (!panel) {
      panel = {
        id,
        file: fn.file,
        absolute: fn.absolute,
        name: fn.file.split("/").at(-1),
        level: fn.level || 0,
        start: fn.start,
        end: fn.end,
        members: [],
        changed: [],
        calls: [],
      };
      panels.set(id, panel);
    }
    panel.members.push(fn);
    panel.start = Math.min(panel.start, fn.start);
    panel.end = Math.max(panel.end, fn.end);
    panel.level = Math.min(panel.level, fn.level || 0);
    panel.changed.push(...fn.changed);
    panel.calls.push(...fn.calls);
    panelForFunction.set(fn.id, id);
  }
  for (const panel of panels.values()) {
    panel.members.sort((a, b) => a.start - b.start);
    panel.changed = [...new Set(panel.changed)];
    let lines = sources[panel.file];
    if (!lines) {
      lines = Array(panel.end).fill("");
      for (const fn of panel.members)
        fn.lines.forEach((line, i) => {
          lines[fn.start - 1 + i] = line;
        });
    }
    panel.lines = lines.slice(panel.start - 1, panel.end);
  }
  for (const fn of functions)
    for (const call of fn.calls) {
      if (call.excluded || !byFunction.has(call.target)) continue;
      edges.push({
        ...call,
        id: `${fn.id}:${call.line}:${call.column || 0}:${call.target}`,
        from: fn.id,
        to: call.target,
      });
    }
  return { functions: byFunction, panels, panelForFunction, edges };
}

/** Follow ancestors to the chosen function, then only the chosen call's descendants. */
export function pathFocus(graph, selection) {
  if (!selection) return null;
  const panel = [...graph.panels.values()].find(
    (p) => p.file === selection.file,
  );
  const owner = panel?.members
    .filter((fn) => selection.line >= fn.start && selection.line <= fn.end)
    .sort((a, b) => a.end - a.start - (b.end - b.start))[0];
  const functions = new Set(),
    edgeIds = new Set();
  if (!owner) return { selection, functions, edgeIds };
  functions.add(owner.id);
  const visited = new Set(),
    queue = [owner.id];
  while (queue.length) {
    const id = queue.shift();
    if (visited.has(id)) continue;
    visited.add(id);
    for (const edge of graph.edges.filter((e) => e.to === id)) {
      edgeIds.add(edge.id);
      functions.add(edge.from);
      queue.push(edge.from);
    }
  }
  const calls = graph.edges.filter(
    (e) => e.from === owner.id && e.line === selection.line,
  );
  const seeds = calls.length
    ? calls
    : graph.edges.filter((e) => e.from === owner.id);
  const descendants = [];
  for (const edge of seeds) {
    edgeIds.add(edge.id);
    functions.add(edge.to);
    descendants.push(edge.to);
  }
  const seen = new Set();
  while (descendants.length) {
    const id = descendants.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    for (const edge of graph.edges.filter((e) => e.from === id)) {
      edgeIds.add(edge.id);
      functions.add(edge.to);
      descendants.push(edge.to);
    }
  }
  return { selection, functions, edgeIds };
}

export function lineOnPath(graph, focus, file, line) {
  if (!focus) return true;
  if (focus.selection.file === file && focus.selection.line === line)
    return true;
  const owner = [...graph.functions.values()]
    .filter((fn) => fn.file === file && line >= fn.start && line <= fn.end)
    .sort((a, b) => a.end - a.start - (b.end - b.start))[0];
  if (!owner || !focus.functions.has(owner.id)) return false;
  const outgoing = graph.edges.filter(
    (e) => e.from === owner.id && e.line === line,
  );
  if (outgoing.length) return outgoing.some((e) => focus.edgeIds.has(e.id));
  if (
    owner.calls.some((c) => c.line === line) &&
    owner.calls.filter((c) => c.line === line).every((c) => c.excluded)
  )
    return false;
  return true;
}
