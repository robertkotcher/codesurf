// Concrete source descriptions also cover saved reviews created without block explanations.
export function describeEdit(op,file={}){
 if(op.metadata)return file.status==='renamed'?`Rename ${file.previousPath} to ${file.path}.`:`Update ${op.path}'s file presence.`;
 const symbols=text=>[...text.matchAll(/(?:\bdef\s+(?:self\.)?|\b(?:async\s+)?function\s+|\bclass\s+)([\w$?!]+)/g)].map(m=>m[1]);
 const added=symbols(op.insert),removed=symbols(op.deleted);
 const context=symbols((file.before||'').slice(0,op.from||0)).at(-1);
 const meaningful=text=>text.split('\n').map(s=>s.trim()).filter(s=>s&&!/^(?:end|[{}()[\];,]+|(?:def|class|function)\b)/.test(s)&&!s.startsWith('//')&&!s.startsWith('#')).slice(0,2).join(' ').slice(0,180);
 const after=meaningful(op.insert),before=meaningful(op.deleted);
 const subject=added.length?added.join(', '):removed.length?removed.join(', '):context;
 if(!op.deleted)return `Add${subject?' '+subject:''}${after?': '+after:'.'}`;
 if(!op.insert)return `Remove${subject?' '+subject:''}${before?': '+before:'.'}`;
 return `${subject?'In '+subject+', replace':'Replace'} ${before||op.deleted.trim().slice(0,140)} with ${after||op.insert.trim().slice(0,140)}.`;
}
export function reviewBlocks(plan,count,path){
 const step=plan.steps[count-1];if(!step)return [];
 const allSelected=new Set(plan.steps.slice(0,count).flatMap(s=>s.ids)),current=new Set(step.ids),file=plan.files.find(f=>f.path===path);
 const operations=plan.operations.filter(o=>o.path===path&&!o.metadata&&allSelected.has(o.id)).sort((a,b)=>a.from-b.from||a.order-b.order);
 let delta=0;const blocks=[];
 for(const op of operations){const from=op.from+delta;delta+=op.insert.length-op.deleted.length;if(!current.has(op.id))continue;
 const note=step.blocks?.find(n=>n.id===op.id&&n.text?.trim());
 const legacy=step.ids.length===1&&(step.notes||[]).find(n=>n.id===op.id&&!/^(?:Apply \d+|Review \d+ edits)/.test(n.text||''));
 blocks.push({id:op.id,from,to:from+op.insert.length,text:note?.text||legacy?.text||describeEdit(op,file),label:note&&note.source!=='code'?'AI note':'Change note'});
 }
 return blocks;
}
