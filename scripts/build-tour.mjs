import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { build } from "esbuild";
import Ajv from "ajv";
import standaloneCode from "ajv/dist/standalone/index.js";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "codesurf-viewer-build-"));
try {
  execFileSync(process.execPath, [path.join(root, "tour/create-demo.mjs")]);
  const schema = JSON.parse(fs.readFileSync(path.join(root, "tour/schema.json"), "utf8"));
  const ajv = new Ajv({ allErrors: true, strict: true, code: { source: true, esm: false } });
  const compiled = ajv.compile(schema);
  fs.mkdirSync(path.join(root, "tour/.generated"), { recursive: true });
  fs.writeFileSync(path.join(root, "tour/.generated/schema-validator.cjs"), standaloneCode(ajv, compiled));
  const { validateTour, VERSION } = await import("../tour/validate.js");
  const example = validateTour(JSON.parse(fs.readFileSync(path.join(root, "tour/example.json"), "utf8")));
  const output = path.join(root, "public/releases", VERSION);
  fs.mkdirSync(output, { recursive: true });
  await build({
    absWorkingDir: root, entryPoints: ["tour/viewer.js"], bundle: true,
    format: "iife", platform: "browser", target: "es2020",
    outfile: path.join(temporary, "viewer.js"), minify: true,
  });
  const js = fs.readFileSync(path.join(temporary, "viewer.js"), "utf8").replaceAll("</script", "<\\/script");
  const fonts = [
    ["inter", "CodeSurf Sans"],
    ["ibm-plex-mono", "CodeSurf Mono"],
  ];
  let fontCSS = "";
  let licenses = "";
  for (const [name, family] of fonts) {
    licenses += name + "\n" + fs.readFileSync(path.join(root, "node_modules/@fontsource", name, "LICENSE"), "utf8") + "\n\n";
    for (const weight of [400, 600]) {
      const bytes = fs.readFileSync(path.join(root, "node_modules/@fontsource", name, "files", `${name}-latin-${weight}-normal.woff2`));
      fontCSS += `@font-face { font-family: "${family}"; font-style: normal; font-weight: ${weight}; font-display: swap; src: url(data:font/woff2;base64,${bytes.toString("base64")}) format("woff2"); }\n`;
    }
  }
  licenses += "highlight.js\n" + fs.readFileSync(path.join(root, "node_modules/highlight.js/LICENSE"), "utf8") + "\n\najv\n" +
    fs.readFileSync(path.join(root, "node_modules/ajv/LICENSE"), "utf8");
  fs.writeFileSync(path.join(output, "LICENSES.txt"), licenses);
  const css = "/* " + licenses.replaceAll("*/", "* /") + " */\n" + fontCSS + fs.readFileSync(path.join(root, "tour/viewer.css"), "utf8") + "\n" +
    fs.readFileSync(path.join(temporary, "viewer.css"), "utf8");
  const template = fs.readFileSync(path.join(root, "tour/viewer.html"), "utf8");
  const viewer = template.replace("/* VIEWER_CSS */", () => css).replace("/* VIEWER_JS */", () => js);
  fs.writeFileSync(path.join(temporary, "embedded.js"),
    "export const viewer=" + JSON.stringify(viewer) + ";\nexport const example=" + JSON.stringify(example) + ";\n");
  await build({
    absWorkingDir: root, entryPoints: ["tour/packager.js"], bundle: true, platform: "node",
    format: "esm", minify: true, target: "node20", outfile: path.join(output, "codesurf.mjs"),
    plugins: [{ name: "embedded-viewer", setup(builder) {
      builder.onResolve({ filter: /^\.\/embedded\.js$/ }, () => ({ path: path.join(temporary, "embedded.js") }));
    } }],
  });
  fs.copyFileSync(path.join(root, "tour/schema.json"), path.join(output, "tour.schema.json"));
  fs.writeFileSync(path.join(output, "example.json"), JSON.stringify(example, null, 2) + "\n");
  fs.writeFileSync(path.join(root, "public/viewer.html"), viewer);
  execFileSync(process.execPath, [path.join(output, "codesurf.mjs"), path.join(output, "example.json"), "--out", path.join(output, "demo.html"), "--force"]);
  // Every published demo keeps working when a newer renderer is released.
  const configPath = path.join(root, "vercel.json");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const policy = config.headers.flatMap((rule) => rule.headers)
    .find((header) => header.key.toLowerCase() === "content-security-policy");
  const hash = (text) => "'sha256-" + crypto.createHash("sha256").update(text).digest("base64") + "'";
  const scriptHashes = new Set([hash(js)]);
  const styleHashes = new Set([hash(css)]);
  const releases = path.join(root, "public/releases");
  for (const release of fs.readdirSync(releases, { withFileTypes: true })) {
    if (!release.isDirectory()) continue;
    const demoPath = path.join(releases, release.name, "demo.html");
    if (!fs.existsSync(demoPath)) continue;
    const html = fs.readFileSync(demoPath, "utf8");
    for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g))
      scriptHashes.add(hash(match[1]));
    for (const match of html.matchAll(/<style>([\s\S]*?)<\/style>/g))
      styleHashes.add(hash(match[1]));
  }
  if (!/font-src /.test(policy.value)) policy.value += "; font-src 'self' data:";
  policy.value = policy.value.split(";").map((part) => {
    const directive = part.trim();
    if (directive.startsWith("script-src ")) return directive.replace(/\s*'sha256-[^']+'/g, "") + " " + [...scriptHashes].join(" ");
    if (directive.startsWith("style-src ")) return directive.replace(/\s*'sha256-[^']+'/g, "") + " " + [...styleHashes].join(" ");
    return directive;
  }).join("; ");
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  const manifest = { version: VERSION, schemaVersion: 1, files: {} };
  for (const name of ["codesurf.mjs", "tour.schema.json", "example.json", "demo.html", "LICENSES.txt"]) {
    const bytes = fs.readFileSync(path.join(output, name));
    manifest.files[name] = { url: `https://codesurf.io/releases/${VERSION}/${name}`,
      sha256: crypto.createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length };
  }
  fs.writeFileSync(path.join(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log("Built CodeSurf viewer and local packager " + VERSION);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
