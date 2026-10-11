import test from 'node:test';import assert from 'node:assert/strict';import {buildCallIndex,indexedCalls} from '../browser/source-index.js';
test('typed entropy selection returns the exact function, not surrounding imports after line shifts',()=>{
 const files=new Map([['route.ts','import x from "x";\n\nfunction entropy(str: string): number {\n if (!str) return 0;\n return str.length;\n}\nfunction first() {\n return entropy("a");\n}\nfunction second() {\n return entropy("b");\n}']]);
 const index=buildCallIndex(files);assert.equal(buildCallIndex(files),index);
 const root=indexedCalls(index,{path:'route.ts',line:3}).blocks[0];assert.equal(root.symbol,'entropy');assert(root.text.startsWith('function entropy'));assert.equal(root.end,6);
 const callers=indexedCalls(index,{path:'route.ts',line:50,symbol:'entropy',direction:'callers'});assert.deepEqual(callers.blocks.map(b=>b.symbol),['first','second']);assert.deepEqual(callers.blocks.map(b=>b.callLine),[8,11]);
 assert.throws(()=>indexedCalls(index,{path:'route.ts',line:1}));
});
test('syntax index ignores comments and strings and resolves aliased relative imports',()=>{
 const index=buildCallIndex(new Map([['lib.ts','export function entropy(str: string) { return str.length; }'],['other.ts','function entropy() { return 0; }'],['entry.ts','import { entropy as measure } from "./lib";\nfunction run() {\n // measure("fake");\n const text="measure(fake)";\n return measure(text);\n}']]));
 assert.deepEqual(indexedCalls(index,{path:'lib.ts',line:1,direction:'callers'}).blocks.map(b=>b.symbol),['run']);assert.equal(indexedCalls(index,{path:'other.ts',line:1,direction:'callers'}).total,0);
 const callees=indexedCalls(index,{path:'entry.ts',line:5,direction:'callees'});assert.equal(callees.blocks[0].path,'lib.ts');
});
test('Python definitions, nested calls and TypeScript arrow functions are indexed',()=>{
 const index=buildCallIndex(new Map([['a.py','def entropy(value: str):\n    return len(value)\n\ndef caller(value):\n    return entropy(value)\n'],['a.ts','const entropy = (s: string) => s.length;\nconst wrapper = () => entropy("a");']]));
 assert.equal(indexedCalls(index,{path:'a.py',line:2}).blocks[0].symbol,'entropy');assert.equal(indexedCalls(index,{path:'a.py',line:1,direction:'callers'}).blocks[0].symbol,'caller');assert.equal(indexedCalls(index,{path:'a.ts',line:1,direction:'callers'}).blocks[0].symbol,'wrapper');
});
