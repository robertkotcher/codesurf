import {indexedCalls} from './source-index.js';
// The parser resolves relationships; the model only chooses what to explore.
export function functionPeeks(index,{path,line,direction='body'}){
 if(typeof path!=='string'||path.split('/').some(part=>part==='..'))throw new Error('Choose a valid source file.');
 if(!Number.isInteger(line)||line<1||!['body','callers','callees'].includes(direction))throw Object.assign(new Error('Choose a source line and callers, callees or body.'),{status:400});
 let root;try{root=indexedCalls(index,{path,line,direction:'root'}).blocks[0]}catch(error){throw Object.assign(error,{status:400})}
 let blocks=[],total=0;
 if(direction==='body')blocks=[root];
 else if(direction==='callers'){const result=indexedCalls(index,{path,line:root.start,direction});blocks=result.blocks;total=result.total;}
 else {
  const calls=index.calls.filter(call=>call.path===path&&(call.callerStart===root.start||call.callerStart==null&&call.line>=root.start&&call.line<=root.end));
  const seen=new Set();
  for(const call of calls){for(const block of indexedCalls(index,{path,line:call.line,direction:'callees'}).blocks){const key=block.path+':'+block.start+':'+call.line;if(!seen.has(key)){seen.add(key);blocks.push(block)}}}
  total=blocks.length;
 }
 return {direction,root,blocks:blocks.slice(0,8),total:direction==='body'?1:total,limited:blocks.length>8};
}
