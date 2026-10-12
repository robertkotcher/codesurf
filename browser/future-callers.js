import {indexedCalls} from './source-index.js';
// Compare parser-resolved callers by identity and call text, not shifting line numbers.
export function futureCallers(current,final,root,currentFiles,finalFiles,aliases=[]){
 const paths=new Set([root.path,...aliases]);
 const match=index=>{const candidates=index.blocks.filter(b=>paths.has(b.path)&&b.symbol===root.symbol&&b.owner===root.owner&&b.methodKind===root.methodKind);return candidates.length===1?candidates[0]:null};
 const headRoot=match(final);if(!headRoot)return {checked:true,total:0,blocks:[]};
 const callers=(index,block)=>block?indexedCalls(index,{path:block.path,line:block.start,direction:'callers'}).blocks:[];
 const key=(b,files)=>JSON.stringify([b.path,b.owner,b.methodKind,b.symbol,files.get(b.path)?.split('\n')[b.callLine-1]?.trim()]);
 const existing=new Set(callers(current,match(current)).map(b=>key(b,currentFiles)));
 const pending=callers(final,headRoot).filter(b=>!existing.has(key(b,finalFiles)));
 const total=pending.length;
 return {checked:true,total,blocks:pending.slice(0,8).map(({path,start,end,symbol,callLine})=>({path,start,end,symbol,callLine,snapshot:'PR head · later review changes'})),message:total?`${total===1?'A caller exists':total+' callers exist'} in the final PR, but ${total===1?"it hasn't":"they haven't"} appeared in the applied review changes yet. You'll see ${total===1?'it':'them'} in a later change.`:undefined};
}
