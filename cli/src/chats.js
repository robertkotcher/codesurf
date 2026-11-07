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
let hoveredSymbolKey = null, hoveredChatId = null;
function chatSymbolKey(c) {
  if (!c || c.overview || c.explainLine) return null;
  const ref = report.symbolRefs?.[c.file]?.find(r=>r.line===c.selection.line && r.column===c.selection.column);
  return c.selection.symbolKey || ref?.target || c.selection.target || c.file+":"+c.selection.text;
}
function refreshChatEmphasis() {
  const selected = chats.get(hoveredChatId || activeChat);
  const key = hoveredSymbolKey || chatSymbolKey(selected);
  for (const token of document.querySelectorAll("[data-symbol-key]"))
    token.classList.toggle("symbol-highlight", Boolean(key) && token.dataset.symbolKey===key);
  for (const c of chats.values()) {
    const related = hoveredSymbolKey && chatSymbolKey(c)===hoveredSymbolKey;
    $("chat-"+c.id)?.classList.toggle("inactive", !related && c.id !== hoveredChatId && c.id !== activeChat);
    $("chat-"+c.id)?.classList.toggle("symbol-related", Boolean(related));
  }
  updateChatDirection();
}
function activateChat(id) { activeChat=id;refreshChatEmphasis(); }
function anchorChat(c, button) {
  const rect = button.getBoundingClientRect?.();
  if (!rect) return;
  const b = bounds();
  c.x = (rect.left - b.left - tx) / scale;
  c.y = (rect.bottom - b.top + 8 - ty) / scale;
  c.manual = true;
}
function positionChats() {
  if (!folderLayout) return;
  for (const c of chats.values()) {
    if (c.overview) continue;
    const p = endpoint(c.selection.nodeId), element = $("chat-" + c.id);
    if (!p || !element) continue;
    const panelId = graph.panelForFunction.get(c.selection.nodeId);
    const card = $("node-" + panelId);
    element.hidden = Boolean(p.folder || collapsedFiles.has(panelId) ||
      !card?.querySelector(`[data-line="${c.selection.line}"]`));
    if (!c.manual) {c.x=p.x+30;c.y=p.y+80;}
    const left=c.x*scale+tx;
    const top=c.y*scale+ty;
    element.style.left=left+"px";element.style.top=top+"px";
    element.style.transform=`scale(${scale})`;
    element.style.transformOrigin="0 0";
  }
  updateChatDirection();
}
function updateChatDirection() {
  let indicator = $("chat-direction");
  const key=hoveredSymbolKey;
  const c=key && [...chats.values()].find(c=>!c.overview && chatSymbolKey(c)===key);
  const element=c && $("chat-"+c.id);
  if(!element || element.hidden){if(indicator)indicator.hidden=true;return;}
  const b=bounds(),left=c.x*scale+tx,top=c.y*scale+ty;
  const width=(element.offsetWidth || 340)*scale,height=(element.offsetHeight || 290)*scale;
  if(left+width>=0 && left<=b.width && top+height>=0 && top<=b.height){if(indicator)indicator.hidden=true;return;}
  if(!indicator){indicator=document.createElement("div");indicator.id="chat-direction";indicator.setAttribute("role","status");$("chats").append(indicator);}
  const dx=left+width/2-b.width/2,dy=top+height/2-b.height/2;
  const ratio=Math.min((b.width/2-65)/Math.max(1,Math.abs(dx)),(b.height/2-24)/Math.max(1,Math.abs(dy)));
  indicator.style.left=Math.max(8,b.width/2+dx*ratio)+"px";
  indicator.style.top=Math.max(8,b.height/2+dy*ratio)+"px";
  const horizontal=Math.abs(dx)>Math.abs(dy);
  const arrow=horizontal?(dx<0?"←":"→"):(dy<0?"↑":"↓");
  indicator.textContent=`${arrow} Chat`;
  indicator.setAttribute("aria-label",`Chat for ${c.selection.text} is offscreen ${horizontal?(dx<0?"left":"right"):(dy<0?"above":"below")}`);
  indicator.hidden=false;
}
function openChat(button, explainLine = false) {
  const n = nodes.get(button.dataset.tokenNode),
    line = Number(button.dataset.tokenLine),
    column = Number(button.dataset.token);
  const existing = [...chats.values()].find(c => !c.overview && c.file === n.file && c.selection.line === line);
  if (existing) {
    if (!explainLine) {
      existing.selection = {...existing.selection,column,text:button.textContent,target:button.dataset.target,symbolKey:button.dataset.symbolKey};
      existing.explainLine = false;
      renderChat(existing);
      $("chat-" + existing.id).querySelector("strong").textContent = button.textContent;
    }
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
      target: button.dataset.target || ref?.target,
      symbolKey: button.dataset.symbolKey,
    },
    file: n.file,
    explainLine,
    messages: [],
    stack,
    manual: false,
  };
  anchorChat(c, button);
  chats.set(id, c);
  renderChat(c);
  activateChat(id);
  positionChats();
  $("chat-" + id).querySelector("input").focus();
  saveChats();
}
const chatMarkdown = window.markdownit({html:false,linkify:true,breaks:true});
function renderAnswer(text) { return chatMarkdown.render(String(text)); }
function renderChat(c) {
  let element = $("chat-" + c.id);
  if (!element) {
    element = document.createElement("section");
    element.id = "chat-" + c.id;
    element.className = "chat inactive" + (c.explainLine ? " line-explanation" : "");
    element.dataset.chat = c.id;
    element.setAttribute("aria-label", "Questions about " + c.selection.text);
    element.innerHTML = `<header class="chat-head" data-drag-chat="${c.id}"><div><strong>${esc(c.explainLine ? "Line " + c.selection.line : c.selection.text)}</strong><small>${esc(c.file)}:${c.selection.line}</small></div><button type="button" data-close-chat="${c.id}" aria-label="Close question panel">×</button></header><div class="chat-definition"></div><div class="chat-messages"></div><div class="chat-progress" role="status"></div><form class="chat-compose"><input aria-label="Ask a question about ${esc(c.selection.text)}" placeholder="Ask a follow-up question…"><button type="submit">Ask</button></form>`;
    if (c.overview) {
      element.classList.add("overview-chat");
      $("trace-overview").replaceChildren(element);
      element.querySelector("strong").textContent = "About this flow";
      element.querySelector("small").textContent = "Ask about any part of this trace";
      element.querySelector("[data-close-chat]").hidden = true;
    } else $("chats").append(element);
    element.addEventListener("pointerenter", () => {hoveredChatId=c.id;refreshChatEmphasis();});
    element.addEventListener("pointerleave", () => {hoveredChatId=null;refreshChatEmphasis();});
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
  if (!c.overview) {
    const ref = report.symbolRefs?.[c.file]?.find(r=>r.line===c.selection.line && r.column===c.selection.column);
    const target = ref?.target || c.selection.target;
    const definition = target && definitions.get(target);
    const detail = element.querySelector(".chat-definition");
    detail.replaceChildren();
    if (definition) {
      const origin=document.createElement("div");
      origin.className="definition-origin";
      origin.textContent=`Defined in ${definition.file}:${definition.start}`;
      const code=document.createElement("pre");
      const fullSource=report.sources?.[definition.file];
      const context=definition.contextLines || (fullSource ? fullSource.slice(Math.max(0,definition.start-2),definition.start+1) : definition.lines?.slice(0,2)) || [];
      const contextStart=definition.contextLines || fullSource ? Math.max(1,definition.start-1) : definition.start;
      context.forEach((text,index)=>{
        const row=document.createElement("span");row.className="definition-code-line";
        const number=document.createElement("span");number.className="definition-line-number";number.textContent=String(contextStart+index);
        const content=document.createElement("span");content.textContent=text;
        row.append(number,content);code.append(row);
      });
      const eye=document.createElement("button");eye.className="definition-eye";eye.innerHTML='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';eye.setAttribute("aria-label","Reveal definition in code");eye.onclick=()=>revealDefinition(definition);
      detail.append(origin,eye,code);
    } else if (!definition && c.selection.module) {
      detail.textContent=`From ${c.selection.module} — source unavailable in this snapshot`;
    }
  }
  const body = element.querySelector(".chat-messages"),
    nearBottom = body.scrollHeight - body.clientHeight - body.scrollTop < 45;
  body.innerHTML = c.messages
    .map(
      (m) =>
        `<div class="chat-message ${m.role}"><span class="chat-speaker">${m.role === "user" ? "You" : "CodeSurf"}</span><div class="chat-text">${renderAnswer(m.text)}</div></div>`,
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
