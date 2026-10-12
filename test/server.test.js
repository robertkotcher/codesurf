import test from 'node:test';
import assert from 'node:assert/strict';
import {seal,unseal} from '../lib.js';
process.env.NODE_ENV='test';
process.env.SESSION_SECRET='test-secret-'.repeat(6);
process.env.APP_URL='http://localhost:5179';
process.env.GITHUB_CLIENT_ID='test-client';
process.env.GITHUB_CLIENT_SECRET='test-secret';
const {default:app}=await import('../server.js');
const server=app.listen(0,'127.0.0.1');
await new Promise(resolve=>server.once('listening',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const request=global.fetch;
const session=seal({token:'test-user-token',tokenExp:Date.now()+3600000,exp:Date.now()+3600000,user:{login:'tester'}},process.env.SESSION_SECRET);
const auth={Cookie:'codesurf_session='+session};
test.after(()=>server.close());
test('repository and question routes reject unauthenticated requests',async()=>{
  for(const p of ['/api/pr?url=https://github.com/a/b/pull/1','/api/file?url=x&path=a','/api/prs','/api/search?q=retry&url=https://github.com/a/b/pull/1'])assert.equal((await request(origin+p)).status,401);
  for(const route of ['/api/reviews','/api/reviews/00000000-0000-0000-0000-000000000000/next','/api/reviews/00000000-0000-0000-0000-000000000000/progress'])assert.equal((await request(origin+route,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);
  assert.equal((await request(origin+'/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);
  assert.equal((await request(origin+'/api/ask',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);
});
test('OAuth callback rejects missing or forged state',async()=>{
  assert.equal((await request(origin+'/auth/github/callback?code=fake&state=fake')).status,400);
});
test('OAuth begins with PKCE and an encrypted HTTP-only state cookie',async()=>{
  const r=await request(origin+'/auth/github',{redirect:'manual'});
  assert.equal(r.status,302);
  const u=new URL(r.headers.get('location'));
  assert.equal(u.hostname,'github.com');
  assert.equal(u.searchParams.get('code_challenge_method'),'S256');
  assert.equal(u.searchParams.get('code_challenge').length,43);
  assert(r.headers.get('set-cookie').includes('HttpOnly'));
  assert(r.headers.get('set-cookie').includes('SameSite=Lax'));
});
test('cross-origin AI requests are refused before repository reads',async()=>{
  const r=await request(origin+'/api/ask',{method:'POST',headers:{...auth,Origin:'https://evil.example','Content-Type':'application/json'},body:'{}'});
  assert.equal(r.status,403);
});
test('source requests use immutable head commit and the user token',async()=>{
  const calls=[];
  global.fetch=async(url,options)=>{
    calls.push({url,token:options.headers.Authorization});
    if(url.includes('/pulls/'))return Response.json({head:{sha:'immutable-head',repo:{full_name:'fork/project'}},base:{sha:'base-sha',repo:{full_name:'acme/project'}}});
    return Response.json({type:'file',encoding:'base64',size:14,content:Buffer.from('const x = 1;').toString('base64')});
  };
  try{
    const r=await request(origin+'/api/file?'+new URLSearchParams({url:'https://github.com/acme/project/pull/4',path:'src/a.ts'}),{headers:auth});
    assert.equal(r.status,200);
    assert.equal((await r.json()).text,'const x = 1;');
    assert(calls[1].url.endsWith('/repos/fork/project/contents/src/a.ts?ref=immutable-head'));
    assert(calls.every(c=>c.token==='Bearer test-user-token'));
  }finally{global.fetch=request;}
});

test('OAuth uses only configured origins and binds callback to its original host',async()=>{
  process.env.APP_ALTERNATE_URLS=origin;
  try{
    const r=await request(origin+'/auth/github',{redirect:'manual'});
    assert.equal(new URL(r.headers.get('location')).searchParams.get('redirect_uri'),origin+'/auth/github/callback');
    const cookie=r.headers.get('set-cookie').split(';')[0];
    const state=unseal(cookie.split('=')[1],process.env.SESSION_SECRET);
    assert.equal(state.origin,origin);
    process.env.APP_ALTERNATE_URLS='';
    const rejected=await request(origin+'/auth/github/callback?code=fake&state='+state.state,{headers:{Cookie:cookie},redirect:'manual'});
    assert.equal(rejected.status,400);
    const fallback=await request(origin+'/auth/github',{redirect:'manual'});
    assert.equal(new URL(fallback.headers.get('location')).searchParams.get('redirect_uri'),process.env.APP_URL+'/auth/github/callback');
  }finally{delete process.env.APP_ALTERNATE_URLS;}
});
test('posting reviews pins the commit and sends only validated diff comments',async()=>{
 const calls=[];global.fetch=async(url,options)=>{calls.push({url,options});if(options.method==='POST')return Response.json({id:42,html_url:'https://github.com/acme/project/pull/4#review-42'});if(url.includes('/files'))return Response.json([{filename:'src/a.ts',patch:'@@ -1 +1 @@\n-old\n+new'}]);return Response.json({head:{sha:'head'}})};
 try{
  const body={url:'https://github.com/acme/project/pull/4',head:'head',body:'Looks good',event:'COMMENT',comments:[{path:'src/a.ts',line:1,body:'Check retries',side:'RIGHT'}]};
  const r=await request(origin+'/api/review',{method:'POST',headers:{...auth,Origin:process.env.APP_URL,'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(r.status,200);assert.equal((await r.json()).id,42);
  const post=calls.find(c=>c.options.method==='POST');assert.equal(JSON.parse(post.options.body).commit_id,'head');assert.equal(post.options.headers.Authorization,'Bearer test-user-token');
  calls.length=0;body.head='old';assert.equal((await request(origin+'/api/review',{method:'POST',headers:{...auth,Origin:process.env.APP_URL,'Content-Type':'application/json'},body:JSON.stringify(body)})).status,409);assert(!calls.some(c=>c.options.method==='POST'));
 }finally{global.fetch=request}
});

test('repository folders load lazily at the pinned head using the user token',async()=>{
  const head='a'.repeat(40),folder='b'.repeat(40),calls=[];
  global.fetch=async(url,options)=>{calls.push({url,token:options.headers.Authorization});if(url.includes('/pulls/'))return Response.json({head:{sha:head,repo:{full_name:'fork/project'}}});return Response.json({tree:[{path:'src',type:'tree',sha:folder},{path:'readme.md',type:'blob',sha:head},{path:'submodule',type:'commit',sha:head}]})};
  try{
    const query=new URLSearchParams({url:'https://github.com/acme/project/pull/4',head,tree:folder});
    const r=await request(origin+'/api/tree?'+query,{headers:auth});assert.equal(r.status,200);assert.equal((await r.json()).entries.length,2);
    assert(calls[1].url.endsWith('/repos/fork/project/git/trees/'+folder));assert(calls.every(c=>c.token==='Bearer test-user-token'));
    query.set('head','c'.repeat(40));assert.equal((await request(origin+'/api/tree?'+query,{headers:auth})).status,409);
  }finally{global.fetch=request}
});

test('review analysis reconstructs from the PR merge-base rather than the moving base branch',async()=>{
  const head='a'.repeat(40),base='b'.repeat(40),merge='c'.repeat(40),calls=[];process.env.APP_ALTERNATE_URLS=origin;
  global.fetch=async(url,options)=>{calls.push(url);if(url.includes('/pulls/4/files'))return Response.json([{filename:'src/a.ts',status:'modified',additions:1,deletions:1}]);if(url.includes('/pulls/4'))return Response.json({changed_files:1,head:{sha:head,repo:{full_name:'fork/project'}},base:{sha:base,repo:{full_name:'acme/project'}}});if(url.includes('/compare/'))return Response.json({merge_base_commit:{sha:merge}});if(url.includes('/contents/'))return Response.json({type:'file',encoding:'base64',size:4,content:Buffer.from(url.includes(merge)?'old\n':'new\n').toString('base64')});throw new Error('Unexpected URL')};
  try{const response=await request(origin+'/api/analyze',{method:'POST',headers:{...auth,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({url:'https://github.com/acme/project/pull/4',head})});assert.equal(response.status,200);const plan=await response.json();assert.equal(plan.base,merge);assert.equal(plan.verified,true);assert.equal(plan.files[0].before,'old\n');assert.equal(plan.files[0].after,'new\n');assert(calls.some(url=>url.includes('/repos/acme/project/contents/src/a.ts?ref='+merge)))}finally{global.fetch=request;process.env.APP_ALTERNATE_URLS=''}
});

test('all PRs includes authored and unassigned changes from connected repositories',async()=>{
  const previous=global.fetch;
  global.fetch=async(url)=>{
    const path=new URL(url).pathname;
    if(path==='/user/installations')return Response.json({installations:[{id:7}]});
    if(path==='/user/installations/7/repositories')return Response.json({repositories:[{full_name:'tester/demo'}]});
    if(path==='/repos/tester/demo/pulls')return Response.json([{title:'Own change',html_url:'https://github.com/tester/demo/pull/2',number:2,updated_at:'2026-10-11T10:00:00Z',user:{login:'tester'}}]);
    throw new Error('Unexpected GitHub request '+path);
  };
  try{const response=await request(origin+'/api/prs?relation=all',{headers:auth});assert.equal(response.status,200);const body=await response.json();assert.equal(body.repositories,1);assert.equal(body.items[0].number,2);assert.equal(body.items[0].author,'tester')}finally{global.fetch=previous}
});

test('direct PR URLs serve the app with absolute asset paths',async()=>{
  const response=await request(origin+'/github/tester/demo/pull/2');
  assert.equal(response.status,200);const html=await response.text();assert(html.includes('src="/app.js"'));assert(html.includes('id="prHome"'));assert(html.includes('class="modal-backdrop hidden" id="signin"'));
});
test('legacy PR links redirect into the GitHub namespace',async()=>{
 const response=await request(origin+'/tester/demo/pull/2?view=code',{redirect:'manual'});
 assert.equal(response.status,308);assert.equal(response.headers.get('location'),'/github/tester/demo/pull/2?view=code');
 assert.equal((await request(origin+'/github/tester/demo/pull/0')).status,404);
});
test('base call index uses the merge-base snapshot while keeping head access pinned',async()=>{
 const {default:tar}=await import('tar-stream');const {gzipSync}=await import('node:zlib');
 const pack=tar.pack();pack.entry({name:'snapshot/route.ts'},'function entropy(s: string) { return s.length; }\nfunction isValid(s: string) { return entropy(s); }');pack.finalize();const chunks=[];for await(const chunk of pack)chunks.push(chunk);const archive=gzipSync(Buffer.concat(chunks));
 const head='a'.repeat(40),base='b'.repeat(40),merge='c'.repeat(40),calls=[];
 global.fetch=async url=>{calls.push(String(url));if(String(url).includes('/pulls/22'))return Response.json({head:{sha:head,repo:{full_name:'acme/entropy'}},base:{sha:base,repo:{full_name:'acme/entropy'}}});if(String(url).includes('/compare/'))return Response.json({merge_base_commit:{sha:merge}});if(String(url).includes('/tarball/'))return new Response(archive);throw new Error('Unexpected request '+url);};
 try{const response=await request(origin+'/api/call-index?'+new URLSearchParams({url:'https://github.com/acme/entropy/pull/22',head,snapshot:'base',symbol:'entropy'}),{headers:auth});assert.equal(response.status,200);const graph=await response.json();assert.equal(graph.sha,merge);assert.equal(graph.head,head);assert(graph.calls.some(e=>e.symbol==='entropy'));assert(graph.blocks.every(b=>!Object.hasOwn(b,'text')));assert(calls.some(url=>url.endsWith('/tarball/'+merge)));assert(!calls.some(url=>url.endsWith('/tarball/'+head)));}finally{global.fetch=request;}
});

test('repository settings list installation access using the signed-in user',async()=>{
 const calls=[];
 global.fetch=async(url,options)=>{calls.push({url,options});return Response.json(url.includes('/repositories?')?{repositories:[{full_name:'acme/project',private:true}]}:{installations:[{id:123,account:{login:'acme'}}]})};
 try{
  assert.equal((await request(origin+'/api/repositories')).status,401);
  const r=await request(origin+'/api/repositories',{headers:auth});assert.equal(r.status,200);
  assert.deepEqual(await r.json(),{items:[{account:'acme',manageUrl:'https://github.com/settings/installations/123',repositories:[{name:'acme/project',private:true}]}]});
  assert(calls.every(c=>c.options.headers.Authorization==='Bearer test-user-token'));
 }finally{global.fetch=request}
});

test('assigned PR inbox filters recent updates, paginates older PRs, and ignores unassigned authorship',async()=>{
 const calls=[],since='2026-09-28T12:00:00Z';
 const make=(number,updated,assigned=true)=>({title:'Change '+number,html_url:`https://github.com/tester/demo/pull/${number}`,number,updated_at:updated,user:{login:'tester'},assignees:assigned?[{login:'Tester'}]:[]});
 global.fetch=async(url,options)=>{
  calls.push({url,options});const u=new URL(url);
  if(u.pathname==='/user/installations')return Response.json({installations:[{id:7}]});
  if(u.pathname==='/user/installations/7/repositories')return Response.json({repositories:[{full_name:'tester/demo'}]});
  if(u.pathname==='/repos/tester/demo/pulls'){
   const page=Number(u.searchParams.get('page'));
   if(page===1)return Response.json(Array.from({length:100},(_,i)=>make(i+1,'2026-10-12T12:00:00Z',i===0)));
   if(page===2)return Response.json(Array.from({length:100},(_,i)=>make(i+101,i===0?since:'2026-09-20T12:00:00Z',i<2)));
   if(page===3)return Response.json([make(201,'2026-09-01T12:00:00Z')]);
  }throw new Error('Unexpected GitHub request');
 };
 try{
  const recent=await request(origin+'/api/prs?'+new URLSearchParams({relation:'assigned',since}),{headers:auth});assert.equal(recent.status,200);assert.deepEqual((await recent.json()).items.map(p=>p.number),[1,101]);assert(!calls.some(c=>c.url.includes('page=3')));
  calls.length=0;const older=await request(origin+'/api/prs?'+new URLSearchParams({relation:'assigned',since,older:'1'}),{headers:auth});assert.equal(older.status,200);assert.deepEqual((await older.json()).items.map(p=>p.number),[102,201]);assert(calls.some(c=>c.url.includes('page=3')));assert(calls.every(c=>c.options.headers.Authorization==='Bearer test-user-token'));
  calls.length=0;assert.equal((await request(origin+'/api/prs?relation=assigned&since=invalid',{headers:auth})).status,400);assert.equal(calls.length,0);
 }finally{global.fetch=request}
});

test('note audio authenticates, validates input, and returns OpenAI MP3 audio',async()=>{
 const headers={...auth,Origin:process.env.APP_URL,'Content-Type':'application/json'};
 const post=(body,h=headers)=>request(origin+'/api/note-audio',{method:'POST',headers:h,body:JSON.stringify(body)});
 assert.equal((await post({text:'Hello'},{'Content-Type':'application/json'})).status,401);
 assert.equal((await post({text:'Hello'},{...headers,Origin:'https://evil.example'})).status,403);
 for(const text of ['', 'x'.repeat(4001),42])assert.equal((await post({text})).status,400);
 const previousKey=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='test-speech-key';let payload;
 global.fetch=async(url,options)=>{assert.equal(String(url),'https://api.openai.com/v1/audio/speech');payload=JSON.parse(options.body);return new Response('ID3test-audio',{headers:{'Content-Type':'audio/mpeg'}})};
 try{
  const response=await post({text:'This adds a refund check.'});assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/audio\/mpeg/);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(await response.text(),'ID3test-audio');
  assert.equal(payload.model,'gpt-4o-mini-tts');assert.equal(payload.voice,'marin');assert.equal(payload.input,'This adds a refund check.');assert.equal(payload.response_format,'mp3');
 }finally{global.fetch=request;if(previousKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=previousKey}
});

test('My PRs includes requested reviews and assignments once, with recent and older filters',async()=>{
 const since='2026-09-28T12:00:00Z';
 const pr=(number,updated,assignees=[],requested_reviewers=[])=>({number,title:'Change '+number,html_url:`https://github.com/solosuitinc/solosuit/pull/${number}`,updated_at:updated,assignees:assignees.map(login=>({login})),requested_reviewers:requested_reviewers.map(login=>({login})),user:{login:'other'}});
 global.fetch=async url=>{
  const path=new URL(url).pathname;
  if(path==='/user/installations')return Response.json({installations:[{id:7}]});
  if(path==='/user/installations/7/repositories')return Response.json({repositories:[{full_name:'solosuitinc/solosuit'}]});
  if(path==='/repos/solosuitinc/solosuit/pulls')return Response.json([
   pr(4326,'2026-10-07T21:17:35Z',['m-musaz'],['TeStEr']),
   pr(4327,'2026-10-06T12:00:00Z',['tester'],['tester']),
   pr(4328,'2026-10-05T12:00:00Z',['other'],['other']),
   pr(4329,'2026-09-20T12:00:00Z',[],['tester'])
  ]);
  throw new Error('Unexpected request '+url);
 };
 try{
  const load=async older=>{const response=await request(origin+'/api/prs?'+new URLSearchParams({relation:'assigned',since,...older?{older:'1'}:{}}),{headers:auth});assert.equal(response.status,200);return (await response.json()).items.map(p=>p.number)};
  assert.deepEqual(await load(false),[4326,4327]);assert.deepEqual(await load(true),[4329]);
 }finally{global.fetch=request}
});

test('OpenAI audio authentication failures do not ask users to sign into GitHub',async()=>{
 const key=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='test-key';global.fetch=async()=>Response.json({error:{message:'Missing scopes: api.model.audio.request',code:'missing_scope',type:'invalid_request_error'}},{status:401});
 try{const response=await request(origin+'/api/note-audio',{method:'POST',headers:{...auth,Origin:process.env.APP_URL,'Content-Type':'application/json'},body:JSON.stringify({text:'Read this note.'})});assert.equal(response.status,502);assert.match((await response.json()).error,/audio generation permission/)}finally{global.fetch=request;if(key===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=key}
});

test('voice requests enforce origin and pin selected source without exposing the API key',async()=>{
 const key=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='voice-test-key';const calls=[];
 global.fetch=async(url,options)=>{calls.push({url,options});if(url.includes('/pulls/'))return Response.json({html_url:'https://github.com/acme/project/pull/4',title:'New behavior',head:{sha:'head',repo:{full_name:'acme/project'}}});if(url.includes('/contents/'))return Response.json({type:'file',encoding:'base64',size:12,content:Buffer.from('const x = 1;').toString('base64')});return new Response('v=0\r\nanswer',{headers:{'Content-Type':'application/sdp'}})};
 try{
  const body={url:'https://github.com/acme/project/pull/4',head:'head',selection:{path:'src/a.ts',start:1,end:1,intermediate:false},sdp:'v=0\r\noffer'};
  const headers={...auth,Origin:process.env.APP_URL,'Content-Type':'application/json'};
  assert.equal((await request(origin+'/api/voice',{method:'POST',headers:{...headers,Origin:'https://evil.example'},body:JSON.stringify(body)})).status,403);assert.equal(calls.length,0);
  const response=await request(origin+'/api/voice',{method:'POST',headers,body:JSON.stringify(body)});assert.equal(response.status,200);assert.equal(await response.text(),'v=0\r\nanswer');
  const upstream=calls.find(c=>c.url.includes('api.openai.com'));assert.equal(upstream.options.headers.Authorization,'Bearer voice-test-key');const session=JSON.parse(upstream.options.body.get('session'));assert.match(session.instructions,/const x = 1/);assert.match(calls.find(c=>c.url.includes('/contents/')).url,/ref=head$/);
  calls.length=0;body.head='old';assert.equal((await request(origin+'/api/voice',{method:'POST',headers,body:JSON.stringify(body)})).status,409);assert(!calls.some(c=>c.url.includes('api.openai.com')));
 }finally{global.fetch=request;if(key===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=key}
});
test('voice source tools search unchanged files and validate highlighted ranges at the pinned head',async()=>{
 const {default:tar}=await import('tar-stream');const {gzipSync}=await import('node:zlib');
 const pack=tar.pack();pack.entry({name:'snapshot/app/models/stash_transaction.rb'},'class StashTransaction\n  def disputed?\n    disputes.any?\n  end\nend');pack.entry({name:'snapshot/app/services/stash_check.rb'},'def check_stash\n StashTransaction.new.disputed?\nend');pack.finalize();const chunks=[];for await(const chunk of pack)chunks.push(chunk);const archive=gzipSync(Buffer.concat(chunks));
 global.fetch=async url=>{if(String(url).includes('/pulls/79'))return Response.json({head:{sha:'voice-head',repo:{full_name:'acme/voice-tools'}}});if(String(url).includes('/tarball/voice-head'))return new Response(archive);throw new Error('Unexpected upstream request');};
 const invoke=(name,args,head='voice-head')=>request(origin+'/api/voice/tool',{method:'POST',headers:{...auth,Origin:process.env.APP_URL,'Content-Type':'application/json'},body:JSON.stringify({url:'https://github.com/acme/voice-tools/pull/79',head,name,args})});
 try{
  let response=await invoke('search_repository',{query:'StashTransaction'});assert.equal(response.status,200);assert.equal((await response.json()).results[0].path,'app/models/stash_transaction.rb');
  response=await invoke('read_code',{path:'app/models/stash_transaction.rb',start:2,end:4});const read=await response.json();assert.match(read.text,/2:   def disputed/);assert.equal(read.reference,undefined);
  response=await invoke('show_code',{path:'app/models/stash_transaction.rb',start:2,end:4});assert.deepEqual((await response.json()).reference,{path:'app/models/stash_transaction.rb',start:2,end:4});
  assert.equal((await invoke('show_code',{path:'app/models/stash_transaction.rb',start:2,end:400})).status,400);
  assert.equal((await invoke('show_code',{path:'app/models/stash_transaction.rb',start:2,end:4},'stale-head')).status,409);
  assert.equal((await invoke('unknown',{})).status,400);
  response=await invoke('explore_calls',{path:'app/models/stash_transaction.rb',line:3,direction:'body',snapshot:'head'});assert.equal(response.status,200);const body=await response.json();assert.equal(body.root.symbol,'disputed?');assert.equal(body.blocks[0].snapshot,'PR head');assert.match(body.blocks[0].text,/def disputed/);
  response=await invoke('explore_calls',{path:'app/models/stash_transaction.rb',line:3,direction:'callers',snapshot:'head'});const callers=await response.json();assert.equal(callers.blocks[0].symbol,'check_stash');assert.equal(callers.blocks[0].callLine,2);
  response=await request(origin+'/api/voice/context',{method:'POST',headers:{...auth,Origin:process.env.APP_URL,'Content-Type':'application/json'},body:JSON.stringify({url:'https://github.com/acme/voice-tools/pull/79',head:'voice-head'})});assert.equal(response.status,200);assert.equal((await response.json()).selection,null);

 }finally{global.fetch=request}
});

test('voice comments are validated drafts and both review outcomes publish all comments to GitHub',async()=>{
 const calls=[];
 global.fetch=async(url,options)=>{
  calls.push({url,options});
  if(options.method==='POST')return Response.json({id:43,html_url:'https://github.com/acme/project/pull/4#review-43'});
  if(url.includes('/files'))return Response.json([{filename:'src/a.ts',patch:'@@ -1 +1 @@\n-old\n+new'}]);
  return Response.json({head:{sha:'head'}});
 };
 const post=(path,body)=>request(origin+path,{method:'POST',headers:{...auth,Origin:process.env.APP_URL,'Content-Type':'application/json'},body:JSON.stringify(body)});
 const target={url:'https://github.com/acme/project/pull/4',head:'head'};
 try{
  let response=await post('/api/voice/tool',{...target,name:'draft_review',args:{path:'src/a.ts',start:1,end:1,body:'Please add coverage',snapshot:'head'}});
  assert.equal(response.status,200);const result=await response.json();assert.equal(result.published,false);assert.equal(result.draft.comments[0].line,1);assert(!calls.some(c=>c.options.method==='POST'));
  response=await post('/api/voice/tool',{...target,name:'draft_review',args:{path:'src/a.ts',start:99,end:99,body:'Wrong line',snapshot:'head'}});assert.equal(response.status,400);
  for(const event of ['APPROVE','REQUEST_CHANGES']){
   calls.length=0;response=await post('/api/review',{...target,...result.draft,body:'Reviewed changes',event});assert.equal(response.status,200);
   const sent=JSON.parse(calls.find(c=>c.options.method==='POST').options.body);assert.equal(sent.event,event);assert.equal(sent.commit_id,'head');assert.deepEqual(sent.comments,result.draft.comments);
  }
  calls.length=0;response=await post('/api/voice/tool',{...target,head:'stale',name:'draft_review',args:{path:null,body:'Concern'}});assert.equal(response.status,409);assert(!calls.some(c=>c.options.method==='POST'));
 }finally{global.fetch=request}
});
