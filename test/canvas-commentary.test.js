import test from 'node:test';
import assert from 'node:assert/strict';
import {stepCommentary} from '../public/canvas-commentary.js';
const block=(rows,extra={})=>({id:'edit',path:'file.ts',rows,...extra});
test('step commentary uses the block explanation and a real added line',()=>{
 const result=stepCommentary({summary:'Overall change.',blocks:[block([{kind:'context',line:10,text:'unchanged'},{kind:'removed',old:11,text:'old()'},{kind:'added',line:11,text:''},{kind:'added',line:12,text:'}'},{kind:'added',line:13,text:'  const safe = Math.max(0, value);'}],{explanation:'Negative inputs become zero. A second sentence is omitted.'})]});
 assert.deepEqual(result,{anchorId:'edit',path:'file.ts',line:13,snapshot:'after',text:'Negative inputs become zero.'});
});
test('removed lines and metadata never receive commentary',()=>{
 assert.equal(stepCommentary({summary:'Removes the retry after a final failure.',blocks:[block([],{metadata:true}),block([{kind:'removed',old:41,line:null,text:'retry()'}],{deleted:true,explanation:'The author removed retries.'})]}),null);
 assert.equal(stepCommentary({summary:'Rename file.',blocks:[block([],{metadata:true})]}),null);
 assert.equal(stepCommentary({summary:'Remove retries.',blocks:[block([{kind:'removed',old:41,text:'retry()'},{kind:'added',line:41,text:''}])]}),null);
});
test('a mixed step places commentary on the added block, skipping earlier removals',()=>{
 const result=stepCommentary({summary:'Update payments.',blocks:[block([{kind:'removed',old:5,text:'old_list = []'}],{id:'removed',explanation:'Delete the old list.'}),block([{kind:'added',line:100,text:'validate()'}],{id:'added',explanation:'Validate the payment.'})]});assert.equal(result.anchorId,'added');assert.equal(result.line,100);assert.equal(result.snapshot,'after');assert.equal(result.text,'Validate the payment.');
});
test('commentary stays brief and skips generic fallback counts',()=>{
 assert.equal(stepCommentary({summary:'Review 3 edits across 2 files.',blocks:[block([{kind:'added',line:1,text:'run()'}])]}),null);
 const result=stepCommentary({summary:'Overall change.',blocks:[block([{kind:'added',line:1,text:'run()'}],{explanation:'This code '+Array(100).fill('checks').join(' ')})]});assert(result.text.length<=220);assert(result.text.endsWith('…'));
});
test('the opening callout stays on the first changed block rather than skipping ahead',()=>{
 const result=stepCommentary({summary:'Use the shared list for validation.',blocks:[block([{kind:'added',line:5,text:'SHARED_LIST.include?(value)'}]),block([{kind:'added',line:100,text:'validate()'}],{id:'later',explanation:'This is a later block.'})]});assert.equal(result.anchorId,'edit');assert.equal(result.line,5);
});
