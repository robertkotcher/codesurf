import test from 'node:test';
import assert from 'node:assert/strict';
import {transformationPlan} from '../transformations.js';
import {canvasChanges} from '../canvas-model.js';
import {prepareCanvasConnections,canvasConnectionPage,canvasSelection} from '../canvas-relations.js';
import {preparedCanvasPage,canvasConnectionKey} from '../public/canvas-preload.js';
import {buildCallIndex,initCallParsers} from '../browser/source-index.js';
const source=files=>({index:{files},graph:buildCallIndex(files)});
test('precomputed connections use repository methods, not loops, framework declarations, variables or comments',async()=>{
 await initCallParsers();
 const ruby='class Payments\n def validate(item)\n  true\n end\n def run\n  items = []\n  items.each do |item|\n   validate(item)\n  end\n  # validate(fake)\n  text = "validate(fake)"\n  let(:payment_type) { "missed" }\n end\nend\n';
 const plan=await transformationPlan([{path:'payments.rb',status:'added',before:'',after:ruby}],{explain:false}),change=canvasChanges(plan,1),prepared=prepareCanvasConnections(change,source(new Map([['payments.rb',ruby]])));
 assert.deepEqual(prepared.affordances.after['payments.rb'].calls,[8]);
 const selection={anchorId:change.blocks[0].id,path:'payments.rb',line:8,direction:'callees',snapshot:'after',level:0},page=preparedCanvasPage(prepared,selection);
 assert.deepEqual(page.relations.map(node=>node.symbol),['validate']);assert.equal(page.relations[0].edges[0].anchorLine,8);assert.equal(page.total,1);
 const orphan=preparedCanvasPage(prepared,{...selection,line:5,direction:'callers'});assert.equal(orphan.total,0);assert.deepEqual(orphan.relations,[]);
 assert.equal(preparedCanvasPage(prepared,{...selection,line:7}),null);assert.equal(preparedCanvasPage(prepared,{...selection,line:12}),null);
});
test('before and after snapshots keep their own definitions and call targets',async()=>{
 const before="import { oldCall } from './old';\nfunction run() {\n return oldCall();\n}\n",after="import { newCall } from './new';\nfunction run() {\n return newCall();\n}\n",plan=await transformationPlan([{path:'run.ts',status:'modified',before,after}],{explain:false});plan.steps=[{ids:plan.operations.map(op=>op.id),title:'Change the calculation'}];
 const shared=[['old.ts','export function oldCall() { return 1; }'],['new.ts','export function newCall() { return 2; }']],current=source(new Map([['run.ts',after],...shared])),previous=source(new Map([['run.ts',before],...shared])),change=canvasChanges(plan,1),prepared=prepareCanvasConnections(change,current,previous);
 for(const [snapshot,symbol]of [['before','oldCall'],['after','newCall']]){const selected=prepared.connections.find(item=>item.selection.snapshot===snapshot&&item.selection.direction==='callees'&&item.selection.line===3),page=preparedCanvasPage(prepared,selected.selection);assert.deepEqual(page.relations.map(node=>node.symbol),[symbol]);assert.deepEqual(page.relations,canvasConnectionPage(canvasSelection(change,selected.selection,current,previous)).relations)}
});
test('all caller pages are warmed, source bodies are deduplicated, and unopened anchors do not leak into results',async()=>{
 const after='export function changed() {\n return helper();\n}\nfunction second() {\n return helper();\n}\n',plan=await transformationPlan([{path:'change.ts',status:'added',before:'',after}],{explain:false}),change=canvasChanges(plan,1),current=source(new Map([['change.ts',after],['helper.ts','export function helper() { return 2; }'],...Array.from({length:30},(_,i)=>['caller'+i+'.ts',`function caller${i}() { changed(); }`])])),prepared=prepareCanvasConnections(change,current),first={anchorId:change.blocks[0].id,path:'change.ts',line:1,direction:'callers',snapshot:'after',level:0};
 assert.equal(preparedCanvasPage(prepared,first).relations.length,24);assert.equal(preparedCanvasPage(prepared,first).nextPage,1);assert.equal(preparedCanvasPage(prepared,first,1).relations.length,6);assert.equal(preparedCanvasPage(prepared,first,1).nextPage,null);
 const a=preparedCanvasPage(prepared,{...first,line:2,direction:'callees'}),b=preparedCanvasPage(prepared,{...first,line:5,direction:'callees'});assert.equal(a.relations[0].id,b.relations[0].id);assert.deepEqual(a.relations[0].edges.map(edge=>edge.anchorLine),[2]);assert.deepEqual(b.relations[0].edges.map(edge=>edge.anchorLine),[5]);assert.equal(Object.keys(prepared.nodes).filter(id=>id.includes('helper.ts')).length,1);
 assert.equal(prepared.results.get(canvasConnectionKey(first)).result.relations.length,30);
});

test('an unknown receiver does not expose an unrelated method with the same name',async()=>{
 await initCallParsers();
 for(const [path,after]of [['entry.ts','function update() { return 1; }\nfunction run(client) {\n client.update();\n}\n'],['entry.rb','def update\n 1\nend\ndef run(client)\n client.update\nend\n']]){
  const plan=await transformationPlan([{path,status:'added',before:'',after}],{explain:false}),change=canvasChanges(plan,1),prepared=prepareCanvasConnections(change,source(new Map([[path,after]])));
  assert.deepEqual(prepared.affordances.after[path].calls,[]);
 }
});

test('preloading a change deep inside a long function skips its out-of-excerpt signature',async()=>{
 const before='function run() {\n'+Array.from({length:20},(_,i)=>` const context${i} = ${i};\n`).join('')+' return 1;\n}\n',after=before.replace('return 1;', 'return helper();'),plan=await transformationPlan([{path:'run.ts',status:'modified',before,after}],{explain:false}),change=canvasChanges(plan,1),current=source(new Map([['run.ts',after],['helper.ts','function helper() { return 2; }']])),previous=source(new Map([['run.ts',before],['helper.ts','function helper() { return 2; }']]));
 assert.equal(change.blocks[0].rows.some(row=>row.line===1),false);
 const prepared=prepareCanvasConnections(change,current,previous);assert.deepEqual(prepared.connections.map(item=>[item.selection.direction,item.selection.line]),[['callees',22]]);assert.equal(preparedCanvasPage(prepared,prepared.connections[0].selection).relations[0].symbol,'helper');
});
