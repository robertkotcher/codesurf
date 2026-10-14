import {stateAt,manifestAt} from './transformations.js';
let parserModule;
const parsers=()=>parserModule??=import('./source-index.js').catch(error=>{parserModule=null;throw error});
export async function reviewAffordances(plan,count){
 const {buildCallIndex,initCallParsers}=await parsers();
 if(plan.files.some(file=>!file.unavailable&&(file.path.endsWith('.rb')||file.previousPath?.endsWith('.rb'))))await initCallParsers();
 const result={};
 for(const [snapshot,step]of [['before',count-1],['after',count]]){
  const state=stateAt(plan,step),manifest=manifestAt(plan,step),files=new Map(manifest.filter(file=>file.exists&&typeof state[file.key]==='string').map(file=>[file.path,state[file.key]])),index=buildCallIndex(files);
  result[snapshot]=Object.fromEntries(manifest.filter(file=>file.exists&&typeof state[file.key]==='string').map(file=>[file.key,{path:file.path,functions:index.blocks.filter(fn=>fn.path===file.path).map(fn=>({start:fn.start,end:fn.end,symbol:fn.symbol})),calls:[...new Set(index.calls.filter(call=>call.path===file.path).map(call=>call.line))]}]));
 }
 return result;
}
