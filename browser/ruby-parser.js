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
  function qualified(name,scope){return name.startsWith('::')?name.slice(2):name.includes('::')||!scope?name:scope+'::'+name}
  function receiverType(node,scope){
   if(!node)return scope.owner?{owner:scope.owner,kind:scope.kind}:null;
   if(node.type==='self')return scope.owner?{owner:scope.owner,kind:scope.kind}:null;
   if(node.type==='constant'||node.type==='scope_resolution')return {owner:node.text.replace(/^::/,''),kind:'class',namespace:scope.namespace};
   if(node.type==='identifier'||node.type==='instance_variable')return scope.bindings.get(node.text)||null;
   if(node.type==='call'){const method=node.childForFieldName('method')?.text,receiver=receiverType(node.childForFieldName('receiver'),scope);if(receiver?.kind==='class'&&['new','find','find_by','find_by!','create','create!','build','first','last'].includes(method))return {...receiver,kind:'instance'}}
   return null;
  }
  function visit(node,parent=null,locals=new Set(),scope={owner:null,namespace:'',kind:'instance',bindings:new Map()}){let enclosing=parent;
   if(node.type==='class'||node.type==='module'){
    const name=node.childForFieldName('name');if(name){const owner=qualified(name.text,scope.namespace);scope={owner,namespace:owner,kind:'class',parentClass:node.childForFieldName('superclass')?.namedChildren[0]?.text||null,bindings:new Map()};enclosing=null}
   }
   if(node.type==='singleton_class'&&node.childForFieldName('value')?.type==='self')scope={...scope,kind:'class'};
   if(node.type==='assignment'){const left=node.childForFieldName('left'),right=node.childForFieldName('right');if(left&&['identifier','instance_variable'].includes(left.type)){const type=receiverType(right,scope);if(type)scope.bindings.set(left.text,type);else scope.bindings.delete(left.text)}}
   if(node.type==='method'||node.type==='singleton_method'){locals=localsIn(node);scope={...scope,kind:node.type==='singleton_method'||node.parent?.parent?.type==='singleton_class'?'class':'instance',bindings:new Map()};
    const object=node.childForFieldName('object');if(object&&object.type!=='self'){const receiver=receiverType(object,scope);scope={...scope,owner:receiver?.owner||null}}
    const name=node.childForFieldName('name');if(name){enclosing={path,start:node.startPosition.row+1,end:node.endPosition.row+1,symbol:name.text,owner:scope.owner,methodKind:scope.kind,parentClass:scope.parentClass||null,precision:'syntax',text:node.text};blocks.push(enclosing)}
   }
   if(node.type==='call'){
    const name=node.childForFieldName('method');if(name)calls.push({path,line:node.startPosition.row+1,symbol:name.text,ruby:true,receiver:receiverType(node.childForFieldName('receiver'),scope),expression:node.text.slice(0,200),callerStart:enclosing?.start??null,precision:'syntax'});
   }else if(node.type==='identifier'&&!locals.has(node.text)&&node.parent?.type!=='call'){
    // Bare Ruby identifiers may be zero-argument calls or local variables.
    // Exclude parameters and assigned locals; remaining bare names are possible calls.
    const parentType=node.parent?.type;
    if(!['method','singleton_method','method_parameters','assignment','operator_assignment','optional_parameter','keyword_parameter','block_parameters','pair','symbol','simple_symbol'].includes(parentType))calls.push({path,line:node.startPosition.row+1,symbol:node.text,ruby:true,receiver:receiverType(null,scope),expression:node.text,callerStart:enclosing?.start??null,precision:'syntax',ambiguous:true});
   }
   for(const child of node.namedChildren)visit(child,enclosing,locals,scope);
  }
  visit(tree.rootNode);return {blocks,calls,language:'ruby'};
 }finally{tree.delete()}
}
