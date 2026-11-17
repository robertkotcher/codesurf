import fs from "node:fs";
import path from "node:path";
import { validateTour, VERSION } from "./validate.js";
import { viewer, example } from "./embedded.js";

const help = `CodeSurf ${VERSION}
Create an offline code tour with the official viewer. Node.js 20.19+.

  node codesurf.mjs tour.json --out tour.html
  node codesurf.mjs tour.json --validate
  node codesurf.mjs --example > tour.json
  node codesurf.mjs --version

Inputs are read locally. The generated HTML embeds the source and viewer.
Existing output files require --force. Tour JSON is limited to 10 MB.
`;
try {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    process.stdout.write(help);
  } else if (args.length === 1 && args[0] === "--version") {
    console.log(VERSION);
  } else if (args.length === 1 && args[0] === "--example") {
    process.stdout.write(JSON.stringify(example, null, 2) + "\n");
  } else {
    const input = args.shift();
    if (!input || input.startsWith("--")) throw new Error("Provide a tour JSON file. Use --help for usage.");
    let output;
    let validateOnly = false;
    let force = false;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--out" && args[i + 1] && !args[i + 1].startsWith("--")) output = args[++i];
      else if (args[i] === "--validate") validateOnly = true;
      else if (args[i] === "--force") force = true;
      else throw new Error("Unknown or incomplete option: " + args[i]);
    }
    if (!output && !validateOnly) throw new Error("Provide --out tour.html or --validate.");
    const inputPath = path.resolve(input);
    if (fs.statSync(inputPath).size > 10 * 1024 * 1024) throw new Error("Tour exceeds the 10 MB limit.");
    const tour = validateTour(JSON.parse(fs.readFileSync(inputPath, "utf8")));
    if (output) {
      if (!/\.html$/i.test(output)) throw new Error("Output must have an .html extension.");
      if (path.resolve(output) === inputPath) throw new Error("Input and output must be different files.");
      const json = JSON.stringify(tour).replaceAll("<", "\\u003c").replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029");
      const html = viewer.replace('<script id="tour-data" type="application/json">null</script>',
        () => '<script id="tour-data" type="application/json">' + json + "</script>");
      fs.writeFileSync(output, html, { flag: force ? "w" : "wx", mode: 0o600 });
      fs.chmodSync(output, 0o600);
      console.log("Created " + path.resolve(output) + " · " + Buffer.byteLength(html) + " bytes");
    } else console.log("Valid CodeSurf tour · " + tour.steps.length + " steps");
  }
} catch (error) {
  console.error("CodeSurf: " + error.message);
  process.exitCode = 1;
}
