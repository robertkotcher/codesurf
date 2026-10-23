import test from 'node:test';
import assert from 'node:assert/strict';
import {transformationPlan} from '../transformations.js';
import {canvasChanges} from '../canvas-model.js';
import {canvasExcerpt,canvasSelection,prepareCanvasConnections} from '../canvas-relations.js';
import {buildCallIndex} from '../browser/source-index.js';
const source=files=>({index:{files},graph:buildCallIndex(files)});
const selection=(block,line=block.rows.find(row=>row.line)?.line)=>({path:block.path,line,direction:'callees',snapshot:'after',anchorId:block.id,level:0});

test('excerpt expansion reveals exact source in bounded batches above and below, stopping at file edges',async()=>{
 const before=Array.from({length:90},(_,i)=>`const line${i+1} = ${i+1};`).join('\n'),after=before.replace('line45 = 45','line45 = 450'),path='entry.ts',plan=await transformationPlan([{path,status:'modified',before,after}],{explain:false}),change=canvasChanges(plan,1),block=change.blocks[0],current=source(new Map([[path,after]])),prepared=prepareCanvasConnections(change,current),initial=prepared.excerpts[block.id],original=JSON.stringify(block.rows),choose=selection(block);
 const above=canvasExcerpt(change,choose,initial,'up',current);assert.equal(above.rows.length,25);assert.equal(above.start,initial.start-25);assert.equal(above.end,initial.end);assert.deepEqual(above.rows.map(row=>row.text),after.split('\n').slice(above.start-1,initial.start-1));assert.ok(above.rows.every(row=>row.kind==='context'));
 const first=canvasExcerpt(change,choose,above,'up',current);assert.equal(first.start,1);assert.equal(canvasExcerpt(change,choose,first,'up',current).rows.length,0);
 const below=canvasExcerpt(change,choose,initial,'down',current);assert.equal(below.rows.length,25);const last=canvasExcerpt(change,choose,below,'down',current);assert.equal(last.end,90);assert.equal(canvasExcerpt(change,choose,last,'down',current).rows.length,0);assert.equal(JSON.stringify(block.rows),original,'expanding context must never alter diff rows or coordinates');
 for(const [range,direction]of [[{start:0,end:2},'up'],[{start:2,end:1},'down'],[{start:1,end:999},'down'],[initial,'sideways']])assert.throws(()=>canvasExcerpt(change,choose,range,direction,current),{status:400});
});

test('unchanged calls, newly revealed calls and calls inside opened functions are all expandable',async()=>{
 const path='entry.ts',before='function run() {\n helper();\n'+Array(35).fill(' // surrounding context').join('\n')+'\n return 1;\n}\n',after=before.replace('return 1','return helper()'),helper='// helper context\nfunction helper() {\n return leaf();\n}\n// after helper\nfunction leaf() { return 7; }\n',plan=await transformationPlan([{path,status:'modified',before,after}],{explain:false}),change=canvasChanges(plan,1),block=change.blocks[0],current=source(new Map([[path,after],['helper.ts',helper]])),choose=selection(block,38),prepared=prepareCanvasConnections(change,current),initial=prepared.excerpts[block.id];
 const above=canvasExcerpt(change,choose,initial,'up',current),first=canvasExcerpt(change,choose,above,'up',current);assert.ok(first.affordances.tokens.some(token=>token.line===2&&token.symbol==='helper'));
 const opened=canvasSelection(change,{...choose,line:2},current).relations[0];assert.equal(opened.symbol,'helper');assert.ok(opened.edges.some(edge=>edge.anchorLine===2));assert.ok(opened.affordances.tokens.some(token=>token.symbol==='leaf'));
 const child={path:opened.path,line:3,direction:'callees',snapshot:'after',anchorId:opened.id,level:opened.level},leaf=canvasSelection(change,child,current).relations[0];assert.equal(leaf.symbol,'leaf');assert.equal(leaf.level,2);assert.ok(leaf.edges.some(edge=>edge.blockId===opened.id&&edge.callLine===3));
 const context=canvasExcerpt(change,child,{start:opened.start,end:opened.end},'up',current);assert.equal(context.start,1);assert.equal(context.rows[0].text,'// helper context');
 assert.throws(()=>canvasSelection(change,{...child,anchorId:opened.id.replace(':2:',':200:')},current),{status:400});assert.throws(()=>canvasSelection(change,{...child,path:'entry.ts'},current),{status:400});
});

test('removed and renamed excerpts expand against the before snapshot without showing final source',async()=>{
 const before=Array.from({length:60},(_,i)=>`// original ${i+1}`).join('\n'),after=before.replace('// original 30','// replacement 30'),path='new.ts',plan=await transformationPlan([{path,previousPath:'old.ts',status:'renamed',before,after}],{explain:false}),change=canvasChanges(plan,1),block=change.blocks[0],current=source(new Map([[path,after]])),previous=source(new Map([['old.ts',before]])),choose={...selection(block,30),path:'old.ts',snapshot:'before'},context=canvasExcerpt(change,choose,{start:29,end:31},'up',current,previous);
 assert.equal(context.rows[0].old,4);assert.ok(context.rows.every(row=>row.line===null));assert.equal(context.rows.at(-1).text,'// original 28');assert.throws(()=>canvasExcerpt(change,{...choose,path:'new.ts'},{start:29,end:31},'up',current,previous),{status:400});
});

test('top-level caller cards remain browsable and function cards in the center column are valid sources',async()=>{
 const path='entry.ts',after='function run() {\n return helper();\n}\n',plan=await transformationPlan([{path,status:'added',before:'',after}],{explain:false}),change=canvasChanges(plan,1),current=source(new Map([[path,after],['helper.ts','function helper() { return 1; }'],['uses.ts','run();\n// surrounding source\n// more source\n']])),block=change.blocks[0];
 const caller=canvasSelection(change,{...selection(block,1),direction:'callers'},current).relations[0];assert.equal(caller.symbol,'Top level');const anchor={path:caller.path,line:1,direction:'callees',snapshot:'after',level:-1,anchorId:caller.id};assert.equal(canvasExcerpt(change,anchor,{start:1,end:1},'down',current).rows[0].text,'// surrounding source');
 const center=canvasSelection(change,anchor,current).relations[0];assert.equal(center.level,0);const helper=canvasSelection(change,{...anchor,path:center.path,line:2,anchorId:center.id,level:0},current).relations[0];assert.equal(helper.symbol,'helper');
});
