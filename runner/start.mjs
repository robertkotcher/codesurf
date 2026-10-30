// Start the application's server independently of the agent's process group.
import { spawn } from "node:child_process";
import { open } from "node:fs/promises";
const command = process.argv.slice(2).join(" ");
if (!command) throw new Error("Pass the server start command.");
const log = await open("/artifacts/server.log", "a");
const child = spawn("bash", ["-lc", command], {
  cwd: process.cwd(),
  detached: true,
  stdio: ["ignore", log.fd, log.fd],
});
await log.close();
child.unref();
console.log(
  JSON.stringify({ pid: child.pid, log: "/artifacts/server.log", command }),
);
