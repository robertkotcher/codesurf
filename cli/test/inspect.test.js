import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inspectToken} from '../src/inspect.js';
const context={roots:['/tmp'],question:'Show the failure path instead',selection:{scenario:'Successful login'},history:[]};
test('new-flow intent returns a standalone scenario without exposing routing JSON',async()=>{
 const events=[];
 const result=await inspectToken(context,{onEvent:e=>events.push(e),answer:async({prompt,onEvent})=>{
  assert.match(prompt,/Successful login/);assert.match(prompt,/Show the failure path/);
  const text='{"action":"trace","question":"Trace login when the password is incorrect."}';
  onEvent({type:'delta',text});return {answer:text};
 }});
 assert.equal(result.traceQuestion,'Trace login when the password is incorrect.');
 assert.equal(events.length,0);
});
test('normal answers stream after a fragmented routing prefix',async()=>{
 const events=[];
 const result=await inspectToken(context,{onEvent:e=>events.push(e),answer:async({onEvent})=>{
  for(const text of ['{"action":','"answer"}\nThis ','returns a token.'])onEvent({type:'delta',text});
  return {answer:'{"action":"answer"}\nThis returns a token.'};
 }});
 assert.equal(result.answer,'This returns a token.');
 assert.equal(events.map(e=>e.text).join(''),'This returns a token.');
});
test('invalid flow actions fail without executing a request',async()=>{
 await assert.rejects(inspectToken(context,{answer:async()=>({answer:'{"action":"trace","question":42}'})}),/invalid flow request/);
});
