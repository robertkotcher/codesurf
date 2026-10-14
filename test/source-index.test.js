import test from 'node:test';import assert from 'node:assert/strict';import {buildCallIndex,indexedCalls,overlayCallIndex as overlayCallIndexForTest} from '../browser/source-index.js';
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
test('step graphs retain deleted entropy callers until their deletion and re-resolve unchanged callers',async()=>{
 const {overlayCallIndex}=await import('../browser/source-index.js');
 const path='route.ts',before='function entropy(str: string): number {\n return str.length;\n}\nfunction isValid(username: string): boolean {\n return entropy(username) < 3.75;\n}\nfunction POST() {\n return isValid("test");\n}';
 const base=buildCallIndex(new Map([[path,before],['unchanged.ts','function external() {\n return entropy("abc");\n}']]));
 const step0=overlayCallIndex(JSON.parse(JSON.stringify(base)),new Map([[path,before]]));assert.deepEqual(indexedCalls(step0,{path,line:1,direction:'callers'}).blocks.map(b=>b.symbol).sort(),['external','isValid']);assert.equal(indexedCalls(step0,{path,line:4,direction:'callers'}).blocks[0].symbol,'POST');
 const shifted='// added line\n'+before;const step1=overlayCallIndex(base,new Map([[path,shifted]]));assert.equal(indexedCalls(step1,{path,line:2,direction:'callers'}).total,2);assert.equal(indexedCalls(step1,{path:'unchanged.ts',line:2,direction:'callees'}).blocks[0].start,2);
 const final=overlayCallIndex(base,new Map([[path,'function POST() { return true; }']]));assert.equal(indexedCalls(final,{path,line:1,symbol:'entropy',direction:'callers'}).total,0);
});

test('Ruby syntax parses predicate methods, singleton methods, nested blocks and calls without parentheses',async()=>{
 const {initCallParsers}=await import('../browser/source-index.js');await initCallParsers();
 const source='class Deposit\n def disputed?\n  items.any? do |item|\n   item.active?\n  end\n end\n def check\n  Deposit.new.disputed?\n end\n def self.status\n  disputed?\n end\nend';
 const index=buildCallIndex(new Map([['deposit.rb',source],['other.rb','def screen\n Deposit.status\nend\n# deposit.disputed?\ntext = "deposit.disputed?"\n']]));
 const root=indexedCalls(index,{path:'deposit.rb',line:2}).blocks[0];assert.equal(root.symbol,'disputed?');assert.equal(root.end,6);assert.equal(root.precision,'syntax');
 assert.deepEqual(indexedCalls(index,{path:'deposit.rb',line:2,direction:'callers'}).blocks.map(b=>b.symbol),['check']);
 assert.equal(indexedCalls(index,{path:'deposit.rb',line:10,direction:'callers'}).blocks[0].symbol,'screen');
 assert.equal(indexedCalls(index,{path:'deposit.rb',line:8,direction:'callees'}).blocks[0].symbol,'disputed?');
});
test('Ruby local variables do not become callers of same-named methods',async()=>{
 const {initCallParsers}=await import('../browser/source-index.js');await initCallParsers();
 const index=buildCallIndex(new Map([['a.rb','def total\n 1\nend\ndef local(total)\n total + 1\nend\ndef assigned\n total = 2\n puts total\nend\ndef caller\n total\nend']]));
 assert.deepEqual(indexedCalls(index,{path:'a.rb',line:1,direction:'callers'}).blocks.map(b=>b.symbol),['caller']);
});

test('lazy caller resolution works with a scoped server index and changed-file overlays',()=>{
 const base=buildCallIndex(new Map([['a.ts','function child() {}\nfunction local() { child(); }'],['b.ts','function external() { child(); }']]));
 const scoped={...base,calls:base.calls.filter(c=>c.symbol==='child')};
 const current=overlayCallIndexForTest(scoped,new Map([['a.ts','function child() {}\nfunction renamed() { child(); }']]));
 assert.deepEqual(indexedCalls(current,{path:'a.ts',line:1,direction:'callers'}).blocks.map(b=>b.symbol).sort(),['external','renamed']);
});

test('Ruby callers resolve receiver classes, instance types and namespaces instead of matching every update',async()=>{
 const {initCallParsers}=await import('../browser/source-index.js');await initCallParsers();
 const index=buildCallIndex(new Map([
 ['one.rb','class One\n def update\n end\n def self.update\n end\n def internal\n update\n end\nend'],
 ['two.rb','class Two\n def update\n end\n def internal\n self.update\n end\nend'],
 ['uses.rb','def correct\n one = One.new\n one.update\nend\ndef wrong\n two = Two.new\n two.update\nend\ndef unknown(value)\n value.update\nend\ndef static\n One.update\nend'],
 ['namespaced.rb','module Admin\n class One\n def update\n end\n def internal\n self.update\n end\n end\nend']
 ]));
 assert.deepEqual(indexedCalls(index,{path:'one.rb',line:2,direction:'callers'}).blocks.map(b=>b.symbol).sort(),['correct','internal']);
 assert.deepEqual(indexedCalls(index,{path:'one.rb',line:4,direction:'callers'}).blocks.map(b=>b.symbol),['static']);
 assert.deepEqual(indexedCalls(index,{path:'two.rb',line:2,direction:'callers'}).blocks.map(b=>b.symbol).sort(),['internal','wrong']);
 assert.deepEqual(indexedCalls(index,{path:'namespaced.rb',line:3,direction:'callers'}).blocks.map(b=>b.symbol),['internal']);
});

test('Ruby inherited methods resolve to their defining class, overridden methods stay separate',async()=>{
 const {initCallParsers}=await import('../browser/source-index.js');await initCallParsers();
 const index=buildCallIndex(new Map([['a.rb','module A\n class Base\n def update\n end\n end\n class Child < Base\n def run\n update\n end\n end\n class Other < Base\n def update\n end\n def run\n update\n end\n end\nend']]));
 assert.deepEqual(indexedCalls(index,{path:'a.rb',line:3,direction:'callers'}).blocks.map(b=>b.owner),['A::Child']);
 assert.deepEqual(indexedCalls(index,{path:'a.rb',line:12,direction:'callers'}).blocks.map(b=>b.owner),['A::Other']);
});

test('multiline calls point at the method name rather than the receiver above it',async()=>{
 const {initCallParsers}=await import('../browser/source-index.js');await initCallParsers();
 const index=buildCallIndex(new Map([['call.ts','function run(client: Client) {\n const result = client\n  .update();\n return result;\n}\n'],['call.rb','def run(client)\n result = client\n  .update\n result\nend\n']]));
 for(const path of ['call.ts','call.rb']){assert.deepEqual(index.calls.filter(call=>call.path===path&&call.symbol==='update').map(call=>call.line),[3]);assert.equal(index.calls.some(call=>call.path===path&&call.line===2),false)}
});
