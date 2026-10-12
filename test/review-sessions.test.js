import test from 'node:test';
import assert from 'node:assert/strict';
import {remainingEdits,checkedStep} from '../review-sessions.js';
import {transformationPlan} from '../transformations.js';
import {validatePlan,stateAt} from '../public/transformations.js';
test('incremental review selections shrink deterministically and reconstruct the head',async()=>{
 const plan=await transformationPlan([{path:'a.js',status:'modified',before:'one\ntwo\nthree\n',after:'ONE\ntwo\nTHREE\n'},{path:'new.js',status:'added',before:'',after:'new\n'}],{explain:false});plan.steps=[];
 const expected=plan.operations.length;let chosen=0;
 while(remainingEdits(plan).length){const remaining=remainingEdits(plan);const step=checkedStep({ids:[remaining.at(-1).id],title:'A change',summary:'Explanation'},remaining);plan.steps.push(step);chosen++;assert.equal(remainingEdits(plan).length,expected-chosen)}
 assert.equal(validatePlan(plan),true);assert.equal(stateAt(plan,plan.steps.length)['a.js'],'ONE\ntwo\nTHREE\n');
});
test('step selection rejects invented, duplicate, empty, oversized, and previously selected edits',()=>{
 const ops=Array.from({length:10},(_,i)=>({id:String(i)})),remaining=remainingEdits({operations:ops,steps:[{ids:['0']}]});
 for(const ids of [[],['invented'],['1','1'],['0'],ops.slice(1).map(o=>o.id)])assert.throws(()=>checkedStep({ids},remaining));
 assert.deepEqual(checkedStep({ids:['1'],title:'Title',summary:'Summary',notes:['ignore']},remaining),{ids:['1'],title:'Title',summary:'Summary',notes:[]});
});
