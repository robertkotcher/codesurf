import test from 'node:test';
import assert from 'node:assert/strict';
import {validateReview} from '../reviews.js';
const files=[{filename:'src/a.ts',patch:'@@ -5,3 +5,4 @@\n before\n-old\n+new\n+extra\n after'}];
test('review comments preserve correct original and current diff coordinates',()=>{
 const review=validateReview({body:'Summary',comments:[{path:'src/a.ts',start_line:6,line:7,side:'RIGHT',body:'Check this range'},{path:'src/a.ts',line:6,side:'LEFT',body:'Original code'}]},files);
 assert.equal(review.comments[0].start_side,'RIGHT');assert.equal(review.comments[1].side,'LEFT');assert.equal(review.event,'COMMENT');
});
test('unchanged files, stale lines, empty comments and invalid events cannot be posted',()=>{
 for(const comment of [{path:'other.ts',line:6,body:'Hi'},{path:'src/a.ts',line:99,body:'Hi'},{path:'src/a.ts',line:6,body:''}])assert.throws(()=>validateReview({body:'',comments:[comment]},files));
 assert.throws(()=>validateReview({body:'',event:'MERGE'},files));assert.throws(()=>validateReview({body:'',comments:[]},files));
});

test('draft comments map displayed review lines to head and refuse changed or unchanged source',async()=>{
 const {draftReview}=await import('../reviews.js');
 const current='def balance\n  amount\nend\n',head='# new header\n'+current;
 const plan={files:[{path:'src/a.ts',before:current,after:head}],operations:[],steps:[]};
 const diff=[{filename:'src/a.ts',patch:'@@ -1,3 +1,4 @@\n+# new header\n def balance\n   amount\n end'}];
 const args={path:'src/a.ts',start:1,end:2,body:'Please check this',snapshot:'review'};
 const draft=draftReview(args,diff,{plan,count:0,snapshot:'review'});
 assert.deepEqual(draft.comments,[{path:'src/a.ts',line:3,start_line:2,start_side:'RIGHT',side:'RIGHT',body:'Please check this'}]);
 plan.files[0].after=head.replace('amount','refund');assert.throws(()=>draftReview(args,diff,{plan,count:0,snapshot:'review'}),/change later/);
 assert.throws(()=>draftReview({...args,path:'unchanged.ts'},diff),/Invalid line comment/);
 assert.throws(()=>draftReview({...args,start:0},diff),/existing line/);
 assert.deepEqual(draftReview({path:null,start:null,end:null,body:'General concern'},diff),{body:'General concern',comments:[],event:'COMMENT'});
});
