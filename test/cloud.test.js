import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dockerCommand, shellQuote } from "../cloud.js";
test("remote Docker arguments cannot execute shell substitutions or escape quoting", () => {
  const payload = "a'$(printf INJECTED); `printf INJECTED`\n";
  assert.equal(
    shellQuote(payload),
    "'a'\\''$(printf INJECTED); `printf INJECTED`\n'",
  );
  const [command, args] = dockerCommand(
    {
      worker: {
        name: "codesurf-test",
        ip: "10.80.0.4",
        knownHosts: "/tmp/hosts",
      },
    },
    ["exec", "container", "echo", payload],
  );
  assert.equal(
    execFileSync("/bin/sh", ["-c", "printf %s " + shellQuote(payload)], {
      encoding: "utf8",
    }),
    payload,
  );
  assert.equal(command, "ssh");
  assert.ok(args.includes("StrictHostKeyChecking=yes"));
  assert.equal(
    args.at(-1),
    "docker 'exec' 'container' 'echo' " + shellQuote(payload),
  );
  assert.deepEqual(dockerCommand({}, ["info"]), ["docker", ["info"]]);
});
