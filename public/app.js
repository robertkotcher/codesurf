import { icon } from "./icons.js";
const $ = (id) => document.getElementById(id),
  esc = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
for (const el of document.querySelectorAll("[data-icon]"))
  el.innerHTML = icon(el.dataset.icon);
const initialRun = location.pathname.match(/^\/runs\/([a-f0-9-]{36})$/)?.[1];
$("home").hidden = !!initialRun;
$("workspace").hidden = !initialRun;
if (initialRun) {
  $("runTitle").textContent = "Loading run…";
  $("stopRun").disabled = true;
}
let runs = [],
  current = null,
  stream = null,
  logs = [],
  activity = [],
  lastEvent = 0,
  frameBusy = false,
  viewVersion = 0,
  user = null,
  terminal = new Set(["passed", "failed", "blocked", "stopped"]),
  controlQueue = Promise.resolve();
async function api(url, body) {
  const response = await fetch(
    url,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw Object.assign(new Error(data.error || "The request failed."), {
      status: response.status,
    });
  return data;
}
let toastTimer;
function toast(text) {
  $("toast").textContent = text;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("toast").hidden = true), 6000);
}
function time(value) {
  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
function renderRuns() {
  $("runCount").textContent = runs.length || "";
  $("runList").innerHTML = runs.length
    ? runs
        .map(
          (run) =>
            `<button class="run-item${current?.id === run.id ? " active" : ""}" data-run="${esc(run.id)}"${current?.id === run.id ? ' aria-current="page"' : ""}><span class="run-item-top"><span class="status-dot ${esc(run.status)}"></span><span class="repo-label">${esc(run.source.repo.split("/").at(-1))}</span><span>${run.source.number ? "#" + run.source.number : run.source.demo ? "Sample" : run.source.head.slice(0, 7)}</span></span><span class="run-item-title">${esc(run.source.title)}</span><small>${esc(run.phase)} · ${new Date(run.created).toLocaleDateString([], { month: "short", day: "numeric" })}</small></button>`,
        )
        .join("")
    : "";
}
function setRun(run) {
  if (!current || current.id !== run.id) return;
  const previous = current;
  current = run;
  runs = [run, ...runs.filter((item) => item.id !== run.id)].sort((a, b) =>
    b.created.localeCompare(a.created),
  );
  renderRuns();
  $("runRepo").textContent =
    run.source.repo + (run.source.number ? " #" + run.source.number : "");
  $("runCommit").textContent = run.source.head?.slice(0, 8) || "";
  $("runTitle").textContent = run.source.title;
  $("runTitle").title = run.source.title;
  $("runStatus").className = "status-badge " + run.status;
  $("runStatus").textContent =
    {
      starting: "Starting",
      running: "Running",
      paused: "Paused",
      passed: "Passed",
      failed: "Issues found",
      blocked: "Blocked",
      stopped: "Stopped",
    }[run.status] || run.status;
  const finished = terminal.has(run.status),
    paused = run.status === "paused";
  $("stopRun").hidden = finished;
  $("stopRun").disabled = false;
  $("takeControl").hidden = finished;
  $("takeControl").disabled = !run.browserReady || run.status === "starting";
  $("takeControl").innerHTML =
    icon(paused ? "play" : "control") +
    (paused ? "Resume agent" : "Take control");
  $("browserScreen").classList.toggle("controlled", paused);
  $("browserScreen").setAttribute(
    "aria-label",
    paused
      ? "Interactive browser. Click to focus a field; type to enter text."
      : "Live view of the agent’s browser",
  );
  $("liveBadge").hidden = !run.browserReady || finished || paused;
  $("waitingSpinner").hidden = finished;
  $("waitingTitle").textContent = run.phase;
  $("waitingDetail").textContent = finished ? run.summary : "";
  $("waitingDetail").hidden = !finished || !run.summary;
  $("browserUrl").textContent = run.browserUrl || "Waiting for the application";
  $("showReplay").hidden = !run.artifacts?.includes("video.webm");
  if (run.browserReady || run.artifacts?.includes("screen.png")) refreshFrame();
  if (run.report || finished) {
    renderReport(run);
    if (!terminal.has(previous.status) && finished) selectTab("report");
  }
  if (finished) {
    stream?.close();
    $("connectionStatus").textContent = "Saved";
    refreshFrame();
  }
}
function selectTab(tab) {
  for (const name of ["activity", "report"]) {
    $(name + "Tab").setAttribute("aria-selected", String(name === tab));
    $(name + "Content").hidden = name !== tab;
  }
}
function artifact(name, download = false) {
  return (
    "/api/runs/" +
    current.id +
    "/artifacts/" +
    encodeURIComponent(name) +
    (download ? "?download=1" : "")
  );
}
function evidenceLinks(items, run) {
  return (items || [])
    .filter((name) => run.artifacts.includes(name))
    .map(
      (name) =>
        `<a class="evidence-link" href="${esc(artifact(name))}" target="_blank" rel="noopener">${icon("external")}${esc(name)}</a>`,
    )
    .join("");
}
function renderReport(run) {
  $("bugCount").textContent = run.report?.bugs.length || "";
  $("bugCount").hidden = !run.report?.bugs.length;
  if (!run.report) {
    $("reportBody").innerHTML =
      `<p>${esc(run.summary || "")}</p><a class="evidence-link" href="/api/runs/${esc(run.id)}/logs">${icon("download")}Download logs</a>`;
    return;
  }
  const report = run.report;
  $("reportBody").innerHTML =
    `<p>${esc(report.summary)}</p>${report.startup ? `<h3>Startup</h3><p>${esc(report.startup)}</p>` : ""}<h3>Checks · ${report.tests.length}</h3>${report.tests.map((test) => `<article class="check-item ${esc(test.status)}"><h4>${icon(test.status === "passed" ? "check" : test.status === "failed" ? "error" : "clock")}${esc(test.title)}</h4><p>${esc(test.detail)}</p>${evidenceLinks(test.evidence, run)}</article>`).join("")}${report.bugs.length ? `<h3>Findings · ${report.bugs.length}</h3>` : ""}${report.bugs.map((bug) => `<article class="bug-item"><h4>${esc(bug.title)}</h4><small>${esc(bug.severity)} severity</small><ol>${bug.steps.map((step) => `<li>${esc(step)}</li>`).join("")}</ol><p><strong>Expected:</strong> ${esc(bug.expected)}</p><p><strong>Actual:</strong> ${esc(bug.actual)}</p>${evidenceLinks(bug.evidence, run)}</article>`).join("")}<div class="report-downloads">${[
      "report.json",
      "trace.zip",
      "video.webm",
    ]
      .filter((name) => name === "report.json" || run.artifacts.includes(name))
      .map(
        (name) =>
          `<a class="evidence-link" href="${esc(artifact(name, true))}">${icon("download")}${esc(name === "report.json" ? "Report" : name === "trace.zip" ? "Browser trace" : "Video")}</a>`,
      )
      .join("")}</div>`;
}
function addEvent(event) {
  if (event.id) {
    if (event.id <= lastEvent) return;
    lastEvent = event.id;
  }
  if (event.type === "log") {
    logs.push(event);
    if (logs.length > 3000) logs.shift();
    if (matchesLog(event)) appendLog(event);
  } else if (event.type === "activity") {
    activity.push(event);
    $("activityCount").textContent = activity.length;
    const li = document.createElement("li"),
      stamp = document.createElement("time");
    stamp.textContent = time(event.time);
    li.append(stamp, document.createTextNode(event.text));
    $("activityList").append(li);
    if (activity.length > 200) $("activityList").firstElementChild?.remove();
    $("activityContent").scrollTop = $("activityContent").scrollHeight;
  } else if (event.type === "state") setRun(event.run);
  else if (event.type === "frame") refreshFrame();
}
function appendLog(event) {
  const pre = $("logs");
  pre.querySelector(".log-placeholder")?.remove();
  const span = document.createElement("span");
  span.className =
    "log-line" +
    (/\berror\b|exception|failed/i.test(event.text) ? " error" : "");
  const prefix = document.createElement("span");
  prefix.className = "log-source";
  prefix.textContent =
    time(event.time) + " " + (event.source || "agent").padEnd(9) + " ";
  span.append(prefix, document.createTextNode(event.text));
  pre.append(span);
  while (pre.children.length > 1500) pre.firstElementChild.remove();
  if ($("followLogs").checked) pre.scrollTop = pre.scrollHeight;
}
function matchesLog(event) {
  return (
    ($("logFilter").value === "all" || $("logFilter").value === event.source) &&
    event.text.toLowerCase().includes($("logSearch").value.toLowerCase())
  );
}
function renderLogs() {
  $("logs").replaceChildren();
  for (const event of logs) if (matchesLog(event)) appendLog(event);
}
async function refreshFrame() {
  if (
    !current ||
    frameBusy ||
    !$("replay").hidden ||
    (!current.browserReady && !current.artifacts?.includes("screen.png"))
  )
    return;
  frameBusy = true;
  const version = viewVersion,
    id = current.id;
  try {
    const response = await fetch(
      "/api/runs/" + id + "/artifacts/screen.png?frame=" + Date.now(),
    );
    if (!response.ok) return;
    const blob = await response.blob();
    if (version !== viewVersion) return;
    const image = $("browserScreen"),
      old = image.dataset.blob,
      url = URL.createObjectURL(blob);
    image.src = url;
    image.dataset.blob = url;
    image.hidden = false;
    $("browserWaiting").hidden = true;
    if (old) URL.revokeObjectURL(old);
  } catch {
  } finally {
    frameBusy = false;
  }
}
async function openRun(id, push = true) {
  const version = ++viewVersion;
  stream?.close();
  stream = null;
  lastEvent = 0;
  logs = [];
  activity = [];
  $("logFilter").value = "all";
  $("logSearch").value = "";
  $("logs").replaceChildren();
  $("activityList").replaceChildren();
  $("activityCount").textContent = "0";
  $("bugCount").hidden = true;
  $("bugCount").textContent = "";
  $("elapsed").textContent = "";
  $("reportBody").replaceChildren();
  $("replay").pause();
  $("replay").hidden = true;
  $("replay").removeAttribute("src");
  $("browserScreen").hidden = true;
  $("browserWaiting").hidden = false;
  $("connectionStatus").textContent = "Connecting…";
  selectTab("activity");
  try {
    const run = await api("/api/runs/" + id);
    if (version !== viewVersion) return;
    current = run;
    $("home").hidden = true;
    $("workspace").hidden = false;
    $("downloadLogs").href = "/api/runs/" + id + "/logs";
    if (push) history.pushState({}, "", "/runs/" + id);
    setRun(run);
    stream = new EventSource("/api/runs/" + id + "/events");
    stream.onopen = () => {
      if (version === viewVersion)
        $("connectionStatus").textContent = terminal.has(current.status)
          ? "Saved"
          : "Connected";
    };
    stream.onmessage = (message) => {
      if (version !== viewVersion) return;
      try {
        addEvent(JSON.parse(message.data));
      } catch {
        toast("A workspace event could not be read.");
      }
    };
    stream.onerror = () => {
      if (version === viewVersion && !terminal.has(current?.status))
        $("connectionStatus").textContent = "Reconnecting…";
    };
  } catch (error) {
    if (version !== viewVersion) return;
    toast(error.message);
    showHome(false);
  }
}
function showHome(push = true) {
  ++viewVersion;
  stream?.close();
  stream = null;
  current = null;
  $("home").hidden = false;
  $("workspace").hidden = true;
  $("replay").pause();
  if (push) history.pushState({}, "", "/");
  renderRuns();
  $("prUrl").focus();
}
async function start(demo = false) {
  const button = demo ? $("sampleRun") : $("startRun");
  button.disabled = true;
  $("launchError").hidden = true;
  try {
    const run = await api(
      "/api/runs",
      demo
        ? { demo: true }
        : { url: $("prUrl").value.trim(), goal: $("goal").value.trim() },
    );
    runs.unshift(run);
    await openRun(run.id);
  } catch (error) {
    $("launchError").textContent = error.message;
    $("launchError").hidden = false;
    if (error.status === 401)
      toast("Connect GitHub before running a pull request.");
  } finally {
    button.disabled = false;
  }
}
$("runForm").onsubmit = (event) => {
  event.preventDefault();
  start();
};
$("sampleRun").onclick = () => start(true);
$("newRun").onclick = () => showHome();
$("runList").onclick = (event) => {
  const row = event.target.closest("[data-run]");
  if (row) openRun(row.dataset.run);
};
async function control(action) {
  if (!current) return;
  const id = current.id;
  try {
    const run = await api("/api/runs/" + id + "/control", { action });
    if (current?.id === id) setRun(run);
  } catch (error) {
    toast(error.message);
  }
}
$("stopRun").onclick = () => {
  if (current) {
    $("stopRun").disabled = true;
    control("stop");
  }
};
$("takeControl").onclick = () =>
  control(current?.status === "paused" ? "resume" : "pause");
$("showReplay").onclick = () => {
  if (!current) return;
  const video = $("replay");
  video.src = artifact("video.webm");
  video.hidden = false;
  $("browserScreen").hidden = true;
  $("browserWaiting").hidden = true;
  video.play().catch(() => {});
};
function sendBrowser(action, args) {
  if (!current || current.status !== "paused") return;
  const id = current.id;
  controlQueue = controlQueue
    .catch(() => {})
    .then(() => api("/api/runs/" + id + "/browser", { action, args }))
    .then(() => refreshFrame())
    .catch((error) => toast(error.message));
}
$("browserScreen").onclick = (event) => {
  if (current?.status !== "paused") return;
  const image = event.currentTarget,
    rect = image.getBoundingClientRect();
  image.focus();
  sendBrowser("tap", [
    Math.round(((event.clientX - rect.left) * 1280) / rect.width),
    Math.round(((event.clientY - rect.top) * 800) / rect.height),
  ]);
};
$("browserScreen").onkeydown = (event) => {
  if (current?.status !== "paused") return;
  if (
    event.key.length === 1 &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey
  ) {
    event.preventDefault();
    sendBrowser("type", [event.key]);
  } else if (
    [
      "Enter",
      "Backspace",
      "Delete",
      "Tab",
      "Escape",
      "ArrowLeft",
      "ArrowRight",
      "ArrowUp",
      "ArrowDown",
      "Home",
      "End",
    ].includes(event.key)
  ) {
    event.preventDefault();
    sendBrowser("key", [(event.shiftKey ? "Shift+" : "") + event.key]);
  }
};
$("browserViewport").addEventListener(
  "wheel",
  (event) => {
    if (current?.status === "paused") {
      event.preventDefault();
      sendBrowser("scroll", [Math.round(event.deltaY)]);
    }
  },
  { passive: false },
);
$("activityTab").onclick = () => selectTab("activity");
$("reportTab").onclick = () => selectTab("report");
$("logFilter").onchange = renderLogs;
$("logSearch").oninput = renderLogs;
$("followLogs").onchange = () => {
  if ($("followLogs").checked) $("logs").scrollTop = $("logs").scrollHeight;
};
let pickerItems = [],
  pickerRepo = null,
  pickerPage = 1,
  pickerVersion = 0;
function renderPicker() {
  const query = $("repositorySearch").value.toLowerCase(),
    items = pickerItems.filter((item) =>
      String(item.name || item.title)
        .toLowerCase()
        .includes(query),
    );
  $("repositoryList").innerHTML = items.length
    ? items
        .map(
          (item) =>
            `<button class="repository-choice" ${pickerRepo ? 'data-pr="' + esc(item.url) + '"' : 'data-repo="' + esc(item.name) + '"'}>${esc(item.name || item.title)}${item.number ? "<small>#" + item.number + "</small>" : ""}</button>`,
        )
        .join("")
    : '<p class="panel-empty">No matches.</p>';
}
async function openPicker(repo = null, more = false) {
  if (!user) {
    location.href = "/auth/github";
    return;
  }
  const version = ++pickerVersion;
  pickerRepo = repo;
  $("runRepository").hidden = !repo;
  pickerPage = more ? pickerPage + 1 : 1;
  if (!$("repositoryDialog").open) $("repositoryDialog").showModal();
  $("repositoryTitle").textContent = repo || "Select a repository";
  $("repositoryBack").hidden = !repo;
  $("repositorySearch").placeholder = repo
    ? "Find a pull request…"
    : "Find a repository…";
  $("repositorySearch").value = "";
  $("repositoryList").textContent = "Loading…";
  $("morePulls").hidden = true;
  try {
    const data = await api(
      repo
        ? "/api/pulls?" + new URLSearchParams({ repo, page: pickerPage })
        : "/api/repositories",
    );
    if (version !== pickerVersion) return;
    pickerItems = more ? [...pickerItems, ...data.items] : data.items;
    renderPicker();
    $("morePulls").hidden = !data.more;
  } catch (error) {
    if (version === pickerVersion)
      $("repositoryList").textContent = error.message;
  }
}
$("chooseRepo").onclick = () => openPicker();
$("closeRepository").onclick = () => {
  $("repositoryDialog").close();
  ++pickerVersion;
};
$("repositoryDialog").onclick = (event) => {
  if (event.target === $("repositoryDialog")) {
    $("repositoryDialog").close();
    ++pickerVersion;
  }
};
$("repositoryBack").onclick = () => openPicker();
$("repositorySearch").oninput = renderPicker;
$("morePulls").onclick = () => openPicker(pickerRepo, true);
$("repositoryList").onclick = (event) => {
  const repo = event.target.closest("[data-repo]"),
    pr = event.target.closest("[data-pr]");
  if (repo) openPicker(repo.dataset.repo);
  if (pr) {
    $("prUrl").value = pr.dataset.pr;
    $("repositoryDialog").close();
    $("goal").focus();
  }
};
$("account").onclick = () => {
  const menu = $("accountMenu");
  menu.hidden = !menu.hidden;
  $("account").setAttribute("aria-expanded", String(!menu.hidden));
};
document.addEventListener("click", (event) => {
  if (!event.target.closest(".header-actions")) {
    $("accountMenu").hidden = true;
    $("account").setAttribute("aria-expanded", "false");
  }
});
$("signOut").onclick = async () => {
  await api("/auth/logout", {});
  location.href = "/";
};
window.addEventListener("popstate", () => {
  const id = location.pathname.match(/^\/runs\/([a-f0-9-]{36})$/)?.[1];
  id ? openRun(id, false) : showHome(false);
});
setInterval(() => {
  if (!current) return;
  const duration = Math.max(
    0,
    Math.round(
      (Date.parse(current.finished || new Date().toISOString()) -
        Date.parse(current.created)) /
        1000,
    ),
  );
  $("elapsed").textContent =
    Math.floor(duration / 60) + ":" + String(duration % 60).padStart(2, "0");
}, 1000);
async function init() {
  try {
    const status = await api("/api/status");
    $("runtimeStatus").classList.toggle("ready", status.runtime.ready);
    $("runtimeStatus").lastChild.textContent = status.runtime.ready
      ? "Runner ready"
      : "Runner offline";
    $("runtimeStatus").title =
      status.runtime.message || "Workspace runner ready";
    $("sampleRun").hidden = !status.sample;
    $("pickerConnect").href = status.installUrl;
    $("connectRepos").href = status.installUrl;
    try {
      const me = await api("/api/me");
      user = me.user;
      if (user) {
        $("signIn").hidden = true;
        $("account").hidden = false;
        $("account").innerHTML = esc("@" + user.login) + icon("down");
      }
      const data = await api("/api/runs");
      runs = data.items;
      renderRuns();
      const id = location.pathname.match(/^\/runs\/([a-f0-9-]{36})$/)?.[1];
      if (id) await openRun(id, false);
    } catch (error) {
      if (error.status !== 401) toast(error.message);
    }
    const pr = new URL(location.href).searchParams.get("pr");
    if (pr) $("prUrl").value = pr;
  } catch (error) {
    toast(error.message);
  }
}
init();

$("runRepository").onclick = () => {
  if (!pickerRepo) return;
  $("prUrl").value = "https://github.com/" + pickerRepo;
  $("repositoryDialog").close();
  $("goal").focus();
};
