import test from 'node:test';
import assert from 'node:assert/strict';
import {transformationPlan} from '../transformations.js';
import {canvasChanges} from '../canvas-model.js';
import {canvasRelations} from '../canvas-relations.js';
import {stateAt} from '../public/transformations.js';
import {buildCallIndex,initCallParsers} from '../browser/source-index.js';
const snapshot=files=>({index:{files},graph:buildCallIndex(files)});
test('canvas diff keeps real line coordinates, shows single-line edits and masks larger blocks',async()=>{
 const before='function total() {\n return 1;\n}\n',after='function total() {\n const n = 2;\n return n;\n}\n';
 const plan=await transformationPlan([{path:'a.ts',status:'modified',before,after}],{explain:false});plan.steps=[{ids:plan.operations.map(o=>o.id),title:'Calculate total',summary:'Return a calculated total. Extra sentence.',blocks:[{id:plan.operations[0].id,text:'Calculate two and return it.'}]}];
 const change=canvasChanges(plan,1),block=change.blocks[0];assert.equal(change.summary,'Return a calculated total.');assert.equal(block.masked,true);assert.equal(block.added,2);assert.equal(block.removed,1);assert.equal(block.rows.find(r=>r.kind==='added').line,2);assert.equal(block.rows.find(r=>r.kind==='removed').old,2);assert.equal(block.summary,'Calculate two and return it.');
 const single=await transformationPlan([{path:'b.ts',status:'modified',before:'const n=1;\n',after:'const n=2;\n'}],{explain:false});assert.equal(canvasChanges(single,1).blocks[0].masked,false);
});
test('out-of-order review edits account for earlier line shifts without changing the plan',async()=>{
 const before='first\n'+Array(8).fill('context').join('\n')+'\nlast\n',after='FIRST\nNEW\n'+Array(8).fill('context').join('\n')+'\nLAST\n';
 const plan=await transformationPlan([{path:'a.ts',status:'modified',before,after}],{explain:false});plan.steps=[{ids:[plan.operations[0].id],title:'First'},{ids:[plan.operations[1].id],title:'Last'}];const original=JSON.stringify(plan);
 const block=canvasChanges(plan,2).blocks[0];assert.equal(block.start,11);assert.equal(block.oldStart,11);assert.equal(block.rows.find(r=>r.kind==='removed').text,'last');assert.equal(block.rows.find(r=>r.kind==='added').text,'LAST');assert.equal(JSON.stringify(plan),original);
});
test('canvas connects all callers and callees with exact call and target lines',async()=>{
 const before='export function changed() {\n return 1;\n}\n',after='export function changed() {\n const value = helper();\n return value;\n}\n';
 const plan=await transformationPlan([{path:'change.ts',status:'modified',before,after}],{explain:false});
 const files=new Map([['change.ts',after],['helper.ts','export function helper() { return 2; }'],...Array.from({length:12},(_,i)=>['caller'+i+'.ts',`function caller${i}() {\n return changed();\n}`])]);
 const result=canvasRelations(canvasChanges(plan,1),snapshot(files));assert.equal(result.relations.filter(r=>r.direction==='callers').length,12);const callee=result.relations.find(r=>r.direction==='callees');assert.equal(callee.symbol,'helper');assert.equal(callee.edges[0].callLine,2);assert.equal(callee.edges[0].targetLine,1);assert.equal(result.relations[0].edges[0].targetLine,1);assert.match(callee.text,/return 2/);
});
test('deleted methods connect their original callers and Ruby methods remain class scoped',async()=>{
 await initCallParsers();const before='class One\n def update\n  true\n end\nend\n',after='class One\nend\n',others='class Two\n def update\n  false\n end\nend\ndef correct\n One.new.update\nend\ndef unrelated\n Two.new.update\nend\n';
 const plan=await transformationPlan([{path:'one.rb',status:'modified',before,after}],{explain:false});
 const old=snapshot(new Map([['one.rb',before],['others.rb',others]])),current=snapshot(new Map([['one.rb',after],['others.rb',others]]));
 const result=canvasRelations(canvasChanges(plan,1),current,old);assert.deepEqual(result.relations.filter(r=>r.direction==='callers').map(r=>r.symbol),['correct']);assert.equal(result.relations[0].snapshot,'Before this change');
});
test('related code changed in the same chunk is labeled as changed, and absent files stay explicit',async()=>{
 const plan=await transformationPlan([{path:'a.ts',status:'modified',before:'function run() {\n return helper();\n}\n',after:'function run() {\n const n=helper();\n return n;\n}\n'},{path:'b.ts',status:'modified',before:'function helper() { return 1; }',after:'function helper() { return 2; }'},{path:'large.bin',unavailable:true,reason:'Binary'}],{explain:false});plan.steps=[{ids:plan.operations.map(o=>o.id),title:'One behavior'}];const change=canvasChanges(plan,1),files=new Map(Object.entries(stateAt(plan,1)));assert.equal(change.blocks.length,2);const result=canvasRelations(change,snapshot(files));assert.equal(result.relations.find(r=>r.symbol==='helper').changed,true);assert.equal(result.relations.find(r=>r.symbol==='run').changed,true);
});
