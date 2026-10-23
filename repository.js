import crypto from 'node:crypto';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createGunzip} from 'node:zlib';
import tar from 'tar-stream';
import {cleanPath} from './lib.js';
const indexes=new Map(),loading=new Map();
const skip=/(^|\/)(node_modules|\.git|vendor|dist|build|\.next)(\/|$)|(^|\/)\.env(?:\.|$)|\.(?:png|jpe?g|gif|webp|pdf|zip|gz|lock|map|pem|key|woff2?|ttf|mp4)$/i;
function limiter(max){let size=0;return new Transform({transform(chunk,_enc,cb){size+=chunk.length;cb(size>max?new Error('Repository archive exceeds the safe search limit.'):null,chunk)}})}
export async function indexArchive(body){
  const files=new Map();let bytes=0,skipped=0,entries=0;
  const extract=tar.extract();
  extract.on('entry',(header,stream,next)=>{
    if(++entries>150000){stream.resume();extract.destroy(new Error('Repository has too many archive entries.'));return}
    const name=header.name.split('/').slice(1).join('/');let valid=true;try{cleanPath(name)}catch{valid=false}
    if(header.type!=='file'||!valid||(skip.test(name)&&name!=='Gemfile.lock')||header.size>200000||bytes+header.size>80*1024*1024){if(header.type==='file')skipped++;stream.resume();stream.on('end',next);return}
    const chunks=[];stream.on('data',chunk=>chunks.push(chunk));stream.on('end',()=>{const buffer=Buffer.concat(chunks);if(!buffer.includes(0)){const text=buffer.toString('utf8');files.set(name,text);bytes+=buffer.length}else skipped++;next()});
  });
  await pipeline(body,limiter(60*1024*1024),createGunzip(),limiter(300*1024*1024),extract);
  return {files,skipped,bytes};
}
export async function repositoryIndex(token,pr){
  const repo=pr.head.repo?.full_name;if(!repo)throw new Error('Source repository is unavailable.');
  // Cache is partitioned by credential and commit; caller rechecks GitHub access first.
  const key=crypto.createHash('sha256').update(token+'\0'+repo+'\0'+pr.head.sha).digest('hex');
  const cached=indexes.get(key);if(cached&&cached.expires>Date.now())return cached.value;
  if(loading.has(key))return loading.get(key);
  indexes.delete(key);
  const pending=(async()=>{
  const response=await fetch(`https://api.github.com/repos/${repo}/tarball/${pr.head.sha}`,{headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json'},signal:AbortSignal.timeout(90000)});
  if(!response.ok)throw new Error('Could not read the repository archive. Check GitHub repository access.');
  const value=await indexArchive(Readable.fromWeb(response.body));
  // At most one warmed snapshot per server instance. Cold starts may rebuild it.
  indexes.clear();indexes.set(key,{value,expires:Date.now()+5*60000});setTimeout(()=>indexes.delete(key),5*60000).unref();return value;
  })();loading.set(key,pending);try{return await pending}finally{loading.delete(key)}
}
export function searchIndex(index,query,limit=12){
  const terms=[...new Set(String(query).slice(0,300).toLowerCase().match(/[\w./:-]{2,}/g)||[])].filter(t=>!new Set(['the','and','how','does','what','this','that','when','where','with','from','code','show','please']).has(t)).slice(0,12);
  if(!terms.length)return {results:[],indexedFiles:index.files.size,skipped:index.skipped};
  const results=[];
  for(const [path,text] of index.files){
    const lower=text.toLowerCase(),pathLower=path.toLowerCase();let score=0,first=-1;
    for(const term of terms){
      const compact=term.replace(/[^a-z0-9]/g,'');
      if(pathLower.includes(term))score+=8;
      if(compact.length>2&&pathLower.split('/').pop().replace(/\.[^.]+$/,'').replace(/[^a-z0-9]/g,'')===compact)score+=35;
      const pos=lower.indexOf(term);if(pos>=0){score+=3;if(first<0||pos<first)first=pos}
      if(/^[a-z_][a-z0-9_]*$/.test(term)){
        const definition=new RegExp('\\b(?:class|module|def|function|interface|struct|enum)\\s+'+term+'(?=[^a-z0-9_]|$)').exec(lower);
        if(definition){score+=30;first=definition.index}
      }
    }
    if(!score)continue;
    const lines=text.split('\n'),hit=first<0?0:text.slice(0,first).split('\n').length-1,start=Math.max(0,hit-4),end=Math.min(lines.length,start+15);
    results.push({path,start:start+1,end,score,text:lines.slice(start,end).join('\n')});
  }
  results.sort((a,b)=>b.score-a.score||a.path.localeCompare(b.path));
  return {results:results.slice(0,limit),indexedFiles:index.files.size,skipped:index.skipped,totalMatches:results.length};
}
export function readBlock(index,path,start=1,end=100){
  cleanPath(path);const text=index.files.get(path);if(text===undefined)return {error:'File was not indexed. It may be binary, generated, excluded, or too large.'};
  const lines=text.split('\n');start=Math.max(1,Math.min(lines.length,Number(start)||1));end=Math.min(lines.length,start+159,Math.max(start,Number(end)||start+99));
  return {path,start,end,totalLines:lines.length,text:lines.slice(start-1,end).map((line,i)=>`${start+i}: ${line}`).join('\n').slice(0,20000)};
}
