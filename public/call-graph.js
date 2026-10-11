// Lightweight source matching: candidates, rather than resolved runtime dispatch.
const declaration=/\b(?:function\s+|def\s+)([\w$]+)\s*\(|\b(?:const|let|var)\s+([\w$]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[\w$]+)\s*=>|^\s*(?:async\s+)?([\w$]+)\s*\([^;]*\)\s*(?::[^=]+)?\s*\{/;
const ignored=new Set(['if','for','while','switch','catch','with','return','function','def']);
export function sourceBlocks(files){
 const blocks=[];
 for(const [path,text] of files){const rows=text.split('\n');for(let i=0;i<rows.length;i++){const m=rows[i].match(declaration),symbol=m&&(m[1]||m[2]||m[3]);if(!symbol||ignored.has(symbol))continue;
 let end=i,depth=0,opened=false;const indent=rows[i].search(/\S/),python=/\bdef\s/.test(rows[i]);
 for(let j=i;j<rows.length;j++){if(python){if(j>i&&rows[j].trim()&&rows[j].search(/\S/)<=indent)break;end=j;continue}for(const c of rows[j].replace(/(['"`]).*?\1/g,'')){if(c==='{'){depth++;opened=true}if(c==='}')depth--}end=j;if(opened&&depth<=0)break;if(!opened&&j>i+4)break;}
 blocks.push({path,start:i+1,end:end+1,symbol,text:rows.slice(i,end+1).join('\n')});
 }}return blocks;
}
export function exploreCalls(files,{path,line,direction='root'}){
 const blocks=sourceBlocks(files),rows=files.get(path)?.split('\n');if(!rows)throw new Error('Source file is unavailable.');
 line=Number(line);if(!Number.isInteger(line)||line<1||line>rows.length)throw new Error('Select a valid source line.');
 const enclosing=blocks.filter(b=>b.path===path&&b.start<=line&&b.end>=line).sort((a,b)=>(a.end-a.start)-(b.end-b.start))[0];
 const root=enclosing||{path,start:Math.max(1,line-4),end:Math.min(rows.length,line+12),symbol:path.split('/').pop(),text:rows.slice(Math.max(0,line-5),line+12).join('\n')};
 if(direction==='root')return {blocks:[root],total:1};
 let matches=[];
 if(direction==='callers'){
 const escaped=root.symbol.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),pattern=new RegExp('(?:^|[^\\w$])'+escaped+'\\s*\\(');
 for(const [callerPath,source] of files)source.split('\n').forEach((row,i)=>{if(!pattern.test(row)||blocks.some(b=>b.path===callerPath&&b.start===i+1&&b.symbol===root.symbol))return;
 const block=blocks.filter(b=>b.path===callerPath&&b.start<=i+1&&b.end>=i+1).sort((a,b)=>(a.end-a.start)-(b.end-b.start))[0];
 if(block)matches.push({...block,callLine:i+1});else matches.push({path:callerPath,start:Math.max(1,i-3),end:i+1,symbol:'Top level',text:source.split('\n').slice(Math.max(0,i-4),i+1).join('\n'),callLine:i+1});});
 }else if(direction==='callees'){
 const names=[...rows[line-1].matchAll(/\b([\w$]+)\s*\(/g)].map(m=>m[1]).filter(n=>!ignored.has(n));
 matches=blocks.filter(b=>names.includes(b.symbol)&&!(b.path===path&&b.start===line)).map(b=>({...b,callLine:line}));
 }else throw new Error('Unknown expansion direction.');
 const unique=[...new Map(matches.map(b=>[b.path+':'+b.start,b])).values()];return {blocks:unique.slice(0,40),total:unique.length};
}
