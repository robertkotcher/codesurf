import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewBlocks} from '../public/review-notes.js';
import {transformationPlan} from '../transformations.js';
test('block explanations stay with their file and account for earlier inserted text',async()=>{
 const plan=await transformationPlan([{path:'a.rb',status:'modified',before:'def first\n  one\nend\n\ndef second\n  two\nend\n',after:'def first\n  one\n  extra\nend\n\ndef second\n  changed\nend\n'},{path:'b.rb',status:'added',before:'',after:'def third\n  three\nend\n'}],{explain:false});
 const [first,second]=plan.operations.filter(o=>o.path==='a.rb'),third=plan.operations.find(o=>o.path==='b.rb');
 plan.steps=[{ids:[first.id]},{ids:[second.id,third.id],blocks:[{id:second.id,text:'Change the second result.'},{id:third.id,text:'Add the third method.'}]}];
 const a=reviewBlocks(plan,2,'a.rb'),b=reviewBlocks(plan,2,'b.rb');assert.equal(a.length,1);assert.equal(b.length,1);assert.equal(a[0].text,'Change the second result.');assert.equal(b[0].text,'Add the third method.');assert.equal(a[0].from,second.from+first.insert.length-first.deleted.length);
 plan.steps[1].blocks=[{id:second.id,text:'Only this block needs context.'}];
 assert.deepEqual(reviewBlocks(plan,2,'b.rb'),[]);
 assert.equal(reviewBlocks(plan,2,'a.rb')[0].from,a[0].from);
});
test('unannotated edits and old automatic descriptions stay quiet',()=>{
 const op={id:'a:0',path:'a.rb',from:0,insert:'value = 2',deleted:'value = 1'};
 const plan={files:[],operations:[op],steps:[{ids:[op.id],summary:'Review edits',notes:[]}]};
 assert.deepEqual(reviewBlocks(plan,1,'a.rb'),[]);
 plan.steps[0].blocks=[{id:op.id,text:'Replace value = 1 with value = 2.',source:'code'}];
 assert.deepEqual(reviewBlocks(plan,1,'a.rb'),[]);
 plan.steps[0].blocks=[];
 assert.deepEqual(reviewBlocks(plan,1,'a.rb'),[]);
});
