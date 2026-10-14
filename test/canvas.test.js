import test from 'node:test';
import assert from 'node:assert/strict';
import {transformationPlan} from '../transformations.js';
import {canvasChanges} from '../canvas-model.js';
import {canvasRelations,canvasSelection,validateCanvasSelection} from '../canvas-relations.js';
import {reviewAffordances} from '../public/canvas-affordances.js';
import {relationshipSummary} from '../public/canvas-relationships.js';
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

test('canvas labels calls elsewhere in an edited function separately from calls in the edit',async()=>{
 await initCallParsers();const before="class PaymentActionsController\n def payment_success\n  unless ['old'].include?(payment_type)\n   reject\n  end\n  finish\n  DashboardCacheService.clear_for_user(user)\n  DashboardCacheService.clear_for_user(current_user)\n end\nend\n",after=before.replace("['old']",'Guard::PAYMENT_TYPES');
 const plan=await transformationPlan([{path:'controller.rb',status:'modified',before,after}],{explain:false}),files=new Map([['controller.rb',after],['cache.rb',"class DashboardCacheService\n def self.clear_for_user(user)\n  reset(user)\n end\nend\n"]]);
 const result=canvasRelations(canvasChanges(plan,1),snapshot(files)),node=result.relations.find(node=>node.symbol==='clear_for_user');assert(node);assert.deepEqual(node.edges.map(edge=>edge.scope),['function','function']);assert.deepEqual(node.edges.map(edge=>edge.callLine),[7,8]);assert.equal(relationshipSummary(node),'Elsewhere in payment_success, lines 7 and 8 call clear_for_user.');assert(!relationshipSummary(node).includes('changed code'));
 const direct=canvasRelations({blocks:[{id:'direct',path:'controller.rb',start:7,end:7}]},snapshot(files)).relations.find(node=>node.symbol==='clear_for_user');assert.equal(direct.edges[0].scope,'change');assert.match(relationshipSummary(direct),/^This edited block calls clear_for_user at line 7/);
});
test('canvas summaries describe uncertain relationships and the actual enclosing function',()=>{
 assert.equal(relationshipSummary({direction:'callees',symbol:'clear_for_user',ambiguous:true,edges:[{scope:'function',sourceSymbol:'payment_success',callLine:388}]}),'Elsewhere in payment_success, line 388 may call clear_for_user.');
 assert.equal(relationshipSummary({direction:'callers',symbol:'submit',edges:[{targetSymbol:'payment_success',callLine:12}]}),'submit calls payment_success at line 12.');
});

test('on-demand expansion traces only the selected line and direction',()=>{
 const files=new Map([['changed.ts','function changed() {\n helper();\n other();\n}'],['helper.ts','function helper() { return 1; }'],['other.ts','function other() { return 2; }'],['caller.ts','function caller() {\n changed();\n}']]),current=snapshot(files),change={blocks:[{id:'edit',path:'changed.ts',start:2,end:2}]},selection={path:'changed.ts',line:2,direction:'callees',snapshot:'after',anchorId:'edit',level:0};
 const callees=canvasSelection(change,selection,current);assert.deepEqual(callees.relations.map(node=>node.symbol),['helper']);assert.equal(callees.relations[0].level,1);assert.equal(callees.relations[0].edges[0].anchorLine,2);assert.deepEqual(callees.relations[0].affordances.calls,[]);
 const callers=canvasSelection(change,{...selection,direction:'callers'},current);assert.deepEqual(callers.relations.map(node=>node.symbol),['caller']);assert.equal(callers.relations[0].level,-1);assert.equal(callers.relations[0].edges[0].targetLine,1);assert.equal(callers.relations[0].edges[0].callLine,2);assert.deepEqual(callers.relations[0].affordances.calls,[2]);
 const nested=canvasSelection(change,{...selection,path:'caller.ts',direction:'callees',anchorId:callers.relations[0].id,level:-1},current);assert.deepEqual(nested.relations.map(node=>node.symbol),['changed']);assert.equal(nested.relations[0].level,0);assert.equal(nested.relations[0].edges[0].blockId,callers.relations[0].id);
 assert.equal(canvasSelection(change,{...selection,line:4},current).relations.length,0);
});
test('on-demand Ruby expansion preserves selected receiver and old snapshot',async()=>{
 await initCallParsers();const files=new Map([['one.rb','class One\n def update\n  true\n end\nend\n'],['two.rb','class Two\n def update\n  false\n end\nend\n'],['caller.rb','def call_one\n One.new.update\nend\ndef call_two\n Two.new.update\nend\n']]),before=snapshot(files),after=snapshot(new Map([...files].filter(([path])=>path!=='one.rb'))),change={blocks:[{id:'removed',path:'one.rb',oldStart:2,oldEnd:4,deleted:true}]},selection={path:'one.rb',line:2,direction:'callers',snapshot:'before',anchorId:'removed',level:0};
 const result=canvasSelection(change,selection,after,before);assert.deepEqual(result.relations.map(node=>node.symbol),['call_one']);assert.equal(result.relations[0].snapshot,'Before this change');assert.throws(()=>canvasSelection(change,{...selection,snapshot:'after'},after,before),/unavailable/);
 for(const invalid of [{direction:'all'},{path:'../secret'},{line:0},{level:99},{snapshot:'head'},{anchorId:''}])assert.throws(()=>validateCanvasSelection({...selection,...invalid}),/Choose a code line/);
 assert.throws(()=>canvasSelection(change,{...selection,line:999},after,before),/unavailable/);
});

test('hover affordances use local syntax, skip unavailable files, and retain both snapshots',async()=>{
 const before='function run() {\n return oldCall();\n}\n',after='function run() {\n return newCall();\n}\n',plan=await transformationPlan([{path:'run.ts',status:'modified',before,after},{path:'large.bin',unavailable:true,reason:'Binary'}],{explain:false});
 const info=await reviewAffordances(plan,1);assert.equal(info.after['run.ts'].functions[0].symbol,'run');assert.deepEqual(info.after['run.ts'].calls,[2]);assert.deepEqual(info.before['run.ts'].calls,[2]);assert.equal(info.after['large.bin'],undefined);
});
