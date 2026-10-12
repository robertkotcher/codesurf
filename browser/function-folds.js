// Keep small edits readable; compact files with several substantial changed methods.
export function defaultFunctionFolds(doc,blocks,chunks){
 const changedLines=chunks.reduce((sum,c)=>sum+doc.lineAt(Math.min(doc.length,Math.max(c.fromB,c.toB-1))).number-doc.lineAt(Math.min(c.fromB,doc.length)).number+1,0);
 const changed=blocks.filter(b=>b.end-b.start>=3&&chunks.some(c=>{const start=doc.lineAt(Math.min(c.fromB,doc.length)).number,end=doc.lineAt(Math.min(doc.length,Math.max(c.fromB,c.toB-1))).number;return start<=b.end&&end>=b.start}));
 const outer=changed.filter(b=>!changed.some(parent=>parent!==b&&parent.start<=b.start&&parent.end>=b.end&&(parent.start<b.start||parent.end>b.end)));
 if(outer.length<3&&(outer.length<2||changedLines<40))return [];
 return outer.map(b=>({from:doc.line(b.start).to,to:doc.line(Math.min(b.end-1,doc.lines)).to})).filter(r=>r.to>r.from);
}
