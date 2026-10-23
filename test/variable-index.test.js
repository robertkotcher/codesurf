import test from 'node:test';
import assert from 'node:assert/strict';
import {variableBindings} from '../browser/variable-index.js';
import {buildCallIndex,initCallParsers} from '../browser/source-index.js';
import {canvasSourceAffordances} from '../canvas-relations.js';
import {mergeVariableBindings} from '../public/variable-data.js';

test('TypeScript variables follow lexical bindings rather than spelling, and retain declared types',()=>{
 const path='example.ts',text='const value: number = 2;\nfunction first(value: string) { return value; }\nfunction second() { const local = value; return local; }\nconst object = {value: "not a reference"}; // value\n',bindings=variableBindings(new Map([[path,text]]),path),values=bindings.filter(item=>item.name==='value');
 assert.equal(values.length,2);assert.notEqual(values[0].id,values[1].id);assert.equal(values[0].type,'number');assert.equal(values[0].typeSource,'declared');assert.deepEqual(values[0].occurrences.map(item=>item.line),[1,3]);assert.equal(values[1].type,'string');assert.deepEqual(values[1].occurrences.map(item=>item.line),[2,2]);
 assert.equal(bindings.find(item=>item.name==='local').type,'number');assert.equal(bindings.find(item=>item.name==='local').typeSource,'inferred');
});
test('top-level and function scopes at the same source offset have distinct identities',()=>{
 const path='first.ts',bindings=variableBindings(new Map([[path,'function run(user: string) { return user; }\nconst user = 1;\nuser;']]),path),users=bindings.filter(item=>item.name==='user');assert.equal(new Set(users.map(item=>item.id)).size,2);assert.deepEqual(users.map(item=>item.occurrences.length),[2,2]);
});
test('destructuring, multiple declarations and nested block shadowing keep their own references',()=>{
 const path='sample.ts',text='const {value: item, other} = source;\nlet first = 1, second: string = "a";\n{ let first = 2; first; }\nfirst; item; other; second;\n',bindings=variableBindings(new Map([[path,text]]),path);
 assert.equal(bindings.find(item=>item.name==='item').type,null);assert.equal(bindings.filter(item=>item.name==='first').length,2);assert.equal(bindings.find(item=>item.name==='second').type,'string');assert.equal(bindings.find(item=>item.name==='item').occurrences.length,2);assert.equal(bindings.find(item=>item.name==='other').occurrences.length,2);assert.ok(!bindings.some(item=>item.name==='value'));
});
test('relative imports show the actual exported variable definition and annotated type',()=>{
 const files=new Map([['config.ts','export const timeout: number = 300;\n'],['entry.ts','import { timeout as wait } from "./config";\nconst result = wait;\n'],['unrelated.ts','export const timeout = "wrong";']]),bindings=variableBindings(files,'entry.ts'),wait=bindings.find(item=>item.name==='wait');assert.equal(wait.definition.path,'config.ts');assert.equal(wait.definition.line,1);assert.equal(wait.type,'number');assert.equal(wait.typeSource,'declared');assert.equal(wait.occurrences.length,2);
});
test('object shorthand, arrow parameters, loop bindings and catch parameters remain inspectable',()=>{
 const path='example.ts',text='const value = 1; const object = {value};\nconst transform = value => value + 1;\nfor (const item of items) { item; }\ntry {} catch (error) { console.log(error); }\n',bindings=variableBindings(new Map([[path,text]]),path),values=bindings.filter(item=>item.name==='value');assert.equal(values.length,2);assert.deepEqual(values.map(item=>item.occurrences.length),[2,2]);assert.equal(bindings.find(item=>item.name==='item').occurrences.length,2);assert.equal(bindings.find(item=>item.name==='error').occurrences.length,2);
});
test('Python parameters, annotations and separate functions resolve independently',()=>{
 const path='example.py',text='def first(user: str, count=2):\n result: str = "ok"\n return user + result\ndef second(user: int):\n return user\n',bindings=variableBindings(new Map([[path,text]]),path),users=bindings.filter(item=>item.name==='user');assert.deepEqual(users.map(item=>item.type),['str','int']);assert.equal(new Set(users.map(item=>item.id)).size,2);assert.deepEqual(users.map(item=>item.occurrences.length),[2,2]);assert.equal(bindings.find(item=>item.name==='count').type,'int');assert.equal(bindings.find(item=>item.name==='result').definition.lines.length,3);
});
test('Python comprehension bindings do not highlight outer variables, and methods bypass class locals',()=>{
 const path='example.py',text='value = "outer"\nclass Demo:\n value = 1\n def run(self, items):\n  return [value for value in items]\n def other(self):\n  return value\n',bindings=variableBindings(new Map([[path,text]]),path),values=bindings.filter(item=>item.name==='value');assert.equal(values.length,3);assert.deepEqual(values.map(item=>item.occurrences.map(token=>token.line)),[[1,7],[3],[5,5]]);
});
test('Python relative imports reveal definitions from the repository rather than unrelated names',()=>{
 const files=new Map([['app/settings.py','timeout: int = 3\n'],['app/run.py','from .settings import timeout as wait\nprint(wait)\n']]),binding=variableBindings(files,'app/run.py').find(item=>item.name==='wait');assert.equal(binding.definition.path,'app/settings.py');assert.equal(binding.type,'int');assert.equal(binding.occurrences.length,2);
});
test('Ruby parameters, locals, block parameters and instance variables use real syntax scopes',async()=>{
 await initCallParsers();const path='demo.rb',text='class Demo\n def setup(user)\n  @user = User.new\n  result = 2\n  items.each do |result|\n   puts result\n  end\n  result\n end\n def other\n  @user\n end\nend',bindings=variableBindings(new Map([[path,text]]),path),results=bindings.filter(item=>item.name==='result'),user=bindings.find(item=>item.name==='@user');assert.equal(results.length,2);assert.deepEqual(results.map(item=>item.occurrences.map(token=>token.line)),[[4,8],[5,6]]);assert.deepEqual(user.occurrences.map(item=>item.line),[3,11]);assert.equal(user.type,'User');assert.equal(user.typeSource,'inferred');assert.equal(bindings.find(item=>item.name==='user').type,null);
});
test('Ruby block-only locals do not escape their block, and outer variables are captured',async()=>{
 await initCallParsers();const path='demo.rb',text='def run\n outer = 1\n items.each do |item|\n  outer += item\n  inner = item\n  inner\n end\n outer\n inner\nend',bindings=variableBindings(new Map([[path,text]]),path);assert.deepEqual(bindings.find(item=>item.name==='outer').occurrences.map(item=>item.line),[2,4,8]);assert.deepEqual(bindings.find(item=>item.name==='inner').occurrences.map(item=>item.line),[5,6]);
});
test('Ruby fields resolve across reopened class files without confusing other owners',async()=>{
 await initCallParsers();const files=new Map([['a.rb','class Demo\n def setup\n  @user = User.new\n end\nend'],['b.rb','class Demo\n def run\n  @user.name\n end\nend'],['other.rb','class Other\n def setup\n  @user = "wrong"\n end\nend']]),graph=buildCallIndex(files),binding=variableBindings(files,'b.rb',{owners:graph.owners}).find(item=>item.name==='@user');assert.equal(binding.definition.path,'a.rb');assert.equal(binding.type,'User');assert.deepEqual(binding.occurrences.map(item=>item.line),[3]);
});
test('Ruby class-instance variables and ordinary instance variables are distinct bindings',async()=>{
 await initCallParsers();const path='demo.rb',text='class Demo\n def self.setup\n  @state = "class"\n  @state\n end\n def setup\n  @state = 1\n  @state\n end\nend',bindings=variableBindings(new Map([[path,text]]),path).filter(binding=>binding.name==='@state');assert.equal(bindings.length,2);assert.deepEqual(bindings.map(binding=>binding.type),['String','Integer']);assert.deepEqual(bindings.map(binding=>binding.occurrences.map(token=>token.line)),[[3,4],[7,8]]);assert.notEqual(bindings[0].id,bindings[1].id);
});
test('unknown fields and call results stay unknown rather than guessing types or origins',async()=>{
 await initCallParsers();const path='demo.rb',bindings=variableBindings(new Map([[path,'class Demo\n def run\n  result = stored_location_for(@user)\n  result\n end\nend']]),path);assert.equal(bindings.find(item=>item.name==='result').type,null);assert.equal(bindings.find(item=>item.name==='@user').definition,null);
});
test('variable metadata is bounded to each excerpt, merges across expansions and separates snapshots',()=>{
 const path='main.ts',before=new Map([[path,'const answer: string = "old";\nanswer;\nanswer;']]),after=new Map([[path,'const answer: number = 7;\nanswer;\nanswer;']]),source=files=>({index:{files},graph:buildCallIndex(files)}),a=source(after),first=canvasSourceAffordances(a,path,1,1),last=canvasSourceAffordances(a,path,2,3),old=canvasSourceAffordances(source(before),path,1,3);
 assert.equal(first.variables[0].occurrences.length,1);assert.equal(last.variables[0].occurrences.length,2);assert.equal(mergeVariableBindings(first.variables,last.variables,first.variables)[0].occurrences.length,3);assert.equal(first.variables[0].type,'number');assert.equal(old.variables[0].type,'string');assert.equal(variableBindings(after,path),variableBindings(after,path));
});
