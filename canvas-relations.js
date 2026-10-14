import {indexedCalls} from './browser/source-index.js';
export function validateCanvasSelection(selection){
 if(!selection||!['callers','callees'].includes(selection.direction)||!['before','after'].includes(selection.snapshot)||typeof selection.path!=='string'||selection.path.length>500||selection.path.split('/').some(part=>!part||part==='.'||part==='..')||/[\x00-\x1f\\]/.test(selection.path)||!Number.isInteger(selection.line)||selection.line<1||typeof selection.anchorId!=='string'||!selection.anchorId||selection.anchorId.length>1000||!Number.isInteger(selection.level)||Math.abs(selection.level)>8)throw Object.assign(new Error('Choose a code line and a connection direction.'),{status:400});
 return selection;
}
export function validateChangedSelection(change,selection){
 validateCanvasSelection(selection);
 const block=change.blocks.find(block=>block.id===selection.anchorId&&!block.metadata),before=selection.snapshot==='before';
 const row=block?.rows?.find(row=>row.kind===(before?'removed':'added')&&(before?row.old:row.line)===selection.line);
 const path=before?block?.previousPath||block?.path:block?.path;
 if(selection.level!==0||!row||selection.path!==path)throw Object.assign(new Error('Choose an added or removed code line in this change.'),{status:400});
 return block;
}
export function canvasSelection(change,selection,current,previous=null){
 validateChangedSelection(change,selection);const source=selection.snapshot==='before'?previous:current;
 if(!source?.index.files.has(selection.path)||selection.line>source.index.files.get(selection.path).split('\n').length)throw Object.assign(new Error('This code line is unavailable in the selected review snapshot.'),{status:400});
 const {path,line,direction}=selection,level=selection.level+(direction==='callers'?-1:1),snapshot=selection.snapshot==='before'?'Before this change':'At this change';
 let root=null;try{root=indexedCalls(source.graph,{path,line,direction:'root'}).blocks[0]}catch{}
 if(direction==='callers'&&root?.start!==line||direction==='callees'&&!source.graph.calls.some(call=>call.path===path&&call.line===line))throw Object.assign(new Error('Choose a changed function definition for callers or a changed function call for callees.'),{status:400});
 const result=indexedCalls(source.graph,{path,line,direction}),records=new Map();
 for(const target of result.blocks){
  const key=direction+':'+target.path+':'+target.start+':'+snapshot+':'+level;
  const callLine=direction==='callers'?target.callLine:line,targetLine=direction==='callers'?root.start:target.start;
  const call=source.graph.calls.find(call=>call.path===path&&call.line===line),enclosing=source.graph.blocks.find(fn=>fn.path===path&&fn.start===call?.callerStart)||root;
  const edge={blockId:selection.anchorId,anchorLine:line,callLine,targetLine,...direction==='callers'?{targetSymbol:root.symbol}:{scope:'change',sourceSymbol:enclosing?.symbol||null}};
  if(records.has(key)){records.get(key).edges.push(edge);continue}
  records.set(key,{...target,id:key,direction,level,text:source.index.files.get(target.path).split('\n').slice(target.start-1,target.end).join('\n'),snapshot,changed:selection.snapshot==='after'&&change.blocks.some(block=>block.path===target.path&&!block.deleted&&block.start<=target.end&&block.end>=target.start),edges:[edge],affordances:{functions:source.graph.blocks.filter(fn=>fn.path===target.path&&fn.end>=target.start&&fn.start<=target.end).map(fn=>({start:fn.start,end:fn.end,symbol:fn.symbol})),calls:[...new Set(source.graph.calls.filter(call=>call.path===target.path&&call.line>=target.start&&call.line<=target.end).map(call=>call.line))]}});
 }
 return {relations:[...records.values()],unresolved:0};
}
