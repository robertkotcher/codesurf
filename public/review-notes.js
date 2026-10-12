export function reviewBlocks(plan,count,path){
 const step=plan.steps[count-1];if(!step)return [];
 const allSelected=new Set(plan.steps.slice(0,count).flatMap(s=>s.ids)),current=new Set(step.ids);
 const operations=plan.operations.filter(o=>o.path===path&&!o.metadata&&allSelected.has(o.id)).sort((a,b)=>a.from-b.from||a.order-b.order);
 let delta=0;const blocks=[];
 for(const op of operations){const from=op.from+delta;delta+=op.insert.length-op.deleted.length;if(!current.has(op.id))continue;
 const note=step.blocks?.find(n=>n.id===op.id&&n.source!=='code'&&n.text?.trim());
 if(note)blocks.push({id:op.id,from,to:from+op.insert.length,text:note.text,label:'AI note'});
 }
 return blocks;
}
