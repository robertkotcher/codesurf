const generic=/^(?:review \d+ edits|apply \d+ added|review this code change|related file edits)/i;
const meaningful=row=>row.text.trim()&&!/^(?:[\s{}()[\];,]+|end\s*;?)$/.test(row.text.trim());
function concise(text){
 const first=String(text||'').replace(/\s+/g,' ').trim().split(/(?<=[.!?])\s+/)[0];
 if(!first||generic.test(first))return '';
 if(first.length<=220)return /[.!?]$/.test(first)?first:first+'.';
 return first.slice(0,217).replace(/\s+\S*$/,'').replace(/[,:;.!?]+$/,'')+'…';
}
export function stepCommentary(change){
 const candidates=change.blocks.filter(block=>!block.metadata).map(block=>{const row=block.rows.find(row=>row.kind==='added'&&meaningful(row))||block.rows.find(row=>row.kind==='removed'&&meaningful(row));return {block,row,text:concise(block.explanation)}}).filter(item=>item.row);
 const choice=concise(change.summary)?candidates[0]:candidates.find(item=>item.text)||candidates[0];if(!choice)return null;
 const text=choice.text||concise(change.summary);if(!text)return null;
 return {anchorId:choice.block.id,path:choice.block.path,line:choice.row.line??choice.row.old,snapshot:choice.row.kind==='removed'?'before':'after',text};
}
