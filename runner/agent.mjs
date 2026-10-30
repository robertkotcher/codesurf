import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
const child = spawn(
  "/opt/codesurf/node_modules/.bin/codex",
  process.argv.slice(2),
  { stdio: "inherit", detached: true },
);
await writeFile("/tmp/codesurf-agent.pid", String(child.pid));
child.on("exit", (code) => process.exit(code ?? 1));
