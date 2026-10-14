import test from 'node:test';
import assert from 'node:assert/strict';
import {remainingEdits,checkedStep,stepBudget,chooseStep,reviewPace,noteStyle} from '../review-sessions.js';
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
 assert.deepEqual(checkedStep({ids:['1'],title:'Title',summary:'Summary',notes:['ignore']},remaining),{ids:['1'],blocks:[],noteStyle,title:'Title',summary:'Summary',notes:[]});
});

test('review paces increase batch sizes and still cover every immutable edit once',async()=>{
 const key=process.env.OPENAI_API_KEY;delete process.env.OPENAI_API_KEY;
 try{const totals=[];for(const pace of ['guided','moderate','quick']){
 const plan={pace,operations:Array.from({length:100},(_,i)=>({id:String(i),path:'file'+Math.floor(i/10)+'.js',insert:'x\n',deleted:'y\n'})),steps:[]};
 while(remainingEdits(plan).length){const before=remainingEdits(plan),budget=stepBudget(plan,before),step=await chooseStep(plan);assert(step.ids.length>=budget.min&&step.ids.length<=budget.max);assert.deepEqual(step.blocks,[]);assert.equal(step.noteStyle,noteStyle);plan.steps.push(step)}
 assert.equal(new Set(plan.steps.flatMap(s=>s.ids)).size,100);totals.push(plan.steps.length);
 }assert.deepEqual(totals,[100,20,5]);}finally{if(key!==undefined)process.env.OPENAI_API_KEY=key}
});
test('pace validation and mode-specific edit count bounds reject invalid selections',()=>{
 assert.throws(()=>reviewPace('instant'),{status:400});assert.equal(reviewPace(),'guided');
 const remaining=Array.from({length:50},(_,i)=>({id:String(i)})),budget=stepBudget({pace:'quick',operations:remaining},remaining);
 assert.throws(()=>checkedStep({ids:['0']},remaining,budget));
 assert.equal(checkedStep({ids:remaining.slice(0,10).map(o=>o.id)},remaining,budget).ids.length,10);
});

test('block explanations only attach to selected edit IDs',()=>{
 const step=checkedStep({ids:['a','b'],blocks:[{id:'a',text:'Add refund totals.'},{id:'other',text:'Wrong file.'},{id:'b',text:''}]},[{id:'a'},{id:'b'}]);
 assert.deepEqual(step.blocks,[{id:'a',text:'Add refund totals.'}]);
});

test('block explanations receive both removed and added source for each edit',async()=>{
 const key=process.env.OPENAI_API_KEY,original=globalThis.fetch;process.env.OPENAI_API_KEY='test';let body;
 const operations=[{id:'remove',path:'confirm.rb',insert:'',deleted:'PAYMENT_TYPES = %w[early missed].freeze\n'},{id:'replace',path:'confirm.rb',insert:'Guard::PAYMENT_TYPES.include?(type)\n',deleted:'PAYMENT_TYPES.include?(type)\n'}],text='The author has removed the local list of accepted payment types.';
 globalThis.fetch=async(_url,options)=>{body=JSON.parse(options.body);return Response.json({id:'response',object:'response',status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify({ids:operations.map(op=>op.id),title:'Share accepted payment types',summary:text,blocks:[{id:'remove',text},{id:'replace',text:'The author has replaced the local list with the shared list.'}]})}]}]})};
 try{const step=await chooseStep({pace:'moderate',operations,steps:[]}),input=JSON.parse(body.input);assert.equal(input.edits[0].removed,operations[0].deleted);assert.equal(input.edits[0].added,'');assert.equal(input.edits[1].removed,operations[1].deleted);assert.equal(input.edits[1].added,operations[1].insert);assert.deepEqual(step.blocks,[{id:'replace',text:'The author has replaced the local list with the shared list.'}]);assert.match(body.instructions,/Omit block notes for pure removals/);assert.equal(step.noteStyle,'canvas-edit-v2')}finally{globalThis.fetch=original;if(key===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=key}
});
