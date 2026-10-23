import test from 'node:test';
import assert from 'node:assert/strict';
import {shortChangeTitle,reviewOutline} from '../public/review-outline.js';
import {checkedStep} from '../review-sessions.js';
import {reconcileStory,planStory} from '../review-story.js';

test('outline labels are capped at ten words, including old saved reviews and invalid generated lengths',()=>{
 const long='Prevent users from being redirected to the marketing homepage after signing in with Google';
 for(const value of [long,'   '+long.replaceAll(' ','\n\t')+'   ','',null,'Show the saved destination'])assert.ok(shortChangeTitle(value).split(/\s+/u).length<=10);
 assert.equal(shortChangeTitle('   Show\n the saved destination  '),'Show the saved destination');assert.ok(shortChangeTitle(long).endsWith('…'));
 const candidate=checkedStep({ids:['a'],title:long,shortTitle:long},[{id:'a'}]);assert.equal(candidate.title,long);assert.equal(candidate.shortTitle.split(/\s+/u).length,10);
 const story=reconcileStory([{id:'a',path:'a.rb'}],[{ids:['a'],title:long,shortTitle:long}]);assert.equal(story[0].shortTitle.split(/\s+/u).length,10);
});
test('outline includes upcoming logical changes and highlights the current chapter across unequal steps',()=>{
 const plan={story:[{ids:['a','b'],title:'Handle the destination saved before login',shortTitle:'Preserve the saved sign-in destination'},{ids:['c'],title:'Test dashboard redirects'}],steps:[{ids:['a'],title:'Read saved destination'},{ids:['b'],title:'Keep the saved destination'}]};
 const items=reviewOutline(plan,2);assert.equal(items.length,2);assert.deepEqual(items.map(item=>item.number),[1,2]);assert.equal(items[0].title,'Preserve the saved sign-in destination');assert.equal(items[0].active,true);assert.equal(items[0].step,1);assert.equal(items[1].step,0);assert.equal(items[1].reviewed,false);
 plan.steps.push({ids:['c'],title:'Test dashboard redirects'});assert.equal(reviewOutline(plan,3)[1].active,true);assert.equal(reviewOutline(plan,3)[1].step,3);
});
test('saved reviews without a story and steps completed before story extraction remain in the sidebar',()=>{
 assert.deepEqual(reviewOutline(null),[]);const steps=[{ids:['old'],title:'Earlier change'},{ids:['new'],title:'New change'}];assert.deepEqual(reviewOutline({steps},1).map(item=>item.step),[1,2]);
 const result=reviewOutline({steps,story:[{ids:['new'],title:'New change'}]},1);assert.deepEqual(result.map(item=>item.title),['Earlier change','New change']);assert.equal(result[0].active,true);
});
test('fully cached step numbers match URL positions even when a story chapter spans several steps',()=>{
 const plan={operations:[{id:'a'},{id:'b'},{id:'c'}],story:[{ids:['a','b'],title:'First chapter'},{ids:['c'],title:'Second chapter'}],steps:[{ids:['a'],title:'Start the first change'},{ids:['b'],title:'Finish the first change'},{ids:['c'],title:'Second change'}]},items=reviewOutline(plan,2);assert.deepEqual(items.map(item=>item.step),[1,2,3]);assert.deepEqual(items.map(item=>item.number),[1,2,3]);assert.equal(items[1].active,true);
});
test('short outline descriptions are generated with the story in one structured request',async()=>{
 const original=global.fetch,key=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='test';const requests=[];
 global.fetch=async(_url,options)=>{requests.push(JSON.parse(options.body));return Response.json({id:'test',object:'response',status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify({chapters:[{ids:['a'],title:'Preserve the destination selected before Google login',shortTitle:'Keep the saved sign-in destination',summary:'Preserve the selected destination.'}]})}]}]})};
 try{const result=await planStory({steps:[],files:[]},[{id:'a',path:'a.rb',from:0,insert:'save_destination\n',deleted:'old_destination\n'}]);assert.equal(requests.length,1);assert.equal(result[0].shortTitle,'Keep the saved sign-in destination');const schema=requests[0].text.format.schema.properties.chapters.items;assert.ok(schema.required.includes('shortTitle'));assert.match(requests[0].instructions,/at most 10 words/)}finally{global.fetch=original;if(key===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=key}
});
