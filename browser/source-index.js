import {parser as javascript} from '@lezer/javascript';
import {parser as python} from '@lezer/python';
import {sourceBlocks} from '../public/call-graph.js';
const warmed=new WeakMap(),js=javascript.configure({dialect:'ts jsx'});
const functionKinds=new Set(['FunctionDeclaration','FunctionExpression','ArrowFunction','MethodDeclaration','FunctionDefinition','LambdaExpression']);
function fileIndex(path,text){
 const language=/\.[cm]?[jt]sx?$/.test(path)?'javascript':/\.py$/.test(path)?'python':null;
 const starts=[0];for(let i=0;i<text.length;i++)if(text[i]==='\n')starts.push(i+1);
 const lineAt=offset=>{let l=0,r=starts.length;while(l+1<r){const m=(l+r)>>1;if(starts[m]<=offset)l=m;else r=m}return l+1};
 const blocks=[],calls=[];
 if(!language){const blocks=sourceBlocks(new Map([[path,text]])).map(b=>({...b,precision:'heuristic'}));for(const m of text.matchAll(/\b([\w$]+(?:\.[\w$]+)*)\s*\(/g)){const line=lineAt(m.index);if(['if','for','while','catch','switch','with'].includes(m[1])||blocks.some(b=>b.start===line))continue;calls.push({path,line,symbol:m[1].split('.').at(-1),expression:m[1],precision:'heuristic'})}return {blocks,calls,language:'heuristic'};}
 const tree=(language==='python'?python:js).parse(text);
 function visit(node,parentBlock=null){let enclosing=parentBlock;
 if(functionKinds.has(node.name)){
 let name=node.name==='ArrowFunction'?null:node.getChild('VariableDefinition')||node.getChild('PropertyDefinition')||node.getChild('VariableName');
 let symbol=name?text.slice(name.from,name.to):null;
 if(!symbol&&node.name==='ArrowFunction'){let prev=node.prevSibling;while(prev&&!['VariableDefinition','PropertyDefinition'].includes(prev.name))prev=prev.prevSibling;if(prev)symbol=text.slice(prev.from,prev.to)}
 if(!symbol){const parent=node.parent;symbol=parent?.name==='ArgList'?'callback at line '+lineAt(node.from):'anonymous at line '+lineAt(node.from)}
 const start=lineAt(node.from),end=lineAt(Math.max(node.from,node.to-1));
 enclosing={path,start,end,symbol,from:node.from,to:node.to,precision:'syntax',text:text.slice(starts[start-1],node.to)};blocks.push(enclosing);
 }
 if(node.name==='CallExpression'){
 const callee=node.firstChild,expression=callee?text.slice(callee.from,callee.to):'',symbol=expression.match(/([\w$]+)\s*$/)?.[1];
 if(symbol)calls.push({path,line:lineAt(node.from),symbol,expression,callerStart:enclosing?.start??null,precision:'syntax'});
 }
 for(let child=node.firstChild;child;child=child.nextSibling)visit(child,enclosing);
 }
 visit(tree.topNode);tree.delete?.();return {blocks,calls,language};
}
export function buildCallIndex(files){
 if(warmed.has(files))return warmed.get(files);
 const blocks=[],calls=[],languages={};for(const [path,text]of files){if(!/\.(?:[cm]?[jt]sx?|py|rb|go|rs|java|c|cc|cpp|h|hpp|cs|php|swift|kt)$/.test(path))continue;const result=fileIndex(path,text);blocks.push(...result.blocks);calls.push(...result.calls);languages[result.language]=(languages[result.language]||0)+1;}
 const symbols=new Map();for(const b of blocks){const list=symbols.get(b.symbol)||[];list.push(b);symbols.set(b.symbol,list)}
 const edges=[],importsByPath=new Map([...files].map(([path,source])=>[path,[...source.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g)]]));
 for(const call of calls){let targets=symbols.get(call.symbol)||[];const same=targets.filter(b=>b.path===call.path);if(same.length)targets=same;
 // Resolve named relative imports before considering same-named definitions elsewhere.
 const imports=importsByPath.get(call.path)||[];
 for(const match of imports){for(const binding of match[1].split(',')){const [original,alias=original]=binding.trim().split(/\s+as\s+/);if(alias!==call.symbol||!match[2].startsWith('.'))continue;const segments=call.path.split('/').slice(0,-1);for(const part of match[2].split('/')){if(part==='..')segments.pop();else if(part!=='.')segments.push(part)}const imported=segments.join('/');targets=(symbols.get(original)||[]).filter(b=>b.path===imported||b.path.replace(/\.[cm]?[jt]sx?$/,'')===imported||b.path.replace(/\/index\.[cm]?[jt]sx?$/,'')===imported);}}
 for(const target of targets)edges.push({...call,targetPath:target.path,targetStart:target.start,ambiguous:targets.length>1});
 }
 const index={blocks,edges,languages};warmed.set(files,index);return index;
}
export function indexedCalls(index,{path,line,direction='root',symbol}){
 line=Number(line);let root=index.blocks.filter(b=>b.path===path&&(symbol?b.symbol===symbol:b.start<=line&&b.end>=line)).sort((a,b)=>symbol?Math.abs(a.start-line)-Math.abs(b.start-line):(a.end-a.start)-(b.end-b.start))[0];
 if(direction==='root'){if(!root)throw new Error('No function found at this selection. Select a function declaration or body.');return {blocks:[root],total:1};}
 let results=[];
 if(direction==='callers'){
 if(!root)return {blocks:[],total:0};
 for(const edge of index.edges.filter(e=>e.targetPath===root.path&&e.targetStart===root.start)){const caller=index.blocks.find(b=>b.path===edge.path&&b.start===edge.callerStart)||index.blocks.filter(b=>b.path===edge.path&&b.start<=edge.line&&b.end>=edge.line).sort((a,b)=>(a.end-a.start)-(b.end-b.start))[0];if(caller)results.push({...caller,callLine:edge.line,ambiguous:edge.ambiguous});else results.push({path:edge.path,start:Math.max(1,edge.line-3),end:edge.line,symbol:'Top level',callLine:edge.line,precision:edge.precision});}
 }else if(direction==='callees')for(const edge of index.edges.filter(e=>e.path===path&&e.line===line)){const target=index.blocks.find(b=>b.path===edge.targetPath&&b.start===edge.targetStart);if(target)results.push({...target,callLine:line,ambiguous:edge.ambiguous})}
 else throw new Error('Unknown expansion direction.');
 const unique=[...new Map(results.map(b=>[b.path+':'+b.start,b])).values()];return {blocks:unique,total:unique.length};
}
