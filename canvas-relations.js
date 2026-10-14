import {callerDefinitionForBlock} from './public/canvas-affordances.js';
import {canvasConnectionKey} from './public/canvas-preload.js';
export {canvasConnectionKey} from './public/canvas-preload.js';
import {indexedCalls} from './browser/source-index.js';
export function validateCanvasSelection(selection){
 if(!selection||!['callers','callees'].includes(selection.direction)||!['before','after'].includes(selection.snapshot)||typeof selection.path!=='string'||selection.path.length>500||selection.path.split('/').some(part=>!part||part==='.'||part==='..')||/[\x00-\x1f\\]/.test(selection.path)||!Number.isInteger(selection.line)||selection.line<1||typeof selection.anchorId!=='string'||!selection.anchorId||selection.anchorId.length>1000||!Number.isInteger(selection.level)||Math.abs(selection.level)>8)throw Object.assign(new Error('Choose a code line and a connection direction.'),{status:400});
 return selection;
}
export function validateChangedSelection(change,selection){
 validateCanvasSelection(selection);
 const block=change.blocks.find(block=>block.id===selection.anchorId&&!block.metadata),before=selection.snapshot==='before';
 const row=block?.rows?.find(row=>(row.kind===(before?'removed':'added')||selection.direction==='callers'&&row.kind==='context')&&(before?row.old:row.line)===selection.line);
 const path=before?block?.previousPath||block?.path:block?.path;
 if(selection.level!==0||!row||selection.path!==path)throw Object.assign(new Error('Choose an added or removed code line in this change.'),{status:400});
 return block;
}
export function canvasSelection(change,selection,current,previous=null){
 const block=validateChangedSelection(change,selection);const source=selection.snapshot==='before'?previous:current;
 if(!source?.index.files.has(selection.path)||selection.line>source.index.files.get(selection.path).split('\n').length)throw Object.assign(new Error('This code line is unavailable in the selected review snapshot.'),{status:400});
 const {path,line,direction}=selection,level=selection.level+(direction==='callers'?-1:1),snapshot=selection.snapshot==='before'?'Before this change':'At this change';
 let root=null;try{root=indexedCalls(source.graph,{path,line,direction:'root'}).blocks[0]}catch{}
 if(direction==='callers'&&(!root||!callerDefinitionForBlock(block,[root],line,selection.snapshot))||direction==='callees'&&!source.graph.calls.some(call=>call.path===path&&call.line===line&&call.precision==='syntax'))throw Object.assign(new Error('Choose the signature of a function changed in this step for callers, or a changed function call for callees.'),{status:400});
 const result=indexedCalls(source.graph,{path,line,direction}),records=new Map();
 for(const target of result.blocks){
  if(target.precision!=='syntax'||target.ambiguous&&!source.graph.calls.some(call=>call.ruby&&call.receiver?.owner&&call.path===(direction==='callers'?target.path:path)&&call.line===(direction==='callers'?target.callLine:line)))continue;
  const key=direction+':'+target.path+':'+target.start+':'+snapshot+':'+level;
  const callLine=direction==='callers'?target.callLine:line,targetLine=direction==='callers'?root.start:target.start;
  const call=source.graph.calls.find(call=>call.path===path&&call.line===line),enclosing=source.graph.blocks.find(fn=>fn.path===path&&fn.start===call?.callerStart)||root;
  const edge={blockId:selection.anchorId,anchorLine:line,callLine,targetLine,...direction==='callers'?{targetSymbol:root.symbol}:{scope:'change',sourceSymbol:enclosing?.symbol||null}};
  if(records.has(key)){records.get(key).edges.push(edge);continue}
  records.set(key,{...target,id:key,direction,level,text:source.index.files.get(target.path).split('\n').slice(target.start-1,target.end).join('\n'),snapshot,changed:selection.snapshot==='after'&&change.blocks.some(block=>block.path===target.path&&!block.deleted&&block.start<=target.end&&block.end>=target.start),edges:[edge],affordances:{functions:source.graph.blocks.filter(fn=>fn.path===target.path&&fn.end>=target.start&&fn.start<=target.end).map(fn=>({start:fn.start,end:fn.end,symbol:fn.symbol})),calls:[...new Set(source.graph.calls.filter(call=>call.path===target.path&&call.line>=target.start&&call.line<=target.end).map(call=>call.line))]}});
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
 const affordances={before:{},after:{}},connections=new Map();
 for(const [snapshot,source]of [['before',previous],['after',current]]){
  if(!source)continue;
  for(const block of change.blocks){
   if(block.metadata)continue;
   const path=snapshot==='before'?block.previousPath||block.path:block.path;
   if(!source.index.files.has(path))continue;
   const functions=source.graph.blocks.filter(fn=>fn.path===path&&fn.precision==='syntax'&&!/^(?:anonymous|callback) at line /.test(fn.symbol)),calls=new Set();
   const changed=new Set(block.rows.filter(row=>row.kind===(snapshot==='before'?'removed':'added')).map(row=>snapshot==='before'?row.old:row.line));
   const selections=[...functions.filter(fn=>callerDefinitionForBlock(block,[fn],fn.start,snapshot)&&block.rows.some(row=>row.kind!==(snapshot==='before'?'added':'removed')&&(snapshot==='before'?row.old:row.line)===fn.start)).map(fn=>({line:fn.start,direction:'callers',symbol:fn.symbol})),...new Set(source.graph.calls.filter(call=>call.path===path&&changed.has(call.line)&&call.precision==='syntax').map(call=>call.line))].map(item=>typeof item==='number'?{line:item,direction:'callees'}:item);
   for(const item of selections){
    const selection={path,snapshot,anchorId:block.id,level:0,...item},result=canvasSelection(change,selection,current,previous);
    if(selection.direction==='callees'&&!result.relations.length)continue;
    if(selection.direction==='callees')calls.add(selection.line);
    connections.set(canvasConnectionKey(selection),{selection,result});
   }
   const prior=affordances[snapshot][block.key];affordances[snapshot][block.key]={path,functions:functions.map(({start,end,symbol})=>({start,end,symbol})),calls:[...new Set([...(prior?.calls||[]),...calls])]};
  }
 }
 const nodes={},prepared=[];
 for(const [key,{selection,result}]of connections){
  const previews=Array.from({length:Math.ceil(result.relations.length/24)},(_,page)=>canvasConnectionPage(result,page).relations).flat();
  for(const {edges,...node}of previews)nodes[node.id]=node;
  prepared.push({key,selection,total:result.relations.length,targets:previews.map(node=>({id:node.id,edges:node.edges}))});
 }
 return {affordances,connections:prepared,nodes,results:connections};
}
