import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCallIndex,initCallParsers,overlayCallIndex} from '../browser/source-index.js';
import {functionPeeks} from '../browser/function-peeks.js';
import {voiceReviewContext,voiceSession} from '../realtime-voice.js';
import {transformationPlan} from '../transformations.js';
test('function previews resolve every call in a body, including imported definitions, with exact call lines',()=>{
 const index=buildCallIndex(new Map([['lib.ts','export function child() { return 1; }'],['main.ts','import { child } from "./lib";\nfunction run() {\n child();\n helper();\n}\nfunction helper() { return 2; }']]));
 const peeks=functionPeeks(index,{path:'main.ts',line:3,direction:'callees'});
 assert.equal(peeks.root.symbol,'run');assert.deepEqual(peeks.blocks.map(block=>[block.symbol,block.path,block.callLine]),[['child','lib.ts',3],['helper','main.ts',4]]);
 assert.equal(functionPeeks(index,{path:'lib.ts',line:1,direction:'callers'}).blocks[0].symbol,'run');
 assert.throws(()=>functionPeeks(index,{path:'main.ts',line:0,direction:'body'}));
});
test('Ruby preview callers are scoped to the selected class and predicates expose their full body',async()=>{
 await initCallParsers();const index=buildCallIndex(new Map([['a.rb','class Account\n def update\n  ready?\n end\n def ready?\n  true\n end\nend'],['b.rb','class Other\n def update\n  false\n end\nend\ndef save_account\n Account.new.update\nend\ndef save_other\n Other.new.update\nend']]));
 const callers=functionPeeks(index,{path:'a.rb',line:3,direction:'callers'});assert.deepEqual(callers.blocks.map(block=>block.symbol),['save_account']);
 assert.equal(functionPeeks(index,{path:'a.rb',line:2,direction:'callees'}).blocks[0].symbol,'ready?');
 const body=functionPeeks(index,{path:'a.rb',line:6,direction:'body'}).blocks[0];assert.equal(body.start,5);assert.equal(body.end,7);
});
test('previews follow the displayed snapshot, and large caller lists are explicitly bounded',()=>{
 const files=new Map([['a.ts','function child() {}\nfunction oldCaller() { child(); }']]);for(let i=0;i<12;i++)files.set('caller'+i+'.ts',`function caller${i}() { child(); }`);
 const base=buildCallIndex(files),current=overlayCallIndex(base,new Map([['a.ts','function child() {}\nfunction newCaller() { child(); }']]));
 const result=functionPeeks(current,{path:'a.ts',line:1,direction:'callers'});assert.equal(result.total,13);assert.equal(result.blocks.length,8);assert.equal(result.limited,true);assert.equal(functionPeeks(current,{path:'a.ts',line:2,direction:'body'}).root.symbol,'newCaller');assert(!result.blocks.some(block=>block.symbol==='oldCaller'));
});
test('whole-review voice context follows progress and boundaries without requiring a line selection',async()=>{
 const plan=await transformationPlan([{path:'a.ts',status:'modified',before:'function value() { return 1; }',after:'function value() { return 2; }'}],{explain:false});plan.steps=[{ids:plan.operations.map(op=>op.id),title:'Change value',summary:'Return two.'}];
 const start=voiceReviewContext(plan,0,true),end=voiceReviewContext(plan,1,true);assert.equal(start.canPrevious,false);assert.equal(start.canNext,true);assert.equal(end.canNext,false);assert.equal(end.canPrevious,false);assert.equal(end.reviewedLines,end.totalLines);assert.match(end.files[0].source,/return 2/);
 const session=voiceSession({review:end,selection:null});assert(session.tools.some(tool=>tool.name==='navigate_review'));assert(session.tools.some(tool=>tool.name==='explore_calls'));assert.match(session.instructions,/never claim to move/i);
});
