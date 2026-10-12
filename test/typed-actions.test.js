import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {answer} from '../answers.js';
test('typed AI can request navigation and show parser-resolved callers with review context',async()=>{
 const fetch=globalThis.fetch,key=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='test';
 let desired={name:'navigate_review',args:{direction:'next'}},requests=[];
 globalThis.fetch=async(url,options)=>{
  requests.push(JSON.parse(options.body));const output=requests.length===1?[{type:'function_call',name:desired.name,arguments:JSON.stringify(desired.args),call_id:'tool',id:'tool'}]:[];
  return new Response('data: '+JSON.stringify({type:'response.completed',response:{id:'response',object:'response',status:'completed',output}})+'\n\n',{headers:{'Content-Type':'text/event-stream'}});
 };
 const invoke=async()=>{
  requests=[];const res=new EventEmitter();res.setHeader=()=>{};res.flushHeaders=()=>{};let output='';res.write=text=>output+=text;res.end=()=>{};
  await answer({req:{},res,p:{pr:{html_url:'https://github.com/acme/test/pull/1',head:{sha:'a'},title:'Change helper'}},changed:[],question:'Please continue to the next change.',selection:{path:'a.ts',start:1,end:1},history:[],token:'test',sourceIndex:{files:new Map([['a.ts','function helper() {}\nfunction caller() { helper(); }']]),skipped:[]},snapshot:'Review step 1',reviewContext:{review:{step:1,canNext:true}}});return output;
 };
 try{
  let output=await invoke();assert.match(output,/event: navigation\ndata: {"direction":"next"}/);assert.equal(requests.length,1);assert(requests[0].tools.some(t=>t.name==='navigate_review'));assert.match(requests[0].input[0].content,/Review step 1/);
  desired={name:'explore_calls',args:{path:'a.ts',line:1,direction:'callers'}};output=await invoke();assert.match(output,/event: peeks/);assert.match(output,/"symbol":"caller"/);assert.match(output,/"snapshot":"Review step 1"/);assert.equal(requests.length,2);
  desired={name:'show_code',args:{path:'a.ts',start:2,end:2}};output=await invoke();assert.match(output,/"direction":"body"/);assert.match(output,/function caller/);
 desired={name:'complete_review',args:{event:'APPROVE'}};output=await invoke();assert.match(output,/event: review\ndata: {"event":"APPROVE"}/);
  desired={name:'draft_review',args:{path:null,start:null,end:null,body:'Please add a test',snapshot:null}};output=await invoke();assert.match(output,/event: draft/);assert.match(output,/Please add a test/);
 }finally{globalThis.fetch=fetch;if(key===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=key}
});
