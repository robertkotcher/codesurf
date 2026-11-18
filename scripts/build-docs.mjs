import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const configPath = path.join(root, "vercel.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const policy = config.headers
  .flatMap((rule) => rule.headers)
  .find((header) => header.key.toLowerCase() === "content-security-policy");
function hashes(tag) {
  return [
    ...html.matchAll(
      new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi"),
    ),
  ]
    .filter((match) => match[1].trim())
    .map(
      (match) =>
        `'sha256-${crypto.createHash("sha256").update(match[1]).digest("base64")}'`,
    );
}
const scripts = hashes("script"),
  styles = hashes("style");
if (process.argv.includes("--update-csp")) {
  const directives = policy.value
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  policy.value = directives
    .map((d) => {
      if (!/^script-src |^style-src /.test(d)) return d;
      const clean = d.replace(/\s*'sha256-[^']+'/g, "");
      return (
        clean + " " + (d.startsWith("script-src ") ? scripts : styles).join(" ")
      );
    })
    .join("; ");
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
}
for (const hash of [...scripts, ...styles])
  if (!policy.value.includes(hash))
    throw new Error(
      "Documentation changed: run node scripts/build-docs.mjs --update-csp before committing.",
    );
if (/\sstyle\s*=/.test(html))
  throw new Error("Use the hashed style block, not inline style attributes.");

// Package the CLI so agents can install it from the site:
//   npm install -g https://codesurf.io/downloads/codesurf-latest.tgz
const output = path.join(root, "public/downloads");
fs.mkdirSync(output, { recursive: true });
const [release] = JSON.parse(
  execFileSync("npm", ["pack", "--json", "--pack-destination", output], {
    cwd: path.join(root, "cli"),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }),
);
for (const file of release.files)
  if (
    !/^(src\/|viewer\/|skill\/|examples\/|README\.md$|LICENSE$|package\.json$)/.test(file.path) ||
    /(^|\/)(node_modules|\.env|__pycache__)(\/|$)|\.pyc$/.test(file.path)
  )
    throw new Error("Unexpected file in the CLI package: " + file.path);
const archive = path.join(output, release.filename);
const sha = crypto.createHash("sha256").update(fs.readFileSync(archive)).digest("hex");
fs.copyFileSync(archive, path.join(output, "codesurf-latest.tgz"));
fs.writeFileSync(archive + ".sha256", `${sha}  ${release.filename}\n`);
fs.writeFileSync(path.join(output, "codesurf-latest.tgz.sha256"), `${sha}  codesurf-latest.tgz\n`);
fs.writeFileSync(
  path.join(output, "latest.json"),
  JSON.stringify({ version: release.version, url: `https://codesurf.io/downloads/${release.filename}`, sha256: sha }, null, 2) + "\n",
);
// The tour format on the site is the one shipped with the CLI.
fs.copyFileSync(path.join(root, "cli/skill/tour-format.md"), path.join(root, "public/tour-format.txt"));
console.log(`Packaged ${release.filename}: ${release.files.length} files, ${release.size} bytes, sha256 ${sha.slice(0, 12)}…`);
