import test from 'node:test';
import assert from 'node:assert/strict';
import {inlineCommentTarget,reviewCommentThreads,publicPRComment} from '../canvas-comments.js';
import {transformationPlan} from '../transformations.js';
import {stateAt} from '../public/transformations.js';
import {mergeCommentThreads} from '../public/canvas-comments.js';

test('inline comments map reviewed lines to the final PR path and reject code changed again later',async()=>{
 const before='first\nkeep\nold\n',after='inserted\nfirst\nkeep\nnew\n',path='new.rb',plan=await transformationPlan([{path,previousPath:'old.rb',status:'renamed',before,after}],{explain:false}),files=[{filename:path,patch:'@@ -1,3 +1,4 @@\n+inserted\n first\n keep\n-old\n+new'}];
 const target=inlineCommentTarget(plan,0,{path:'old.rb',line:2},files,new Map([['old.rb',before]]));assert.equal(target.path,path);assert.equal(target.line,3);assert.equal(target.side,'RIGHT');
 assert.throws(()=>inlineCommentTarget(plan,0,{path:'old.rb',line:3},files,new Map([['old.rb',before]])),{status:409});assert.throws(()=>inlineCommentTarget(plan,0,{path:'library.rb',line:1},files,new Map([['library.rb','source']])),{status:400});assert.throws(()=>inlineCommentTarget(plan,0,{path:'old.rb',line:2},[{filename:path,patch:'@@ -3 +4 @@\n-old\n+new'}],new Map([['old.rb',before]])),/outside GitHub/);
});
test('existing GitHub threads map to each displayed snapshot and retain replies, while outdated anchors stay hidden',async()=>{
 const before='first\nkeep\nold\n',after='inserted\nfirst\nkeep\nnew\n',path='entry.rb',plan=await transformationPlan([{path,status:'modified',before,after}],{explain:false});plan.steps=[{ids:plan.operations.map(op=>op.id),title:'Update'}];
 const raw=[{id:1,path,line:3,side:'RIGHT',body:'Question',user:{login:'reviewer'},created_at:'2026-10-23T12:00:00Z'},{id:2,in_reply_to_id:1,path,line:3,body:'Answer',user:{login:'author'},created_at:'2026-10-23T12:01:00Z'},{id:3,path,line:null,original_line:3,body:'Outdated'},{id:4,path,line:3,side:'LEFT',body:'Removed'}],threads=reviewCommentThreads(raw,plan,1);
 assert.equal(threads.length,2);assert.equal(threads.find(thread=>thread.snapshot==='after').line,3);assert.equal(threads.find(thread=>thread.snapshot==='before').line,2);assert.deepEqual(threads[0].comments.map(comment=>comment.body),['Question','Answer']);
 assert.ok(stateAt(plan,1)[path].includes('new'));const merged=mergeCommentThreads(threads,reviewCommentThreads([...raw,{id:5,in_reply_to_id:1,path,line:3,body:'Follow-up',user:{login:'reviewer'}}],plan,1));assert.deepEqual(merged[0].comments.map(comment=>comment.id),[1,2,5]);
});
test('comment metadata never exposes unsafe avatar or link URLs',()=>{
 const comment=publicPRComment({id:1,body:'<img src=x onerror=alert(1)>',user:{login:'person',avatar_url:'https://evil.example/pixel'},html_url:'javascript:alert(1)'});assert.equal(comment.author.avatar,null);assert.equal(comment.url,null);assert.ok(comment.body.startsWith('<img'));
});
