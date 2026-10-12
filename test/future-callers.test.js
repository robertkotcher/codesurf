import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCallIndex,initCallParsers} from '../browser/source-index.js';
import {futureCallers} from '../browser/future-callers.js';
const files=text=>new Map([['example.ts',text]]);
test('future callers distinguish unapplied changes from current callers despite shifted lines',()=>{
 const applied=files('function helper() {}\nfunction existing() { helper(); }');
 const final=files('// new heading\nfunction helper() {}\nfunction existing() { helper(); }\nfunction later() { helper(); }');
 const a=buildCallIndex(applied),b=buildCallIndex(final),result=futureCallers(a,b,a.blocks[0],applied,final);
 assert.equal(result.total,1);assert.equal(result.blocks[0].symbol,'later');assert.match(result.message,/applied review changes/);
 assert.equal(futureCallers(b,b,b.blocks[0],final,final).total,0);
});
test('a function introduced later can report its final PR callers without implying it exists now',()=>{
 const applied=files('function old() {}'),final=files('function helper() {}\nfunction later() { helper(); }');
 const a=buildCallIndex(applied),b=buildCallIndex(final);assert.equal(futureCallers(a,b,b.blocks[0],applied,final).total,1);
});
test('future Ruby callers stay scoped to the selected class',async()=>{
 await initCallParsers();const applied=new Map([['models.rb','class Account\n def update\n end\nend\nclass Other\n def update\n end\nend']]),final=new Map([['models.rb',applied.get('models.rb')+'\ndef wrong\n Other.new.update\nend\ndef later\n Account.new.update\nend']]);
 const a=buildCallIndex(applied),b=buildCallIndex(final),result=futureCallers(a,b,a.blocks.find(x=>x.owner==='Account'),applied,final);assert.deepEqual(result.blocks.map(b=>b.symbol),['later']);
});
