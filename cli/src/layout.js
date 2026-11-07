/** Folder names and nesting come exclusively from repository-relative paths. */
export function layoutFolders(nodes, sizes, collapsed) {
  const root = { key: "", name: "", depth: -1, children: new Map(), nodes: [] };
  const nodePositions = new Map(),
    hiddenBy = new Map(),
    folders = [];
  for (const node of nodes) {
    let folder = root;
    const parts = node.file
      .replaceAll("\\", "/")
      .split("/")
      .filter(Boolean)
      .slice(0, -1);
    parts.forEach((name, depth) => {
      const key = parts.slice(0, depth + 1).join("/");
      if (!folder.children.has(name))
        folder.children.set(name, {
          key,
          name,
          depth,
          children: new Map(),
          nodes: [],
        });
      folder = folder.children.get(name);
    });
    folder.nodes.push(node);
  }
  const levels = [...new Set(nodes.map((n) => n.level || 0))].sort(
      (a, b) => a - b,
    ),
    xs = new Map();
  let x = 110;
  for (const level of levels) {
    xs.set(level, x);
    x +=
      Math.max(
        340,
        ...nodes
          .filter((n) => (n.level || 0) === level)
          .map((n) => sizes.get(n.id)?.width || 340),
      ) + 150;
  }
  function descendants(folder) {
    return [
      ...folder.nodes,
      ...[...folder.children.values()].flatMap(descendants),
    ];
  }
  function place(folder, top) {
    const members = descendants(folder);
    if (folder.key && collapsed.has(folder.key)) {
      const box = {
        ...folder,
        x: Math.min(...members.map((n) => xs.get(n.level || 0))) - 18,
        y: top,
        width: 250,
        height: 64,
        collapsed: true,
        count: members.length,
      };
      folders.push(box);
      for (const n of members) hiddenBy.set(n.id, folder.key);
      return box;
    }
    let y = top + (folder.key ? 40 : 0);
    const bounds = [];
    const columns = new Map();
    for (const n of folder.nodes) {
      const level = n.level || 0;
      if (!columns.has(level)) columns.set(level, []);
      columns.get(level).push(n);
    }
    let bottom = y;
    for (const [level, list] of columns) {
      let row = y;
      for (const n of list) {
        const size = sizes.get(n.id) || { width: 340, height: 280 };
        const p = { x: xs.get(level), y: row, ...size };
        nodePositions.set(n.id, p);
        bounds.push(p);
        row += p.height + 24;
      }
      bottom = Math.max(bottom, row - 24);
    }
    if (folder.nodes.length) y = bottom + 24;
    const children = [...folder.children.values()].sort(
      (a, b) =>
        Math.min(...descendants(a).map((n) => n.level || 0)) -
          Math.min(...descendants(b).map((n) => n.level || 0)) ||
        a.key.localeCompare(b.key),
    );
    for (const child of children) {
      const firstFolder = folders.length;
      const childMembers = descendants(child);
      const box = place(child, top + (folder.key ? 40 : 0));
      let targetY = box.y;
      for (const occupied of bounds) {
        const overlapsX = box.x < occupied.x + occupied.width + 24 &&
          box.x + box.width + 24 > occupied.x;
        if (overlapsX) targetY = Math.max(targetY, occupied.y + occupied.height + 24);
      }
      const delta = targetY - box.y;
      if (delta) {
        for (const member of childMembers) {
          const position = nodePositions.get(member.id);
          if (position) position.y += delta;
        }
        for (const region of folders.slice(firstFolder)) region.y += delta;
      }
      bounds.push(box);
    }
    if (!bounds.length) return { x: 0, y: top, width: 0, height: 0 };
    const left = Math.min(...bounds.map((b) => b.x)) - (folder.key ? 18 : 0),
      right =
        Math.max(...bounds.map((b) => b.x + b.width)) + (folder.key ? 18 : 0);
    const box = {
      ...folder,
      x: left,
      y: top,
      width: right - left,
      height:
        Math.max(...bounds.map((b) => b.y + b.height)) -
        top +
        (folder.key ? 16 : 0),
      collapsed: false,
      count: members.length,
    };
    if (folder.key) folders.push(box);
    return box;
  }
  const box = place(root, 30);
  const offset = Math.max(0, 24 - box.x);
  for (const position of nodePositions.values()) position.x += offset;
  for (const folder of folders) folder.x += offset;
  return {
    nodePositions,
    hiddenBy,
    folders: folders.sort((a, b) => a.depth - b.depth),
    width: Math.max(400, box.x + offset + box.width + 50),
    height: Math.max(250, box.y + box.height + 50),
  };
}
