import test from 'node:test';
import assert from 'node:assert/strict';
import {stepChangeCounts} from '../public/file-details.js';
test('file footer counts only this step and file, including final lines without newlines',()=>{
 const plan={steps:[{ids:['a','b','rename']},{ids:['later']}],operations:[{id:'a',path:'one.rb',insert:'one\ntwo',deleted:'old\n'},{id:'b',path:'two.rb',insert:'other\n',deleted:''},{id:'rename',path:'one.rb',metadata:true,insert:'ignored',deleted:'ignored'},{id:'later',path:'one.rb',insert:'later\n',deleted:''}]};
 assert.deepEqual(stepChangeCounts(plan,1,'one.rb'),{added:2,removed:1});assert.deepEqual(stepChangeCounts(plan,1,'unchanged.rb'),{added:0,removed:0});assert.deepEqual(stepChangeCounts(plan,2,'one.rb'),{added:1,removed:0});
});
