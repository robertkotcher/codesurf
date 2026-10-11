import test from 'node:test';import assert from 'node:assert/strict';import {exploreCalls} from '../public/call-graph.js';
const files=new Map([['entry.js','function entry() {\n  child();\n}\nfunction another() {\n  child();\n}'],['child.js','function child() {\n  grandchild();\n}'],['grand.js','function grandchild() {\n return 1;\n}']]);
test('call canvas finds enclosing block and expands callers and callees recursively',()=>{
 assert.equal(exploreCalls(files,{path:'child.js',line:2}).blocks[0].symbol,'child');
 const callers=exploreCalls(files,{path:'child.js',line:1,direction:'callers'});assert.deepEqual(callers.blocks.map(b=>[b.symbol,b.callLine]),[['entry',2],['another',5]]);
 const child=exploreCalls(files,{path:'entry.js',line:2,direction:'callees'}).blocks[0];assert.equal(child.symbol,'child');
 assert.equal(exploreCalls(files,{path:child.path,line:2,direction:'callees'}).blocks[0].symbol,'grandchild');
 assert.equal(exploreCalls(files,{path:'entry.js',line:1,direction:'callers'}).total,0);
});
test('call canvas rejects unavailable paths and invalid coordinates',()=>{assert.throws(()=>exploreCalls(files,{path:'missing',line:1}));assert.throws(()=>exploreCalls(files,{path:'child.js',line:99}));});
