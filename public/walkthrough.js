// Every +/- line belongs to exactly one chunk. Context can repeat between chunks.
export function changeChunks(files){
  const chunks=[];
  for(const file of files){
    let old=0,line=0,rows=[];
    const flush=()=>{if(rows.some(r=>r.kind!=='context'))chunks.push({id:'change-'+chunks.length,path:file.path,status:file.status,rows,added:rows.filter(r=>r.kind==='add').length,removed:rows.filter(r=>r.kind==='del').length});rows=[]};
    for(const text of (file.patch||'').split('\n')){
      const h=text.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if(h){flush();old=+h[1];line=+h[2];continue}
      if(!old&&!line)continue;
      if(text[0]==='+')rows.push({kind:'add',line:line++,text:text.slice(1)});
      else if(text[0]==='-')rows.push({kind:'del',old:old++,text:text.slice(1)});
      else if(text[0]===' ')rows.push({kind:'context',line:line++,old:old++,text:text.slice(1)});
      if(rows.length>=45){const context=rows.slice(-2).filter(r=>r.kind==='context');flush();rows=context}
    }
    flush();
    if(!file.patch)chunks.push({id:'change-'+chunks.length,path:file.path,status:file.status,rows:[],added:file.additions||0,removed:file.deletions||0,unavailable:true});
  }
  return chunks;
}
export function completeCards(chunks,groups=[]){
  const remaining=new Map(chunks.map(c=>[c.id,c])),cards=[];
  for(const group of groups){const parts=[];for(const id of group.ids||[]){if(remaining.has(id)){parts.push(remaining.get(id));remaining.delete(id)}}if(parts.length)for(let offset=0;offset<parts.length;){let end=offset,total=0;while(end<parts.length&&(end===offset||total+parts[end].added+parts[end].removed<=60)){total+=parts[end].added+parts[end].removed;end++}cards.push({title:String(group.title||'Related changes').slice(0,100),summary:String(group.summary||'').slice(0,350),chunks:parts.slice(offset,end)});offset=end}}
  for(const chunk of remaining.values())cards.push({title:chunk.path.split('/').pop(),summary:chunk.unavailable?'Diff unavailable: inspect this file on GitHub before completing the review.':`${chunk.added} added and ${chunk.removed} removed lines in ${chunk.path}. Review this focused part of the change.`,chunks:[chunk]});
  return cards;
}
