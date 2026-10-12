import test from 'node:test';
import assert from 'node:assert/strict';
import {voiceSelection,voiceSession} from '../realtime-voice.js';
import {commentLines} from '../browser/comment-lines.js';
test('voice context is bounded, numbered and anchored to the selected source',()=>{
 const text=Array.from({length:200},(_,i)=>'line '+(i+1)).join('\n');
 const context=voiceSelection({path:'src/a.js',start:100,end:102},text);
 assert.equal(context.start,100);assert(context.source.startsWith('65: line 65'));assert(context.source.endsWith('137: line 137'));
 for(const selection of [{path:'../secret',start:1},{path:'a',start:0},{path:'a',start:2,end:201},{path:'a',start:2,end:1}])assert.throws(()=>voiceSelection(selection,text));
 const session=voiceSession({selection:context});assert.equal(session.type,'realtime');assert.equal(session.audio.output.voice,'marin');assert.equal(session.audio.input.turn_detection.interrupt_response,true);assert.match(session.instructions,/untrusted data/);
});
test('review comments map to final lines and reject code that changes again',()=>{
 assert.deepEqual(commentLines('a\nb\nc','intro\na\nb\nc',2,3),{start:3,end:4});
 assert.equal(commentLines('a\nb\nc','a\nchanged\nc',2,2),null);
 assert.equal(commentLines('a\nb\nc','a\nb\nextra\nc',2,3),null);
});
test('repository searches rank symbol definitions above incidental references',async()=>{
 const {searchIndex}=await import('../repository.js');
 const files=new Map(Array.from({length:30},(_,i)=>['app/admin/ref'+i+'.rb','StashTransaction.find(1)']));files.set('app/models/stash_transaction.rb','class StashTransaction\n  def disputed?\n    true\n  end\nend');
 assert.equal(searchIndex({files,skipped:0},'StashTransaction').results[0].path,'app/models/stash_transaction.rb');
 assert.equal(searchIndex({files,skipped:0},'disputed').results[0].start,1);
});
