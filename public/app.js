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
for (const element of document.querySelectorAll("[data-icon]"))
  element.innerHTML = icon(element.dataset.icon);
const terminal = new Set(["passed", "failed", "blocked", "stopped"]);
let current = null,
  stream = null,
  logs = [],
  activity = [],
  lastEvent = 0,
  frameBusy = false,
  viewVersion = 0,
  controlQueue = Promise.resolve(),
  user = null;
let review = null,
  selected = null,
  routeVersion = 0,
  selectionVersion = 0,
  reviewUrl = null,
  launchTimer = null,
  reviewTimer = null,
  localMode = false;
let repositories = [],
  repoPulls = new Map(),
  expandedRepos = new Set(),
  loadingRepos = new Set();
let homeLoaded = false,
  homeLoading = false;
async function loadRepositories() {
  if (homeLoaded || homeLoading) return;
  homeLoading = true;
  $("repositoryList").innerHTML = skeleton();
  try {
    const data = await api("/api/repositories");
    repositories = data.items;
    let preferred;
    try {
      preferred = localStorage.getItem("codesurf.repository");
    } catch {}
    const first =
      repositories.find((r) => r.name === preferred) || repositories[0];
    if (first) expandedRepos.add(first.name);
    homeLoaded = true;
    renderRepositories();
    if (first) loadPulls(first.name);
  } catch (error) {
    $("repositoryList").innerHTML =
      '<p class="inline-error">' + esc(error.message) + "</p>";
  } finally {
    homeLoading = false;
  }
}
async function api(url, body) {
  const response = await fetch(
    url,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw Object.assign(new Error(data.error || "The request failed."), {
      status: response.status,
      code: data.code,
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
const time = (value) =>
  new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
const reviewPath = (source) =>
  "/review/github/" + source.baseRepo + "/pr/" + source.number;
function parseRoute() {
  const match = location.pathname.match(
    /^\/review\/github\/([\w.-]+)\/([\w.-]+)\/pr\/([1-9]\d*)\/?$/,
  );
  return match
    ? {
        url: `https://github.com/${match[1]}/${match[2]}/pull/${match[3]}`,
        repo: match[1] + "/" + match[2],
        number: match[3],
      }
    : null;
}
function skeleton() {
  return (
    '<div class="skeleton-list" aria-label="Loading repositories">' +
    Array.from({ length: 4 }, () => "<div></div>").join("") +
    "</div>"
  );
}
function renderRepositories() {
  const query = $("repositorySearch").value.toLowerCase();
  const items = repositories.filter((r) =>
    r.name.toLowerCase().includes(query),
  );
  $("repositoryList").innerHTML = items.length
    ? items
        .map((repo) => {
          const data = repoPulls.get(repo.name),
            open = expandedRepos.has(repo.name);
          return `<details class="repository-group" data-repo="${esc(repo.name)}"${open ? " open" : ""}><summary><span class="repo-chevron">${icon("chevron")}</span>${icon("repo")}<span>${esc(repo.name)}</span>${data && !data.error ? `<small>${data.items.length}${data.more ? "+" : ""}</small>` : ""}</summary><div class="pull-list">${renderPulls(repo.name)}</div></details>`;
        })
        .join("")
    : '<p class="empty-state">' +
      (repositories.length
        ? "No matching repositories."
        : "No connected repositories.") +
      "</p>";
}
function renderPulls(repo) {
  const data = repoPulls.get(repo);
  if (!data)
    return '<div class="pull-loading"><span class="small-spinner"></span>Loading pull requests…</div>';
  if (data.error)
    return `<p class="inline-error">${esc(data.error)} <button class="text-button" data-retry-repo="${esc(repo)}">Try again</button></p>`;
  return (
    data.items
      .map(
        (pr) =>
          `<a class="pull-item" href="/review/github/${esc(repo)}/pr/${pr.number}" data-review-url="${esc(pr.url)}">${icon("pull")}<span class="pull-title">${esc(pr.title)}</span><span class="pull-number">#${pr.number}</span>${icon("chevron")}</a>`,
      )
      .join("") +
    (!data.items.length
      ? '<p class="empty-pulls">No open pull requests.</p>'
      : "") +
    (data.more
      ? `<button class="more-pulls text-button" data-more-repo="${esc(repo)}">Show more pull requests</button>`
      : "")
  );
}
async function loadPulls(repo, more = false) {
  if (loadingRepos.has(repo)) return;
  loadingRepos.add(repo);
  const before = repoPulls.get(repo),
    page = more ? (before?.page || 1) + 1 : 1;
  try {
    const data = await api("/api/pulls?" + new URLSearchParams({ repo, page }));
    repoPulls.set(repo, {
      ...data,
      page,
      items: more ? [...(before?.items || []), ...data.items] : data.items,
    });
  } catch (error) {
    repoPulls.set(repo, { error: error.message });
  } finally {
    loadingRepos.delete(repo);
    renderRepositories();
  }
}
$("repositoryList").addEventListener(
  "toggle",
  (event) => {
    const details = event.target.closest("details[data-repo]");
    if (!details) return;
    const repo = details.dataset.repo;
    if (details.open) {
      expandedRepos.add(repo);
      if (!repoPulls.has(repo)) loadPulls(repo);
    } else expandedRepos.delete(repo);
  },
  true,
);
$("repositoryList").onclick = (event) => {
  const pr = event.target.closest("[data-review-url]");
  if (pr && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
    event.preventDefault();
    navigateReview(pr.dataset.reviewUrl);
  }
  const more = event.target.closest("[data-more-repo]");
  if (more) {
    more.disabled = true;
    loadPulls(more.dataset.moreRepo, true);
  }
  const retry = event.target.closest("[data-retry-repo]");
  if (retry) loadPulls(retry.dataset.retryRepo);
};
$("repositorySearch").oninput = renderRepositories;
$("openPrForm").onsubmit = (event) => {
  event.preventDefault();
  navigateReview($("prUrl").value.trim());
};
function detachRun() {
  ++viewVersion;
  stream?.close();
  stream = null;
  current = null;
  frameBusy = false;
  $("replay").pause();
  $("replay").hidden = true;
  $("replay").removeAttribute("src");
  const image = $("browserScreen");
  if (image.dataset.blob) URL.revokeObjectURL(image.dataset.blob);
  delete image.dataset.blob;
  image.removeAttribute("src");
  image.hidden = true;
}
function cancelNavigation() {
  ++routeVersion;
  ++selectionVersion;
  clearTimeout(launchTimer);
  clearTimeout(reviewTimer);
  detachRun();
}
function showHome(push = true) {
  cancelNavigation();
  review = null;
  selected = null;
  $("home").hidden = false;
  $("reviewPage").hidden = true;
  if (push) history.pushState({}, "", "/");
  document.title = "CodeSurf";
  if (user || localMode) loadRepositories();
}
async function navigateReview(
  url,
  retry = false,
  push = true,
  useLatest = false,
) {
  let parsed;
  try {
    parsed = new URL(url);
    const m = parsed.pathname.match(
      /^\/([\w.-]+)\/([\w.-]+)\/pull\/([1-9]\d*)\/?$/,
    );
    if (parsed.origin !== "https://github.com" || !m) throw Error();
    try {
      localStorage.setItem("codesurf.repository", m[1] + "/" + m[2]);
    } catch {}
    if (push)
      history.pushState({}, "", `/review/github/${m[1]}/${m[2]}/pr/${m[3]}`);
  } catch {
    toast("Enter a GitHub pull request URL.");
    return;
  }
  if (useLatest) {
    const target = parseRoute();
    if (target)
      history.replaceState(
        {},
        "",
        "/review/github/" + target.repo + "/pr/" + target.number,
      );
  }
  cancelNavigation();
  $("revisionBanner").hidden = true;
  reviewUrl = url;
  review = null;
  selected = null;
  const version = routeVersion;
  $("home").hidden = true;
  $("reviewPage").hidden = false;
  $("reviewLayout").hidden = true;
  $("reviewLoading").hidden = false;
  $("reviewSpinner").hidden = false;
  $("reviewPhase").textContent = "Reading pull request…";
  $("reviewError").hidden = true;
  $("retryReview").hidden = true;
  const route = parseRoute();
  $("reviewRepo").textContent = route?.repo || "";
  $("reviewNumber").textContent = route ? "#" + route.number : "";
  $("reviewTitle").textContent = "Pull request";
  $("reviewCommit").textContent = "";
  $("githubPr").href = url;
  $("signIn").href =
    "/auth/github?returnTo=" +
    encodeURIComponent(location.pathname + location.search);
  try {
    const result = await api("/api/reviews", {
      url,
      retry,
      useLatest,
      reviewId: new URL(location.href).searchParams.get("review"),
    });
    if (version !== routeVersion) return;
    receiveReview(result, version);
  } catch (error) {
    if (version !== routeVersion) return;
    showReviewError(error);
  }
}
function showReviewError(error) {
  $("reviewSpinner").hidden = true;
  $("reviewPhase").textContent = "Could not load changes";
  $("reviewError").textContent = error.message;
  $("reviewError").hidden = false;
  $("retryReview").hidden = false;
}
function receiveReview(data, version) {
  review = data;
  $("revisionBanner").hidden = !data.updateAvailable;
  const page = new URL(location.href);
  page.searchParams.set("review", data.id);
  history.replaceState({}, "", page.pathname + page.search);
  $("reviewRepo").textContent = data.source.baseRepo;
  $("reviewNumber").textContent = "#" + data.source.number;
  $("reviewTitle").textContent = data.source.title;
  $("reviewCommit").textContent = data.source.head.slice(0, 8);
  $("githubPr").href = data.source.url;
  document.title = data.source.title + " · CodeSurf";
  if (data.status === "loading") {
    $("reviewPhase").textContent = data.phase + "…";
    reviewTimer = setTimeout(async () => {
      try {
        const next = await api("/api/reviews/" + data.id);
        if (version === routeVersion) receiveReview(next, version);
      } catch (error) {
        if (version === routeVersion) showReviewError(error);
      }
    }, 1000);
    return;
  }
  if (data.status === "failed") {
    showReviewError(new Error(data.error));
    return;
  }
  $("reviewLoading").hidden = true;
  $("reviewLayout").hidden = false;
  $("reviewLayout").classList.remove("legacy");
  renderChanges();
  const changeId = new URL(location.href).searchParams.get("change");
  if (changeId && data.changes.some((c) => c.id === changeId))
    selectChange(changeId, false);
  else showChanges(false);
}
$("loadLatest").onclick = () => navigateReview(reviewUrl, false, false, true);
$("retryReview").onclick = () => navigateReview(reviewUrl, true, false);
function statusIcon(run, index) {
  return run
    ? `<span class="change-state ${esc(run.status)}" title="${esc(run.phase)}">${terminal.has(run.status) ? icon(run.status === "passed" ? "check" : run.status === "failed" ? "error" : "stop") : '<span class="small-spinner"></span>'}</span>`
    : `<span class="change-number">${index + 1}</span>`;
}
function renderChanges() {
  if (!review?.changes) return;
  $("changeCount").textContent = review.changes.length;
  const unavailable = review.files.filter((file) =>
    file.hunks.some((h) => h.unavailable),
  );
  $("unavailableFiles").hidden = !unavailable.length;
  $("unavailableFiles").title = unavailable
    .map((file) => file.path + ": GitHub did not provide a complete text diff")
    .join("\n");
  const rows = review.changes
    .map(
      (change, index) =>
        `<button class="change-choice${selected?.id === change.id ? " selected" : ""}" data-change="${esc(change.id)}"${selected?.id === change.id ? ' aria-current="step"' : ""}>${statusIcon(review.runs?.[change.id], index)}<span class="change-copy"><strong>${esc(change.title)}</strong><small>${esc(change.description)}</small></span><span class="change-chevron">${icon("chevron")}</span></button>`,
    )
    .join("");
  $("changeList").innerHTML = rows;
  $("sidebarChanges").innerHTML = rows;
  $("noChanges").hidden = !!review.changes.length;
}
function renderRuns() {
  if (review && current?.source.reviewId === review.id) {
    review.runs[current.source.changeId] = current;
    renderChanges();
  }
}
function showChanges(push = true) {
  ++selectionVersion;
  clearTimeout(launchTimer);
  detachRun();
  selected = null;
  $("changePicker").hidden = false;
  $("changeSidebar").hidden = true;
  $("workspace").hidden = true;
  $("reviewLayout").classList.remove("selected-change");
  renderChanges();
  if (push)
    history.pushState(
      {},
      "",
      reviewPath(review.source) + "?review=" + review.id,
    );
}
function renderCode(change) {
  $("changeTitle").textContent = change.title;
  $("changeDescription").textContent = change.description;
  $("expectedResult").innerHTML =
    "<span>Expected</span><p>" + esc(change.expected) + "</p>";
  const ids = new Set(change.hunkIds);
  const files = review.files
    .map((file) => ({
      ...file,
      hunks: file.hunks.filter((h) => ids.has(h.id)),
    }))
    .filter((f) => f.hunks.length);
  $("codeFiles").innerHTML = files
    .map(
      (file) =>
        `<article class="code-file"><header>${icon("code")}<span title="${esc(file.path)}">${esc(file.path)}</span><small class="additions">+${file.hunks.reduce((n, h) => n + h.rows.filter((r) => r.kind === "added").length, 0)}</small><small class="deletions">−${file.hunks.reduce((n, h) => n + h.rows.filter((r) => r.kind === "removed").length, 0)}</small></header>${file.hunks.map((h) => (h.unavailable ? '<p class="unavailable-code">GitHub did not provide a text diff for this file.</p>' : `<div class="code-hunk"><div class="hunk-header">${esc(h.header)}</div>${h.rows.map((row) => `<div class="code-line ${row.kind}"><span class="old-number">${row.old ?? ""}</span><span class="new-number">${row.new ?? ""}</span><span class="diff-sign">${row.kind === "added" ? "+" : row.kind === "removed" ? "−" : " "}</span><code>${esc(row.text) || " "}</code></div>`).join("")}</div>`)).join("")}</article>`,
    )
    .join("");
}
function pendingWorkspace(message = "Starting workspace") {
  detachRun();
  logs = [];
  activity = [];
  lastEvent = 0;
  $("logs").replaceChildren();
  $("activityList").replaceChildren();
  $("activityCount").textContent = "0";
  $("bugCount").hidden = true;
  $("reportBody").replaceChildren();
  $("elapsed").textContent = "";
  $("runTitle").textContent = "Browser";
  $("runStatus").textContent = "Starting";
  $("runStatus").className = "status-badge starting";
  $("browserUrl").textContent = "Waiting for the application";
  $("browserWaiting").hidden = false;
  $("waitingSpinner").hidden = false;
  $("waitingTitle").textContent = message;
  $("waitingDetail").hidden = true;
  $("stopRun").hidden = true;
  $("takeControl").hidden = false;
  $("takeControl").disabled = true;
  $("showReplay").hidden = true;
  $("liveBadge").hidden = true;
  $("rerunTest").hidden = true;
  $("retryTest").hidden = true;
  $("connectionStatus").textContent = "";
  selectTab("logs");
}
async function selectChange(id, push = true, retry = false) {
  const change = review?.changes.find((c) => c.id === id);
  if (!change) return;
  const token = ++selectionVersion;
  clearTimeout(launchTimer);
  selected = change;
  $("changePicker").hidden = true;
  $("changeSidebar").hidden = false;
  $("workspace").hidden = false;
  $("reviewLayout").classList.add("selected-change");
  renderChanges();
  renderCode(change);
  pendingWorkspace();
  if (push)
    history.pushState(
      {},
      "",
      reviewPath(review.source) +
        "?review=" +
        review.id +
        "&change=" +
        encodeURIComponent(id),
    );
  const reviewId = review.id;
  async function start() {
    if (token !== selectionVersion || review?.id !== reviewId) return;
    try {
      const fresh = await api("/api/reviews/" + reviewId + "/runs");
      if (token !== selectionVersion) return;
      review.runs = fresh.runs;
      renderChanges();
      let run = retry ? null : review.runs?.[id];
      if (!run)
        run = await api(`/api/reviews/${reviewId}/changes/${id}/run`, {
          retry,
        });
      if (token !== selectionVersion) return;
      review.runs[id] = run;
      renderChanges();
      await openRun(run.id, false);
    } catch (error) {
      if (token !== selectionVersion) return;
      if (error.code === "WORKSPACE_BUSY") {
        $("waitingTitle").textContent =
          error.status === 409
            ? "Waiting for the current test"
            : "Waiting for a workspace";
        $("waitingDetail").textContent = error.message;
        $("waitingDetail").hidden = false;
        launchTimer = setTimeout(start, 3000);
      } else {
        $("waitingSpinner").hidden = true;
        $("waitingTitle").textContent = "Could not start this test";
        $("waitingDetail").textContent = error.message;
        $("waitingDetail").hidden = false;
        $("runStatus").textContent = "Blocked";
        $("runStatus").className = "status-badge blocked";
        $("retryTest").hidden = false;
        $("retryTest").textContent =
          error.status === 412 ? "Reload changes" : "Try again";
        $("retryTest").onclick = () =>
          error.status === 412
            ? navigateReview(reviewUrl, false, false, true)
            : selectChange(id, false, true);
      }
    }
  }
  start();
}
for (const name of ["changeList", "sidebarChanges"])
  $(name).onclick = (event) => {
    const row = event.target.closest("[data-change]");
    if (row) selectChange(row.dataset.change);
  };
$("allChanges").onclick = () => showChanges();
$("wrapCode").onclick = () => {
  const wrap = $("wrapCode").getAttribute("aria-pressed") !== "true";
  $("wrapCode").setAttribute("aria-pressed", String(wrap));
  $("codeFiles").classList.toggle("wrap", wrap);
};
$("rerunTest").onclick = () =>
  selected && selectChange(selected.id, false, true);

function setRun(run) {
  if (!current || current.id !== run.id) return;
  const previous = current;
  current = run;
  renderRuns();
  $("runTitle").textContent = "Browser";
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
  $("rerunTest").hidden = !finished || !selected;
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
  for (const name of ["activity", "logs", "report"]) {
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
  } else if (
    event.type === "state" &&
    !(terminal.has(current?.status) && !terminal.has(event.run.status))
  )
    setRun(event.run);
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
  selectTab("logs");
  $("retryTest").hidden = true;
  try {
    const run = await api("/api/runs/" + id);
    if (version !== viewVersion) return;
    current = run;
    $("home").hidden = true;
    $("workspace").hidden = false;
    $("downloadLogs").href = "/api/runs/" + id + "/logs";
    if (push) history.pushState({}, "", "/runs/" + id);
    setRun(run);
    if (terminal.has(run.status)) selectTab("report");
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
    $("waitingSpinner").hidden = true;
    $("waitingTitle").textContent = "Could not load this test";
    $("waitingDetail").textContent = error.message;
    $("waitingDetail").hidden = false;
  }
}

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
$("logsTab").onclick = () => selectTab("logs");
$("reportTab").onclick = () => selectTab("report");
$("logFilter").onchange = renderLogs;
$("logSearch").oninput = renderLogs;
$("followLogs").onchange = () => {
  if ($("followLogs").checked) $("logs").scrollTop = $("logs").scrollHeight;
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
  const link = event.target.closest('a[href="/"]');
  if (link && !event.metaKey && !event.ctrlKey) {
    event.preventDefault();
    showHome();
  }
});
$("signOut").onclick = async () => {
  await api("/auth/logout", {});
  location.href = "/";
};
async function route() {
  const target = parseRoute();
  if (target) return navigateReview(target.url, false, false);
  const id = location.pathname.match(/^\/runs\/([a-f0-9-]{36})$/)?.[1];
  if (id) {
    cancelNavigation();
    try {
      const run = await api("/api/runs/" + id);
      if (run.source.reviewId) {
        const parent = await api("/api/reviews/" + run.source.reviewId);
        history.replaceState(
          {},
          "",
          reviewPath(parent.source) +
            "?review=" +
            parent.id +
            "&change=" +
            run.source.changeId,
        );
        return navigateReview(parent.source.url, false, false);
      }
      $("home").hidden = true;
      $("reviewPage").hidden = false;
      $("reviewLoading").hidden = true;
      $("reviewLayout").hidden = false;
      $("reviewLayout").classList.add("legacy");
      $("changePicker").hidden = true;
      $("changeSidebar").hidden = true;
      $("codePanel").hidden = true;
      $("workspace").hidden = false;
      $("reviewRepo").textContent = run.source.baseRepo || run.source.repo;
      $("reviewTitle").textContent = run.source.title;
      $("reviewCommit").textContent = run.source.head.slice(0, 8);
      $("githubPr").href =
        run.source.url || "https://github.com/" + run.source.repo;
      await openRun(id, false);
    } catch (error) {
      toast(error.message);
      showHome(false);
    }
    return;
  }
  showHome(false);
  const url = new URL(location.href).searchParams.get("pr");
  if (url) navigateReview(url);
}
window.addEventListener("popstate", () => {
  const target = parseRoute();
  if (target && review?.source.url === target.url) {
    const id = new URL(location.href).searchParams.get("change");
    return id ? selectChange(id, false) : showChanges(false);
  }
  route();
});
setInterval(() => {
  if (!current) return;
  const seconds = Math.max(
    0,
    Math.round(
      (Date.parse(current.finished || new Date().toISOString()) -
        Date.parse(current.created)) /
        1000,
    ),
  );
  $("elapsed").textContent =
    Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
}, 1000);
async function init() {
  const target = parseRoute();
  $("home").hidden = !!target;
  $("reviewPage").hidden = !target;
  if (target) {
    $("reviewLoading").hidden = false;
    $("reviewRepo").textContent = target.repo;
    $("reviewTitle").textContent = "Pull request #" + target.number;
  }
  $("repositoryList").innerHTML = skeleton();
  try {
    const status = await api("/api/status");
    for (const id of ["connectRepos", "manageRepos"])
      $(id).href = status.installUrl;
    try {
      const me = await api("/api/me");
      user = me.user;
      localMode = me.local;
      if (user) {
        $("signIn").hidden = true;
        $("account").hidden = false;
        $("account").innerHTML = esc("@" + user.login) + icon("down");
      }
    } catch (error) {
      if (error.status !== 401) throw error;
    }
    const connected = !!user || localMode;
    $("connectedHome").hidden = !connected;
    $("signedOut").hidden = connected;
    if (connected && !target && !location.pathname.startsWith("/runs/"))
      await loadRepositories();
    if (target && !connected) {
      $("reviewSpinner").hidden = true;
      $("reviewPhase").textContent =
        "Connect GitHub to review this pull request";
      $("signIn").href =
        "/auth/github?returnTo=" +
        encodeURIComponent(location.pathname + location.search);
      return;
    }
    await route();
  } catch (error) {
    if (target) showReviewError(error);
    else {
      $("repositoryList").innerHTML =
        '<p class="inline-error">' + esc(error.message) + "</p>";
      $("connectedHome").hidden = false;
    }
    toast(error.message);
  }
}
init();
