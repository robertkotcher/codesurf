import test from 'node:test';
import assert from 'node:assert/strict';
import {transformationPlan} from '../transformations.js';
import {canvasChanges} from '../canvas-model.js';
import {canvasSelection,validateCanvasSelection,validateChangedSelection} from '../canvas-relations.js';
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
test('canvas summaries describe uncertain relationships and the actual enclosing function',()=>{
 assert.equal(relationshipSummary({direction:'callees',symbol:'clear_for_user',ambiguous:true,edges:[{scope:'function',sourceSymbol:'payment_success',callLine:388}]}),'Elsewhere in payment_success, line 388 may call clear_for_user.');
 assert.equal(relationshipSummary({direction:'callers',symbol:'submit',edges:[{targetSymbol:'payment_success',callLine:12}]}),'submit calls payment_success at line 12.');
});

test('hover affordances use local syntax, skip unavailable files, and retain both snapshots',async()=>{
 const before='function run() {\n return oldCall();\n}\n',after='function run() {\n return newCall();\n}\n',plan=await transformationPlan([{path:'run.ts',status:'modified',before,after},{path:'large.bin',unavailable:true,reason:'Binary'}],{explain:false});
 const info=await reviewAffordances(plan,1);assert.equal(info.after['run.ts'].functions[0].symbol,'run');assert.deepEqual(info.after['run.ts'].calls,[2]);assert.deepEqual(info.before['run.ts'].calls,[2]);assert.equal(info.after['large.bin'],undefined);
});

test('masked previews keep both diff colors and surrounding source without changing the full diff',async()=>{
 const {previewRows}=await import('../public/canvas-preview.js');
 const context=text=>({kind:'context',text}),change=(kind,length)=>Array.from({length},(_,i)=>({kind,text:i?'  value_'+i:'function changed() {'}));
 const above=[context('class Payments'),context('  include PaymentSummary'),context('')],below=[context('  def confirm'),context('    process_payment'),context('  end')],rows=[...above,...change('removed',20),...change('added',30),...below],original=JSON.stringify(rows),preview=previewRows(rows);
 assert.deepEqual(preview.slice(0,above.length).map(item=>item.row),above);assert.deepEqual(preview.slice(-below.length).map(item=>item.row),below);
 for(const kind of ['added','removed']){assert(preview.some(item=>item.row?.kind===kind));assert(preview.some(item=>item.kind===kind&&item.omitted>0))}
 assert.equal(preview.reduce((sum,item)=>sum+(item.omitted||1),0),rows.length);assert.equal(JSON.stringify(rows),original);
});

test('small deletion previews preserve the exact unblurred context around the deleted list',async()=>{
 const {previewRows}=await import('../public/canvas-preview.js');
 const before="class ConfirmPaymentService\n  include PaymentPlanSummaryRewarm\n\n  PAYMENT_TYPES = %w[additional_payment pay_early missed_payment].freeze\n\n  MISSING_INTENT_MESSAGE = 'Missing payment information.'\n  GENERIC_FAILURE_MESSAGE = 'Please try again.'\nend\n",after=before.replace('  PAYMENT_TYPES = %w[additional_payment pay_early missed_payment].freeze\n\n','');
 const plan=await transformationPlan([{path:'confirm.rb',status:'modified',before,after}],{explain:false}),block=canvasChanges(plan,1).blocks[0],preview=previewRows(block.rows);
 assert.equal(block.masked,true);assert(preview.some(item=>item.row?.kind==='removed'&&item.row.text.includes('PAYMENT_TYPES')));assert(preview.some(item=>item.row?.kind==='context'&&item.row.text.includes('include PaymentPlanSummaryRewarm')));assert(preview.some(item=>item.row?.kind==='context'&&item.row.text.includes('MISSING_INTENT_MESSAGE')));assert.equal(preview.some(item=>item.omitted),false);
});

const select=(block,line,direction='callees',snapshot='after')=>({path:snapshot==='before'?block.previousPath||block.path:block.path,line,direction,snapshot,anchorId:block.id,level:0});
test('only explicitly selected changed calls return their direct targets',async()=>{
 const before='function changed() {\n old();\n other();\n}\n',after=before.replace('old();','helper();'),plan=await transformationPlan([{path:'changed.ts',status:'modified',before,after}],{explain:false}),change=canvasChanges(plan,1),block=change.blocks[0],current=snapshot(new Map([['changed.ts',after],['helper.ts','function helper() { return 1; }'],['other.ts','function other() { return 2; }'],['caller.ts','function caller() { changed(); }']]));
 const result=canvasSelection(change,select(block,2),current);assert.deepEqual(result.relations.map(node=>node.symbol),['helper']);assert.equal(result.relations[0].edges[0].anchorLine,2);assert.equal(result.relations[0].edges[0].scope,'change');
 for(const selection of [select(block,1,'callers'),select(block,2,'callers'),select(block,3),select(block,4),{...select(block,2),anchorId:'invented'},{...select(block,2),path:'other.ts'},{...select(block,2),level:-1}])assert.throws(()=>canvasSelection(change,selection,current),{status:400});
 assert.throws(()=>canvasSelection(change,{...select(block,1),path:'helper.ts',anchorId:result.relations[0].id,level:1},current),{status:400});
});

test('changed function definitions load callers only when that definition is selected',async()=>{
 const after='export function changed() {\n return helper();\n}\n',plan=await transformationPlan([{path:'change.ts',status:'added',before:'',after}],{explain:false}),change=canvasChanges(plan,1),block=change.blocks[0],files=new Map([['change.ts',after],['helper.ts','export function helper() { return 2; }'],...Array.from({length:12},(_,i)=>['caller'+i+'.ts',`function caller${i}() {\n return changed();\n}`])]),current=snapshot(files);
 const callers=canvasSelection(change,select(block,1,'callers'),current);assert.equal(callers.relations.length,12);assert(callers.relations.every(node=>node.direction==='callers'&&node.edges[0].targetLine===1));
 const callee=canvasSelection(change,select(block,2),current);assert.deepEqual(callee.relations.map(node=>node.symbol),['helper']);assert.equal(callee.relations[0].edges[0].callLine,2);
});

test('clear_for_user elsewhere in a changed method cannot appear as a change connection',async()=>{
 await initCallParsers();const before="class PaymentActionsController\n def payment_success\n  unless ['old'].include?(payment_type)\n   reject\n  end\n  finish\n  DashboardCacheService.clear_for_user(user)\n  DashboardCacheService.clear_for_user(current_user)\n end\nend\n",after=before.replace("['old']",'Guard::PAYMENT_TYPES'),plan=await transformationPlan([{path:'controller.rb',status:'modified',before,after}],{explain:false}),change=canvasChanges(plan,1),block=change.blocks[0],current=snapshot(new Map([['controller.rb',after],['cache.rb','class DashboardCacheService\n def self.clear_for_user(user)\n  reset(user)\n end\nend\n']]));
 assert.deepEqual(canvasSelection(change,select(block,3),current).relations,[]);
 for(const line of [2,7,8]){assert.throws(()=>canvasSelection(change,select(block,line),current),{status:400});assert.throws(()=>canvasSelection(change,select(block,line,'callers'),current),{status:400})}
});

test('removed Ruby definitions retain old source and class-scoped callers',async()=>{
 await initCallParsers();const before='class One\n def update\n  true\n end\nend\n',after='class One\nend\n',others='class Two\n def update\n  false\n end\nend\ndef correct\n One.new.update\nend\ndef unrelated\n Two.new.update\nend\n',plan=await transformationPlan([{path:'one.rb',status:'modified',before,after}],{explain:false}),change=canvasChanges(plan,1),block=change.blocks[0],old=snapshot(new Map([['one.rb',before],['others.rb',others]])),current=snapshot(new Map([['one.rb',after],['others.rb',others]]));
 const result=canvasSelection(change,select(block,2,'callers','before'),current,old);assert.deepEqual(result.relations.map(node=>node.symbol),['correct']);assert.equal(result.relations[0].snapshot,'Before this change');assert.throws(()=>canvasSelection(change,select(block,2,'callers'),current,old),{status:400});
 for(const invalid of [{direction:'all'},{path:'../secret'},{line:0},{level:99},{snapshot:'head'},{anchorId:''}])assert.throws(()=>validateCanvasSelection({...select(block,2),...invalid}),{status:400});
});

test('connections to code changed in this step are labeled and unavailable files remain explicit',async()=>{
 const plan=await transformationPlan([{path:'a.ts',status:'modified',before:'function run() {\n return 1;\n}\n',after:'function run() {\n return helper();\n}\n'},{path:'b.ts',status:'modified',before:'function helper() { return 1; }',after:'function helper() { return 2; }'},{path:'large.bin',unavailable:true,reason:'Binary'}],{explain:false});plan.steps=[{ids:plan.operations.map(op=>op.id),title:'Calculate totals'}];const change=canvasChanges(plan,1),current=snapshot(new Map(Object.entries(stateAt(plan,1)))),block=change.blocks.find(block=>block.path==='a.ts'),result=canvasSelection(change,select(block,2),current);assert.equal(result.relations[0].changed,true);assert.equal(result.relations[0].symbol,'helper');assert.equal(change.blocks.length,2);assert(plan.files.find(file=>file.path==='large.bin').unavailable);
});

test('removed runs collapse independently and expansion restores exact text and coordinates',async()=>{
 const {displayCodeRows}=await import('../public/canvas-preview.js');
 const rows=[{kind:'context',line:1,old:1,text:'before'},{kind:'removed',old:2,text:'old_a()'},{kind:'removed',old:3,text:'old_b()'},{kind:'added',line:2,text:'new_a()'},{kind:'context',line:3,old:4,text:'between'},{kind:'removed',old:5,text:'old_c()'},{kind:'context',line:4,old:6,text:'after'}],original=JSON.stringify(rows),collapsed=displayCodeRows(rows);
 assert.equal(collapsed.filter(item=>item.removed).length,2);assert.equal(collapsed.some(item=>item.row?.kind==='removed'),false);assert.deepEqual(collapsed.filter(item=>item.removed).map(({from,to,count})=>({from,to,count})),[{from:2,to:3,count:2},{from:5,to:5,count:1}]);
 const first=displayCodeRows(rows,{preview:true,expandedRemoved:new Set([1])});assert.deepEqual(first.filter(item=>item.row?.kind==='removed').map(item=>item.row),rows.slice(1,3));assert.equal(first.find(item=>item.index===5).expanded,false);assert(first.filter(item=>item.row?.kind==='removed').every(item=>item.removedExpanded));
 const all=displayCodeRows(rows,{expandedRemoved:new Set([1,5])});assert.deepEqual(all.filter(item=>item.row).map(item=>item.row),rows);assert.deepEqual(all.filter(item=>item.row).map(item=>item.index),[0,1,2,3,4,5,6]);assert.equal(JSON.stringify(rows),original);
});
