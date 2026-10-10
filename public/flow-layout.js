// Give a callee's declaration the same vertical coordinate as its call site.
export function layoutFlow(steps,lineHeight=20){
  let offset=0;
  const layout=steps.map((step,i)=>{
    if(i&&step.relation==='call')offset+=(step.callerLine-steps[i-1].start-((step.entryLine||step.start)-step.start))*lineHeight;
    if(i&&step.relation!=='call')offset=0;
    return {...step,offset};
  });
  const shift=-Math.min(0,...layout.map(step=>step.offset));
  return layout.map(step=>({...step,offset:step.offset+shift}));
}
