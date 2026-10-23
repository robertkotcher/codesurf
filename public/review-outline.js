// Shared by the server and browser, including older saved reviews without labels.
export function shortChangeTitle(value){
 const words=String(value||'Review this change').replace(/\s+/gu,' ').trim().split(' ').filter(Boolean);
 if(!words.length)return 'Review this change';
 return words.length>10?words.slice(0,10).join(' ').replace(/[,:;.!?]+$/u,'')+'…':words.join(' ');
}
export function reviewOutline(plan,count=0){
 if(!plan)return [];
 const steps=plan.steps||[],story=(plan.story||[]).filter(chapter=>Array.isArray(chapter.ids)&&chapter.ids.length),covered=new Set(story.flatMap(chapter=>chapter.ids)),groups=story.length?[...steps.filter(step=>!step.ids.some(id=>covered.has(id))),...story]:steps;
 const reviewed=new Set(steps.slice(0,count).flatMap(step=>step.ids)),activeID=steps[count-1]?.ids[0];
 return groups.map((group,index)=>({number:index+1,title:shortChangeTitle(group.shortTitle||group.title),active:!!activeID&&group.ids.includes(activeID),reviewed:group.ids.every(id=>reviewed.has(id)),step:steps.findIndex(step=>step.ids.some(id=>group.ids.includes(id)))+1}));
}
