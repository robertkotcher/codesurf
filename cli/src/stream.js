import { spawn } from "node:child_process";

/** Only user-facing answer deltas and brief tool activity leave this adapter. */
export async function streamAnswer({
  root,
  prompt,
  onEvent = () => {},
  executable = process.env.CODESURF_CODEX || process.env.CODETRAIL_CODEX || "codex",
  timeout = 180000,
}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(executable, ["app-server", "--stdio"], {
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    const pending = new Map(),
      items = new Map();
    let sequence = 0,
      buffer = "",
      errors = "",
      finished = false,
      answer = "";
    function stop() {
      try {
        process.platform === "win32"
          ? child.kill()
          : process.kill(-child.pid, "SIGTERM");
      } catch {}
    }
    function finish(error) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      process.removeListener("SIGTERM", cancel);
      for (const p of pending.values())
        p.reject(new Error("Agent connection closed"));
      pending.clear();
      stop();
      error ? reject(error) : resolve({ answer, sources: [], caveats: [] });
    }
    function cancel() {
      finish(new Error("Question cancelled."));
    }
    process.once("SIGTERM", cancel);
    const timer = setTimeout(
      () =>
        finish(new Error("Question timed out. Try a more specific question.")),
      timeout,
    );
    function send(message) {
      if (!finished) child.stdin.write(JSON.stringify(message) + "\n");
    }
    function rpc(method, params) {
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        pending.set(id, { resolve, reject });
        send({ id, method, params });
      });
    }
    function notification(method, p) {
      if (method === "item/started") {
        const item = p.item;
        items.set(item.id, { ...item, text: item.text || "" });
        if (item.type === "commandExecution")
          onEvent({ type: "progress", message: "Reading repository source…" });
        if (item.type === "webSearch")
          onEvent({
            type: "progress",
            message:
              item.action?.type === "openPage"
                ? "Reading a web reference…"
                : "Searching the web…",
          });
      } else if (method === "item/agentMessage/delta") {
        const item = items.get(p.itemId) || {
          id: p.itemId,
          type: "agentMessage",
          text: "",
        };
        item.text += p.delta;
        items.set(p.itemId, item);
        if (item.phase !== "commentary") {
          answer += p.delta;
          onEvent({ type: "delta", text: p.delta });
        }
      } else if (method === "item/completed") {
        const item = p.item;
        items.set(item.id, item);
        if (item.type === "agentMessage" && item.phase === "commentary")
          onEvent({ type: "progress", message: item.text.slice(0, 220) });
      } else if (method === "turn/completed") {
        if (p.turn.status !== "completed") {
          finish(
            new Error(
              p.turn.error?.message || "Agent request did not complete.",
            ),
          );
          return;
        }
        const completed = [...items.values()]
          .filter(
            (i) =>
              i.type === "agentMessage" && i.phase !== "commentary" && i.text,
          )
          .map((i) => i.text);
        if (completed.length) answer = completed.join("\n\n");
        finish();
      } else if (method === "error" && !p.willRetry) {
        finish(new Error(p.error?.message || "Agent error"));
      }
    }
    child.stdout.on("data", (data) => {
      buffer += data;
      let end;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (message.id !== undefined && !message.method) {
          const p = pending.get(message.id);
          if (p) {
            pending.delete(message.id);
            message.error
              ? p.reject(new Error(message.error.message))
              : p.resolve(message.result);
          }
        } else if (message.id !== undefined && message.method) {
          send({
            id: message.id,
            error: {
              code: -32601,
              message:
                "Interactive requests are unavailable in read-only CodeSurf questions.",
            },
          });
        } else if (message.method)
          notification(message.method, message.params || {});
      }
    });
    child.stderr.on("data", (data) => {
      errors = (errors + data).slice(-2000);
    });
    child.stdin.on("error", () => {});
    child.on("error", (error) => finish(error));
    child.on("close", (code) => {
      if (!finished)
        finish(
          new Error(`Agent connection ended (${code}): ${errors.slice(-700)}`),
        );
    });
    (async () => {
      onEvent({ type: "progress", message: "Connecting to the agent…" });
      await rpc("initialize", {
        clientInfo: { name: "codesurf", title: "CodeSurf", version: "0.1.0" },
        capabilities: {
          experimentalApi: true,
          optOutNotificationMethods: [
            "item/reasoning/summaryTextDelta",
            "item/reasoning/textDelta",
            "item/commandExecution/outputDelta",
          ],
        },
      });
      send({ method: "initialized", params: {} });
      const started = await rpc("thread/start", {
        cwd: root,
        sandbox: "read-only",
        approvalPolicy: "never",
        ephemeral: true,
        config: { web_search: "live" },
        developerInstructions:
          "Answer code-token questions concisely. You may read repository source and search/read the web. Do not modify files, run the application, or use external messaging/account tools. Give brief progress updates when using tools. Never expose private internal reasoning.",
      });
      onEvent({ type: "progress", message: "Inspecting the selected code…" });
      await rpc("turn/start", {
        threadId: started.thread.id,
        input: [{ type: "text", text: prompt }],
        effort: "low",
        summary: "none",
      });
    })().catch(finish);
  });
}
