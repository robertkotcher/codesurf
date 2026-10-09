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
