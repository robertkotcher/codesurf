// Read pinned public gem sources as data only. Never load or execute gem code.
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createGunzip} from 'node:zlib';
import {createHash} from 'node:crypto';
import tar from 'tar-stream';
import {buildCallIndex,initCallParsers} from './browser/source-index.js';
const packages=new Map();
function limit(max){let size=0;return new Transform({transform(chunk,_encoding,callback){size+=chunk.length;callback(size>max?new Error('Dependency source exceeds the size limit.'):null,chunk)}})}
export function lockedRubyGems(lock=''){
 const gems=[];let registry=false,specs=false,publicRegistry=false;
 for(const line of lock.split('\n')){
  if(/^\S/.test(line)){registry=line==='GEM';specs=false;publicRegistry=false}
  if(registry&&/^  remote: https:\/\/rubygems\.org\/?$/.test(line))publicRegistry=true;
  if(registry&&line==='  specs:')specs=true;
  const match=specs&&publicRegistry&&line.match(/^    ([a-zA-Z0-9_-]+) \(([0-9]+(?:\.[0-9A-Za-z]+)*)\)$/);
  if(match)gems.push({name:match[1],version:match[2]});
 }
 return gems;
}
async function gemFiles(body){
 const outer=tar.extract();let compressed;
 outer.on('entry',(header,stream,next)=>{const chunks=[];let size=0;stream.on('data',chunk=>{if(header.name==='data.tar.gz'){size+=chunk.length;if(size>10*1024*1024){outer.destroy(new Error('Dependency source exceeds the size limit.'));return}chunks.push(chunk)}});stream.on('end',()=>{if(header.name==='data.tar.gz')compressed=Buffer.concat(chunks);next()})});
 await pipeline(body,limit(12*1024*1024),outer);
 if(!compressed)throw new Error('Dependency source archive is unavailable.');
 const files=new Map(),extract=tar.extract();let bytes=0,entries=0;
 extract.on('entry',(header,stream,next)=>{
  if(++entries>20000){stream.resume();extract.destroy(new Error('Dependency has too many source entries.'));return}
  if(header.type!=='file'||!/^((lib|app)\/).*\.rb$/.test(header.name)||header.name.split('/').some(part=>!part||part==='..'||part==='.')||header.size>200000||bytes+header.size>8*1024*1024){stream.resume();stream.on('end',next);return}
  const chunks=[];stream.on('data',chunk=>chunks.push(chunk));stream.on('end',()=>{const buffer=Buffer.concat(chunks);if(!buffer.includes(0)){bytes+=buffer.length;files.set(header.name,buffer.toString('utf8'))}next()});
 });
 await pipeline(Readable.from([compressed]),createGunzip(),limit(32*1024*1024),extract);return files;
}
async function loadGem(gem,fetcher){
 const key=gem.name+'@'+gem.version;
 if(packages.has(key))return packages.get(key);
 const work=(async()=>{
  const response=await fetcher(`https://rubygems.org/api/v2/rubygems/${gem.name}/versions/${gem.version}.json`,{signal:AbortSignal.timeout(15000),redirect:'error'});
  if(!response.ok)throw new Error('Dependency metadata is unavailable.');
  const metadata=await response.json();if(metadata.name!==gem.name||metadata.version!==gem.version||!/^[a-f0-9]{64}$/i.test(metadata.sha))throw new Error('Dependency version could not be verified.');
  const archive=await fetcher(`https://rubygems.org/downloads/${gem.name}-${gem.version}.gem`,{signal:AbortSignal.timeout(20000),redirect:'error'});
  if(!archive.ok)throw new Error('Dependency source is unavailable.');
  const chunks=[];let size=0;for await(const chunk of Readable.fromWeb(archive.body)){size+=chunk.length;if(size>12*1024*1024)throw new Error('Dependency source exceeds the size limit.');chunks.push(chunk)}
  const bytes=Buffer.concat(chunks);if(createHash('sha256').update(bytes).digest('hex')!==metadata.sha)throw new Error('Dependency source checksum does not match.');
  return {files:await gemFiles(Readable.from([bytes])),library:{...gem,url:`https://rubygems.org/gems/${gem.name}/versions/${gem.version}`,description:String(metadata.info||'').slice(0,400)}};
 })();packages.set(key,work);if(packages.size>12)packages.delete(packages.keys().next().value);
 try{return await work}catch(error){packages.delete(key);throw error}
}
// Rails installs Devise's helpers through on_load, not a literal class include.
// Apply this adapter only when the pinned source contains that integration.
function deviseRails(graph,files,prefix,repository){
 const devise=files.get('lib/devise.rb')||'',helpers=files.get('lib/devise/controllers/helpers.rb')||'';
 if(!devise.includes('ActiveSupport.on_load(:action_controller)')||!devise.includes('include scope::Helpers')||!helpers.includes('include Devise::Controllers::StoreLocation'))return;
 graph.owners.push({path:prefix+'lib/devise.rb',owner:'ActionController::Base',namespace:'ActionController',includes:['::Devise::Controllers::Helpers'],prepends:[],extends:[]});
 const configuration=[...repository].filter(([path])=>/^config\/initializers\/.*\.rb$/.test(path)).map(([,text])=>text).join('\n');
 const configured=configuration.match(/^\s*config\.parent_controller\s*=\s*['"]([\w:]+)['"]/m)?.[1];
 // Do not guess when the application computes its parent controller dynamically.
 const dynamic=/^\s*config\.parent_controller\s*=/m.test(configuration)&&!configured;
 if(!dynamic){const owner=graph.owners.find(item=>item.owner==='DeviseController');if(owner&&devise.includes('@@parent_controller = "ApplicationController"'))owner.parentClass=configured||'ApplicationController'}
}
export async function withRubyDependencies(source,{fetcher=fetch}={}){
 const lock=source.index.files.get('Gemfile.lock');if(!lock)return source;
 const owners=source.graph.owners||[],references=owners.flatMap(item=>[item.parentClass,...item.includes||[],...item.prepends||[],...item.extends||[]]).filter(Boolean);
 const gems=lockedRubyGems(lock).filter(gem=>{const root=gem.name.split(/[-_]/).map(part=>part[0].toUpperCase()+part.slice(1)).join('');return references.some(name=>name.replace(/^::/,'').split('::')[0]===root)}).slice(0,4);
 if(!gems.length)return source;
 await initCallParsers();const files=new Map(source.index.files),libraries=new Map(),graphs=[],issues=[];
 // Bounded parallel reads keep dependency preparation off the interaction path.
 const loaded=await Promise.allSettled(gems.map(gem=>loadGem(gem,fetcher)));
 for(let i=0;i<loaded.length;i++){
  const result=loaded[i];if(result.status!=='fulfilled'){issues.push({library:gems[i].name,error:result.reason.message});continue}
  const {files:dependency,library}=result.value,prefix=`.dependencies/rubygems/${library.name}/${library.version}/`,mapped=new Map([...dependency].map(([path,text])=>[prefix+path,text]));
  for(const [path,text]of mapped){files.set(path,text);libraries.set(path,library)}
  const graph=buildCallIndex(mapped);graphs.push({...graph,owners:graph.owners.map(item=>({...item,includes:[...item.includes],prepends:[...item.prepends],extends:[...item.extends]}))});
  if(library.name==='devise')deviseRails(graphs.at(-1),dependency,prefix,source.index.files);
 }
 const graph={...source.graph,blocks:[...source.graph.blocks,...graphs.flatMap(item=>item.blocks)],calls:[...source.graph.calls,...graphs.flatMap(item=>item.calls)],imports:[...source.graph.imports,...graphs.flatMap(item=>item.imports)],owners:[...owners,...graphs.flatMap(item=>item.owners)]};
 return {...source,index:{...source.index,files},graph,libraries,dependencyIssues:issues};
}
