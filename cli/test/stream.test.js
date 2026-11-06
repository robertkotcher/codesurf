import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { streamAnswer } from "../src/stream.js";
test("app-server streams answer deltas and brief activity, excluding internal reasoning", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codesurf-stream-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const executable = path.join(root, "mock.cjs");
  fs.writeFileSync(
    executable,
    `#!/usr/bin/env node
const readline=require('node:readline');const emit=x=>process.stdout.write(JSON.stringify(x)+'\\n');readline.createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.method==='initialize')emit({id:m.id,result:{}});if(m.method==='thread/start')emit({id:m.id,result:{thread:{id:'t'}}});if(m.method==='turn/start'){emit({id:m.id,result:{}});emit({method:'item/started',params:{item:{id:'r',type:'reasoning'}}});emit({method:'item/reasoning/textDelta',params:{delta:'PRIVATE REASONING'}});emit({method:'item/started',params:{item:{id:'web',type:'webSearch',action:{type:'search'}}}});emit({method:'item/started',params:{item:{id:'a',type:'agentMessage',phase:'final_answer',text:''}}});for(const delta of ['First ','second.'])emit({method:'item/agentMessage/delta',params:{itemId:'a',delta}});emit({method:'item/completed',params:{item:{id:'a',type:'agentMessage',phase:'final_answer',text:'First second.'}}});emit({method:'turn/completed',params:{turn:{status:'completed'}}});}});
`,
    { mode: 0o755 },
  );
  const events = [];
  const result = await streamAnswer({
    root,
    prompt: "Test",
    executable,
    onEvent: (e) => events.push(e),
  });
  assert.equal(result.answer, "First second.");
  assert.deepEqual(
    events.filter((e) => e.type === "delta").map((e) => e.text),
    ["First ", "second."],
  );
  assert.ok(events.some((e) => e.message === "Searching the web…"));
  assert.ok(!JSON.stringify(events).includes("PRIVATE"));
});
