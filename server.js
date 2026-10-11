import {demoFiles} from './demo-plan.js';
import {transformationPlan} from './transformations.js';
import express from 'express';
import {saveGitHubProfile} from './database.js';
import crypto from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import OpenAI from 'openai';
import {repositoryIndex,searchIndex} from './repository.js';
import {validateReview} from './reviews.js';
import {answer} from './answers.js';
import {seal,unseal,parsePR,cleanPath,encodePath} from './lib.js';
const app=express(),root=path.dirname(fileURLToPath(import.meta.url));
const env=process.env;
const base=req=>{const primary=env.APP_URL||'http://localhost:5179';const allowed=[primary,...(env.APP_ALTERNATE_URLS||'').split(',').filter(Boolean)];return allowed.find(url=>new URL(url).host===req?.get('host'))||primary};
app.disable('x-powered-by');app.set('trust proxy',1);app.use(express.json({limit:'200kb'}));
app.use((req,res,next)=>{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https://avatars.githubusercontent.com data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://github.com");if(req.path.startsWith('/api/')||req.path.startsWith('/auth/'))res.setHeader('Cache-Control','no-store');next()});
const cookies=req=>Object.fromEntries((req.headers.cookie||'').split(';').map(s=>s.trim().split('=')).filter(x=>x.length===2));
const opts={httpOnly:true,secure:base().startsWith('https:'),sameSite:'lax',path:'/'};
const session=req=>unseal(cookies(req).codesurf_session,env.SESSION_SECRET);
function setSession(res,s){res.cookie('codesurf_session',seal(s,env.SESSION_SECRET),{...opts,maxAge:7*864e5})}
const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
app.get('/api/status',(_req,res)=>res.json({github:!!(env.GITHUB_CLIENT_ID&&env.GITHUB_CLIENT_SECRET&&env.SESSION_SECRET),openai:!!env.OPENAI_API_KEY,installUrl:env.GITHUB_APP_SLUG?`https://github.com/apps/${env.GITHUB_APP_SLUG}/installations/new`:null}));
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
  res.json(plan);
}));
app.use('/api',wrap(async(req,res,next)=>{if(req.path==='/status')return next();let s=session(req);if(!s)return res.status(401).json({error:'Sign in with GitHub'});if(req.method==='POST'&&req.headers.origin!==base(req))return res.sendStatus(403);if(s.tokenExp<Date.now()+60000&&s.refresh){const r=await fetch('https://github.com/login/oauth/access_token',{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify({client_id:env.GITHUB_CLIENT_ID,client_secret:env.GITHUB_CLIENT_SECRET,grant_type:'refresh_token',refresh_token:s.refresh})});const t=await r.json();if(!t.access_token)return res.status(401).json({error:'GitHub session expired. Sign in again.'});s={...s,token:t.access_token,refresh:t.refresh_token,tokenExp:Date.now()+t.expires_in*1000};setSession(res,s)}req.auth=s;next()}));
app.get('/api/me',wrap(async(req,res)=>{const s=session(req);if(!s)return res.status(401).json({error:'Sign in with GitHub'});await github(s.token,'/user');res.json(s.user)}));
app.get('/api/prs',wrap(async(req,res)=>{
  if(req.query.relation==='all'){
    const items=[];let installations=[];
    for(let page=1;;page++){const batch=await github(req.auth.token,`/user/installations?per_page=100&page=${page}`);installations.push(...batch.installations);if(batch.installations.length<100)break}
    const repos=new Map();
    for(const installation of installations){for(let page=1;;page++){const batch=await github(req.auth.token,`/user/installations/${installation.id}/repositories?per_page=100&page=${page}`);for(const repo of batch.repositories)repos.set(repo.full_name,repo);if(batch.repositories.length<100)break}}
    const names=[...repos.keys()];
    for(let offset=0;offset<names.length;offset+=5){await Promise.all(names.slice(offset,offset+5).map(async repo=>{for(let page=1;;page++){const batch=await github(req.auth.token,`/repos/${repo}/pulls?state=open&sort=updated&direction=desc&per_page=100&page=${page}`);for(const pr of batch)items.push({title:pr.title,url:pr.html_url,number:pr.number,repo,updated:pr.updated_at,author:pr.user?.login});if(batch.length<100)break}}))}
    items.sort((a,b)=>String(b.updated).localeCompare(String(a.updated)));
    return res.json({items,total:items.length,repositories:repos.size});
  }
  const relation=req.query.relation==='assigned'?'assignee':'review-requested';const q=encodeURIComponent(`is:pr is:open ${relation}:${req.auth.user.login}`);const result=await github(req.auth.token,`/search/issues?q=${q}&sort=updated&per_page=50`);res.json({items:result.items.map(x=>({title:x.title,url:x.html_url,number:x.number,repo:x.repository_url.split('/').slice(-2).join('/')})),total:result.total_count})
}));
async function pull(token,url,expectedHead){const p=parsePR(url),prefix=`/repos/${p.owner}/${p.repo}`;const pr=await github(token,`${prefix}/pulls/${p.number}`);if(expectedHead&&pr.head.sha!==expectedHead){const e=new Error('This PR has new commits. Reopen it before asking about the updated code.');e.status=409;throw e}return {...p,prefix,pr}}
async function changedFiles(token,p){let files=[];for(let page=1;page<=30;page++){const batch=await github(token,`${p.prefix}/pulls/${p.number}/files?per_page=100&page=${page}`);files.push(...batch);if(batch.length<100)break}return files}
async function content(token,p,filename,side='head'){cleanPath(filename);const branch=side==='base'?p.pr.base:p.pr.head;const repo=branch.repo?.full_name;if(!repo)throw new Error('The source repository is no longer accessible.');const f=await github(token,`/repos/${repo}/contents/${encodePath(filename)}?ref=${branch.sha}`);if(f.type!=='file'||f.encoding!=='base64'||f.size>500000)throw new Error('File is binary, too large, or unavailable.');const raw=Buffer.from(f.content,'base64'),text=raw.toString('utf8');if(!Buffer.from(text,'utf8').equals(raw))throw new Error('Non-UTF-8 source cannot be reconstructed as text.');if(text.includes('\0'))throw new Error('Binary files cannot be shown in the code editor.');return {path:filename,text,sha:branch.sha}}
app.get('/api/pr',wrap(async(req,res)=>{const p=await pull(req.auth.token,req.query.url);const files=await changedFiles(req.auth.token,p);res.json({url:p.pr.html_url,title:p.pr.title,number:p.number,repo:`${p.owner}/${p.repo}`,head:p.pr.head.sha,base:p.pr.base.sha,author:p.pr.user.login,body:p.pr.body||'',changedFiles:p.pr.changed_files,limited:p.pr.changed_files>files.length,files:files.map(f=>({path:f.filename,previousPath:f.previous_filename,status:f.status,additions:f.additions,deletions:f.deletions,patch:f.patch||null}))})}));
app.post('/api/analyze',wrap(async(req,res)=>{
  const p=await pull(req.auth.token,req.body.url,req.body.head),raw=await changedFiles(req.auth.token,p);
  const comparison=await github(req.auth.token,`${p.prefix}/compare/${p.pr.base.sha}...${p.pr.head.sha}`);
  const mergeBase=comparison.merge_base_commit?.sha;if(!mergeBase)throw new Error('Cannot determine the PR merge-base.');
  const source={...p,pr:{...p.pr,base:{...p.pr.base,sha:mergeBase}}},files=[];let bytes=0;
  for(let i=0;i<raw.length;i+=4){if(bytes>1200000){files.push(...raw.slice(i).map(f=>({path:f.filename,status:f.status,unavailable:true,reason:'Review snapshot exceeds the current response size limit. Inspect this file on GitHub.'})));break}const batch=await Promise.all(raw.slice(i,i+4).map(async f=>{
    const meta={path:f.filename,previousPath:f.previous_filename||f.filename,status:f.status};
    try{const [before,after]=await Promise.all([f.status==='added'?'':content(req.auth.token,source,meta.previousPath,'base').then(x=>x.text),f.status==='removed'?'':content(req.auth.token,source,f.filename,'head').then(x=>x.text)]);return {...meta,before,after}}
    catch(error){return {...meta,unavailable:true,reason:error.message}}
  }));for(const file of batch){bytes+=Buffer.byteLength(JSON.stringify(file));files.push(bytes>1200000?{path:file.path,status:file.status,unavailable:true,reason:'Review snapshot exceeds the current response size limit. Inspect this file on GitHub.'}:file)}}
  res.json(await transformationPlan(files,{limited:p.pr.changed_files>raw.length,base:mergeBase,head:p.pr.head.sha}));
}));
app.get('/api/tree',wrap(async(req,res)=>{
  const p=await pull(req.auth.token,req.query.url,req.query.head);
  const tree=String(req.query.tree||p.pr.head.sha);
  if(!/^[a-f0-9]{40}$/i.test(tree))return res.status(400).json({error:'Invalid tree reference.'});
  const repo=p.pr.head.repo?.full_name;if(!repo)throw new Error('Source repository unavailable.');
  const data=await github(req.auth.token,`/repos/${repo}/git/trees/${tree}`);
  if(data.truncated)throw new Error('This directory is too large to list completely.');
  res.json({head:p.pr.head.sha,entries:data.tree.filter(x=>x.type==='tree'||x.type==='blob').map(x=>({name:x.path,type:x.type,sha:x.sha}))});
}));
app.get('/api/file',wrap(async(req,res)=>{const p=await pull(req.auth.token,req.query.url,req.query.head);res.json(await content(req.auth.token,p,req.query.path,req.query.side==='base'?'base':'head'))}));
const recent=new Map();
app.get('/api/search',wrap(async(req,res)=>{
  const query=String(req.query.q||'').trim();
  if(query.length<2||query.length>300)return res.status(400).json({error:'Search for 2–300 characters.'});
  const p=await pull(req.auth.token,req.query.url,req.query.head);
  res.json({...searchIndex(await repositoryIndex(req.auth.token,p.pr),query,30),head:p.pr.head.sha});
}));
app.post('/api/review',wrap(async(req,res)=>{
  if(!req.body.head)return res.status(400).json({error:'A PR commit is required.'});
  const p=await pull(req.auth.token,req.body.url,req.body.head);
  const draft=validateReview(req.body,await changedFiles(req.auth.token,p));
  const result=await fetch('https://api.github.com'+p.prefix+'/pulls/'+p.number+'/reviews',{method:'POST',headers:{Authorization:`Bearer ${req.auth.token}`,Accept:'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'},body:JSON.stringify({...draft,commit_id:p.pr.head.sha}),signal:AbortSignal.timeout(20000)});
  if(!result.ok){const code=result.status;return res.status(code===403?403:code===422?422:502).json({error:code===403?'Posting requires Pull requests: read and write permission. Update the CodeSurf installation on GitHub, then sign in again.':code===422?'GitHub could not accept this review. Check the selected diff lines and review action (authors cannot approve their own PR).':'GitHub could not confirm this review. Check the PR before retrying to avoid duplicates.'})}
  const review=await result.json();res.json({url:review.html_url,id:review.id});
}));
app.post('/api/ask',wrap(async(req,res)=>{
  if(!env.OPENAI_API_KEY)return res.status(503).json({error:'The server OpenAI key has not been configured yet.'});
  const {url,question,selection,history=[]}=req.body;
  if(typeof question!=='string'||!question.trim()||question.length>4000)return res.status(400).json({error:'Enter a question under 4,000 characters.'});
  const now=Date.now(),id=req.auth.user.login,attempts=(recent.get(id)||[]).filter(t=>t>now-60000);
  if(attempts.length>=10)return res.status(429).json({error:'Please wait a minute before asking another question.'});
  recent.set(id,[...attempts,now]);if(recent.size>10000)for(const [k,v]of recent)if(v.at(-1)<now-60000)recent.delete(k);
  const p=await pull(req.auth.token,url,req.body.head),changed=await changedFiles(req.auth.token,p);
  await answer({req,res,p,changed,question,selection,history,token:req.auth.token});
}));
app.use(express.static(path.join(root,'public')));
app.get('/:owner/:repo/pull/:number',(req,res,next)=>{if(!/^[1-9]\d*$/.test(req.params.number))return next();res.sendFile(path.join(root,'public/index.html'))});
app.use((error,req,res,_next)=>{if(res.headersSent)return res.end();res.status(error.status||500).json({error:error.status?error.message:error instanceof OpenAI.APIError?'OpenAI request failed. Check project billing and model access.':error.message?.startsWith('Enter ')||error.message==='Invalid file path'?error.message:'The request could not be completed. Please retry.'})});
if(!env.VERCEL&&process.env.NODE_ENV!=='test')app.listen(Number(env.PORT||5179),'127.0.0.1',()=>console.log('CodeSurf: http://localhost:'+(env.PORT||5179)));
export default app;
