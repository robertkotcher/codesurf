const { app, BrowserWindow, shell, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { spawn } = require("node:child_process");

app.setName("CodeSurf");
// Retain local question histories from the original desktop app profile.
const legacyProfile = path.join(app.getPath("appData"), "CodeTrail");
if (fs.existsSync(legacyProfile)) app.setPath("userData", legacyProfile);
app.whenReady().then(() => {
  const report = process.argv[2];
  if (!report || !path.isAbsolute(report)) {
    app.quit();
    return;
  }
  let snapshot = JSON.parse(
    fs.readFileSync(report.replace(/\.html$/, "") + ".json", "utf8"),
  );
  let investigation = null;
  const explanations = new Set();
  const window = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 580,
    minHeight: 420,
    title: "CodeSurf",
    backgroundColor: "#ffffff",
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });
  // Only explicit editor links leave this local, sandboxed report window.
  window.webContents.on("will-navigate", (event, url) => {
    event.preventDefault();
    if (url.startsWith("vscode://file/") || url.startsWith("https://"))
      shell.openExternal(url);
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  ipcMain.handle("trace", async (event, question) => {
    if (
      event.sender !== window.webContents ||
      typeof question !== "string" ||
      !question.trim() ||
      question.length > 8000
    )
      throw new Error("Supply a scenario of 1–8000 characters.");
    if (investigation) throw new Error("An investigation is already running.");
    const destination = path.join(
      os.homedir(),
      ".codesurf",
      "reports",
      `trace-${Date.now()}.html`,
    );
    const args = [path.join(__dirname, "cli.js"), snapshot.roots[0], question];
    for (const root of snapshot.roots.slice(1)) args.push("--repo", root);
    if (Number.isInteger(snapshot.limit))
      args.push("--limit", String(snapshot.limit));
    args.push("--no-open", "--out", destination);
    await new Promise((resolve, reject) => {
      investigation = spawn(process.execPath, args, {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let errors = "";
      investigation.stdout.on("data", (data) => {
        if (!window.isDestroyed())
          window.webContents.send("trace-progress", data.toString().trim());
      });
      investigation.stderr.on("data", (data) => {
        errors = (errors + data).slice(-3000);
      });
      investigation.on("error", (error) => {
        investigation = null;
        reject(error);
      });
      investigation.on("close", (code) => {
        investigation = null;
        code === 0
          ? resolve()
          : reject(
              new Error(errors.trim() || `Investigation exited with ${code}`),
            );
      });
    });
    if (!window.isDestroyed()) {
      snapshot = JSON.parse(
        fs.readFileSync(destination.replace(/\.html$/, "") + ".json", "utf8"),
      );
      await window.loadFile(destination);
    }
  });
  ipcMain.handle("inspect-token", async (event, selection) => {
    if (
      event.sender !== window.webContents ||
      !selection ||
      typeof selection.requestId !== "string" ||
      selection.requestId.length > 120 ||
      typeof selection.question !== "string" ||
      !selection.question.trim() ||
      selection.question.length > 4000 ||
      explanations.size >= 4
    )
      throw new Error(
        "Supply a token question; at most four explanations can run at once.",
      );
    const node =
      snapshot.nodes.find((n) => n.id === selection.nodeId) ||
      snapshot.definitions.find((n) => n.id === selection.nodeId) ||
      snapshot.symbolDefinitions?.[selection.nodeId];
    if (
      !node ||
      !Number.isInteger(selection.line) ||
      !Number.isInteger(selection.column) ||
      selection.column < 0 ||
      typeof selection.text !== "string" ||
      !selection.text ||
      selection.text.length > 1000
    )
      throw new Error("Invalid source selection.");
    const lines =
      snapshot.sources[node.file] ||
      Array(node.start - 1)
        .fill("")
        .concat(node.lines);
    if (
      lines[selection.line - 1]?.slice(
        selection.column,
        selection.column + selection.text.length,
      ) !== selection.text
    )
      throw new Error("Selected token does not match the source snapshot.");
    const ref = snapshot.symbolRefs?.[node.file]?.find(
      (r) => r.line === selection.line && r.column === selection.column,
    );
    const declaration =
      ref &&
      (snapshot.symbolDefinitions?.[ref.target] ||
        snapshot.definitions.find((n) => n.id === ref.target));
    const context = {
      roots: snapshot.roots,
      history: Array.isArray(selection.history)
        ? selection.history
            .slice(-10)
            .filter(
              (m) =>
                ["user", "assistant"].includes(m.role) &&
                typeof m.text === "string",
            )
            .map((m) => ({ role: m.role, text: m.text.slice(0, 12000) }))
        : [],
      question: selection.question,
      selection: {
        token: selection.text,
        file: node.file,
        line: selection.line,
        module: ref?.module || node.originModule || "",
        scenario: snapshot.question,
        declaration,
        source: lines
          .slice(Math.max(0, selection.line - 6), selection.line + 5)
          .map((text, i) => `${Math.max(1, selection.line - 5) + i}: ${text}`)
          .join("\n"),
      },
    };
    return await new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [path.join(__dirname, "inspect.js")],
        {
          env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      explanations.add(child);
      let output = "",
        result = null,
        errors = "";
      child.stdout.on("data", (data) => {
        output += data;
        let end;
        while ((end = output.indexOf("\n")) >= 0) {
          const line = output.slice(0, end);
          output = output.slice(end + 1);
          try {
            const update = JSON.parse(line);
            if (update.type === "done")
              result = { answer: update.answer, sources: [], caveats: [] };
            if (!window.isDestroyed())
              window.webContents.send("inspect-progress", {
                ...update,
                requestId: selection.requestId,
              });
          } catch {}
        }
      });
      child.stderr.on("data", (data) => {
        errors = (errors + data).slice(-3000);
      });
      child.on("error", (error) => {
        explanations.delete(child);
        reject(error);
      });
      child.on("close", (code) => {
        explanations.delete(child);
        if (code !== 0) {
          reject(new Error(errors || `Explanation exited with ${code}`));
          return;
        }
        try {
          if (!result) throw new Error("Missing final answer");
          resolve(result);
        } catch {
          reject(new Error("Invalid explanation output."));
        }
      });
      child.stdin.on("error", () => {});
      child.stdin.end(JSON.stringify(context));
    });
  });
  window.on("closed", () => {
    investigation?.kill();
    for (const child of explanations) child.kill();
  });
  window.loadFile(report);
});
app.on("window-all-closed", () => app.quit());
