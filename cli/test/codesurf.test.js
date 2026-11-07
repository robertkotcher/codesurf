import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { JSDOM, VirtualConsole } from "jsdom";
import { analyze } from "../src/analyze.js";
import { applyPlan } from "../src/planner.js";
import { writeReport } from "../src/report.js";

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codesurf-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(
    path.join(root, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } }),
  );
  fs.writeFileSync(
    path.join(root, "src/service.ts"),
    "export const lookup = (id: string) => id.trim();\n",
  );
  fs.writeFileSync(
    path.join(root, "src/route.ts"),
    `import { lookup as find } from '@/service';
export function POST() {
  const payload = '</script><img src=x onerror=alert(1)>';
  const padding = 1;
  const other = 2;
  const result = find('hello');
  return result;
}
`,
  );
  return root;
}

test("resolves aliased imports, preserves line numbers, bounds traversal, and marks external calls", (t) => {
  const root = fixture(t);
  const r = analyze([root], "Trace POST", { entry: "src/route.ts#POST" });
  assert.equal(r.nodes.length, 2);
  assert.deepEqual(r.nodes[0].inputs, []);
  assert.equal(r.nodes[0].output.type, "string");
  assert.equal(r.nodes[0].calls[0].target, r.nodes[1].id);
  assert.equal(r.nodes[0].calls[0].line, 6);
  assert.equal(r.nodes[1].calls[0].kind, "boundary");
  assert.equal(analyze([root], "POST", { depth: 0 }).nodes.length, 1);
  assert.throws(
    () => analyze([root], "nonexistent-symbol"),
    /No matching entry/,
  );
});

test("Git highlights staged and unstaged additions against HEAD", (t) => {
  const root = fixture(t);
  const git = (...args) =>
    execFileSync("git", ["-C", root, ...args], { stdio: "pipe" });
  git("init");
  git("add", ".");
  git(
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "-m",
    "fixture",
  );
  fs.writeFileSync(
    path.join(root, "src/service.ts"),
    "export const lookup = (id: string) => id.toUpperCase();\n",
  );
  git("add", ".");
  assert.deepEqual(analyze([root], "lookup").nodes[0].changed, [1]);
});

test("graph expands source, anchors edges to row sides, opens token questions, and zooms safely", async (t) => {
  const root = fixture(t),
    out = path.join(root, "report.html");
  execFileSync(process.execPath, [
    "src/cli.js",
    root,
    "POST",
    "--depth",
    "4",
    "--static",
    "--out",
    out,
    "--html-only",
  ]);
  const errors = [],
    console = new VirtualConsole();
  console.on("jsdomError", (e) => errors.push(e.message));
  const dom = new JSDOM(fs.readFileSync(out, "utf8"), {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole: console,
    beforeParse(window) {
      window.ResizeObserver = class {
        observe() {}
        disconnect() {}
      };
    },
  });
  t.after(() => dom.window.close());
  const d = dom.window.document;
  for (const id of [...d.querySelectorAll('[data-function-toggle][aria-expanded="false"]')].map(b => b.dataset.functionToggle)) d.querySelector(`[data-function-toggle="${id}"]`).click();
  const nextFrame = () =>
    new Promise((resolve) => dom.window.requestAnimationFrame(resolve));
  await nextFrame();
  assert.equal(d.querySelectorAll("article").length, 2);
  assert.equal(d.querySelectorAll("img").length, 0);
  d.querySelector("[data-below]").click();
  assert.match(d.querySelector(".snippet").textContent, /<\/script><img/);
  assert.equal(d.querySelectorAll("img").length, 0);
  const link = [...d.querySelectorAll("[data-token]")].find(
    (button) =>
      button.textContent === "find" && button.dataset.tokenLine === "6",
  );
  link.click();
  assert.equal(d.querySelectorAll(".chat:not(.overview-chat)").length, 1);
  assert.equal(d.querySelector("#token-definition"), null);
  const cards = [...d.querySelectorAll("article")];
  assert.ok(parseFloat(cards[1].style.left) > parseFloat(cards[0].style.left));
  const edge = d.querySelector(".edge[data-from-line]");
  assert.equal(edge.dataset.fromLine, "6");
  assert.equal(edge.dataset.fromSide, "right");
  assert.equal(edge.dataset.toSide, "left");
  assert.equal(cards[0].querySelector("[data-line-port]"), null);
  const coords = edge
    .getAttribute("d")
    .match(/-?\d+(?:\.\d+)?/g)
    .map(Number);
  assert.equal(
    coords[0],
    parseFloat(cards[0].style.left) + parseFloat(cards[0].style.width),
  );
  assert.equal(coords.at(-2), parseFloat(cards[1].style.left));
  d.querySelector("[data-wrap]").click();
  assert.ok(d.querySelector(".snippet.wrap"));
  const before = d.querySelector("#world").style.transform;
  d.querySelector("#plus").click();
  assert.notEqual(d.querySelector("#world").style.transform, before);
  d.querySelector("#minus").click();
  const numbers = (s) => s.match(/-?\d+(?:\.\d+)?/g).map(Number);
  numbers(before).forEach((n, i) =>
    assert.ok(
      Math.abs(numbers(d.querySelector("#world").style.transform)[i] - n) <
        1e-8,
    ),
  );
  // Expanding above the function includes its imports, without executing source markup.
  d.querySelector("[data-above]").click();
  assert.match(
    cards[0].textContent + d.querySelector("article").textContent,
    /import/,
  );
  assert.deepEqual(errors, []);
});

test("LLM plan validates selected code, rejects invented lines, and preserves omitted branches", (t) => {
  const root = fixture(t),
    index = analyze([root], "Explain the request", { catalog: true });
  const entry = index.definitions.find((n) => n.name === "POST");
  const lookup = index.definitions.find((n) => n.name === "lookup");
  const plan = {
    entryId: entry.id,
    title: "Find a value",
    summary: "Trims the value.",
    assumptions: [],
    omitted: [],
    steps: [
      {
        id: entry.id,
        reason: "Handles request",
        lines: [2, 6, 7],
        skipCalls: [],
      },
      { id: lookup.id, reason: "Trims input", lines: [1], skipCalls: [] },
    ],
  };
  const report = applyPlan(index, plan);
  assert.equal(report.nodes[1].level, 1);
  assert.equal(report.mode, "llm");
  assert.equal(report.groups, undefined);
  assert.deepEqual(report.nodes[0].relevantLines, [2, 6, 7]);
  assert.throws(
    () =>
      applyPlan(index, {
        ...plan,
        steps: [{ ...plan.steps[0], lines: [900] }],
      }),
    /invalid source lines/,
  );
  assert.throws(
    () =>
      applyPlan(index, {
        ...plan,
        steps: [
          { ...plan.steps[0], skipCalls: [{ line: 6, reason: "Irrelevant" }] },
          plan.steps[1],
        ],
      }),
    /without a verified path/,
  );
  assert.throws(
    () =>
      applyPlan(index, {
        ...plan,
        steps: [{ ...plan.steps[0], id: "invented" }],
      }),
    /unknown/,
  );
});

test("graph view has no follow-up request bar", async (t) => {
  const root = fixture(t),
    out = path.join(root, "welcome.html");
  // Welcome generation needs no source analysis or LLM; disable desktop opening via a generated static report fixture.
  execFileSync(process.execPath, [
    "src/cli.js",
    root,
    "POST",
    "--static",
    "--out",
    out,
    "--html-only",
  ]);
  let question;
  const dom = new JSDOM(fs.readFileSync(out, "utf8"), {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    beforeParse(window) {
      window.ResizeObserver = class {
        observe() {}
        disconnect() {}
      };
      window.codesurf = {
        trace: async (value) => {
          question = value;
        },
        onProgress: () => {},
      };
    },
  });
  t.after(() => dom.window.close());
  assert.equal(dom.window.document.querySelector("#ask"), null);
  assert.equal(dom.window.document.querySelector("#question-input"), null);
});

test("token questions stream into independent persistent panels and fade on click-away", async (t) => {
  const root = fixture(t),
    out = path.join(root, "report.html");
  execFileSync(process.execPath, [
    "src/cli.js",
    root,
    "POST",
    "--static",
    "--out",
    out,
    "--html-only",
  ]);
  const pending = [];
  let onInspect;
  const dom = new JSDOM(fs.readFileSync(out, "utf8"), {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    url: "http://codesurf.test/",
    beforeParse(w) {
      w.ResizeObserver = class {
        observe() {}
        disconnect() {}
      };
      w.codesurf = {
        onProgress: () => {},
        onInspect: (callback) => {
          onInspect = callback;
        },
        inspect: (selection) =>
          new Promise((resolve) => pending.push({ selection, resolve })),
      };
    },
  });
  t.after(() => dom.window.close());
  const d = dom.window.document;
  for (const id of [...d.querySelectorAll('[data-function-toggle][aria-expanded="false"]')].map(b => b.dataset.functionToggle)) d.querySelector(`[data-function-toggle="${id}"]`).click();
  const token = [...d.querySelectorAll("[data-token]")].find(
    (b) => b.textContent === "find" && b.dataset.tokenLine === "6",
  );
  token.click();
  const first = d.querySelector(".chat:not(.overview-chat)");
  first.querySelector("input").value = "What does this do?";
  first
    .querySelector("form")
    .dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
  onInspect({
    requestId: pending[0].selection.requestId,
    type: "progress",
    message: "Reading repository source…",
  });
  assert.match(
    first.querySelector(".chat-progress").textContent,
    /Reading repository/,
  );
  onInspect({
    requestId: pending[0].selection.requestId,
    type: "delta",
    text: "It looks ",
  });
  onInspect({
    requestId: pending[0].selection.requestId,
    type: "delta",
    text: "up a value.",
  });
  assert.match(first.textContent, /It looks up a value/);
  d.querySelector('[data-file="src/route.ts"][data-line="7"] .token').click();
  const second = d.querySelectorAll(".chat:not(.overview-chat)")[1];
  assert.ok(first.classList.contains("inactive"));
  second.querySelector("input").value = "What about empty input?";
  second
    .querySelector("form")
    .dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
  onInspect({
    requestId: pending[1].selection.requestId,
    type: "delta",
    text: "Empty input stays empty.",
  });
  assert.match(second.textContent, /Empty input stays empty/);
  assert.doesNotMatch(first.textContent, /Empty input stays empty/);
  for (const p of pending) {
    onInspect({
      requestId: p.selection.requestId,
      type: "done",
      answer: "[Reference](https://example.com/docs)",
    });
    p.resolve({ answer: "[Reference](https://example.com/docs)" });
  }
  await new Promise((resolve) => dom.window.requestAnimationFrame(resolve));
  assert.equal(d.querySelectorAll(".chat:not(.overview-chat)").length, 2);
  assert.equal(first.querySelector(".chat-messages a").href, "https://example.com/docs");
  d.querySelector("#viewport").click();
  assert.ok(
    [...d.querySelectorAll(".chat:not(.overview-chat)")].every((c) =>
      c.classList.contains("inactive"),
    ),
  );
  assert.ok(dom.window.localStorage.length > 0);
});

test("explicit gaps and surrounding context reveal source", (t) => {
  const root = fixture(t),
    out = path.join(root, "report.html");
  execFileSync(process.execPath, [
    "src/cli.js",
    root,
    "POST",
    "--static",
    "--out",
    out,
    "--html-only",
  ]);
  const report = JSON.parse(
    fs.readFileSync(out.replace(".html", ".json"), "utf8"),
  );
  report.nodes[0].relevantLines = [2, 6, 7];
  report.groups = [
    {
      id: "boundary",
      label: "Request entry",
      description: "Fixture role",
      files: ["src/route.ts"],
    },
    {
      id: "values",
      label: "Value handling",
      description: "Fixture role",
      files: ["src/service.ts"],
    },
  ];
  for (const n of report.nodes)
    n.groupId = n.file === "src/route.ts" ? "boundary" : "values";
  writeReport(report, out);
  const dom = new JSDOM(fs.readFileSync(out, "utf8"), {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    beforeParse(w) {
      w.ResizeObserver = class {
        observe() {}
        disconnect() {}
      };
    },
  });
  t.after(() => dom.window.close());
  const d = dom.window.document;
  for (const id of [...d.querySelectorAll('[data-function-toggle][aria-expanded="false"]')].map(b => b.dataset.functionToggle)) d.querySelector(`[data-function-toggle="${id}"]`).click();
  d.querySelector("[data-gap]").click();
  d.querySelector('[data-file="src/route.ts"]').closest("article").querySelector("[data-below]").click();
  assert.equal(d.querySelectorAll("[data-gap], [data-expand]").length, 0);
  assert.equal(d.querySelector(".fold"), null);
  const route = d.querySelector('[data-file="src/route.ts"]').closest("article");
  assert.deepEqual([...route.querySelectorAll(".line")].map(row => Number(row.dataset.line)), [2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(d.querySelectorAll(".folder").length, 1);
  assert.match(d.querySelector(".folder").textContent, /src/);

  d.querySelector("[data-below]").click();
  assert.match(
    d.querySelector("article .snippet").textContent,
    /const padding/,
  );
});

test("question and response live in the graph, reserve their own lane, and connect to a collapsed entry folder", async (t) => {
  const root = fixture(t),
    out = path.join(root, "overview.html");
  const report = analyze([root], "What happens when the user sends a value?", {
    entry: "src/route.ts#POST",
  });
  report.title = "Follow the request";
  report.summary = "The handler looks up and normalizes the value.";
  writeReport(report, out);
  const errors = [],
    vc = new VirtualConsole();
  vc.on("jsdomError", (e) => errors.push(e.message));
  const dom = new JSDOM(fs.readFileSync(out, "utf8"), {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(w) {
      w.ResizeObserver = class {
        observe() {}
        disconnect() {}
      };
    },
  });
  t.after(() => dom.window.close());
  const d = dom.window.document,
    nextFrame = () =>
      new Promise((resolve) => dom.window.requestAnimationFrame(resolve));
  await nextFrame();
  const overview = d.querySelector("#trace-overview");
  assert.equal(overview.parentElement.id, "world");
  assert.equal(d.querySelector(".summary"), null);
  assert.equal(d.querySelector("#overview-question"), null);
  assert.match(overview.querySelector(".chat-messages").textContent, new RegExp(report.summary));
  const overviewRight = parseFloat(overview.style.left) + 350;
  for (const element of d.querySelectorAll(".node,.folder"))
    assert.ok(parseFloat(element.style.left) > overviewRight);
  assert.equal(d.querySelector(".overview-edge").dataset.to, report.entry);
  const before = d.querySelector("#world").style.transform;
  d.querySelector("#plus").click();
  assert.notEqual(d.querySelector("#world").style.transform, before);
  d.querySelector('[data-folder="src"]').click();
  await nextFrame();
  assert.equal(d.querySelector(".overview-edge").dataset.toFolder, "src");
  assert.equal(d.querySelectorAll(".node:not([hidden])").length, 0);
  assert.deepEqual(errors, []);
});

test("line whitespace opens an empty chat for a user question", async (t) => {
  const root = fixture(t), out = path.join(root, 'line.html');
  writeReport(analyze([root], 'POST', {entry:'src/route.ts#POST'}), out);
  const pending = [];
  const dom = new JSDOM(fs.readFileSync(out,'utf8'), {
    runScripts:'dangerously', pretendToBeVisual:true,
    beforeParse(w) {
      w.ResizeObserver = class {observe(){} disconnect(){}};
      w.codesurf = {onInspect(){}, inspect: selection => new Promise(resolve => pending.push({selection,resolve}))};
    }
  });
  t.after(()=>dom.window.close());
  const d=dom.window.document;
  for (const id of [...d.querySelectorAll('[data-function-toggle][aria-expanded="false"]')].map(b => b.dataset.functionToggle)) d.querySelector(`[data-function-toggle="${id}"]`).click();
  d.querySelector('[data-file="src/route.ts"][data-line="6"] .source-text').click();
  d.querySelector('[data-file="src/route.ts"][data-line="6"] .token').click();
  d.querySelector('[data-file="src/route.ts"][data-line="6"] .source-text').click();
  assert.equal(d.querySelectorAll('.chat:not(.overview-chat)').length, 1);
  assert.equal(pending.length,0);
  assert.equal(d.querySelector('.line-explanation .chat-messages').textContent, '');
  d.querySelector('.line-explanation input').value='What does this line do?';
  d.querySelector('.line-explanation form').dispatchEvent(new dom.window.Event('submit',{cancelable:true}));
  assert.equal(pending.length,1);
  assert.equal(pending[0].selection.question,'What does this line do?');
  assert.equal(pending[0].selection.text,"const");
  assert.ok(d.querySelector('.line-explanation .chat-progress.busy'));
  pending[0].resolve({answer:'Looks up the value.'});
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(d.querySelector('.chat-progress.busy'),null);
  assert.match(d.querySelector('.line-explanation .chat-messages').textContent,/Looks up the value/);
  d.querySelector('.line-explanation input').value='Why?';
  d.querySelector('.line-explanation form').dispatchEvent(new dom.window.Event('submit',{cancelable:true}));
  assert.equal(pending.length,2);
  assert.equal(pending[1].selection.history.length,2);
  pending[1].resolve({answer:'For the request.'});
});

test('functions initially collapse and their info buttons show descriptions', t => {
  const root=fixture(t), out=path.join(root,'collapsed.html');
  const report=analyze([root],'POST',{entry:'src/route.ts#POST'});
  report.nodes[0].description='Looks up the requested value and returns it.';
  writeReport(report,out);
  const dom=new JSDOM(fs.readFileSync(out,'utf8'),{runScripts:'dangerously',pretendToBeVisual:true,beforeParse(w){w.ResizeObserver=class{observe(){} disconnect(){}};}});
  t.after(()=>dom.window.close());
  const d=dom.window.document;
  assert.equal(d.querySelector('[data-file="src/route.ts"][data-line="6"]'),null);
  d.querySelector('[data-function-info]').click();
  assert.match(d.querySelector('[role="tooltip"]').textContent,/Looks up/);
  d.querySelector('[data-function-toggle]').click();
  assert.ok(d.querySelector('[data-file="src/route.ts"][data-line="6"]'));
});

test('introductory card supports follow-ups with the walkthrough in context', async t => {
  const root=fixture(t), out=path.join(root,'intro-chat.html');
  const report=analyze([root],'POST',{entry:'src/route.ts#POST'});
  report.summary='The handler looks up a value and returns it.';
  writeReport(report,out);
  let selection;
  const dom=new JSDOM(fs.readFileSync(out,'utf8'),{runScripts:'dangerously',pretendToBeVisual:true,beforeParse(w){w.ResizeObserver=class{observe(){} disconnect(){}};w.codesurf={onInspect(){},inspect:async s=>{selection=s;return {answer:'It returns the lookup result.\n\n[Docs](https://example.com)\n\n- **Result**: `string`\n\n<script>alert(1)</script>'};}};}});
  t.after(()=>dom.window.close());
  const card=dom.window.document.querySelector('.overview-chat');
  assert.ok(card);
  assert.match(card.textContent,/handler looks up/);
  card.querySelector('input').value='What is returned?';
  card.querySelector('form').dispatchEvent(new dom.window.Event('submit',{cancelable:true}));
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(selection.question,'What is returned?');
  assert.equal(selection.history[0].text,report.summary);
  assert.match(card.textContent,/returns the lookup result/);
  assert.equal(card.querySelector('.chat-text a').href,'https://example.com/');
  assert.ok(card.querySelector('.chat-text li strong'));
  assert.ok(card.querySelector('.chat-text code'));
  assert.equal(card.querySelector('.chat-text script'),null);
});

test('large functions initially show scenario evidence and expandable gaps',t=>{
 const root=fixture(t), out=path.join(root,'focused.html');
 fs.writeFileSync(path.join(root,'large.ts'),'export function renderPlane() {\n'+Array.from({length:100},(_,i)=>`  const value${i} = ${i};`).join('\n')+'\n}\n');
 const report=analyze([root],'renderPlane',{entry:'large.ts#renderPlane'});
 report.nodes[0].relevantLines=[5,95];writeReport(report,out);
 const dom=new JSDOM(fs.readFileSync(out,'utf8'),{runScripts:'dangerously',pretendToBeVisual:true,beforeParse(w){w.ResizeObserver=class{observe(){} disconnect(){}};}});t.after(()=>dom.window.close());
 const d=dom.window.document;
 assert.ok(d.querySelector('[data-line="5"]'));
 assert.equal(d.querySelector('[data-line="50"]'),null);
 assert.ok(d.querySelectorAll('.line').length<25);
 [...d.querySelectorAll('[data-gap]')].find(b => Number(b.dataset.from) <= 50 && Number(b.dataset.to) >= 50).click();
 assert.ok(d.querySelector('[data-line="50"]'));
 assert.equal(d.querySelector('[data-full-file]'),null);
 d.querySelector('[data-undo]').click();
 assert.equal(d.querySelector('[data-line="50"]'),null);
 d.querySelector('[data-redo]').click();
 assert.ok(d.querySelector('[data-line="50"]'));
});

test('symbol chats show definitions, scale with the canvas, and hide with files and folders',t=>{
 const root=fixture(t),out=path.join(root,'symbols.html');
 writeReport(analyze([root],'POST',{entry:'src/route.ts#POST'}),out);
 const dom=new JSDOM(fs.readFileSync(out,'utf8'),{runScripts:'dangerously',pretendToBeVisual:true,beforeParse(w){w.ResizeObserver=class{observe(){} disconnect(){}};}});t.after(()=>dom.window.close());
 const d=dom.window.document;
 for(const id of [...d.querySelectorAll('[data-function-toggle]')].map(b=>b.dataset.functionToggle))d.querySelector(`[data-function-toggle="${id}"]`).click();
 const token=[...d.querySelectorAll('[data-token]')].find(b=>b.textContent==='find');
 token.click();
 const chat=d.querySelector('.chat:not(.overview-chat)');
 assert.match(chat.querySelector('.chat-definition .definition-origin').textContent,/Defined in src\/service.ts:1/);
 assert.equal(chat.querySelector('.definition-line-number').textContent,'1');
 assert.match(chat.querySelector('.chat-definition pre').textContent,/id.trim/);
 assert.equal(chat.querySelector('.chat-definition a'),null);
 const before=chat.style.transform;d.querySelector('#plus').click();assert.notEqual(chat.style.transform,before);
 const leftBefore=parseFloat(chat.style.left);
 d.querySelector('#viewport').dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
 assert.ok(Math.abs(parseFloat(chat.style.left)-(leftBefore-40))<0.001);
 const position=dom.window.eval('JSON.stringify([...chats.values()].find(c=>!c.overview).x)');
 dom.window.eval('tx=-10000; transform()');
 token.dispatchEvent(new dom.window.MouseEvent('pointerover',{bubbles:true}));
 assert.equal(d.querySelector('#chat-direction').hidden,false);
 assert.equal(dom.window.eval('JSON.stringify([...chats.values()].find(c=>!c.overview).x)'),position);

 token.dispatchEvent(new dom.window.MouseEvent('pointerover',{bubbles:true}));assert.ok(token.classList.contains('symbol-highlight'));
 d.querySelector('[data-collapse-file="file:src/route.ts"]').click();assert.equal(chat.hidden,true);
 d.querySelector('[data-collapse-file="file:src/route.ts"]').click();assert.equal(chat.hidden,false);
 d.querySelector('[data-folder="src"]').click();assert.equal(chat.hidden,true);
 d.querySelector('[data-folder="src"]').click();assert.equal(chat.hidden,false);
});

test('definition hover never expands source; eye reveal supports file undo and redo',t=>{
 const root=fixture(t),out=path.join(root,'eye.html');
 fs.writeFileSync(path.join(root,'eye.ts'),'export function example() {\n  const item = 42;\n'+Array(40).fill('  // unrelated').join('\n')+'\n  return item;\n}\n');
 const r=analyze([root],'example',{entry:'eye.ts#example'});r.nodes[0].relevantLines=[43];writeReport(r,out);
 const dom=new JSDOM(fs.readFileSync(out,'utf8'),{runScripts:'dangerously',pretendToBeVisual:true,beforeParse(w){w.ResizeObserver=class{observe(){} disconnect(){}};}});t.after(()=>dom.window.close());
 const d=dom.window.document,token=[...d.querySelectorAll('[data-token]')].find(t=>t.textContent==='item');
 token.dispatchEvent(new dom.window.MouseEvent('pointerover',{bubbles:true}));assert.equal(d.querySelector('[data-line="2"]'),null);
 token.click();const chat=d.querySelector('.chat:not(.overview-chat)');assert.match(chat.querySelector('.chat-definition pre').textContent,/const item/);
 chat.querySelector('[aria-label="Reveal definition in code"]').click();assert.ok(d.querySelector('[data-line="2"]'));
 d.querySelector('[data-undo]').click();assert.equal(d.querySelector('[data-line="2"]'),null);
 d.querySelector('[data-redo]').click();assert.ok(d.querySelector('[data-line="2"]'));
});
