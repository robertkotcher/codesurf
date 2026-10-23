import {rubyIndex} from './ruby-parser.js';
export {initCallParsers} from './ruby-parser.js';
import {parser as javascript} from '@lezer/javascript';
import {parser as python} from '@lezer/python';
import {sourceBlocks} from '../public/call-graph.js';
const warmed=new WeakMap(),lookups=new WeakMap(),siteCache=new WeakMap(),js=javascript.configure({dialect:'ts jsx'});
const functionKinds=new Set(['FunctionDeclaration','FunctionExpression','ArrowFunction','MethodDeclaration','FunctionDefinition','LambdaExpression']);
function fileIndex(path,text){
 if(/\.rb$/.test(path))return rubyIndex(path,text);
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
 const callee=node.firstChild,expression=callee?text.slice(callee.from,callee.to):'',name=expression.match(/([\w$]+)\s*$/),symbol=name?.[1];
 if(symbol)calls.push({path,line:lineAt(callee.from+name.index),column:callee.from+name.index-starts[lineAt(callee.from+name.index)-1],endColumn:callee.from+name.index-starts[lineAt(callee.from+name.index)-1]+symbol.length,symbol,expression:expression.slice(0,200),callerStart:enclosing?.start??null,precision:'syntax',ambiguous:!/^[$\w]+$/.test(expression)});
 }
 for(let child=node.firstChild;child;child=child.nextSibling)visit(child,enclosing);
 }
 visit(tree.topNode);tree.delete?.();return {blocks,calls,language};
}
export function buildCallIndex(files){
 if(warmed.has(files))return warmed.get(files);
 const blocks=[],calls=[],owners=[],languages={};for(const [path,text]of files){if(!/\.(?:[cm]?[jt]sx?|py|rb|go|rs|java|c|cc|cpp|h|hpp|cs|php|swift|kt)$/.test(path))continue;const result=fileIndex(path,text);blocks.push(...result.blocks);calls.push(...result.calls);owners.push(...result.owners||[]);languages[result.language]=(languages[result.language]||0)+1;}
 const imports=[...files].map(([path,source])=>[path,[...source.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g)].map(m=>[null,m[1],m[2]])]);
 const index=resolveIndex(blocks,calls,imports,languages,owners);warmed.set(files,index);return index;
}
function resolveIndex(blocks,calls,imports,languages,owners=[]){return {blocks,calls,imports,languages,owners}}
function callLookup(index){
 if(lookups.has(index))return lookups.get(index);
 const symbols=new Map(),bySymbol=new Map(),byLine=new Map(),aliases=new Map(),ownersByName=new Map();
 for(const owner of index.owners||[]){const records=ownersByName.get(owner.owner)||[];records.push(owner);ownersByName.set(owner.owner,records)}
 for(const block of index.blocks){const list=symbols.get(block.symbol)||[];list.push(block);symbols.set(block.symbol,list)}
 for(const call of index.calls){for(const [map,key]of [[bySymbol,call.symbol],[byLine,call.path+':'+call.line]]){const list=map.get(key)||[];list.push(call);map.set(key,list)}}
 for(const [,bindings]of index.imports)for(const match of bindings)for(const binding of match[1].split(',')){const [original,alias=original]=binding.trim().split(/\s+as\s+/);const names=aliases.get(original)||new Set();names.add(alias);aliases.set(original,names)}
 const value={symbols,bySymbol,byLine,aliases,ownersByName,importsByPath:new Map(index.imports),owners:new Set([...index.blocks.filter(block=>block.owner).map(block=>block.owner),...(index.owners||[]).map(item=>item.owner)])};lookups.set(index,value);return value;
}
function resolveEdges(index,root,path,line,direction,column){
 const {blocks}=index,{symbols,bySymbol,byLine,aliases,importsByPath,owners,ownersByName}=callLookup(index);
 const names=new Set([root?.symbol,...(aliases.get(root?.symbol)||[])]);
 const calls=direction==='callers'?[...new Set([...names].flatMap(name=>bySymbol.get(name)||[]))]:byLine.get(path+':'+line)||[];
 const edges=[];
 for(const call of calls){if(direction==='callees'&&column!==undefined&&call.column!==column)continue;let targets=symbols.get(call.symbol)||[];
 if(call.ruby){
  const receiver=call.receiver;
  if(receiver){let owner=receiver.owner;if(receiver.namespace&&!owner.includes('::')){const parts=receiver.namespace.split('::');while(parts.length){const candidate=parts.join('::')+'::'+owner;if(owners.has(candidate)){owner=candidate;break}parts.pop()}}
   // Ruby dispatch: prepends, own methods, includes (last wins), then superclass.
   // Keep metadata for empty/reopened classes, rather than inferring ancestry from methods.
   const qualify=(name,namespace)=>{if(!name)return null;if(name.startsWith('::'))return name.slice(2);const parts=(namespace||'').split('::').filter(Boolean);while(parts.length){const candidate=parts.join('::')+'::'+name;if(owners.has(candidate))return candidate;parts.pop()}return name};
   const seen=new Set();
   function dispatch(owner,kind){const key=owner+':'+kind;if(!owner||seen.has(key))return [];seen.add(key);const records=ownersByName.get(owner)||[],modules=field=>records.flatMap(item=>(item[field]||[]).map(name=>qualify(name,item.owner))).reverse();
    for(const mixin of kind==='instance'?modules('prepends'):[]){const found=dispatch(mixin,'instance');if(found.length)return found}
    const own=targets.filter(b=>b.owner===owner&&b.methodKind===kind);if(own.length)return own;
    for(const mixin of modules(kind==='class'?'extends':'includes')){const found=dispatch(mixin,'instance');if(found.length)return found}
    const declaration=records.findLast(item=>item.parentClass),parent=declaration?.parentClass||(records.length?null:blocks.find(b=>b.owner===owner&&b.parentClass)?.parentClass);
    return dispatch(qualify(parent,declaration?.namespace??owner.split('::').slice(0,-1).join('::')),kind);
   }
   targets=dispatch(owner,receiver.kind);
  }else targets=call.explicitReceiver?[]:targets.filter(b=>!b.owner&&b.path===call.path);
 }else{const same=targets.filter(b=>b.path===call.path);if(same.length)targets=same;}
 // Resolve named relative imports before considering same-named definitions elsewhere.
 const imports=importsByPath.get(call.path)||[];
 for(const match of imports){for(const binding of match[1].split(',')){const [original,alias=original]=binding.trim().split(/\s+as\s+/);if(alias!==call.symbol||!match[2].startsWith('.'))continue;const segments=call.path.split('/').slice(0,-1);for(const part of match[2].split('/')){if(part==='..')segments.pop();else if(part!=='.')segments.push(part)}const imported=segments.join('/');targets=(symbols.get(original)||[]).filter(b=>b.path===imported||b.path.replace(/\.[cm]?[jt]sx?$/,'')===imported||b.path.replace(/\/index\.[cm]?[jt]sx?$/,'')===imported);}}
 for(const target of targets)if(direction!=='callers'||target.path===root.path&&target.start===root.start)edges.push({...call,targetPath:target.path,targetStart:target.start,ambiguous:!!call.ambiguous||targets.length>1});
 }
 return edges;
}
// Replace changed file definitions/call sites, then resolve edges against the
// complete base index so unchanged callers follow the displayed review state.
export function overlayCallIndex(base,overrides){
 const changed=buildCallIndex(new Map([...overrides].filter(([,text])=>text!==null))),paths=new Set(overrides.keys());
 return resolveIndex([...base.blocks.filter(b=>!paths.has(b.path)),...changed.blocks], [...base.calls.filter(c=>!paths.has(c.path)),...changed.calls], [...base.imports.filter(([path])=>!paths.has(path)),...changed.imports],base.languages,[...(base.owners||[]).filter(item=>!paths.has(item.path)),...changed.owners]);
}
export function indexedCalls(index,{path,line,direction='root',symbol,column}){
 line=Number(line);let root=index.blocks.filter(b=>b.path===path&&(symbol?b.symbol===symbol:b.start<=line&&b.end>=line)).sort((a,b)=>symbol?Math.abs(a.start-line)-Math.abs(b.start-line):(a.end-a.start)-(b.end-b.start))[0];
 if(direction==='root'){if(!root)throw new Error('No function found at this selection. Select a function declaration or body.');return {blocks:[root],total:1};}
 if(direction==='callers'&&!root)return {blocks:[],total:0};
 const edges=resolveEdges(index,root,path,line,direction,column);let results=[];
 if(direction==='callers'){
 if(!root)return {blocks:[],total:0};
 for(const edge of edges.filter(e=>e.targetPath===root.path&&e.targetStart===root.start)){const caller=index.blocks.find(b=>b.path===edge.path&&b.start===edge.callerStart)||index.blocks.filter(b=>b.path===edge.path&&b.start<=edge.line&&b.end>=edge.line).sort((a,b)=>(a.end-a.start)-(b.end-b.start))[0];if(caller)results.push({...caller,callLine:edge.line,ambiguous:edge.ambiguous});else results.push({path:edge.path,start:Math.max(1,edge.line-3),end:edge.line,symbol:'Top level',callLine:edge.line,precision:edge.precision});}
 }else if(direction==='callees')for(const edge of edges.filter(e=>e.path===path&&e.line===line)){const target=index.blocks.find(b=>b.path===edge.targetPath&&b.start===edge.targetStart);if(target)results.push({...target,callLine:line,ambiguous:edge.ambiguous})}
 else throw new Error('Unknown expansion direction.');
 const unique=[...new Map(results.map(b=>[b.path+':'+b.start,b])).values()];return {blocks:unique,total:unique.length};
}

export {functionPeeks} from './function-peeks.js';

export function resolvedCallSites(index,target){
 let cached=siteCache.get(index);if(!cached){cached=new Map();siteCache.set(index,cached)}const key=target.path+':'+target.start;
 if(!cached.has(key))cached.set(key,resolveEdges(index,target,target.path,target.start,'callers').filter(edge=>!edge.ambiguous||edge.ruby&&edge.receiver?.owner));return cached.get(key);
}
