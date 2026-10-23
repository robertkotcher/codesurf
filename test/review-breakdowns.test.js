import test from 'node:test';
import assert from 'node:assert/strict';
import {completeBreakdown} from '../review-breakdowns.js';
import {transformationPlan} from '../transformations.js';
import {validatePlan,stateAt} from '../public/transformations.js';

test('saved story chapters materialize into complete deterministic steps without further AI requests',async()=>{
 const plan=await transformationPlan([{path:'a.ts',status:'modified',before:'one\ntwo\nthree\n',after:'ONE\ntwo\nTHREE\n'},{path:'b.ts',status:'added',before:'',after:'new\n'}],{explain:false});plan.pace='moderate';plan.steps=[];
 plan.story=[{title:'Introduce the new helper',shortTitle:'Introduce the new helper',ids:[plan.operations.at(-1).id]},{title:'Use the helper in the existing behavior',ids:plan.operations.slice(0,-1).map(op=>op.id)}];
 const before=JSON.stringify(plan),network=global.fetch;global.fetch=()=>{throw Error('Saved story must not call AI')};
 try{const result=await completeBreakdown(plan);assert.equal(JSON.stringify(plan),before);assert.equal(validatePlan(result),true);assert.deepEqual(result.steps.map(step=>step.ids),plan.story.map(chapter=>chapter.ids));assert.equal(result.steps[0].title,plan.story[0].title);assert.deepEqual(await completeBreakdown(result),result);assert.deepEqual(stateAt(result,result.steps.length),{'a.ts':'ONE\ntwo\nTHREE\n','b.ts':'new\n'})}finally{global.fetch=network}
});
test('already generated steps and their explanations stay unchanged while missing steps are filled once',async()=>{
 const plan=await transformationPlan([{path:'a.ts',status:'modified',before:'one\ntwo\nthree\n',after:'ONE\ntwo\nTHREE\n'}],{explain:false});plan.pace='guided';plan.steps=[{ids:[plan.operations[0].id],title:'Saved title',summary:'Saved explanation',blocks:[{id:plan.operations[0].id,text:'Keep this text.'}]}];plan.story=[{title:'Continue the saved story',ids:plan.operations.map(op=>op.id)}];
 const completed=await completeBreakdown(plan);assert.deepEqual(completed.steps[0],plan.steps[0]);assert.equal(validatePlan(completed),true);assert.equal(completed.steps.length,2);
});
test('each pace chunks a long saved chapter deterministically without losing or repeating edits',async()=>{
 const files=Array.from({length:40},(_,index)=>({path:index+'.ts',status:'added',before:'',after:'const value = '+index+';\n'})),original=await transformationPlan(files,{explain:false});
 original.steps=[];original.story=[{title:'Add the new examples',ids:original.operations.map(op=>op.id)}];
 for(const [pace,expected]of [['guided',14],['moderate',3],['quick',1]]){const completed=await completeBreakdown({...original,pace});assert.equal(completed.steps.length,expected);assert.equal(validatePlan(completed),true)}
});
