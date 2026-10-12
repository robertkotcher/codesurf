import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileStory} from '../review-story.js';
import {chooseStep,remainingEdits} from '../review-sessions.js';
import {transformationPlan} from '../transformations.js';
import {stateAt,validatePlan} from '../public/transformations.js';
test('story assignments preserve narrative order while accounting for omitted, duplicate and invented IDs',()=>{
 const operations=[{id:'a',path:'a.js'},{id:'b',path:'b.js'},{id:'c',path:'a.js'}];
 const story=reconcileStory(operations,[{title:'Core behavior',ids:['b','invented','b']},{title:'Integration',ids:['a','b']}]);
 assert.deepEqual(story.map(c=>c.ids),[['b'],['a'],['c']]);
 assert.equal(story[0].title,'Core behavior');
});
test('unequal story chapters cross file boundaries without padding and reconstruct the exact head',async()=>{
 const key=process.env.OPENAI_API_KEY;delete process.env.OPENAI_API_KEY;
 try{
  const files=[{path:'a.js',status:'modified',before:'one\ntwo\nthree\n',after:'ONE\ntwo\nTHREE\n'},{path:'b.js',status:'added',before:'',after:'new\n'}];
  const plan=await transformationPlan(files,{explain:false});plan.steps=[];plan.pace='quick';
  const [a,c,b]=plan.operations;
  plan.story=reconcileStory(plan.operations,[{title:'Introduce behavior',summary:'The foundation.',ids:[b.id]},{title:'Connect existing code',summary:'Use the new behavior.',ids:[c.id,a.id]}]);
  const first=await chooseStep(plan);assert.deepEqual(first.ids,[b.id]);assert.equal(first.title,'Introduce behavior');plan.steps.push(first);
  const second=await chooseStep(plan);assert.deepEqual(second.ids,[c.id,a.id]);plan.steps.push(second);
  assert.equal(remainingEdits(plan).length,0);assert.equal(await chooseStep(plan),null);assert.equal(validatePlan(plan),true);
  const state=stateAt(plan,2);for(const file of files)assert.equal(state[file.path],file.after);
 }finally{if(key!==undefined)process.env.OPENAI_API_KEY=key}
});
