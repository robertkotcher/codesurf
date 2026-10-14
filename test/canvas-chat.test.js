import test from 'node:test';
import assert from 'node:assert/strict';
import {readChatStream} from '../public/chat-stream.js';
import {formatChatMessage} from '../public/canvas-chat.js';
import {answer} from '../answers.js';
import {EventEmitter} from 'node:events';

test('chat stream reconstructs split Unicode and multiline SSE frames',async()=>{
 const text='event: delta\r\ndata: {"text":"Hello café 👋"}\r\n\r\nevent: done\r\ndata: {}\r\n\r\n',bytes=new TextEncoder().encode(text),events=[];
 const response=new Response(new ReadableStream({start(controller){for(let i=0;i<bytes.length;i+=3)controller.enqueue(bytes.slice(i,i+3));controller.close()}}));await readChatStream(response,(name,body)=>events.push({name,body}));assert.deepEqual(events,[{name:'delta',body:{text:'Hello café 👋'}},{name:'done',body:{}}]);
});
test('chat stream reports HTTP errors, upstream errors, malformed data and early EOF',async()=>{
 await assert.rejects(()=>readChatStream(Response.json({error:'Expired session'},{status:401}),()=>{}),/Expired session/);
 for(const [text,match]of [['event: error\ndata: {"message":"Lookup failed"}\n\n',/Lookup failed/],['event: delta\ndata: bad json\n\n',/could not be read/],['event: delta\ndata: {"text":"Partial"}\n\n',/ended early/]])await assert.rejects(()=>readChatStream(new Response(text),()=>{}),match);
});
test('chat formatting never executes model HTML',()=>{
 const text=formatChatMessage('**Title** `run()` <img src=x onerror=alert(1)>\n```js\n<script>unsafe()</script>\n```');assert.match(text,/<strong>Title<\/strong>/);assert.match(text,/<code>run\(\)<\/code>/);assert(!text.includes('<img'));assert(!text.includes('<script>'));assert(text.includes('&lt;script&gt;'));
});
test('canvas AI retrieves caller source as evidence and keeps all output in its chat',async()=>{
 const original=globalThis.fetch,key=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='test';const calls=[];
 globalThis.fetch=async(_url,options)=>{const body=JSON.parse(options.body);calls.push(body);const output=calls.length===1?[{type:'function_call',name:'explore_calls',arguments:JSON.stringify({path:'a.ts',line:1,direction:'callers'}),call_id:'source',id:'source'}]:[];return new Response('data: '+JSON.stringify({type:'response.completed',response:{id:'response',object:'response',status:'completed',output}})+'\n\n',{headers:{'Content-Type':'text/event-stream'}})};
 try{const res=new EventEmitter();res.setHeader=()=>{};res.flushHeaders=()=>{};res.end=()=>{};let output='';res.write=value=>output+=value;await answer({req:{},res,p:{pr:{html_url:'https://github.com/acme/test/pull/1',head:{sha:'head'},title:'Update helper'}},changed:[],question:'Who calls this?',selection:{path:'a.ts',start:1,end:1},history:[{role:'user',content:'Earlier question in this window'}],token:'test',sourceIndex:{files:new Map([['a.ts','function helper() {}\nfunction caller() { helper(); }']]),skipped:0},snapshot:'Review step 1',reviewContext:{selection:{path:'a.ts',start:1}},surface:'canvas'});assert.match(output,/event: done/);assert(!output.includes('event: peeks'));assert(!output.includes('event: flow'));assert(!calls[0].tools.some(tool=>['navigate_review','show_code_flow','complete_review','draft_review'].includes(tool.name)));assert.match(calls[0].instructions,/anchored/);assert(calls[1].input.some(item=>item.type==='function_call_output'&&item.output.includes('function caller()')));assert(calls[0].input.some(item=>item.content==='Earlier question in this window'))}finally{globalThis.fetch=original;if(key===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=key}
});
