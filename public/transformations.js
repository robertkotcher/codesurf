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
