import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import net from "node:net";
const exec = promisify(execFile);
export const cloudEnabled = () => process.env.CODESURF_RUNTIME === "gce";
const project = () => process.env.CODESURF_GCP_PROJECT;
const zone = () => process.env.CODESURF_GCP_ZONE || "us-central1-a";
const key = () => process.env.CODESURF_SSH_KEY;
const gcloud = (args, options = {}) =>
  exec("gcloud", [...args, "--project=" + project(), "--quiet"], {
    timeout: 120000,
    maxBuffer: 2e6,
    ...options,
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const shellQuote = (value) =>
  "'" + String(value).replaceAll("'", "'\\''") + "'";
export function dockerCommand(state, args) {
  if (!state.worker) return ["docker", args];
  return [
    "ssh",
    [...sshArgs(state), "docker " + args.map(shellQuote).join(" ")],
  ];
}
export const runDocker = (state, args, options = {}) => {
  const [command, argv] = dockerCommand(state, args);
  return exec(command, argv, { timeout: 30000, maxBuffer: 2e6, ...options });
};
export const spawnDocker = (state, args, options) => {
  const [command, argv] = dockerCommand(state, args);
  return spawn(command, argv, options);
};
function sshArgs(state) {
  return [
    "-i",
    key(),
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=8",
    "-o",
    "ServerAliveInterval=10",
    "-o",
    "ServerAliveCountMax=3",
    "-o",
    "StrictHostKeyChecking=yes",
    "-o",
    "UserKnownHostsFile=" + state.worker.knownHosts,
    "-o",
    "HostKeyAlias=" + state.worker.name,
    "codesurf@" + state.worker.ip,
  ];
}
export async function cloudStatus() {
  try {
    if (!project() || !process.env.CODESURF_GCP_IMAGE || !key()) throw Error();
    await access(key());
    return { available: true, ready: true };
  } catch {
    return {
      available: false,
      ready: false,
      message: "The cloud runner is not configured.",
    };
  }
}
export async function provisionWorker(state, directory, persist) {
  const name = "codesurf-" + state.run.id;
  state.worker = {
    name,
    ip: null,
    knownHosts: path.join(directory, "ssh-known-hosts"),
  };
  state.run.worker = { name, zone: zone() };
  await persist();
  const publicKey = (await readFile(key() + ".pub", "utf8")).trim();
  const metadata = path.join(directory, "worker-ssh.pub");
  await writeFile(metadata, "codesurf:" + publicKey, { mode: 0o600 });
  const result = await gcloud([
    "compute",
    "instances",
    "create",
    name,
    "--zone=" + zone(),
    "--machine-type=e2-standard-2",
    "--max-run-duration=30m",
    "--instance-termination-action=DELETE",
    "--no-restart-on-failure",
    "--subnet=" + (process.env.CODESURF_GCP_SUBNET || "codesurf-us"),
    "--tags=codesurf-worker",
    "--no-service-account",
    "--no-scopes",
    "--boot-disk-size=30GB",
    "--image=" + process.env.CODESURF_GCP_IMAGE,
    "--metadata=block-project-ssh-keys=TRUE,enable-guest-attributes=TRUE",
    "--metadata-from-file=ssh-keys=" +
      metadata +
      ",startup-script=" +
      path.resolve("infra/worker-startup.sh"),
    "--labels=codesurf-role=worker",
    "--format=json",
  ]);
  state.worker.ip = JSON.parse(result.stdout)[0].networkInterfaces[0].networkIP;
  for (let i = 0; i < 75; i++) {
    if (state.stopped) throw Error("Run stopped.");
    try {
      const output = await gcloud(
        [
          "compute",
          "instances",
          "get-guest-attributes",
          name,
          "--zone=" + zone(),
          "--query-path=codesurf/hostkey",
          "--format=json",
        ],
        { timeout: 15000 },
      );
      const data = JSON.parse(output.stdout);
      const rows = Array.isArray(data) ? data : data.queryValue?.items || [];
      const hostKey = rows.find((row) => row.key === "hostkey")?.value;
      if (!/^ssh-ed25519 [A-Za-z0-9+/=]+/.test(hostKey || ""))
        throw Error("Waiting for host key");
      await writeFile(
        state.worker.knownHosts,
        name + " " + hostKey.trim() + "\n",
        { mode: 0o600 },
      );
      await runDocker(state, ["info", "--format", "{{.ServerVersion}}"]);
      return;
    } catch {
      await sleep(2000);
    }
  }
  throw Error("The cloud workspace did not start.");
}
export async function connectWorker(state, remotePort, proxyPort) {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const localPort = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  const args = sshArgs(state);
  const destination = args.pop();
  const tunnel = spawn(
    "ssh",
    [
      ...args,
      "-N",
      "-o",
      "ExitOnForwardFailure=yes",
      "-L",
      `127.0.0.1:${localPort}:127.0.0.1:${remotePort}`,
      "-R",
      `0.0.0.0:4780:127.0.0.1:${proxyPort}`,
      destination,
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  state.tunnel = tunnel;
  let error = "";
  tunnel.stderr.on("data", (data) => {
    error = (error + data).slice(-2000);
  });
  await new Promise((resolve, reject) => {
    tunnel.once("error", reject);
    setTimeout(resolve, 1000);
  });
  if (tunnel.exitCode !== null)
    throw Error("Workspace connection failed: " + error);
  return localPort;
}
export async function deleteWorker(worker) {
  if (worker?.name && /^codesurf-[a-f0-9-]{36}$/.test(worker.name))
    await gcloud(
      [
        "compute",
        "instances",
        "delete",
        worker.name,
        "--zone=" + (worker.zone || zone()),
      ],
      { timeout: 120000 },
    );
}
export async function backupRun(id, directory) {
  if (!process.env.CODESURF_GCS_BUCKET) return;
  await gcloud(
    [
      "storage",
      "rsync",
      directory,
      `gs://${process.env.CODESURF_GCS_BUCKET}/runs/${id}`,
      "--recursive",
    ],
    { timeout: 120000 },
  );
}
// Only called before the controller accepts traffic: all previous workers are orphaned.
export async function recoverCloudWorkers() {
  const { stdout } = await gcloud([
    "compute",
    "instances",
    "list",
    "--filter=labels.codesurf-role=worker",
    "--format=json",
  ]);
  for (const worker of JSON.parse(stdout))
    await deleteWorker({
      name: worker.name,
      zone: worker.zone.split("/").at(-1),
    });
}
