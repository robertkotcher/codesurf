export const lineCount=text=>(text?.match(/[^\n]*\n|[^\n]+$/g)||[]).length;
export function stepChangeCounts(plan,count,path){
 const ids=new Set(plan.steps[count-1]?.ids||[]);
 return plan.operations.filter(o=>o.path===path&&ids.has(o.id)&&!o.metadata).reduce((counts,o)=>({added:counts.added+lineCount(o.insert),removed:counts.removed+lineCount(o.deleted)}),{added:0,removed:0});
}
