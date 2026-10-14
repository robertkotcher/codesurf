import {indexedCalls} from './browser/source-index.js';
// Resolve exact source relationships; never match callers by method name alone.
export function canvasRelations(change,current,previous=null){
 const records=new Map(),roots=new Set();const unresolvedSites=new Set();
 for(const block of change.blocks.filter(b=>!b.metadata)){
  const source=block.deleted&&previous?previous:current,start=block.deleted?block.oldStart:block.start,end=block.deleted?block.oldEnd:block.end,snapshot=source===previous?'Before this change':'At this change';
  const path=source.index.files.has(block.path)?block.path:block.previousPath||block.key;
  const candidates=source.graph.blocks.filter(fn=>fn.path===path&&fn.start>=start&&fn.start<=end);
  try{const root=indexedCalls(source.graph,{path,line:start,direction:'root'}).blocks[0];if(!candidates.some(fn=>fn.start===root.start))candidates.push(root)}catch{}
  const add=(target,direction,callLine,targetLine=target.start,detail={})=>{
   const key=direction+':'+target.path+':'+target.start+':'+snapshot;
   if(!records.has(key)){const text=source.index.files.get(target.path)?.split('\n').slice(target.start-1,target.end).join('\n');if(text===undefined)return;records.set(key,{id:key,direction,path:target.path,start:target.start,end:target.end,symbol:target.symbol,text,snapshot,ambiguous:!!target.ambiguous,precision:target.precision,changed:snapshot==='At this change'&&change.blocks.some(b=>!b.deleted&&b.path===target.path&&b.start<=target.end&&b.end>=target.start),edges:[]})}
   const record=records.get(key);record.ambiguous||=!!target.ambiguous;
   if(!record.edges.some(edge=>edge.blockId===block.id&&edge.callLine===callLine&&edge.targetLine===targetLine))record.edges.push({blockId:block.id,callLine,targetLine,...detail});
  };
  for(const root of candidates){const rootKey=block.id+':'+root.path+':'+root.start;if(roots.has(rootKey))continue;roots.add(rootKey);
   for(const caller of indexedCalls(source.graph,{path,line:root.start,direction:'callers'}).blocks)add(caller,'callers',caller.callLine,root.start,{targetSymbol:root.symbol});
  }
  const calls=source.graph.calls.filter(call=>call.path===path&&(candidates.some(root=>call.callerStart===root.start||call.callerStart==null&&call.line>=root.start&&call.line<=root.end)||call.line>=start&&call.line<=end));
  const sites=new Set();for(const call of calls){if(sites.has(call.line))continue;sites.add(call.line);const targets=indexedCalls(source.graph,{path,line:call.line,direction:'callees'}).blocks;if(!targets.length)unresolvedSites.add(path+':'+call.line);for(const target of targets){const enclosing=source.graph.blocks.find(fn=>fn.path===path&&fn.start===call.callerStart);add(target,'callees',call.line,target.start,{scope:call.line>=start&&call.line<=end?'change':'function',sourceSymbol:enclosing?.symbol||null})}}
 }
 return {relations:[...records.values()],unresolved:unresolvedSites.size};
}

export function validateCanvasSelection(selection){
 if(!selection||!['callers','callees'].includes(selection.direction)||!['before','after'].includes(selection.snapshot)||typeof selection.path!=='string'||selection.path.length>500||selection.path.split('/').some(part=>!part||part==='.'||part==='..')||/[\x00-\x1f\\]/.test(selection.path)||!Number.isInteger(selection.line)||selection.line<1||typeof selection.anchorId!=='string'||!selection.anchorId||selection.anchorId.length>1000||!Number.isInteger(selection.level)||Math.abs(selection.level)>8)throw Object.assign(new Error('Choose a code line and a connection direction.'),{status:400});
 return selection;
}
export function canvasSelection(change,selection,current,previous=null){
 validateCanvasSelection(selection);const source=selection.snapshot==='before'?previous:current;
 if(!source?.index.files.has(selection.path)||selection.line>source.index.files.get(selection.path).split('\n').length)throw Object.assign(new Error('This code line is unavailable in the selected review snapshot.'),{status:400});
 const {path,line,direction}=selection,level=selection.level+(direction==='callers'?-1:1),snapshot=selection.snapshot==='before'?'Before this change':'At this change';
 let root=null;try{root=indexedCalls(source.graph,{path,line,direction:'root'}).blocks[0]}catch{}
 const result=indexedCalls(source.graph,{path,line,direction}),records=new Map();
 for(const target of result.blocks){
  const key=direction+':'+target.path+':'+target.start+':'+snapshot+':'+level;
  const callLine=direction==='callers'?target.callLine:line,targetLine=direction==='callers'?root.start:target.start;
  const call=source.graph.calls.find(call=>call.path===path&&call.line===line),enclosing=source.graph.blocks.find(fn=>fn.path===path&&fn.start===call?.callerStart)||root;
  const edge={blockId:selection.anchorId,anchorLine:line,callLine,targetLine,...direction==='callers'?{targetSymbol:root.symbol}:{scope:change.blocks.some(block=>(selection.snapshot==='before'?block.previousPath||block.path:block.path)===path&&line>=(selection.snapshot==='before'?block.oldStart:block.start)&&line<=(selection.snapshot==='before'?block.oldEnd:block.end))?'change':'function',sourceSymbol:enclosing?.symbol||null}};
  if(records.has(key)){records.get(key).edges.push(edge);continue}
  records.set(key,{...target,id:key,direction,level,text:source.index.files.get(target.path).split('\n').slice(target.start-1,target.end).join('\n'),snapshot,changed:selection.snapshot==='after'&&change.blocks.some(block=>block.path===target.path&&!block.deleted&&block.start<=target.end&&block.end>=target.start),edges:[edge],affordances:{functions:source.graph.blocks.filter(fn=>fn.path===target.path&&fn.end>=target.start&&fn.start<=target.end).map(fn=>({start:fn.start,end:fn.end,symbol:fn.symbol})),calls:[...new Set(source.graph.calls.filter(call=>call.path===target.path&&call.line>=target.start&&call.line<=target.end).map(call=>call.line))]}});
 }
 return {relations:[...records.values()],unresolved:0};
}
