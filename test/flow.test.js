import test from 'node:test';
import assert from 'node:assert/strict';
import {validateFlow} from '../flow.js';
import {layoutFlow} from '../public/flow-layout.js';
const index={files:new Map([['entry.ts','function entry() {\n  child();\n}'],['child.ts','function child() {\n  grandchild();\n}'],['grand.ts','function grandchild() {}']])};
const input={title:'Request flow',summary:'Entry calls child.',steps:[{path:'entry.ts',start:1,end:3,label:'entry',relation:'entry',callerLine:null},{path:'child.ts',start:1,end:3,label:'child',relation:'call',callerLine:2,symbol:'child'},{path:'grand.ts',start:1,end:1,label:'grandchild',relation:'call',callerLine:2,symbol:'grandchild'}]};
test('callee lines align with caller sites through successive call depths',()=>{const result=layoutFlow(validateFlow(input,index).steps);assert.deepEqual(result.map(s=>s.offset),[0,20,40]);for(let i=1;i<result.length;i++)assert.equal(result[i].offset,result[i-1].offset+(result[i].callerLine-result[i-1].start)*20)});
test('source layout rejects invented source ranges and incorrect call sites',()=>{assert.throws(()=>validateFlow({...input,steps:[{...input.steps[0],end:9}]},index));assert.throws(()=>validateFlow({...input,steps:[input.steps[0],{...input.steps[1],callerLine:1}]},index));assert.throws(()=>validateFlow({...input,steps:[input.steps[0],{...input.steps[1],symbol:'unrelated'}]},index));});
test('related models and templates are not displayed as direct calls',()=>{const result=layoutFlow(validateFlow({...input,steps:[input.steps[0],{...input.steps[1],relation:'related',callerLine:null,symbol:'Model'}]},index).steps);assert.equal(result[1].offset,0);assert.equal(result[1].relation,'related');assert.equal(result[1].callerLine,null)});

test('constants above a callee remain visible without shifting the call alignment',()=>{const steps=[{start:20,end:30,entryLine:20,relation:'entry'},{start:1,end:8,entryLine:4,callerLine:22,relation:'call'}];const layout=layoutFlow(steps);assert(layout.every(s=>s.offset>=0));assert.equal(layout[0].offset+(22-20)*20,layout[1].offset+(4-1)*20)});

test('a unique source call recovers an omitted call coordinate',()=>{const flow=validateFlow({...input,steps:[input.steps[0],{...input.steps[1],relation:'related',callerLine:null}]},index);assert.equal(flow.steps[1].relation,'call');assert.equal(flow.steps[1].callerLine,2)});
