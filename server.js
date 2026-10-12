import {savedURL,listSavedPulls,savePull,refreshSavedPull,removeSavedPull} from './saved-pulls.js';
import {futureCallers} from './browser/future-callers.js';
import {functionPeeks} from './browser/function-peeks.js';
import {voiceSelection,voiceSession,voiceReviewContext} from './realtime-voice.js';
import {stateAt,manifestAt} from './public/transformations.js';
import {openAIErrorMessage,reportOpenAIError} from './openai-errors.js';
import {findReview,createReview,getReview,publicReview,nextStep,advanceReview,reviewPace,setReviewPace,stepBudget,ensureStepBlocks} from './review-sessions.js';
import {buildCallIndex,indexedCalls,initCallParsers,overlayCallIndex} from './browser/source-index.js';
import {functionData} from './public/data-shapes.js';
import {demoFiles} from './demo-plan.js';
import {transformationPlan} from './transformations.js';
import express from 'express';
import {saveGitHubProfile,pool} from './database.js';
import crypto from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import OpenAI from 'openai';
import {repositoryIndex,searchIndex,readBlock} from './repository.js';
import {validateReview,draftReview} from './reviews.js';
import {answer} from './answers.js';
import {seal,unseal,parsePR,cleanPath,encodePath} from './lib.js';
const app=express(),root=path.dirname(fileURLToPath(import.meta.url));
const env=process.env;
const base=req=>{const primary=env.APP_URL||'http://localhost:5179';const allowed=[primary,...(env.APP_ALTERNATE_URLS||'').split(',').filter(Boolean)];return allowed.find(url=>new URL(url).host===req?.get('host'))||primary};
app.disable('x-powered-by');app.set('trust proxy',1);app.use(express.json({limit:'200kb'}));
app.use((req,res,next)=>{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' https://avatars.githubusercontent.com data:; connect-src 'self'; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://github.com");if(req.path.startsWith('/api/')||req.path.startsWith('/auth/'))res.setHeader('Cache-Control','no-store');next()});
const cookies=req=>Object.fromEntries((req.headers.cookie||'').split(';').map(s=>s.trim().split('=')).filter(x=>x.length===2));
const opts={httpOnly:true,secure:base().startsWith('https:'),sameSite:'lax',path:'/'};
const session=req=>unseal(cookies(req).codesurf_session,env.SESSION_SECRET);
function setSession(res,s){res.cookie('codesurf_session',seal(s,env.SESSION_SECRET),{...opts,maxAge:7*864e5})}
const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
app.get('/api/status',(_req,res)=>res.json({github:!!(env.GITHUB_CLIENT_ID&&env.GITHUB_CLIENT_SECRET&&env.SESSION_SECRET),openai:!!env.OPENAI_API_KEY,reviewSessions:!!pool,installUrl:env.GITHUB_APP_SLUG?`https://github.com/apps/${env.GITHUB_APP_SLUG}/installations/new`:null}));
app.get('/auth/github',wrap(async(req,res)=>{if(!env.GITHUB_CLIENT_ID||!env.GITHUB_CLIENT_SECRET||!env.SESSION_SECRET)return res.status(503).send('GitHub App setup is not complete yet.');const state=crypto.randomBytes(32).toString('base64url'),verifier=crypto.randomBytes(48).toString('base64url');res.cookie('codesurf_oauth',seal({state,verifier,origin:base(req),exp:Date.now()+600000},env.SESSION_SECRET),{...opts,maxAge:600000});const p=new URLSearchParams({client_id:env.GITHUB_CLIENT_ID,redirect_uri:base(req)+'/auth/github/callback',state,code_challenge:crypto.createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'});res.redirect('https://github.com/login/oauth/authorize?'+p)}));
app.get('/auth/github/callback',wrap(async(req,res)=>{const saved=unseal(cookies(req).codesurf_oauth,env.SESSION_SECRET);res.clearCookie('codesurf_oauth',opts);if(!saved||saved.origin!==base(req)||typeof req.query.state!=='string'||saved.state!==req.query.state||typeof req.query.code!=='string')return res.status(400).send('Sign-in expired or could not be verified. Return to CodeSurf and sign in again.');const r=await fetch('https://github.com/login/oauth/access_token',{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify({client_id:env.GITHUB_CLIENT_ID,client_secret:env.GITHUB_CLIENT_SECRET,code:req.query.code,redirect_uri:base(req)+'/auth/github/callback',code_verifier:saved.verifier})});const t=await r.json();if(!t.access_token)throw new Error('GitHub did not authorize sign-in. Try again.');const user=await github(t.access_token,'/user');const allow=(env.ALLOWED_GITHUB_USERS||'').split(',').map(x=>x.trim()).filter(Boolean);if(allow.length&&!allow.includes(user.login))return res.status(403).send('CodeSurf is currently in a private beta.');await saveGitHubProfile(user);setSession(res,{token:t.access_token,refresh:t.refresh_token,tokenExp:Date.now()+(t.expires_in||28800)*1000,exp:Date.now()+7*864e5,user:{login:user.login,name:user.name,avatar:user.avatar_url}});res.redirect('/')}));
app.post('/auth/logout',(req,res)=>{if(req.headers.origin!==base(req))return res.sendStatus(403);res.clearCookie('codesurf_session',opts);res.json({ok:true})});
async function github(token,url){const r=await fetch('https://api.github.com'+url,{headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},signal:AbortSignal.timeout(20000)});if(!r.ok){const e=new Error(r.status===401?'GitHub session expired. Sign in again.':r.status===404?'PR or file unavailable. Check the app’s repository access.':r.status===403?'GitHub access denied or API limit reached.':'GitHub request failed ('+r.status+')');e.status=r.status===401?401:r.status===404?404:502;throw e}return r.json()}
app.get('/api/demo-plan',wrap(async(req,res)=>{
  if(process.env.VERCEL||process.env.NODE_ENV==='production'||!['localhost','127.0.0.1'].includes(req.hostname))return res.sendStatus(404);
  const plan=await transformationPlan(demoFiles,{base:'c91b802000000000000000000000000000000000',head:'a81fc9e000000000000000000000000000000000',explain:false});
  for(const step of plan.steps){const op=plan.operations.find(o=>step.ids.includes(o.id));const code=op.insert;
    const description=op.path.includes('test')?['Check retry behavior','Assert that a failed delivery schedules another attempt.']:code.includes('import { recordAttempt')?['Connect attempt tracking','Import the recorder used to save delivery outcomes.']:code.includes('recordAttempt(event.id')?['Record the result and check the limit','Save the response status, then increment the attempt counter. Once the limit is reached, enter the failure branch.']:code.includes('queue.enqueue')?['Stop or schedule another attempt','At the limit, mark the delivery as failed and return. Otherwise queue another attempt after the calculated delay.']:op.path.includes('retry-policy')?['Define retry delays','Limit retries to five attempts. Calculate a delay that doubles with each attempt.']:op.path.includes('types')?['Track the attempt number','Store the attempt number on the webhook event.']:['Check retry behavior','Assert that a failed delivery schedules another attempt.'];
    [step.title,step.summary]=description;for(const note of step.notes)note.text=step.summary;
  }
  const pace=reviewPace(req.query.pace);if(pace!=='guided'){
    const original=plan.steps;plan.pace=pace;plan.steps=[];const budget=stepBudget(plan);let batch=[];
    const flush=()=>{if(!batch.length)return;plan.steps.push({ids:batch.flatMap(step=>step.ids),title:batch.map(step=>step.title).join(' · ').slice(0,100),summary:[...new Set(batch.map(step=>step.summary))].join(' ').slice(0,600),notes:[]});batch=[]};
    for(const step of original){batch.push(step);if(batch.flatMap(s=>s.ids).length>=budget.target)flush()}flush();
  }
  res.json(plan);
}));
app.use('/api',wrap(async(req,res,next)=>{if(req.path==='/status')return next();let s=session(req);if(!s)return res.status(401).json({error:'Sign in with GitHub'});if(req.method==='POST'&&req.headers.origin!==base(req))return res.sendStatus(403);if(s.tokenExp<Date.now()+60000&&s.refresh){const r=await fetch('https://github.com/login/oauth/access_token',{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify({client_id:env.GITHUB_CLIENT_ID,client_secret:env.GITHUB_CLIENT_SECRET,grant_type:'refresh_token',refresh_token:s.refresh})});const t=await r.json();if(!t.access_token)return res.status(401).json({error:'GitHub session expired. Sign in again.'});s={...s,token:t.access_token,refresh:t.refresh_token,tokenExp:Date.now()+t.expires_in*1000};setSession(res,s)}req.auth=s;next()}));
app.get('/api/me',wrap(async(req,res)=>{const s=session(req);if(!s)return res.status(401).json({error:'Sign in with GitHub'});await github(s.token,'/user');res.json(s.user)}));
app.get('/api/repositories',wrap(async(req,res)=>{
  const installations=[];
  for(let page=1;;page++){const batch=await github(req.auth.token,`/user/installations?per_page=100&page=${page}`);installations.push(...batch.installations);if(batch.installations.length<100)break}
  const items=[];
  for(const installation of installations){
    const repositories=[];
    for(let page=1;;page++){const batch=await github(req.auth.token,`/user/installations/${installation.id}/repositories?per_page=100&page=${page}`);repositories.push(...batch.repositories.map(repo=>({name:repo.full_name,private:repo.private})));if(batch.repositories.length<100)break}
    items.push({account:installation.account.login,manageUrl:`https://github.com/settings/installations/${installation.id}`,repositories});
  }
  res.json({items});
}));
app.get('/api/saved-prs',wrap(async(req,res)=>res.json({items:await listSavedPulls(req.auth.user.login)})));
app.post('/api/saved-prs',wrap(async(req,res)=>{
 if(typeof req.body.saved!=='boolean')return res.status(400).json({error:'Choose save or remove.'});
 const url=savedURL(req.body.url),owner=req.auth.user.login;
 if(!req.body.saved){await removeSavedPull(owner,url);return res.json({saved:false,url})}
 const p=await pull(req.auth.token,url);
 res.json({saved:true,item:await savePull(owner,p.pr)});
}));
app.post('/api/saved-prs/refresh',wrap(async(req,res)=>{
 if(!Array.isArray(req.body.urls)||req.body.urls.length>20)return res.status(400).json({error:'Refresh up to 20 saved pull requests at a time.'});
 const urls=new Set(req.body.urls.map(savedURL)),owner=req.auth.user.login;
 const saved=(await listSavedPulls(owner)).filter(item=>urls.has(item.url)),items=[];
 for(let i=0;i<saved.length;i+=5)await Promise.all(saved.slice(i,i+5).map(async item=>{
  let pr;
  try{pr=(await pull(req.auth.token,item.url)).pr}catch{items.push({...item,statusUnavailable:true});return}
  const updated=await refreshSavedPull(owner,item.url,pr);if(updated)items.push(updated);
 }));
 res.json({items});
}));
app.get('/api/prs',wrap(async(req,res)=>{
  if(req.query.relation==='all'||req.query.relation==='assigned'){
    const assigned=req.query.relation==='assigned',older=req.query.older==='1';
    const cutoff=Date.parse(req.query.since||new Date(Date.now()-14*864e5).toISOString());
    if(assigned&&!Number.isFinite(cutoff))return res.status(400).json({error:'Invalid date filter.'});
    const items=[];let installations=[];
    for(let page=1;;page++){const batch=await github(req.auth.token,`/user/installations?per_page=100&page=${page}`);installations.push(...batch.installations);if(batch.installations.length<100)break}
    const repos=new Map();
    for(const installation of installations){for(let page=1;;page++){const batch=await github(req.auth.token,`/user/installations/${installation.id}/repositories?per_page=100&page=${page}`);for(const repo of batch.repositories)repos.set(repo.full_name,repo);if(batch.repositories.length<100)break}}
    const names=[...repos.keys()];
    for(let offset=0;offset<names.length;offset+=5){await Promise.all(names.slice(offset,offset+5).map(async repo=>{for(let page=1;;page++){const batch=await github(req.auth.token,`/repos/${repo}/pulls?state=open&sort=updated&direction=desc&per_page=100&page=${page}`);for(const pr of batch){if(assigned&&(![...(pr.assignees||[]),...(pr.requested_reviewers||[])].some(person=>person.login.toLowerCase()===req.auth.user.login.toLowerCase())||(older?Date.parse(pr.updated_at)>=cutoff:Date.parse(pr.updated_at)<cutoff)))continue;items.push({title:pr.title,url:pr.html_url,number:pr.number,repo,updated:pr.updated_at,author:pr.user?.login})}if(batch.length<100||(assigned&&!older&&batch.some(pr=>Date.parse(pr.updated_at)<cutoff)))break}}))}
    items.sort((a,b)=>String(b.updated).localeCompare(String(a.updated)));
    return res.json({items,total:items.length,repositories:repos.size});
  }
  const relation=req.query.relation==='assigned'?'assignee':'review-requested';const q=encodeURIComponent(`is:pr is:open ${relation}:${req.auth.user.login}`);const result=await github(req.auth.token,`/search/issues?q=${q}&sort=updated&per_page=50`);res.json({items:result.items.map(x=>({title:x.title,url:x.html_url,number:x.number,repo:x.repository_url.split('/').slice(-2).join('/')})),total:result.total_count})
}));
async function pull(token,url,expectedHead){const p=parsePR(url),prefix=`/repos/${p.owner}/${p.repo}`;const pr=await github(token,`${prefix}/pulls/${p.number}`);if(expectedHead&&pr.head.sha!==expectedHead){const e=new Error('This PR has new commits. Reopen it before asking about the updated code.');e.status=409;throw e}return {...p,prefix,pr}}
async function changedFiles(token,p){let files=[];for(let page=1;page<=30;page++){const batch=await github(token,`${p.prefix}/pulls/${p.number}/files?per_page=100&page=${page}`);files.push(...batch);if(batch.length<100)break}return files}
async function content(token,p,filename,side='head'){cleanPath(filename);const branch=side==='base'?p.pr.base:p.pr.head;const repo=branch.repo?.full_name;if(!repo)throw new Error('The source repository is no longer accessible.');const f=await github(token,`/repos/${repo}/contents/${encodePath(filename)}?ref=${branch.sha}`);if(f.type!=='file'||f.encoding!=='base64'||f.size>500000)throw new Error('File is binary, too large, or unavailable.');const raw=Buffer.from(f.content,'base64'),text=raw.toString('utf8');if(!Buffer.from(text,'utf8').equals(raw))throw new Error('Non-UTF-8 source cannot be reconstructed as text.');if(text.includes('\0'))throw new Error('Binary files cannot be shown in the code editor.');return {path:filename,text,sha:branch.sha}}
app.get('/api/pr',wrap(async(req,res)=>{const p=await pull(req.auth.token,req.query.url);const files=await changedFiles(req.auth.token,p);res.json({url:p.pr.html_url,title:p.pr.title,number:p.number,repo:`${p.owner}/${p.repo}`,head:p.pr.head.sha,base:p.pr.base.sha,author:p.pr.user.login,body:p.pr.body||'',changedFiles:p.pr.changed_files,limited:p.pr.changed_files>files.length,files:files.map(f=>({path:f.filename,previousPath:f.previous_filename,status:f.status,additions:f.additions,deletions:f.deletions,patch:f.patch||null}))})}));
async function snapshot(req,p){
  const raw=await changedFiles(req.auth.token,p);
  const comparison=await github(req.auth.token,`${p.prefix}/compare/${p.pr.base.sha}...${p.pr.head.sha}`);
  const mergeBase=comparison.merge_base_commit?.sha;if(!mergeBase)throw new Error('Cannot determine the PR merge-base.');
  const source={...p,pr:{...p.pr,base:{...p.pr.base,sha:mergeBase}}},files=[];let bytes=0;
  for(let i=0;i<raw.length;i+=4){if(bytes>1200000){files.push(...raw.slice(i).map(f=>({path:f.filename,status:f.status,unavailable:true,reason:'Review snapshot exceeds the current response size limit. Inspect this file on GitHub.'})));break}const batch=await Promise.all(raw.slice(i,i+4).map(async f=>{
    const meta={path:f.filename,previousPath:f.previous_filename||f.filename,status:f.status};
    try{const [before,after]=await Promise.all([f.status==='added'?'':content(req.auth.token,source,meta.previousPath,'base').then(x=>x.text),f.status==='removed'?'':content(req.auth.token,source,f.filename,'head').then(x=>x.text)]);return {...meta,before,after}}
    catch(error){return {...meta,unavailable:true,reason:error.message}}
  }));for(const file of batch){bytes+=Buffer.byteLength(JSON.stringify(file));files.push(bytes>1200000?{path:file.path,status:file.status,unavailable:true,reason:'Review snapshot exceeds the current response size limit. Inspect this file on GitHub.'}:file)}}
  return {...await transformationPlan(files,{limited:p.pr.changed_files>raw.length,base:mergeBase,head:p.pr.head.sha,explain:false}),prContext:{title:p.pr.title,body:(p.pr.body||'').slice(0,6000)}};
}
app.post('/api/analyze',wrap(async(req,res)=>{const p=await pull(req.auth.token,req.body.url,req.body.head);res.json(await snapshot(req,p))}));
app.post('/api/reviews',wrap(async(req,res)=>{
 const pace=reviewPace(req.body.pace);const p=await pull(req.auth.token,req.body.url,req.body.head);
 const owner=req.auth.user.login;let row=await findReview(owner,p.pr.html_url,p.pr.head.sha);
 if(!row)row=await createReview(owner,p.pr.html_url,p.pr.head.sha,await snapshot(req,p));
 row=await setReviewPace(row,pace);row=await ensureStepBlocks(row);res.json(publicReview(row));
}));
app.post('/api/reviews/:id/next',wrap(async(req,res)=>{const row=await getReview(req.auth.user.login,req.params.id);await pull(req.auth.token,row.pr_url,row.head);res.json(await nextStep(row,req.body.index))}));
app.post('/api/reviews/:id/progress',wrap(async(req,res)=>{const row=await getReview(req.auth.user.login,req.params.id);await pull(req.auth.token,row.pr_url,row.head);res.json(await advanceReview(row,req.body.cursor))}));
app.get('/api/tree',wrap(async(req,res)=>{
  const p=await pull(req.auth.token,req.query.url,req.query.head);
  const tree=String(req.query.tree||p.pr.head.sha);
  if(!/^[a-f0-9]{40}$/i.test(tree))return res.status(400).json({error:'Invalid tree reference.'});
  const repo=p.pr.head.repo?.full_name;if(!repo)throw new Error('Source repository unavailable.');
  const data=await github(req.auth.token,`/repos/${repo}/git/trees/${tree}`);
  if(data.truncated)throw new Error('This directory is too large to list completely.');
  res.json({head:p.pr.head.sha,entries:data.tree.filter(x=>x.type==='tree'||x.type==='blob').map(x=>({name:x.path,type:x.type,sha:x.sha}))});
}));
app.get('/api/file',wrap(async(req,res)=>{let p=await pull(req.auth.token,req.query.url,req.query.head);if(req.query.side==='base'){const comparison=await github(req.auth.token,`${p.prefix}/compare/${p.pr.base.sha}...${p.pr.head.sha}`);const sha=comparison.merge_base_commit?.sha;if(!sha)throw new Error('Cannot determine the PR merge-base.');p={...p,pr:{...p.pr,base:{...p.pr.base,sha}}};}res.json(await content(req.auth.token,p,req.query.path,req.query.side==='base'?'base':'head'))}));

const recent=new Map();
app.get('/api/search',wrap(async(req,res)=>{
  const query=String(req.query.q||'').trim();
  if(query.length<2||query.length>300)return res.status(400).json({error:'Search for 2–300 characters.'});
  const p=await pull(req.auth.token,req.query.url,req.query.head);
  res.json({...searchIndex(await repositoryIndex(req.auth.token,p.pr),query,30),head:p.pr.head.sha});
}));
app.get('/api/function-data',wrap(async(req,res)=>{
 const p=await pull(req.auth.token,req.query.url,req.query.head);
 const index=await repositoryIndex(req.auth.token,p.pr);
 res.json({...functionData(index.files,req.query),head:p.pr.head.sha});
}));
app.get('/api/call-index',wrap(async(req,res)=>{
 if(!req.query.symbol&&!(req.query.path&&Number.isInteger(Number(req.query.line))))return res.status(400).json({error:'Choose a method or call site to explore.'});
 const p=await pull(req.auth.token,req.query.url,req.query.head);let snapshot=p.pr.head;
 if(req.query.snapshot==='base'){
 const comparison=await github(req.auth.token,`${p.prefix}/compare/${p.pr.base.sha}...${p.pr.head.sha}`);
 const sha=comparison.merge_base_commit?.sha;if(!sha)throw new Error('Cannot determine the PR merge-base.');snapshot={...p.pr.base,sha};
 }
 const index=await repositoryIndex(req.auth.token,{...p.pr,head:snapshot}),graph=(await initCallParsers(),buildCallIndex(index.files));
 const names=new Set([req.query.symbol]);for(const [,bindings]of graph.imports)for(const match of bindings)for(const binding of match[1].split(',')){const [original,alias=original]=binding.trim().split(/\s+as\s+/);if(original===req.query.symbol)names.add(alias)}
 const calls=graph.calls.filter(c=>req.query.direction==='callees'?c.path===req.query.path&&c.line===Number(req.query.line):names.has(c.symbol));
 res.json({head:p.pr.head.sha,sha:snapshot.sha,languages:graph.languages,blocks:graph.blocks.map(({text,from,to,...block})=>block),calls:calls.map(({expression,...call})=>call),imports:graph.imports});
}));
app.get('/api/calls',wrap(async(req,res)=>{
 const p=await pull(req.auth.token,req.query.url,req.query.head);
 const index=await repositoryIndex(req.auth.token,p.pr);
 const graph=(await initCallParsers(),buildCallIndex(index.files));const result=indexedCalls(graph,req.query);res.json({...result,blocks:result.blocks.map(b=>({...b,text:b.text??index.files.get(b.path).split('\n').slice(b.start-1,b.end).join('\n')})),head:p.pr.head.sha});
}));
app.post('/api/review',wrap(async(req,res)=>{
  if(!req.body.head)return res.status(400).json({error:'A PR commit is required.'});
  const p=await pull(req.auth.token,req.body.url,req.body.head);
  const draft=validateReview(req.body,await changedFiles(req.auth.token,p));
  const result=await fetch('https://api.github.com'+p.prefix+'/pulls/'+p.number+'/reviews',{method:'POST',headers:{Authorization:`Bearer ${req.auth.token}`,Accept:'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'},body:JSON.stringify({...draft,commit_id:p.pr.head.sha}),signal:AbortSignal.timeout(20000)});
  if(!result.ok){const code=result.status;return res.status(code===403?403:code===422?422:502).json({error:code===403?'Posting requires Pull requests: read and write permission. Update the CodeSurf installation on GitHub, then sign in again.':code===422?'GitHub could not accept this review. Check the selected diff lines and review action (authors cannot approve their own PR).':'GitHub could not confirm this review. Check the PR before retrying to avoid duplicates.'})}
  const review=await result.json();res.json({url:review.html_url,id:review.id});
}));
async function ownedVoiceReview(req,p){
 const row=await getReview(req.auth.user.login,req.body.reviewId),count=req.body.step;
 if(row.head!==p.pr.head.sha||row.pr_url!==p.pr.html_url||!Number.isInteger(count)||count<0||count>row.cursor)throw Object.assign(new Error('Reopen this review before continuing voice chat.'),{status:409});
 return row;
}
async function voiceContext(req,p){
 const selection=req.body.selection;let review=null,text,snapshot='PR head';
 if(req.body.reviewId){const row=await ownedVoiceReview(req,p);review=voiceReviewContext(row.plan,req.body.step,publicReview(row).done);if(selection?.intermediate!==false){
  snapshot='Review step '+req.body.step;
  if(selection){const entry=manifestAt(row.plan,req.body.step).find(file=>file.key===selection.path);if(entry&&!entry.exists)throw Object.assign(new Error('The selected file is unavailable at this review step.'),{status:400});text=stateAt(row.plan,req.body.step)[selection.path]}
 }}
 if(selection&&text===undefined)text=(await content(req.auth.token,p,selection.path)).text;
 return {title:p.pr.title,description:(p.pr.body||'').slice(0,6000),head:p.pr.head.sha,snapshot,review,selection:selection?voiceSelection(selection,text):null};
}
async function voiceCallSnapshot(req,p,args){
 if(args.snapshot!=='review'||!req.body.reviewId){const index=await repositoryIndex(req.auth.token,p.pr);await initCallParsers();return {index,graph:buildCallIndex(index.files),snapshot:'PR head'}}
 const row=await ownedVoiceReview(req,p),count=req.body.step;
 const comparison=await github(req.auth.token,`${p.prefix}/compare/${p.pr.base.sha}...${p.pr.head.sha}`),sha=comparison.merge_base_commit?.sha;
 if(!sha)throw new Error('Cannot determine the review merge-base.');
 const base=await repositoryIndex(req.auth.token,{...p.pr,head:{...p.pr.base,sha}}),overrides=new Map(),state=stateAt(row.plan,count),manifest=manifestAt(row.plan,count);
 for(const file of row.plan.files){if(file.unavailable)continue;overrides.set(file.path,null);if(file.previousPath)overrides.set(file.previousPath,null);const entry=manifest.find(item=>item.key===file.path);if(entry?.exists)overrides.set(entry.path,state[file.path])}
 const selected=manifest.find(item=>item.key===args.path);if(selected)args.path=selected.path;
 await initCallParsers();const files=new Map(base.files);for(const [path,text]of overrides){if(text===null)files.delete(path);else files.set(path,text)}
 return {index:{...base,files},graph:overlayCallIndex(buildCallIndex(base.files),overrides),snapshot:'Review step '+count};
}
async function reviewCallPeeks(req,p,args){
 const request={...args};
 const {index,graph,snapshot}=await voiceCallSnapshot(req,p,request),result=functionPeeks(graph,request);
 const source=block=>({...block,text:index.files.get(block.path)?.split('\n').slice(block.start-1,block.end).join('\n'),snapshot});
 if(args.direction==='callers'&&req.body.reviewId){
  try{
   const head=args.snapshot==='head'?{index,graph}:await voiceCallSnapshot(req,p,{...args,snapshot:'head'});
   const applied=args.snapshot==='head'?await voiceCallSnapshot(req,p,{...args,snapshot:'review'}):{index,graph};
   const row=await ownedVoiceReview(req,p),file=row.plan.files.find(f=>f.path===args.path||f.previousPath===args.path);
   result.future=futureCallers(applied.graph,head.graph,result.root,applied.index.files,head.index.files,[file?.path,file?.previousPath].filter(Boolean));
  }catch{result.future={checked:false,total:0,message:'The applied callers are shown, but callers in later PR changes could not be checked.'}}
 }
 return {...result,root:source(result.root),blocks:result.blocks.map(source)};
}
async function reviewDraft(req,p,args,files){
 const row=req.body.reviewId?await ownedVoiceReview(req,p):null;
 const snapshot=args.snapshot||(req.body.selection?.intermediate===false?'head':row?'review':'head');
 if(!['review','head'].includes(snapshot))throw Object.assign(new Error('Invalid comment snapshot.'),{status:400});
 return draftReview(args,files||await changedFiles(req.auth.token,p),{plan:row?.plan,count:req.body.step,snapshot});
}
app.post('/api/voice/context',wrap(async(req,res)=>{const p=await pull(req.auth.token,req.body.url,req.body.head);res.json(await voiceContext(req,p))}));
const speechRequests=new Map();
const voiceRequests=new Map();
app.post('/api/voice/tool',wrap(async(req,res)=>{
 const {name,args,head}=req.body;
 if(!['search_repository','read_code','show_code','explore_calls','draft_review'].includes(name)||!args||typeof args!=='object'||typeof head!=='string'||!head)return res.status(400).json({error:'Invalid repository tool request.'});
 const p=await pull(req.auth.token,req.body.url,head);
 if(name==='draft_review')return res.json({draft:await reviewDraft(req,p,args),drafted:true,published:false,head});
 if(name==='explore_calls'){
  cleanPath(args.path);
  return res.json({...await reviewCallPeeks(req,p,args),head});
 }
 const index=await repositoryIndex(req.auth.token,p.pr);
 if(name==='search_repository'){
  if(typeof args.query!=='string'||args.query.length<2||args.query.length>300)return res.status(400).json({error:'Use a short source search query.'});
  return res.json({...searchIndex(index,args.query,10),head});
 }
 cleanPath(args.path);
 const text=index.files.get(args.path);
 if(text===undefined)return res.json({error:'File unavailable in source index. It may be excluded, binary, generated or too large.'});
 const total=text.split('\n').length;
 if(!Number.isInteger(args.start)||!Number.isInteger(args.end)||args.start<1||args.end<args.start||args.end>total||args.end-args.start>=160)return res.status(400).json({error:'Choose an existing source range of up to 160 lines.'});
 const block=readBlock(index,args.path,args.start,args.end);
 res.json({...block,head,...(name==='show_code'?{reference:{path:block.path,start:block.start,end:block.end}}:{})});
}));
app.post('/api/voice',wrap(async(req,res)=>{
 if(!env.OPENAI_API_KEY)return res.status(503).json({error:'Voice chat is not configured.'});
 if(typeof req.body.head!=='string'||!req.body.head)return res.status(400).json({error:'Reopen the pull request before starting voice chat.'});
 if(typeof req.body.sdp!=='string'||!req.body.sdp.startsWith('v=0')||req.body.sdp.length>30000)return res.status(400).json({error:'Invalid voice connection offer.'});
 const owner=req.auth.user.login,now=Date.now(),recent=(voiceRequests.get(owner)||[]).filter(t=>t>now-60000);
 if(recent.length>=5)return res.status(429).json({error:'Please wait a minute before starting another voice chat.'});
 voiceRequests.set(owner,[...recent,now]);if(voiceRequests.size>10000)for(const [key,times]of voiceRequests)if(times.at(-1)<now-60000)voiceRequests.delete(key);
 const p=await pull(req.auth.token,req.body.url,req.body.head);
 const context=await voiceContext(req,p);
 const form=new FormData();form.set('sdp',req.body.sdp);form.set('session',JSON.stringify(voiceSession(context)));
 const response=await fetch('https://api.openai.com/v1/realtime/calls',{method:'POST',headers:{Authorization:'Bearer '+env.OPENAI_API_KEY,'OpenAI-Safety-Identifier':crypto.createHash('sha256').update(owner).digest('hex')},body:form,signal:AbortSignal.timeout(35000)});
 if(!response.ok){const body=await response.json().catch(()=>({}));const error={status:response.status,...body.error};reportOpenAIError(error);return res.status(response.status===429?429:502).json({error:openAIErrorMessage(error)})}
 res.type('application/sdp').send(await response.text());
}));
app.post('/api/note-audio',wrap(async(req,res)=>{
 const text=typeof req.body.text==='string'?req.body.text.trim():'';
 if(!text||text.length>4000)return res.status(400).json({error:'Choose a note under 4,000 characters to read aloud.'});
 if(!env.OPENAI_API_KEY)return res.status(503).json({error:'Audio is not configured yet.'});
 const now=Date.now(),owner=req.auth.user.login,recent=(speechRequests.get(owner)||[]).filter(t=>t>now-60000);
 if(recent.length>=20)return res.status(429).json({error:'Please wait a minute before generating more recordings.'});
 speechRequests.set(owner,[...recent,now]);if(speechRequests.size>10000)for(const [key,times]of speechRequests)if(times.at(-1)<now-60000)speechRequests.delete(key);
 const client=new OpenAI({apiKey:env.OPENAI_API_KEY,maxRetries:0,timeout:30000});
 const audio=await client.audio.speech.create({model:'gpt-4o-mini-tts',voice:'marin',input:text,response_format:'mp3',instructions:'Read this code-review explanation in a warm, clear, natural conversational voice. Use a calm, helpful tone and a comfortable pace, with brief pauses between sentences. Read the text as written; do not add commentary.'});
 res.set('Cache-Control','private, no-store').type('audio/mpeg').send(Buffer.from(await audio.arrayBuffer()));
}));
app.post('/api/ask',wrap(async(req,res)=>{
  if(!env.OPENAI_API_KEY)return res.status(503).json({error:'The server OpenAI key has not been configured yet.'});
  const {url,question,selection,history=[]}=req.body;
  if(typeof question!=='string'||!question.trim()||question.length>4000)return res.status(400).json({error:'Enter a question under 4,000 characters.'});
  const now=Date.now(),id=req.auth.user.login,attempts=(recent.get(id)||[]).filter(t=>t>now-60000);
  if(attempts.length>=10)return res.status(429).json({error:'Please wait a minute before asking another question.'});
  recent.set(id,[...attempts,now]);if(recent.size>10000)for(const [k,v]of recent)if(v.at(-1)<now-60000)recent.delete(k);
  const p=await pull(req.auth.token,url,req.body.head),changed=await changedFiles(req.auth.token,p);
  const snapshot=selection?.intermediate&&req.body.reviewId?await voiceCallSnapshot(req,p,{path:selection.path,snapshot:'review'}):null;
  const context=req.body.reviewId?await voiceContext(req,p):null;
  await answer({draftReview:args=>reviewDraft(req,p,args,changed),req,res,p,changed,question,selection,history,token:req.auth.token,sourceIndex:snapshot?.index,snapshot:snapshot?.snapshot||'PR head',reviewContext:context,finalSourceIndex:()=>repositoryIndex(req.auth.token,p.pr),exploreCalls:args=>reviewCallPeeks(req,p,{...args,snapshot:args.snapshot||(selection?.intermediate===false?'head':req.body.reviewId?'review':'head')})});
}));
app.use(express.static(path.join(root,'public')));
app.get('/github/:owner/:repo/pull/:number',(req,res,next)=>{if(!/^[1-9]\d*$/.test(req.params.number))return next();res.sendFile(path.join(root,'public/index.html'))});
app.get('/:owner/:repo/pull/:number',(req,res,next)=>{if(!/^[1-9]\d*$/.test(req.params.number))return next();res.redirect(308,'/github'+req.originalUrl)});
app.use((error,req,res,_next)=>{if(res.headersSent)return res.end();if(error instanceof OpenAI.APIError){reportOpenAIError(error);return res.status(error.status===429?429:502).json({error:openAIErrorMessage(error)})}res.status(error.status||500).json({error:error.status?error.message:error instanceof OpenAI.APIError?'OpenAI request failed. Check project billing and model access.':error.message?.startsWith('Enter ')||error.message==='Invalid file path'?error.message:'The request could not be completed. Please retry.'})});
if(!env.VERCEL&&process.env.NODE_ENV!=='test')app.listen(Number(env.PORT||5179),'127.0.0.1',()=>console.log('CodeSurf: http://localhost:'+(env.PORT||5179)));
export default app;
