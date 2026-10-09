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
