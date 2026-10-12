import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {gzipSync} from 'node:zlib';
import tar from 'tar-stream';
import {indexArchive,searchIndex,readBlock} from '../repository.js';
async function archive(entries){const pack=tar.pack(),chunks=[];const done=(async()=>{for await(const c of pack)chunks.push(c)})();for(const entry of entries)pack.entry({name:'snapshot/'+entry.path,type:entry.type||'file'},entry.text||'');pack.finalize();await done;return Readable.from([gzipSync(Buffer.concat(chunks))])}
test('snapshot search includes unchanged source and returns exact code ranges',async()=>{
 const index=await indexArchive(await archive([{path:'src/api.ts',text:'import { charge } from "./billing";\ncharge();'},{path:'src/billing.ts',text:'// unrelated\nexport function charge() {\n  return "paid";\n}'}]));
 const result=searchIndex(index,'charge');assert.equal(result.indexedFiles,2);assert.equal(result.results.length,2);assert(result.results.some(r=>r.path==='src/billing.ts'));
 assert.equal(readBlock(index,'src/billing.ts',2,3).text,'2: export function charge() {\n3:   return "paid";');
});
test('archive never extracts or follows links and excludes unsafe, binary and credential files',async()=>{
 const index=await indexArchive(await archive([{path:'../escape.js',text:'unsafe'},{path:'.env.local',text:'secret'},{path:'link.ts',type:'symlink'},{path:'binary.ts',text:'a\0b'},{path:'node_modules/a.js',text:'dependency'},{path:'safe.ts',text:'export const safe = true;'}]));
 assert.deepEqual([...index.files.keys()],['safe.ts']);assert.equal(index.skipped,4);assert.throws(()=>readBlock(index,'../escape.js'));
});
test('search ranks matching paths and works across tens of thousands of files',()=>{
 const files=new Map(Array.from({length:25000},(_,i)=>[`src/file-${i}.ts`,'export const value = 1;']));files.set('src/payments/checkout.ts','export function settleInvoice() {}');
 const index={files,skipped:0};assert.equal(searchIndex(index,'settleInvoice').results[0].path,'src/payments/checkout.ts');assert.equal(searchIndex(index,'checkout').results[0].path,'src/payments/checkout.ts');
});

test('concurrent repository requests share one archive download and failed downloads can retry',async()=>{
 const {repositoryIndex}=await import('../repository.js');const previous=global.fetch;let calls=0;
 const stream=await archive([{path:'a.rb',text:'def ready?\n true\nend'}]),parts=[];for await(const chunk of stream)parts.push(chunk);const bytes=Buffer.concat(parts);
 const pr={head:{sha:'concurrency-test',repo:{full_name:'acme/concurrent'}}};
 global.fetch=async()=>{calls++;await new Promise(r=>setTimeout(r,10));return new Response(bytes)};
 try{const [first,second]=await Promise.all([repositoryIndex('test-token',pr),repositoryIndex('test-token',pr)]);assert.equal(calls,1);assert.equal(first,second);
  global.fetch=async()=>{calls++;return new Response('',{status:502})};pr.head.sha='retry-test';await assert.rejects(repositoryIndex('test-token',pr));
  global.fetch=async()=>{calls++;return new Response(bytes)};assert.equal((await repositoryIndex('test-token',pr)).files.size,1);
 }finally{global.fetch=previous}
});
