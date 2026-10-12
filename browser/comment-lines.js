import {diffArrays} from 'diff';
export function commentLines(current,head,start,end=start){
 let oldLine=1,newLine=1;const mapped=new Map();
 for(const chunk of diffArrays(current.split('\n'),head.split('\n'))){
  if(chunk.added){newLine+=chunk.value.length;continue}
  if(chunk.removed){oldLine+=chunk.value.length;continue}
  for(let i=0;i<chunk.value.length;i++)mapped.set(oldLine++,newLine++);
 }
 const first=mapped.get(start),last=mapped.get(end);if(!first||!last||last-first!==end-start)return null;
 for(let line=start;line<=end;line++)if(mapped.get(line)!==first+line-start)return null;
 return {start:first,end:last};
}
