let parser,ready;
export function initCallParsers(){
 if(ready)return ready;
 ready=(async()=>{
  let Parser;
  if(typeof window==='undefined'){
   Parser=(await import('web-tree-sitter')).default;const {readFile}=await import('node:fs/promises');
   await Parser.init({wasmBinary:await readFile(new URL('../public/vendor/tree-sitter.wasm',import.meta.url))});
   parser=new Parser();parser.setLanguage(await Parser.Language.load(await readFile(new URL('../public/vendor/tree-sitter-ruby.wasm',import.meta.url))));
  }else{
   if(!window.TreeSitter)await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='/vendor/tree-sitter.js';script.onload=resolve;script.onerror=()=>reject(new Error('Ruby parser could not load. Try again.'));document.head.append(script)});
   Parser=window.TreeSitter;await Parser.init({locateFile:()=>'/vendor/tree-sitter.wasm'});parser=new Parser();parser.setLanguage(await Parser.Language.load('/vendor/tree-sitter-ruby.wasm'));
  }
 })().catch(error=>{ready=null;throw error});return ready;
}
export function rubyIndex(path,text){
 if(!parser)throw new Error('Ruby parser is not ready.');
 const tree=parser.parse(text),blocks=[],calls=[];
 try{
  function localsIn(node){const names=new Set();function namesFrom(n){if(n.type==='identifier')names.add(n.text);else for(const child of n.namedChildren)namesFrom(child)}function scan(n){if(n!==node&&['method','singleton_method','class','module'].includes(n.type))return;if(n.type==='method_parameters'||n.type==='block_parameters')namesFrom(n);if(n.type==='assignment'||n.type==='operator_assignment'){const left=n.childForFieldName('left');if(left)namesFrom(left)}for(const child of n.namedChildren)scan(child)}scan(node);return names}
  function visit(node,parent=null,locals=new Set()){let enclosing=parent;
   if(node.type==='method'||node.type==='singleton_method'){locals=localsIn(node);
    const name=node.childForFieldName('name');if(name){enclosing={path,start:node.startPosition.row+1,end:node.endPosition.row+1,symbol:name.text,precision:'syntax',text:node.text};blocks.push(enclosing)}
   }
   if(node.type==='call'){
    const name=node.childForFieldName('method');if(name)calls.push({path,line:node.startPosition.row+1,symbol:name.text,expression:node.text.slice(0,200),callerStart:enclosing?.start??null,precision:'syntax'});
   }else if(node.type==='identifier'&&!locals.has(node.text)&&node.parent?.type!=='call'){
    // Bare Ruby identifiers may be zero-argument calls or local variables.
    // Exclude parameters and assigned locals; remaining bare names are possible calls.
    const parentType=node.parent?.type;
    if(!['method','singleton_method','method_parameters','assignment','operator_assignment','optional_parameter','keyword_parameter','block_parameters','pair','symbol','simple_symbol'].includes(parentType))calls.push({path,line:node.startPosition.row+1,symbol:node.text,expression:node.text,callerStart:enclosing?.start??null,precision:'syntax',ambiguous:true});
   }
   for(const child of node.namedChildren)visit(child,enclosing,locals);
  }
  visit(tree.rootNode);return {blocks,calls,language:'ruby'};
 }finally{tree.delete()}
}
