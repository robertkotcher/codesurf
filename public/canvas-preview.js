// Keep surrounding source and both diff colors visible in a compact overview.
export function previewRows(rows){
 const result=[];
 for(let start=0;start<rows.length;){
  const kind=rows[start].kind;let end=start+1;while(end<rows.length&&rows[end].kind===kind)end++;
  const kept=new Set();
  if(kind==='context'||end-start<=4)for(let i=start;i<end;i++)kept.add(i);
  else{kept.add(start);kept.add(start+1);kept.add(end-1);for(let i=start;i<end;i++){if(rows[i].text.trim()&&!/^(?:[\s{}()[\];,]+|end\s*;?)$/.test(rows[i].text.trim())){kept.add(i);break}}}
  let omitted=0;for(let i=start;i<end;i++){if(kept.has(i)){if(omitted){result.push({kind,omitted});omitted=0}result.push({row:rows[i],index:i})}else omitted++}if(omitted)result.push({kind,omitted});
  start=end;
 }
 return result;
}

export function displayCodeRows(rows,{preview=false,expandedRemoved=new Set()}={}){
 const result=[];
 for(let start=0;start<rows.length;){
  const kind=rows[start].kind;let end=start+1;while(end<rows.length&&rows[end].kind===kind)end++;
  if(kind==='removed'){
   const expanded=expandedRemoved.has(start);
   result.push({removed:true,index:start,count:end-start,from:rows[start].old??rows[start].line,to:rows[end-1].old??rows[end-1].line,expanded});
   if(expanded)for(let index=start;index<end;index++)result.push({row:rows[index],index,removedExpanded:true});
  }else{
   const group=rows.slice(start,end),visible=preview?previewRows(group):group.map((row,index)=>({row,index}));
   result.push(...visible.map(item=>item.row?{...item,index:item.index+start}:item));
  }
  start=end;
 }
 return result;
}
