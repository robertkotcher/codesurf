import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewLocation,reviewChangeURL} from '../public/review-url.js';
const pr='https://github.com/acme/example/pull/42',head='a'.repeat(40),base='b'.repeat(40);
test('a plain PR URL starts at change one while explicit change links retain their immutable revision',()=>{
 assert.deepEqual(reviewLocation('https://codesurf.io/github/acme/example/pull/42'),{change:1,head:null,base:null});
 const url=reviewChangeURL(pr,7,head,base);assert.equal(new URL(url,'https://codesurf.io').searchParams.get('change'),'7');assert.deepEqual(reviewLocation('https://codesurf.io'+url),{change:7,head,base});
});
test('invalid change numbers normalize to the first change and links cannot escape the app route',()=>{
 for(const value of ['0','-1','2.5','Infinity','abc','9999999','01'])assert.equal(reviewLocation('https://codesurf.io/github/a/b/pull/1?change='+value).change,1);
 assert.equal(reviewLocation('https://codesurf.io/?change=3&head=invalid').head,null);
 for(const [url,change]of [['https://evil.example/acme/example/pull/42',1],[pr,0],[pr,NaN],[pr,1.5]])assert.throws(()=>reviewChangeURL(url,change,head,base));
});
