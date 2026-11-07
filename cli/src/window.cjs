const { app, BrowserWindow, WebContentsView, shell, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { spawn } = require("node:child_process");

app.setName("CodeSurf");
// Retain local question histories from the original desktop app profile.
const legacyProfile = path.join(app.getPath("appData"), "CodeTrail");
if (fs.existsSync(legacyProfile)) app.setPath("userData", legacyProfile);
// All invocations share one desktop process and retain each run's renderer state.
const handlers = new Map();
for (const channel of ["trace", "inspect-token", "open-editor"])
  ipcMain.handle(channel, (event, value) => {
    const handler = handlers.get(event.sender.id)?.[channel];
    if (!handler) throw new Error("Unknown run.");
    return handler(event, value);
  });
let host, active, writeReport, serial = 0;
const runs = new Map();
function resize() {
  if (!host || host.isDestroyed()) return;
  const [width, height] = host.getContentSize();
  for (const run of runs.values()) run.view.setBounds({x: 220, y: 0, width: Math.max(1, width - 220), height});
}
function publish() {
  host.webContents.send("runs", {active, runs: [...runs.values()].map(r => ({id:r.id, title:r.title, question:r.question}))});
}
function select(id) {
  if (!runs.has(id)) return;
  active = id;
  for (const run of runs.values()) run.view.setVisible(run.id === id);
  resize(); publish();
}
function addRun(report) {
  if (!report || !path.isAbsolute(report) || !fs.existsSync(report)) return;
  const existing = [...runs.values()].find(r => r.report === report);
  if (existing) { select(existing.id); host.show(); host.focus(); return; }
  let snapshot = JSON.parse(fs.readFileSync(report.replace(/\.html$/, "") + ".json", "utf8"));
  let investigation = null;
  const explanations = new Set();
  const view = new WebContentsView({webPreferences:{nodeIntegration:false, contextIsolation:true, sandbox:true, preload:path.join(__dirname,"preload.cjs")}});
  const id = String(++serial);
  const run = {id, report, view, title:snapshot.title || snapshot.question || "New run", question:snapshot.question || ""};
  runs.set(id,run);
  host.contentView.addChildView(view);
  const window = {
    webContents: view.webContents,
    isDestroyed: () => view.webContents.isDestroyed(),
    loadFile: file => view.webContents.loadFile(file),
    on: (name, callback) => { if (name === "closed") run.dispose = callback; },
  };
  const register = (channel, callback) => {
    const map = handlers.get(view.webContents.id) || {};
    map[channel] = callback;
    handlers.set(view.webContents.id,map);
  };
  // Only explicit editor links leave this local, sandboxed report window.
  window.webContents.on("will-navigate", (event, url) => {
    event.preventDefault();
    if (url.startsWith("vscode://file/") || url.startsWith("https://"))
      shell.openExternal(url);
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  register("open-editor", async (event, selection) => {
    if(event.sender!==view.webContents || typeof selection?.file!=="string" || !Number.isInteger(selection.line) || selection.line<1)throw new Error("Invalid editor location");
    const file=fs.realpathSync(selection.file);
    const root=snapshot.roots.find(root=>file.startsWith(fs.realpathSync(root)+path.sep));
    if(!root)throw new Error("File is outside this graph's repositories");
    await new Promise((resolve,reject)=>{const child=spawn("code",["--reuse-window",root,"--goto",`${file}:${selection.line}`],{stdio:"ignore",shell:false});child.on("error",()=>reject(new Error("Install the VS Code 'code' command on PATH to open the project.")));child.on("close",code=>code===0?resolve():reject(new Error("Could not open project in VS Code")));});
  });
  register("trace", async (event, question, onProgress) => {
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
    args.push("--html-only", "--out", destination);
    await new Promise((resolve, reject) => {
      investigation = spawn(process.execPath, args, {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let errors = "";
      investigation.stdout.on("data", (data) => {
        if (!window.isDestroyed()) {
          window.webContents.send("trace-progress", data.toString().trim());
          onProgress?.(data.toString().trim());
        }
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
      addRun(destination);
    }
  });
  register("inspect-token", async (event, selection) => {
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
    const result = await new Promise((resolve, reject) => {
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
              result = { answer: update.answer, traceQuestion:update.traceQuestion, sources: [], caveats: [] };
            if (!window.isDestroyed() && !(update.type === "done" && update.traceQuestion))
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
    if (result.traceQuestion) {
      const progress = message => {
        if (!window.isDestroyed()) window.webContents.send("inspect-progress", {type:"progress",requestId:selection.requestId,message});
      };
      progress("Building your new flow…");
      await handlers.get(view.webContents.id).trace(event, result.traceQuestion, progress);
      return {answer:"Opened the requested flow in a new tab."};
    }
    return result;
  });
  window.on("closed", () => {
    investigation?.kill();
    for (const child of explanations) child.kill();
  });
  window.loadFile(report);
  select(id);
  host.show(); host.focus();
}
function closeRun(id) {
  const run = runs.get(id);
  if (!run) return;
  run.dispose?.();
  handlers.delete(run.view.webContents.id);
  host.contentView.removeChildView(run.view);
  run.view.webContents.close();
  runs.delete(id);
  if (active === id) active = [...runs.keys()].at(-1);
  if (active) select(active); else publish();
}
const locked = app.requestSingleInstanceLock({report:process.argv[2]});
if (!locked) app.quit();
else {
  const pending = [];
  app.on("second-instance", (_event, argv, _cwd, data) => {
    const report = data?.report || argv.find(value => path.isAbsolute(value) && value.endsWith(".html"));
    if (host) addRun(report); else pending.push(report);
  });
  app.whenReady().then(async () => {
    ({writeReport} = await import("./report.js"));
    app.dock?.setIcon(path.join(__dirname, "logo.png"));
    host = new BrowserWindow({width:1280,height:800,minWidth:760,minHeight:420,title:"CodeSurf",icon:path.join(__dirname,"logo.png"),backgroundColor:"#ffffff",autoHideMenuBar:true,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,preload:path.join(__dirname,"shell-preload.cjs")}});
    ipcMain.handle("runs-ready", event => { if(event.sender === host.webContents) publish(); });
    ipcMain.handle("select-run", (event,id) => {if(event.sender === host.webContents) select(id);});
    ipcMain.handle("close-run", (event,id) => {if(event.sender === host.webContents) closeRun(id);});
    host.on("resize",resize);
    host.on("closed",() => {for (const run of runs.values()) {run.dispose?.();run.view.webContents.close();} runs.clear();});
    host.loadFile(path.join(__dirname,"shell.html"));
    addRun(process.argv[2]);
    for (const report of pending) addRun(report);
  });
}
app.on("window-all-closed", () => app.quit());
