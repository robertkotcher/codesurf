// Operations use offsets in the immutable base, never AI-authored replacement text.
export function reconstruct(base,operations,selected){
  let result='',cursor=0;
  for(const op of operations.filter(op=>selected.has(op.id)&&!op.metadata).sort((a,b)=>a.from-b.from||a.order-b.order)){
    if(op.from<cursor||base.slice(op.from,op.to)!==op.deleted)throw new Error('A transformation does not match the base document.');
    result+=base.slice(cursor,op.from)+op.insert;cursor=op.to;
  }
  return result+base.slice(cursor);
}
export function stateAt(plan,count){
  const ids=new Set(plan.steps.slice(0,count).flatMap(s=>s.ids)),state={};
  for(const file of plan.files){if(file.unavailable)continue;state[file.path]=reconstruct(file.before,plan.operations.filter(o=>o.path===file.path),ids)}
  return state;
}
export function validatePlan(plan){
  const ids=plan.steps.flatMap(s=>s.ids),expected=plan.operations.map(o=>o.id);
  if(ids.length!==expected.length||new Set(ids).size!==ids.length||expected.some(id=>!ids.includes(id)))throw new Error('Transformations must include every edit exactly once.');
  const state=stateAt(plan,plan.steps.length);
  for(const file of plan.files){if(!file.unavailable&&state[file.path]!==file.after)throw new Error('The transformations do not reconstruct '+file.path)}
  return !plan.files.some(f=>f.unavailable)&&!plan.limited;
}

export function manifestAt(plan,count){
  const selected=new Set(plan.steps.slice(0,count).flatMap(s=>s.ids));
  return plan.files.map(file=>{const ops=plan.operations.filter(o=>o.path===file.path),any=ops.some(o=>selected.has(o.id)),all=ops.every(o=>selected.has(o.id)),renamed=ops.some(o=>o.metadata&&selected.has(o.id));return {key:file.path,path:file.status==='renamed'&&!renamed?file.previousPath:file.path,exists:file.status==='added'?any:file.status==='removed'?!all:true}});
}

// Status compares this transformation to its immediate predecessor.
export function stepFiles(plan,count){
  const now=manifestAt(plan,count),before=manifestAt(plan,Math.max(0,count-1));
  const ids=new Set(plan.steps[count-1]?.ids||[]),changed=new Set(plan.operations.filter(o=>ids.has(o.id)).map(o=>o.path));
  return now.filter(f=>f.exists||(changed.has(f.key)&&before.find(b=>b.key===f.key)?.exists)).map(f=>{const prior=before.find(b=>b.key===f.key);return {...f,status:!changed.has(f.key)?'':!prior?.exists?'A':!f.exists?'D':prior.path!==f.path?'R':'M'}});
}
export function notesAt(plan,count,path){
  const selected=new Set(plan.steps.slice(0,count).flatMap(s=>s.ids));
  const operations=plan.operations.filter(o=>o.path===path&&!o.metadata&&selected.has(o.id)).sort((a,b)=>a.from-b.from||a.order-b.order);
  const text=stateAt(plan,count)[path]||'';let delta=0;const positions=new Map();
  for(const op of operations){positions.set(op.id,op.from+delta);delta+=op.insert.length-op.deleted.length}
  const notes=plan.steps.slice(0,count).flatMap(s=>s.notes||[]).filter(n=>positions.has(n.id)).map(n=>{const op=operations.find(o=>o.id===n.id);const prefix=n.side==='removed'?'':op.insert.split('\n').slice(0,n.start-1).join('\n')+(n.start>1?'\n':'');const line=text.slice(0,positions.get(n.id)+prefix.length).split('\n').length;return {...n,line:Math.min(line,text.split('\n').length),endLine:n.side==='removed'?line:line+n.end-n.start}});
  const rows=text.split('\n'),functions=new Map();
  for(const note of notes){for(let i=Math.min(note.line-1,rows.length-1);i>=0;i--){const match=rows[i].match(/(?:function\s+|def\s+)([\w$]+)/);if(match){functions.set(i+1,{line:i+1,endLine:i+1,side:'added',text:match[1]+' is the enclosing function. '+note.text});break}}}
  return [...functions.values(),...notes];
}
