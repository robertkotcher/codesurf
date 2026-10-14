import {diffArrays} from 'diff';
import {stateAt,manifestAt} from './public/transformations.js';
const lines=text=>(text.match(/[^\n]*\n|[^\n]+$/g)||[]).length;
const sentence=text=>String(text||'').trim().split(/(?<=[.!?])\s+/)[0];
function excerpt(text,offset,length){const source=text.split('\n'),start=text.slice(0,offset).split('\n').length,end=text.slice(0,offset+length).split('\n').length,from=Math.max(1,start-3),to=Math.min(source.length,end+3);return {start,end,from,text:source.slice(from-1,to).join('\n')}}
export function canvasChanges(plan,count){
 const step=plan.steps[count-1];if(!step)return {title:'No changes',summary:'',blocks:[]};
 const before=stateAt(plan,count-1),after=stateAt(plan,count),manifest=manifestAt(plan,count),previousManifest=manifestAt(plan,count-1),prior=new Set(plan.steps.slice(0,count-1).flatMap(s=>s.ids)),current=new Set(step.ids),selected=new Set([...prior,...current]),blocks=[];
 for(const file of plan.files){if(file.unavailable)continue;let oldDelta=0,newDelta=0;
  for(const op of plan.operations.filter(o=>o.path===file.path).sort((a,b)=>a.from-b.from||a.order-b.order)){
   const oldOffset=op.from+oldDelta,newOffset=op.from+newDelta;
   if(prior.has(op.id)&&!op.metadata)oldDelta+=op.insert.length-op.deleted.length;
   if(selected.has(op.id)&&!op.metadata)newDelta+=op.insert.length-op.deleted.length;
   if(!current.has(op.id))continue;
   const old=excerpt(before[file.path]||'',oldOffset,op.deleted.length),now=excerpt(after[file.path]||'',newOffset,op.insert.length);
   let oldLine=old.from,newLine=now.from;const rows=[];
   if(!op.metadata)for(const part of diffArrays(old.text.split('\n'),now.text.split('\n')))for(const text of part.value)rows.push({kind:part.added?'added':part.removed?'removed':'context',old:part.added?null:oldLine++,line:part.removed?null:newLine++,text});
   const note=step.blocks?.find(b=>b.id===op.id&&b.source!=='code')?.text;
   blocks.push({id:op.id,path:manifest.find(f=>f.key===file.path)?.path||file.path,key:file.path,previousPath:previousManifest.find(f=>f.key===file.path)?.path||file.previousPath||file.path,summary:sentence(note||step.summary)||'Review this code change.',summaryAvailable:!!(note||step.summary),explanation:sentence(note),rows,added:lines(op.insert),removed:lines(op.deleted),masked:Math.max(lines(op.insert),lines(op.deleted))>1,metadata:!!op.metadata,deleted:!op.insert&&!!op.deleted,start:now.start,end:Math.max(now.start,now.end-(op.insert.endsWith('\n')?1:0)),oldStart:old.start,oldEnd:Math.max(old.start,old.end-(op.deleted.endsWith('\n')?1:0))});
  }
 }
 return {title:step.title,summary:sentence(step.summary),blocks};
}
