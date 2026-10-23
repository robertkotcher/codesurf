import {canvasConnectionKey} from './public/canvas-preload.js';
export {canvasConnectionKey} from './public/canvas-preload.js';
import {indexedCalls,resolvedCallSites} from './browser/source-index.js';
import {variableBindings} from './browser/variable-index.js';
import {mergeVariableBindings} from './public/variable-data.js';
export function validateCanvasSelection(selection){
 if(!selection||!['callers','callees'].includes(selection.direction)||!['before','after'].includes(selection.snapshot)||typeof selection.path!=='string'||selection.path.length>500||selection.path.split('/').some(part=>!part||part==='.'||part==='..')||/[\x00-\x1f\\]/.test(selection.path)||!Number.isInteger(selection.line)||selection.line<1||typeof selection.anchorId!=='string'||!selection.anchorId||selection.anchorId.length>1000||!Number.isInteger(selection.level)||Math.abs(selection.level)>8)throw Object.assign(new Error('Choose a code line and a connection direction.'),{status:400});
 if(selection.column!==undefined&&(!Number.isInteger(selection.column)||selection.column<0||selection.column>200000))throw Object.assign(new Error('Invalid function selection.'),{status:400});
 return selection;
}
// Anchor validation is independent of changed lines: surrounding source and
// function cards are browsable at the same immutable review snapshot.
export function validateChangedSelection(change,selection){
 validateCanvasSelection(selection);
 if(selection.level===0){const block=change.blocks.find(block=>block.id===selection.anchorId&&!block.metadata),path=selection.snapshot==='before'?block?.previousPath||block?.path:block?.path;if(block){if(selection.path!==path)throw Object.assign(new Error('Choose a source card in this change.'),{status:400});return block}}
 const label=selection.snapshot==='before'?'Before this change':'At this change';
 if(!['callers','callees'].some(direction=>selection.anchorId.startsWith(direction+':'+selection.path+':')&&selection.anchorId.endsWith(':'+label+':'+selection.level)))throw Object.assign(new Error('Choose a source card in this change.'),{status:400});
 return null;
}
export function sourceForSelection(change,selection,current,previous){
 const block=validateChangedSelection(change,selection),source=selection.snapshot==='before'?previous:current,text=source?.index.files.get(selection.path);
 if(text===undefined||selection.line>text.split('\n').length||source.libraries?.has(selection.path))throw Object.assign(new Error('This code line is unavailable in the selected review snapshot.'),{status:400});
 if(!block){const label=selection.snapshot==='before'?'Before this change':'At this change';if(!source.graph.blocks.some(fn=>fn.path===selection.path&&['callers','callees'].some(direction=>selection.anchorId===`${direction}:${fn.path}:${fn.start}:${label}:${selection.level}`))&&!source.graph.calls.some(call=>call.path===selection.path&&call.callerStart===null&&selection.anchorId===`callers:${call.path}:${Math.max(1,call.line-3)}:${label}:${selection.level}`))throw Object.assign(new Error('Choose a source card in this change.'),{status:400})}
 return source;
}
const precise=(target,graph,path,line,direction)=>target.precision==='syntax'&&(!target.ambiguous||graph.calls.some(call=>call.ruby&&call.receiver?.owner&&call.path===(direction==='callers'?target.path:path)&&call.line===(direction==='callers'?target.callLine:line)));
const affordanceCache=new WeakMap();
export function canvasSourceAffordances(source,path,start,end){
 let cache=affordanceCache.get(source.graph);if(!cache){cache=new Map();affordanceCache.set(source.graph,cache)}const key=JSON.stringify([path,start,end]);if(cache.has(key))return cache.get(key);
 const functions=source.graph.blocks.filter(fn=>fn.path===path&&fn.precision==='syntax'&&!/^(?:anonymous|callback) at line /.test(fn.symbol)).map(({start,end,symbol})=>({start,end,symbol})),tokens=[];
 for(const call of source.graph.calls.filter(call=>call.path===path&&call.line>=start&&call.line<=end&&call.precision==='syntax'&&Number.isInteger(call.column))){
  const result=indexedCalls(source.graph,{path,line:call.line,column:call.column,direction:'callees'});
  if(result.blocks.some(target=>precise(target,source.graph,path,call.line,'callees')))tokens.push({line:call.line,column:call.column,endColumn:call.endColumn,symbol:call.symbol});
 }
 const variables=variableBindings(source.index.files,path,{owners:source.graph.owners}).map(binding=>({...binding,occurrences:binding.occurrences.filter(token=>token.line>=start&&token.line<=end)})).filter(binding=>binding.occurrences.length);
 const result={path,functions,calls:[...new Set(tokens.map(token=>token.line))],tokens,variables};cache.set(key,result);return result;
}
export function canvasExcerpt(change,selection,range,direction,current,previous=null){
 if(!range||!Number.isInteger(range.start)||!Number.isInteger(range.end)||range.start<1||range.end<range.start||!['up','down'].includes(direction))throw Object.assign(new Error('Choose a valid source range and expansion direction.'),{status:400});
 const source=sourceForSelection(change,selection,current,previous),lines=source.index.files.get(selection.path).split('\n');
 if(range.end>lines.length)throw Object.assign(new Error('This source range is unavailable.'),{status:400});
 const start=direction==='up'?Math.max(1,range.start-25):range.end+1,end=direction==='up'?range.start-1:Math.min(lines.length,range.end+25),before=selection.snapshot==='before';
 return {start:Math.min(range.start,start),end:Math.max(range.end,end),totalLines:lines.length,rows:lines.slice(start-1,end).map((text,index)=>({text,kind:'context',line:before?null:start+index,old:before?start+index:null})),affordances:canvasSourceAffordances(source,selection.path,start,end)};
}
export function canvasSelection(change,selection,current,previous=null){
 const source=sourceForSelection(change,selection,current,previous);
 const {path,line,direction}=selection,level=selection.level+(direction==='callers'?-1:1),snapshot=selection.snapshot==='before'?'Before this change':'At this change';
 let root=null;try{root=indexedCalls(source.graph,{path,line,direction:'root'}).blocks[0]}catch{}
 if(direction==='callers'&&(!root||root.start!==line)||direction==='callees'&&!source.graph.calls.some(call=>call.path===path&&call.line===line&&call.precision==='syntax'))throw Object.assign(new Error('Choose a function signature for callers or a function call for callees.'),{status:400});
 const result=indexedCalls(source.graph,{path,line,direction,column:selection.column}),records=new Map();
 for(const target of result.blocks){
  if(!precise(target,source.graph,path,line,direction))continue;
  const key=direction+':'+target.path+':'+target.start+':'+snapshot+':'+level;
  const callLine=direction==='callers'?target.callLine:line,targetLine=direction==='callers'?root.start:target.start;
  const call=source.graph.calls.find(call=>call.path===path&&call.line===line),enclosing=source.graph.blocks.find(fn=>fn.path===path&&fn.start===call?.callerStart)||root;
  const edge={blockId:selection.anchorId,anchorLine:line,callLine,targetLine,...direction==='callers'?{targetSymbol:root.symbol}:{scope:'change',sourceSymbol:enclosing?.symbol||null}};
  const matchingEdges=direction==='callees'?resolvedCallSites(source.graph,target).flatMap(site=>{
   const anchor=change.blocks.find(candidate=>!candidate.metadata&&(selection.snapshot==='before'?candidate.previousPath||candidate.path:candidate.path)===site.path&&candidate.rows.some(row=>row.kind!==(selection.snapshot==='before'?'added':'removed')&&(selection.snapshot==='before'?row.old:row.line)===site.line));
   return anchor?[{blockId:anchor.id,anchorLine:site.line,callLine:site.line,targetLine:target.start,scope:'change',sourceSymbol:source.graph.blocks.find(fn=>fn.path===site.path&&fn.start===site.callerStart)?.symbol||null}]:[];
  }):[edge];
  const uniqueEdges=[...new Map([...matchingEdges,edge].map(item=>[JSON.stringify(item),item])).values()];
  if(records.has(key)){records.get(key).edges.push(...uniqueEdges);continue}
  const library=source.libraries?.get(target.path),text=source.index.files.get(target.path).split('\n').slice(target.start-1,target.end).join('\n');
  const preceding=source.index.files.get(target.path).split('\n').slice(Math.max(0,target.start-12),target.start-1),documentation=[];
  for(let i=preceding.length-1;i>=0;i--){const match=preceding[i].match(/^\s*# ?(.*)$/);if(!match)break;documentation.unshift(match[1])}
  const explanation=documentation.join(' ').split(/(?:Example:|Examples:|Usage:)/)[0].trim().replace(/\s+/g,' ').slice(0,350);
  records.set(key,{...target,id:key,direction,level,text:library?'':text,...library?{library:{...library,owner:target.owner,explanation:explanation||library.description}}:{},snapshot,changed:selection.snapshot==='after'&&change.blocks.some(block=>block.path===target.path&&!block.deleted&&block.start<=target.end&&block.end>=target.start),edges:uniqueEdges,totalLines:source.index.files.get(target.path).split('\n').length,affordances:library?{path:target.path,functions:[],calls:[],tokens:[]}:canvasSourceAffordances(source,target.path,target.start,Math.min(target.end,target.start+99))});
 }
 return {relations:[...records.values()],unresolved:0};
}

export function canvasConnectionPage(result,page=0){
 const offset=page*24,relations=result.relations.slice(offset,offset+24).map(node=>{
  const preview=node.text.split('\n').slice(0,100).join('\n').slice(0,16000);
  return preview.length<node.text.length?{...node,text:preview,end:node.start+preview.split('\n').length-1,fullEnd:node.end,clipped:true}:node;
 });
 return {...result,relations,total:result.relations.length,nextPage:offset+24<result.relations.length?page+1:null};
}
export function prepareCanvasConnections(change,current,previous=null){
 const affordances={before:{},after:{}},excerpts={},connections=new Map();
 for(const [snapshot,source]of [['before',previous],['after',current]]){
  if(!source)continue;
  for(const block of change.blocks){
   if(block.metadata)continue;const before=snapshot==='before',path=before?block.previousPath||block.path:block.path;
   if(!source.index.files.has(path))continue;
   const visible=block.rows.filter(row=>row.kind!==(before?'added':'removed')),numbers=visible.map(row=>before?row.old:row.line).filter(Number.isInteger);if(!numbers.length)continue;
   const start=Math.min(...numbers),end=Math.max(...numbers),info=canvasSourceAffordances(source,path,start,end),lines=new Set(numbers);
   const selections=[...info.functions.filter(fn=>lines.has(fn.start)).map(fn=>({line:fn.start,direction:'callers',symbol:fn.symbol})),...info.calls.filter(line=>lines.has(line)).map(line=>({line,direction:'callees'})),...info.tokens.filter(token=>lines.has(token.line)).map(token=>({line:token.line,column:token.column,symbol:token.symbol,direction:'callees'}))];
   for(const item of selections){const selection={path,snapshot,anchorId:block.id,level:0,...item},result=canvasSelection(change,selection,current,previous);connections.set(canvasConnectionKey(selection),{selection,result})}
   const prior=affordances[snapshot][block.key];affordances[snapshot][block.key]={...info,calls:[...new Set([...(prior?.calls||[]),...info.calls])],tokens:[...new Map([...(prior?.tokens||[]),...info.tokens].map(token=>[token.line+':'+token.column,token])).values()],variables:mergeVariableBindings(prior?.variables,info.variables)};
   if(snapshot===(block.deleted?'before':'after'))excerpts[block.id]={path,snapshot,anchorId:block.id,level:0,start,end,totalLines:source.index.files.get(path).split('\n').length};
  }
 }
 const nodes={},prepared=[];
 for(const [key,{selection,result}]of connections){
  const previews=Array.from({length:Math.ceil(result.relations.length/24)},(_,page)=>canvasConnectionPage(result,page).relations).flat();
  for(const {edges,...node}of previews)nodes[node.id]=node;
  prepared.push({key,selection,total:result.relations.length,targets:previews.map(node=>({id:node.id,edges:node.edges}))});
 }
 return {affordances,excerpts,connections:prepared,nodes,results:connections};
}
