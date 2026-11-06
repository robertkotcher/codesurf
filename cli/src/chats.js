const chats = new Map(),
  requests = new Map();
let activeChat = null,
  chatSequence = 0;
const chatStorageKey =
  "codesurf-chats:" +
  (report.generated || report.question || location.pathname);
function saveChats() {
  try {
    localStorage.setItem(
      chatStorageKey,
      JSON.stringify(
        [...chats.values()].map((c) => ({
          ...c,
          messages: c.messages.map((m) => ({
            ...m,
            status: m.status === "running" ? "interrupted" : m.status,
          })),
        })),
      ),
    );
  } catch {}
}
function restoreChats() {
  try {
    const saved = JSON.parse(
      localStorage.getItem(chatStorageKey) ||
        localStorage.getItem(
          chatStorageKey.replace("codesurf-chats:", "codetrail-chats:"),
        ) ||
        "[]",
    );
    for (const c of saved)
      if (c.id && nodes.has(c.selection?.nodeId) && Array.isArray(c.messages)) {
        if (!c.overview && [...chats.values()].some(saved => !saved.overview && saved.file === c.file && saved.selection.line === c.selection.line)) continue;
        chats.set(c.id, c);
        renderChat(c);
      }
  } catch {}
}
function activateChat(id) {
  activeChat = id;
  for (const c of chats.values())
    $("chat-" + c.id)?.classList.toggle("inactive", c.id !== id);
}
function positionChats() {
  if (!folderLayout) return;
  for (const c of chats.values()) {
    if (c.overview) continue;
    const p = endpoint(c.selection.nodeId),
      element = $("chat-" + c.id);
    if (!p || !element) continue;
    if (!c.manual) {
      c.x = p.x + p.width + 24 + c.stack * 24;
      c.y = p.y + 65 + c.stack * 24;
    }
    element.style.left = c.x * scale + tx + "px";
    element.style.top = c.y * scale + ty + "px";
  }
}
function openChat(button, explainLine = false) {
  const n = nodes.get(button.dataset.tokenNode),
    line = Number(button.dataset.tokenLine),
    column = Number(button.dataset.token);
  const existing = [...chats.values()].find(c => !c.overview && c.file === n.file && c.selection.line === line);
  if (existing) {
    activateChat(existing.id);
    positionChats();
    $("chat-" + existing.id)?.querySelector("input")?.focus();
    return;
  }
  const ref = report.symbolRefs?.[n.file]?.find(
    (r) => r.line === line && r.column === column,
  );
  const id = "q" + Date.now().toString(36) + ++chatSequence,
    stack = [...chats.values()].filter(
      (c) => c.selection.nodeId === n.id,
    ).length;
  const c = {
    id,
    selection: {
      nodeId: n.id,
      line,
      column,
      text: button.textContent,
      module: ref?.module || "",
    },
    file: n.file,
    explainLine,
    messages: [],
    stack,
    manual: false,
  };
  chats.set(id, c);
  renderChat(c);
  activateChat(id);
  positionChats();
  const element = $("chat-" + id),
    b = bounds(),
    left = parseFloat(element.style.left),
    top = parseFloat(element.style.top);
  if (left + 350 > b.width || top + 280 > b.height) {
    c.x = (Math.max(8, Math.min(b.width - 360, left)) - tx) / scale;
    c.y = (Math.max(90, Math.min(b.height - 290, top)) - ty) / scale;
    c.manual = true;
    positionChats();
  }
  element.querySelector("input").focus();
  saveChats();
}
function renderAnswer(text) {
  let result = "",
    at = 0;
  const pattern = /\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g;
  for (const match of text.matchAll(pattern)) {
    result += esc(text.slice(at, match.index));
    result += `<a href="${esc(match[2])}">${esc(match[1])}</a>`;
    at = match.index + match[0].length;
  }
  return result + esc(text.slice(at));
}
function renderChat(c) {
  let element = $("chat-" + c.id);
  if (!element) {
    element = document.createElement("section");
    element.id = "chat-" + c.id;
    element.className = "chat inactive" + (c.explainLine ? " line-explanation" : "");
    element.dataset.chat = c.id;
    element.setAttribute("aria-label", "Questions about " + c.selection.text);
    element.innerHTML = `<header class="chat-head" data-drag-chat="${c.id}"><div><strong>${esc(c.explainLine ? "Line " + c.selection.line : c.selection.text)}</strong><small>${esc(c.file)}:${c.selection.line}</small></div><button type="button" data-close-chat="${c.id}" aria-label="Close question panel">×</button></header><div class="chat-messages"></div><div class="chat-progress" role="status"></div><form class="chat-compose"><input aria-label="Ask a question about ${esc(c.selection.text)}" placeholder="Ask a follow-up question…"><button type="submit">Ask</button></form>`;
    if (c.overview) {
      element.classList.add("overview-chat");
      $("trace-overview").replaceChildren(element);
      element.querySelector("strong").textContent = "About this flow";
      element.querySelector("small").textContent = "Ask about any part of this trace";
      element.querySelector("[data-close-chat]").hidden = true;
    } else $("chats").append(element);
    element.addEventListener("pointerdown", () => activateChat(c.id));
    element.addEventListener("focusin", () => activateChat(c.id));
    element.querySelector("form").addEventListener("submit", (e) => {
      e.preventDefault();
      const input = element.querySelector("input"),
        question = input.value.trim();
      if (question) {
        input.value = "";
        askChat(c, question);
      }
    });
    element.querySelector("[data-close-chat]").onclick = () => {
      chats.delete(c.id);
      element.remove();
      saveChats();
    };
    element
      .querySelector("[data-drag-chat]")
      .addEventListener("pointerdown", (e) => {
        if (c.overview || e.target.closest("button") || e.button !== 0) return;
        e.preventDefault();
        const start = { x: e.clientX, y: e.clientY, cx: c.x, cy: c.y };
        c.manual = true;
        const head = e.currentTarget;
        head.setPointerCapture?.(e.pointerId);
        const move = (event) => {
          c.x = start.cx + (event.clientX - start.x) / scale;
          c.y = start.cy + (event.clientY - start.y) / scale;
          positionChats();
        };
        const up = () => {
          head.removeEventListener("pointermove", move);
          head.removeEventListener("pointerup", up);
          head.removeEventListener("pointercancel", up);
          saveChats();
        };
        head.addEventListener("pointermove", move);
        head.addEventListener("pointerup", up);
        head.addEventListener("pointercancel", up);
      });
  }
  const body = element.querySelector(".chat-messages"),
    nearBottom = body.scrollHeight - body.clientHeight - body.scrollTop < 45;
  body.innerHTML = c.messages
    .map(
      (m) =>
        `<div class="chat-message ${m.role}"><span class="chat-speaker">${m.role === "user" ? "You" : "CodeSurf"}</span><div class="chat-text">${m.status === "running" ? esc(m.text) : renderAnswer(m.text)}</div></div>`,
    )
    .join("");
  const last = c.messages.at(-1);
  element.querySelector(".chat-progress").classList.toggle("busy", last?.status === "running");
  element.querySelector(".chat-progress").textContent =
    last?.status === "running"
      ? last.progress || "Starting agent…"
      : last?.status === "interrupted"
        ? "Previous request was interrupted. Ask to continue."
        : "";
  if (nearBottom) body.scrollTop = body.scrollHeight;
  positionChats();
}
async function askChat(c, question) {
  if (c.messages.at(-1)?.status === "running") return;
  activateChat(c.id);
  const history = c.messages
    .slice(-10)
    .map((m) => ({ role: m.role, text: m.text }));
  c.messages.push({ role: "user", text: question });
  const message = {
    role: "assistant",
    text: "",
    status: "running",
    progress: "Starting agent…",
  };
  c.messages.push(message);
  const requestId = c.id + "-" + Date.now();
  requests.set(requestId, { chatId: c.id, message });
  renderChat(c);
  saveChats();
  if (!window.codesurf?.inspect) {
    message.status = "failed";
    message.text =
      "Open this report in the CodeSurf desktop window to ask questions.";
    renderChat(c);
    saveChats();
    return;
  }
  try {
    const result = await window.codesurf.inspect({
      ...c.selection,
      question,
      requestId,
      history,
    });
    if (!chats.has(c.id)) return;
    message.text = result.answer || message.text;
    message.status = "completed";
    renderChat(c);
  } catch (error) {
    if (!chats.has(c.id)) return;
    message.status = "failed";
    message.text +=
      (message.text ? "\n\n" : "") + "Request failed: " + error.message;
    renderChat(c);
  } finally {
    requests.delete(requestId);
    saveChats();
  }
}
function applyInspectEvent(event) {
  const request = requests.get(event.requestId),
    c = request && chats.get(request.chatId);
  if (!c) return;
  const message = request.message;
  if (event.type === "delta") message.text += event.text;
  else if (event.type === "progress") message.progress = event.message;
  else if (event.type === "done") {
    message.text = event.answer || message.text;
    message.status = "completed";
  }
  renderChat(c);
}
window.codesurf?.onInspect?.(applyInspectEvent);

window.addEventListener("blur", () => activateChat(null));

function initializeOverviewChat() {
  if (chats.has("overview")) return;
  const entry = nodes.get(report.entry);
  if (!entry) return;
  const text = (report.sources?.[entry.file]?.[entry.start - 1] || entry.lines[0] || "").slice(0, 1000);
  if (!text) return;
  const c = {id:"overview", overview:true, file:entry.file,
    selection:{nodeId:entry.id,line:entry.start,column:0,text},
    messages:[{role:"assistant",text:$("summary").textContent,status:"completed"}], stack:0};
  chats.set(c.id,c);
  renderChat(c);
}
