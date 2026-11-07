import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { analyze } from "../src/analyze.js";

function fixture(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codesurf-languages-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  }
  return root;
}

test("Python resolves relative imports, aliases, src layouts, async, and Unicode columns without executing application code", (t) => {
  const root = fixture(t, {
    "src/app/__init__.py": "",
    "src/app/routes.py": `from .service import normalize as clean\nraise RuntimeError("MUST NOT EXECUTE")\nasync def endpoint(value):\n    marker = "😀"; return clean(value)\n`,
    "src/app/service.py": `from .model import save\ndef normalize(value):\n    match value.strip():\n        case "":\n            raise ValueError("empty")\n        case text:\n            return save(text)\n`,
    "src/app/model.py": 'def save(text):\n    return {"text": text}\n',
    ".venv/lib/broken.py": "this is not python !!!!!",
  });
  const r = analyze([root], "endpoint", {
    entry: "src/app/routes.py#endpoint",
  });
  assert.deepEqual(
    r.nodes.map((n) => n.name),
    ["endpoint", "normalize", "save"],
  );
  assert.equal(r.nodes[0].calls[0].column, '    marker = "😀"; return '.length);
  assert.equal(r.nodes[0].calls[0].target, r.nodes[1].id);
  assert.equal(r.nodes[0].calls[0].line, 4);
  assert.equal(r.diagnostics.length, 0);
  assert.match(r.parsers.python, /3\./);
  const ref = r.symbolRefs["src/app/routes.py"].find((r) => r.text === "clean");
  assert.equal(ref.target, r.nodes[1].id);
});

test("Python resolves class instance methods, lexical closures, and respects parameter shadowing", (t) => {
  const root = fixture(t, {
    "main.py": `class Service:\n    def run(self, value):\n        def inner():\n            return value\n        return inner()\ndef entry(value):\n    service = Service()\n    return service.run(value)\ndef shadow(entry):\n    return entry("not the module function")\n`,
  });
  const r = analyze([root], "entry", { entry: "main.py#entry" });
  assert.deepEqual(
    r.nodes.map((n) => n.name),
    ["entry", "run", "inner"],
  );
  const shadow = r.definitions.find((n) => n.name === "shadow");
  assert.equal(shadow.calls[0].target, null);
});

test("Python reports syntax failures and supports recent generic syntax with a matching interpreter", (t) => {
  const root = fixture(t, {
    "good.py": "def entry():\n    return 1\n",
    "broken.py": "def bad(:\n    pass\n",
  });
  let r = analyze([root], "entry");
  assert.equal(r.diagnostics.length, 1);
  assert.match(r.diagnostics[0], /broken.py/);
  const version = Number(r.parsers.python.match(/\(3\.(\d+)/)[1]);
  if (version >= 12) {
    fs.writeFileSync(
      path.join(root, "generic.py"),
      "type Items[T] = list[T]\ndef first[T](items: Items[T]) -> T:\n    return items[0]\n",
    );
    r = analyze([root], "first");
    assert.equal(r.nodes[0].name, "first");
    assert.equal(r.diagnostics.length, 1);
  }
});

test("Node ESM .mjs/.mts and CommonJS .cjs resolve local definitions", (t) => {
  const root = fixture(t, {
    "math.mts": "export function twice(value: number) { return value * 2; }\n",
    "entry.mts":
      'import { twice } from "./math.mjs"; export async function entry() { return twice(3); }\n',
    "lib.cjs": "exports.increment = function increment(n) { return n + 1; };\n",
    "run.cjs":
      'const lib = require("./lib.cjs"); function run() { return lib.increment(1); } module.exports = { run };\n',
  });
  let r = analyze([root], "entry", { entry: "entry.mts#entry" });
  assert.deepEqual(
    r.nodes.map((n) => n.name),
    ["entry", "twice"],
  );
  r = analyze([root], "run", { entry: "run.cjs#run" });
  assert.deepEqual(
    r.nodes.map((n) => n.name),
    ["run", "increment"],
  );
});

test("mixed Python and Node roots keep unique IDs and report both language families", (t) => {
  const root = fixture(t, {
    "main.py": "def run():\n    return 1\n",
    "main.ts": "export function run() { return 2; }\n",
  });
  const r = analyze([root], "run", { catalog: true });
  assert.equal(r.definitions.length, 2);
  assert.equal(new Set(r.definitions.map((n) => n.id)).size, 2);
  assert.ok(r.languages.includes("Python"));
  assert.ok(r.languages.includes("TypeScript"));
  const py = analyze([root], "run", { entry: "main.py#run" });
  assert.equal(py.nodes[0].language, "Python");
});

import {languageAdapters,validateIndex} from '../src/languages/index.js';
function rubyFixture(t) {const root=fs.mkdtempSync(path.join(os.tmpdir(),'codesurf-ruby-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
test('Ruby indexes methods, namespaces, singleton calls and parameter shapes without executing code',t=>{
 const root=rubyFixture(t);
 fs.writeFileSync(path.join(root,'api.rb'),`raise 'Never execute source'
module Api
 class Client
  def request(path, token: nil, required:, **options, &block)
   refresh_session(path)
  end
  def refresh_session(path)
   Tokens.read
  end
 end
 class Tokens
  def self.read
   'token'
  end
 end
end
`);
 const r=analyze([root],'request',{entry:'api.rb#request'});
 assert.deepEqual(r.languages,['Ruby']);
 assert.equal(r.nodes.length,3);
 assert.equal(r.nodes[0].end,6);
 assert.deepEqual(r.nodes[0].inputs.map(p=>[p.name,p.optional]),[['path',false],['token',true],['required',false],['**options',false],['&block',false]]);
 assert.equal(r.nodes[0].calls[0].line,5);
 assert.equal(r.nodes[0].calls[0].column,3);
 assert.equal(r.nodes[0].calls[0].target,r.nodes[1].id);
 assert.equal(r.nodes[1].calls[0].target,r.nodes[2].id);
 assert.equal(r.nodes[0].output.type,'unknown');
 assert.ok(r.symbolRefs['api.rb'].length>=2);
});
test('Ruby leaves unknown receivers and ambiguous reopened methods unresolved',t=>{
 const root=rubyFixture(t);fs.writeFileSync(path.join(root,'a.rb'),`def start(client)
 client.work
 work
end
def work; 1; end
def work; 2; end
`);
 const r=analyze([root],'start',{entry:'a.rb#start'});
 assert.equal(r.nodes.length,1);
 assert.ok(r.nodes[0].calls.every(c=>!c.target));
});
test('bad Ruby syntax and missing runtime do not break a TypeScript repository',t=>{
 const root=rubyFixture(t);fs.writeFileSync(path.join(root,'good.ts'),'export function start() { return 1; }');fs.writeFileSync(path.join(root,'bad.rb'),'def broken(');
 const r=analyze([root],'start',{entry:'good.ts#start'});
 assert.equal(r.nodes.length,1);assert.ok(r.diagnostics.some(d=>d.includes('bad.rb')));
 const old=process.env.CODESURF_RUBY;process.env.CODESURF_RUBY=path.join(root,'missing');
 try {const mixed=analyze([root],'start',{entry:'good.ts#start'});assert.equal(mixed.nodes.length,1);assert.ok(mixed.diagnostics.some(d=>d.includes('CODESURF_RUBY')));}finally {if(old===undefined)delete process.env.CODESURF_RUBY;else process.env.CODESURF_RUBY=old;}
});
test('language registry permits disabling Ruby and validates adapter contracts',t=>{
 const root=rubyFixture(t);fs.writeFileSync(path.join(root,'good.ts'),'export function start() { return 1; }');fs.writeFileSync(path.join(root,'bad.rb'),'def broken(');
 const r=analyze([root],'start',{languages:['typescript'],entry:'good.ts#start'});
 assert.deepEqual(r.languages,['JavaScript','TypeScript']);assert.deepEqual(r.diagnostics,[]);
 assert.throws(()=>analyze([root],'start',{languages:['missing']}),/Unknown language adapter/);
 assert.throws(()=>validateIndex('bad',{}),/invalid index/);
 assert.equal(new Set(languageAdapters.map(a=>a.id)).size,languageAdapters.length);
});

test('Ruby modern syntax and Unicode call columns work with a matching runtime',t=>{
 const root=rubyFixture(t);
 fs.writeFileSync(path.join(root,'modern.rb'),`def start(data)
  label = "😀"; finish(data)
end
def finish(data) = data
`);
 let r;
 try {r=analyze([root],'start',{catalog:true});} catch(error) {if(/syntax error/.test(error.message)){t.skip('Selected Ruby does not support endless method syntax');return;}throw error;}
 const start=r.definitions.find(n=>n.name==='start');
 const finish=r.definitions.find(n=>n.name==='finish');
 assert.equal(start.calls.find(c=>c.name==='finish').target,finish.id);
 assert.equal(start.calls.find(c=>c.name==='finish').column,'  label = "😀"; '.length);
 assert.equal(finish.start,4);assert.equal(finish.end,4);
});
test('Ruby and Node/Python roots merge without definition ID collisions',t=>{
 const root=rubyFixture(t);
 fs.writeFileSync(path.join(root,'same.rb'),'def same; 1; end');
 fs.writeFileSync(path.join(root,'same.py'),'def same():\n    return 1\n');
 fs.writeFileSync(path.join(root,'same.ts'),'export function same() { return 1; }');
 const r=analyze([root],'same',{catalog:true});
 assert.equal(r.definitions.length,3);
 assert.equal(new Set(r.definitions.map(n=>n.id)).size,3);
 assert.deepEqual(new Set(r.languages),new Set(['Ruby','Python','JavaScript','TypeScript']));
});
