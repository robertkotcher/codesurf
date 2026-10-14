import {indexedCalls} from './browser/source-index.js';
// Resolve exact source relationships; never match callers by method name alone.
export function canvasRelations(change,current,previous=null){
 const records=new Map(),roots=new Set();const unresolvedSites=new Set();
 for(const block of change.blocks.filter(b=>!b.metadata)){
  const source=block.deleted&&previous?previous:current,start=block.deleted?block.oldStart:block.start,end=block.deleted?block.oldEnd:block.end,snapshot=source===previous?'Before this change':'At this change';
  const path=source.index.files.has(block.path)?block.path:block.previousPath||block.key;
  const candidates=source.graph.blocks.filter(fn=>fn.path===path&&fn.start>=start&&fn.start<=end);
  try{const root=indexedCalls(source.graph,{path,line:start,direction:'root'}).blocks[0];if(!candidates.some(fn=>fn.start===root.start))candidates.push(root)}catch{}
  const add=(target,direction,callLine,targetLine=target.start)=>{
   const key=direction+':'+target.path+':'+target.start+':'+snapshot;
   if(!records.has(key)){const text=source.index.files.get(target.path)?.split('\n').slice(target.start-1,target.end).join('\n');if(text===undefined)return;records.set(key,{id:key,direction,path:target.path,start:target.start,end:target.end,symbol:target.symbol,text,snapshot,ambiguous:!!target.ambiguous,precision:target.precision,changed:snapshot==='At this change'&&change.blocks.some(b=>!b.deleted&&b.path===target.path&&b.start<=target.end&&b.end>=target.start),edges:[]})}
   const record=records.get(key);record.ambiguous||=!!target.ambiguous;
   if(!record.edges.some(edge=>edge.blockId===block.id&&edge.callLine===callLine&&edge.targetLine===targetLine))record.edges.push({blockId:block.id,callLine,targetLine});
  };
  for(const root of candidates){const rootKey=block.id+':'+root.path+':'+root.start;if(roots.has(rootKey))continue;roots.add(rootKey);
   for(const caller of indexedCalls(source.graph,{path,line:root.start,direction:'callers'}).blocks)add(caller,'callers',caller.callLine,root.start);
  }
  const calls=source.graph.calls.filter(call=>call.path===path&&(candidates.some(root=>call.callerStart===root.start||call.callerStart==null&&call.line>=root.start&&call.line<=root.end)||call.line>=start&&call.line<=end));
  const sites=new Set();for(const call of calls){if(sites.has(call.line))continue;sites.add(call.line);const targets=indexedCalls(source.graph,{path,line:call.line,direction:'callees'}).blocks;if(!targets.length)unresolvedSites.add(path+':'+call.line);for(const target of targets)add(target,'callees',call.line)}
 }
 return {relations:[...records.values()],unresolved:unresolvedSites.size};
}
