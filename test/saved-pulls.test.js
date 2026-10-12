import test from 'node:test';
import assert from 'node:assert/strict';
import {seal} from '../lib.js';
import {sortSavedPulls} from '../public/saved-pulls.js';
process.env.NODE_ENV='test';process.env.DATABASE_URL='postgresql://test:test@localhost/test';process.env.SESSION_SECRET='saved-pull-test-'.repeat(4);process.env.APP_URL='http://localhost:5179';
const {pool}=await import('../database.js');
const rows=new Map(),queries=[];
pool.query=async(sql,values)=>{
 queries.push({sql,values});const [owner,url,repo,number,title,author,status,draft,updated]=values,key=owner+'|'+url;
 if(sql.startsWith('SELECT'))return {rows:[...rows.values()].filter(row=>row.owner===owner)};
 if(sql.startsWith('DELETE')){rows.delete(key);return {rows:[]}}
 if(sql.startsWith('UPDATE')&&!rows.has(key))return {rows:[]};
 const row={owner,pr_url:url,repo,number,title,author,status,draft,pr_updated_at:updated,saved_at:rows.get(key)?.saved_at||new Date().toISOString(),checked_at:new Date().toISOString()};rows.set(key,row);return {rows:[row]};
};
const {default:app}=await import('../server.js'),server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const origin='http://127.0.0.1:'+server.address().port;
const request=global.fetch;
const auth=owner=>({Cookie:'codesurf_session='+seal({token:'user-token',tokenExp:Date.now()+3600000,exp:Date.now()+3600000,user:{login:owner}},process.env.SESSION_SECRET),Origin:process.env.APP_URL,'Content-Type':'application/json'});
const call=(owner,path,body)=>request(origin+path,{headers:auth(owner),...(body?{method:'POST',body:JSON.stringify(body)}:{})});
const pr={html_url:'https://github.com/Acme/Project/pull/4',base:{repo:{full_name:'Acme/Project'}},number:4,title:'Fix retries',user:{login:'author'},state:'open',draft:false,updated_at:'2026-10-12T10:00:00Z'};
test.after(async()=>{global.fetch=request;server.close();await pool.end()});
test('saves persist per user, normalize URLs, and remove without GitHub access',async()=>{
 global.fetch=async()=>Response.json(pr);
 const body={url:pr.html_url,saved:true,owner:'someone-else'};
 let response=await call('Reviewer','/api/saved-prs',body);assert.equal(response.status,200);assert.equal((await response.json()).item.status,'open');
 const savedAt=[...rows.values()][0].saved_at;
 await call('Reviewer','/api/saved-prs',{...body,url:pr.html_url.toLowerCase()+'?ignored=1'});assert.equal(rows.size,1);assert.equal([...rows.values()][0].saved_at,savedAt);
 response=await call('REVIEWER','/api/saved-prs');assert.equal((await response.json()).items.length,1);
 response=await call('Other','/api/saved-prs');assert.deepEqual((await response.json()).items,[]);
 global.fetch=async()=>{throw new Error('Should not contact GitHub to remove a save')};
 await call('Other','/api/saved-prs',{...body,saved:false});assert.equal(rows.size,1);
 await call('Reviewer','/api/saved-prs',{...body,saved:false});assert.equal(rows.size,0);
 assert(queries.every(q=>q.values[0]===q.values[0].toLowerCase()));
});
test('refresh stores merged status, preserves unavailable saves, and cannot recreate removed saves',async()=>{
 global.fetch=async()=>Response.json(pr);await call('Reviewer','/api/saved-prs',{url:pr.html_url,saved:true});
 let reads=0;global.fetch=async()=>{reads++;return Response.json({...pr,state:'closed',merged_at:'2026-10-12T11:00:00Z'})};
 let response=await call('Other','/api/saved-prs/refresh',{urls:[pr.html_url]});assert.equal((await response.json()).items.length,0);assert.equal(reads,0);
 response=await call('Reviewer','/api/saved-prs/refresh',{urls:[pr.html_url]});assert.equal((await response.json()).items[0].status,'merged');assert.equal([...rows.values()][0].status,'merged');
 global.fetch=async()=>new Response('',{status:404});response=await call('Reviewer','/api/saved-prs/refresh',{urls:[pr.html_url]});const item=(await response.json()).items[0];assert.equal(item.status,'merged');assert.equal(item.statusUnavailable,true);assert.equal(rows.size,1);
 const {refreshSavedPull}=await import('../saved-pulls.js');rows.clear();assert.equal(await refreshSavedPull('Reviewer',pr.html_url,pr),null);assert.equal(rows.size,0);
});
test('saving enforces authentication, origin, input validation and bounded refreshes',async()=>{
 assert.equal((await request(origin+'/api/saved-prs')).status,401);
 assert.equal((await request(origin+'/api/saved-prs',{method:'POST',headers:{...auth('Reviewer'),Origin:'https://evil.example'},body:'{}'})).status,403);
 for(const body of [{url:pr.html_url,saved:'yes'},{url:'https://evil.example/a/b/pull/4',saved:true},{url:'https://github.com/a/b/pull/0',saved:true}])assert.equal((await call('Reviewer','/api/saved-prs',body)).status,400);
 assert.equal((await call('Reviewer','/api/saved-prs/refresh',{urls:Array(21).fill(pr.html_url)})).status,400);
});
test('saved list puts open then closed PRs before merged, sorts recency, and filters',()=>{
 const items=[{url:'merged',status:'merged',updated:'2026-10-12',repo:'acme/project',title:'Merged work',number:1},{url:'older',status:'open',updated:'2026-10-10',repo:'acme/project',title:'Older work',number:2},{url:'closed',status:'closed',updated:'2026-10-12',repo:'acme/project',title:'Abandoned work',number:3},{url:'newest',status:'open',updated:'2026-10-12',repo:'acme/other',title:'Review next',number:4}];
 assert.deepEqual(sortSavedPulls(items).map(x=>x.url),['newest','older','closed','merged']);assert.deepEqual(sortSavedPulls(items,'review next').map(x=>x.url),['newest']);assert.equal(items[0].url,'merged');
});
