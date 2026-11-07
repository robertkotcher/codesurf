import fs from "node:fs";
import path from "node:path";
import {createRequire} from "node:module";
const require = createRequire(import.meta.url);

export function writeReport(report, destination) {
  // Catalogs are investigation data, not viewer payloads. Keep source for visible files
  // and definitions referenced by their tokens, preserving navigation without all roots.
  const visibleFiles = new Set(report.nodes.map(n=>n.file));
  const refs = Object.fromEntries(Object.entries(report.symbolRefs || {}).filter(([file])=>visibleFiles.has(file)));
  const targets = new Set(Object.values(refs).flat().map(ref=>ref.target));
  report = {...report,
    sources:Object.fromEntries(Object.entries(report.sources || {}).filter(([file])=>visibleFiles.has(file))),
    definitions:(report.definitions || report.nodes).filter(n=>visibleFiles.has(n.file) || targets.has(n.id)),
    symbolRefs:refs,
    symbolDefinitions:Object.fromEntries(Object.entries(report.symbolDefinitions || {}).filter(([id])=>targets.has(id))),
  };
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const template = fs.readFileSync(
    new URL("./viewer.html", import.meta.url),
    "utf8",
  );
  let viewer = fs.readFileSync(new URL("./viewer.js", import.meta.url), "utf8");
  const markdown = fs.readFileSync(path.join(path.dirname(require.resolve("markdown-it/package.json")),"dist/browser/markdown-it.umd.min.js"),"utf8").replaceAll("</script", "<\\/script");
  viewer = markdown + "\n" + viewer;
  viewer = viewer.replace("/*__CHATS__*/", () =>
    fs.readFileSync(new URL("./chats.js", import.meta.url), "utf8"),
  );
  const layout = fs
    .readFileSync(new URL("./layout.js", import.meta.url), "utf8")
    .replaceAll("export function ", "function ");
  const graph = fs
    .readFileSync(new URL("./graph.js", import.meta.url), "utf8")
    .replaceAll("export function ", "function ");
  // Repository text must remain inert inside the inline JSON script.
  const serialized = JSON.stringify(report)
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
  fs.writeFileSync(
    destination,
    template
      .replace("/*__VIEWER__*/", () => graph + "\n" + layout + "\n" + viewer)
      .replace(/\/\*__REPORT__\*\/\s*null/, () => serialized),
  );
  fs.writeFileSync(
    destination.replace(/\.html$/, "") + ".json",
    JSON.stringify(report, null, 2),
  );
}
