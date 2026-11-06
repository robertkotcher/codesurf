import fs from "node:fs";
import path from "node:path";

export function writeReport(report, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const template = fs.readFileSync(
    new URL("./viewer.html", import.meta.url),
    "utf8",
  );
  let viewer = fs.readFileSync(new URL("./viewer.js", import.meta.url), "utf8");
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
