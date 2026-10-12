import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewBlocks,describeEdit} from '../public/review-notes.js';
import {transformationPlan} from '../transformations.js';
test('block explanations stay with their file and account for earlier inserted text',async()=>{
 const plan=await transformationPlan([{path:'a.rb',status:'modified',before:'def first\n  one\nend\n\ndef second\n  two\nend\n',after:'def first\n  one\n  extra\nend\n\ndef second\n  changed\nend\n'},{path:'b.rb',status:'added',before:'',after:'def third\n  three\nend\n'}],{explain:false});
 const [first,second]=plan.operations.filter(o=>o.path==='a.rb'),third=plan.operations.find(o=>o.path==='b.rb');
 plan.steps=[{ids:[first.id]},{ids:[second.id,third.id],blocks:[{id:second.id,text:'Change the second result.'},{id:third.id,text:'Add the third method.'}]}];
 const a=reviewBlocks(plan,2,'a.rb'),b=reviewBlocks(plan,2,'b.rb');assert.equal(a.length,1);assert.equal(b.length,1);assert.equal(a[0].text,'Change the second result.');assert.equal(b[0].text,'Add the third method.');assert.equal(a[0].from,second.from+first.insert.length-first.deleted.length);
});
test('saved generic summaries are replaced by concrete source descriptions',()=>{
 const op={id:'a:0',path:'a.rb',from:11,insert:'  transactions.includes(:refunds)\n',deleted:'  transactions\n'};
 const plan={files:[{path:'a.rb',before:'def ledger\n  transactions\nend\n'}],operations:[op],steps:[{ids:[op.id],summary:'Review 3 edits across 2 files. Related file edits are grouped together.',notes:[]}]};
 const note=reviewBlocks(plan,1,'a.rb')[0];assert.match(note.text,/ledger/);assert.match(note.text,/includes\(:refunds\)/);assert.doesNotMatch(note.text,/edits across/);assert.equal(note.label,'Change note');
 assert.match(describeEdit({...op,insert:'',deleted:'def ledger\n  transactions\nend\n'}),/Remove ledger/);
});
