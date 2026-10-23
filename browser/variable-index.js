import {parser as javascript} from '@lezer/javascript';
import {parser as python} from '@lezer/python';
import {withRubySyntaxTree} from './ruby-parser.js';

const js=javascript.configure({dialect:'ts jsx'}),cache=new WeakMap(),resolved=new WeakMap();
const jsFunctions=new Set(['FunctionDeclaration','FunctionExpression','ArrowFunction','MethodDeclaration']);
const rubyFields=['name','left','right','method','receiver','value','object','parameters'];
function syntax(node,ruby,parent=null){
 const result={name:ruby?node.type:node.name,from:ruby?node.startIndex:node.from,to:ruby?node.endIndex:node.to,parent,children:[],fields:{}};
 for(let child=ruby?null:node.firstChild;child;child=child.nextSibling)result.children.push(syntax(child,false,result));
 if(ruby){for(const child of node.namedChildren)result.children.push(syntax(child,true,result));for(const field of rubyFields){const child=node.childForFieldName(field);if(child)result.fields[field]=result.children.find(item=>item.from===child.startIndex&&item.to===child.endIndex)}}
 return result;
}
const descend=(node,visit)=>{visit(node);for(const child of node.children)descend(child,visit)};
const ancestor=(node,predicate)=>{for(let item=node?.parent;item;item=item.parent)if(predicate(item))return item;return null};

function parseVariables(path,text){
 const language=/\.rb$/.test(path)?'ruby':/\.[cm]?[jt]sx?$/.test(path)?'javascript':/\.pyi?$/.test(path)?'python':null;
 if(!language)return {bindings:[],references:[],language:null};
 const ruby=language==='ruby',root=ruby?withRubySyntaxTree(text,node=>syntax(node,true)):syntax((language==='python'?python:js).parse(text).topNode,false);
 const starts=[0];for(let i=0;i<text.length;i++)if(text[i]==='\n')starts.push(i+1);
 const position=offset=>{let low=0,high=starts.length;while(low+1<high){const mid=(low+high)>>1;if(starts[mid]<=offset)low=mid;else high=mid}return {line:low+1,column:offset-starts[low]}};
 const value=node=>node?text.slice(node.from,node.to):'',scopes=[],bindings=[],references=[],declarations=new Map(),nodeScopes=new Map();
 function scope(node,parent,kind,owner=parent?.owner||''){const result={node,parent,kind,owner,receiverKind:parent?.receiverKind||'instance',bindings:new Map()};scopes.push(result);return result}
 const global=scope(root,null,'file');
 function localScope(current){while(current.kind==='block'&&current.parent)current=current.parent;return current}
 function fieldScope(current){return [...scopes].find(item=>item.owner===current.owner&&item.kind==='class')||global}
 function infer(node,seen=new Set()){
  if(!node)return null;
  const types=ruby?{integer:'Integer',float:'Float',string:'String',heredoc_body:'String',symbol:'Symbol',simple_symbol:'Symbol',array:'Array',hash:'Hash',true:'TrueClass',false:'FalseClass',nil:'NilClass'}:language==='python'?{String:'str',Number:/[.eE]/.test(value(node))?'float':'int',Boolean:'bool',None:'None',ArrayExpression:'list',DictionaryExpression:'dict',TupleExpression:'tuple',SetExpression:'set'}:{String:'string',TemplateString:'string',Number:'number',BooleanLiteral:'boolean',Null:'null',ArrayExpression:'Array',ObjectExpression:'object',ArrowFunction:'Function',FunctionExpression:'Function'};
  if(types[node.name])return types[node.name];
  if(node.name==='ParenthesizedExpression')return infer(node.children.find(child=>!['(',')'].includes(child.name)),seen);
  if(['VariableName','identifier','instance_variable','class_variable','constant'].includes(node.name)){const binding=resolve(node,nodeScopes.get(node));if(binding&&!seen.has(binding)){seen.add(binding);return value(binding.annotation).replace(/^:\s*/,'')||infer(binding.initializer,seen)}}
  if(ruby&&node.name==='call'&&value(node.fields.method)==='new'&&['constant','scope_resolution'].includes(node.fields.receiver?.name))return value(node.fields.receiver);
  if(!ruby&&node.name==='NewExpression')return value(node.children.find(child=>['VariableName','MemberExpression'].includes(child.name)))||null;
  if(language==='python'&&node.name==='CallExpression'){const callee=node.children[0],name=value(callee);if(['str','int','float','bool','list','dict','set','tuple'].includes(name)||scopes.some(item=>item.kind==='class'&&item.owner===name))return name}
  return null;
 }
 function declare(node,current,kind,initializer=null,annotation=null,extra={}){
  if(!node)return;const name=value(node);let target=current;
  if(ruby){if(['instance_variable','class_variable','constant','global_variable'].includes(node.name))target=node.name==='global_variable'?global:fieldScope(current);else if(kind!=='parameter'&&current.kind==='block'){for(let at=current;at;at=at.parent){if(at.bindings.has('local:'+name)){target=at;break}if(at.kind==='function')break}}}
  const category=ruby&&['instance_variable','class_variable','constant','global_variable'].includes(node.name)?node.name:'local',key=category+':'+(category==='instance_variable'?current.receiverKind+':':'')+name;
  let binding=target.bindings.get(key);
  if(!binding){binding={id:JSON.stringify([path,target.kind,target.node.from,target.owner,key]),name,kind,scope:target,receiverKind:current.receiverKind,category,node,initializer,annotation,...extra,references:[]};target.bindings.set(key,binding);bindings.push(binding)}
  declarations.set(node,binding);return binding;
 }
 function pattern(node,current,kind,initializer,annotation,extra){
  if(!node)return;
  if(['VariableDefinition','VariableName','identifier','instance_variable','class_variable','global_variable','constant'].includes(node.name)){declare(node,current,kind,initializer,annotation,extra);return}
  // Patterns bind names, never property keys or default-value expressions.
  for(const child of node.children){if(['Equals','AssignOp'].includes(child.name))break;if(['PropertyName',':','TypeAnnotation','TypeDef'].includes(child.name))continue;pattern(child,current,kind,null,null,extra)}
 }
 function parameters(node,current){
  if(!node)return;let previous=null;
  for(const child of node.children){
   if(['VariableDefinition','VariableName','identifier'].includes(child.name)){previous=declare(child,current,'parameter');continue}
   if(['TypeAnnotation','TypeDef'].includes(child.name)&&previous){previous.annotation=child;continue}
   if(['Equals','AssignOp'].includes(child.name)&&previous){previous.initializer=child.parent.children[child.parent.children.indexOf(child)+1];previous=null;continue}
   if(ruby&&child.fields.name)declare(child.fields.name,current,'parameter',child.fields.value);
   else if(['ObjectPattern','ArrayPattern','TupleExpression'].includes(child.name))pattern(child,current,'parameter');
  }
 }
 function visit(node,current){
  if(ruby&&['class','module'].includes(node.name)){const name=value(node.fields.name),owner=name.includes('::')||!current.owner?name:current.owner+'::'+name;current=scope(node,current,'class',owner);current.receiverKind='class'}
  else if(ruby&&['method','singleton_method'].includes(node.name)){current=scope(node,current,'function');current.receiverKind=node.name==='singleton_method'||ancestor(node,item=>item.name==='singleton_class')?'class':'instance';parameters(node.fields.parameters,current)}
  else if(ruby&&['do_block','block','lambda'].includes(node.name)){current=scope(node,current,'block');parameters(node.fields.parameters||node.children.find(child=>child.name==='block_parameters'),current)}
  else if(!ruby&&['ClassDeclaration','ClassDefinition'].includes(node.name)){current=scope(node,current,'class',value(node.children.find(child=>['VariableDefinition','VariableName'].includes(child.name))))}
  else if(!ruby&&(jsFunctions.has(node.name)||['FunctionDefinition','LambdaExpression'].includes(node.name))){current=scope(node,current,'function');parameters(node.children.find(child=>child.name==='ParamList'),current)}
  else if(language==='javascript'&&['Block','ForStatement','ForInStatement','ForOfStatement','CatchClause'].includes(node.name))current=scope(node,current,'block');
  else if(language==='python'&&/ComprehensionExpression$/.test(node.name)){current=scope(node,current,'comprehension');for(let i=0;i<node.children.length;i++)if(node.children[i].name==='for'){for(let j=i+1;j<node.children.length&&node.children[j].name!=='in';j++)pattern(node.children[j],current,'local variable')}}
  nodeScopes.set(node,current);
  if(ruby&&['assignment','operator_assignment'].includes(node.name)){
   const left=node.fields.left,right=node.fields.right;
   if(left?.name==='left_assignment_list'&&right?.name==='array')left.children.forEach((child,index)=>pattern(child,current,'local variable',right.children[index]));else pattern(left,current,'local variable',right);
  }
  if(language==='javascript'&&node.name==='VariableDeclaration'){
   const kind=node.children[0]?.name==='const'?'constant':'local variable',target=node.children[0]?.name==='var'?localScope(current):current;
   // Each comma-separated declaration has its own initializer and annotation.
   let group=[];for(const child of [...node.children,{name:','}]){if([',',';'].includes(child.name)){const at=group.findIndex(item=>item.name==='Equals');for(const item of group.slice(1,at<0?undefined:at))if(!['TypeAnnotation','const','let','var'].includes(item.name))pattern(item,target,kind,at>=0?group[at+1]:null,group.find(item=>item.name==='TypeAnnotation'));group=[{name:node.children[0]?.name}]}else group.push(child)}
  }
  if(language==='javascript'&&['CatchClause','ForOfSpec','ForInSpec'].includes(node.name)){
   const stop=node.children.findIndex(child=>['of','in'].includes(child.name));for(const child of node.children.slice(0,stop<0?undefined:stop))if(['VariableDefinition','ObjectPattern','ArrayPattern'].includes(child.name))pattern(child,current,node.name==='CatchClause'?'parameter':'local variable');
  }
  if(language==='python'&&['AssignStatement','ForStatement'].includes(node.name)){
   const stop=node.children.findIndex(child=>['AssignOp','in'].includes(child.name)),annotation=node.children.find(child=>child.name==='TypeDef');
   for(const child of node.children.slice(node.name==='ForStatement'?1:0,stop<0?undefined:stop))if(child.name!=='TypeDef')pattern(child,localScope(current),'local variable',node.name==='AssignStatement'&&stop>=0?node.children[stop+1]:null,annotation);
  }
  if(language==='javascript'&&node.name==='ImportDeclaration'){
   const module=node.children.find(child=>child.name==='String'),specifier=value(module).slice(1,-1);
   descend(node,item=>{if(item.name==='VariableDefinition'){const prior=item.parent.children[item.parent.children.indexOf(item)-2],imported=prior?.name==='VariableName'?value(prior):item.parent.name==='ImportDeclaration'?'default':value(item);declare(item,current,'import',null,null,{imported,specifier})}});
  }
  if(language==='python'&&node.name==='ImportStatement'){
   const at=node.children.findIndex(child=>child.name==='import'),from=node.children[0]?.name==='from',specifier=from?node.children.slice(1,at).map(value).join(''):null;
   for(let i=at+1;i<node.children.length;i++){const child=node.children[i];if(child.name!=='VariableName')continue;const alias=node.children[i+1]?.name==='as'?node.children[i+2]:child;declare(alias,current,'import',null,null,{imported:from?value(child):'*',specifier:specifier||value(child)});if(alias!==child)i+=2}
  }
  const comprehensionIn=current.kind==='comprehension'&&current.node===node?node.children.findIndex(child=>child.name==='in'):-1;
  for(const [i,child]of node.children.entries())visit(child,comprehensionIn>=0&&i===comprehensionIn+1?current.parent:current);
 }
 visit(root,global);
 function resolve(node,current){
  const name=value(node),category=ruby&&['instance_variable','class_variable','constant','global_variable'].includes(node.name)?node.name:'local';
  if(category!=='local'){const target=category==='global_variable'?global:fieldScope(current);for(let at=target;at;at=category==='constant'?at.parent:null){const binding=at.bindings.get(category+':'+(category==='instance_variable'?current.receiverKind+':':'')+name);if(binding)return binding}return}
  for(let at=current;at;at=at.parent){if(language==='python'&&at.kind==='class'&&current!==at)continue;const binding=at.bindings.get('local:'+name);if(binding)return binding;if(ruby&&['function','class'].includes(at.kind))break}
 }
 descend(root,node=>{
  const declaration=declarations.get(node);if(declaration){const ref={...position(node.from),endColumn:position(node.from).column+value(node).length};declaration.references.push(ref);return}
  const shorthand=node.name==='PropertyDefinition'&&node.parent.name==='Property'&&node.parent.children.length===1;
  if(!shorthand&&!['VariableName','identifier','instance_variable','class_variable','global_variable','constant'].includes(node.name))return;
  if(ruby&&(node.parent.fields.method===node||node.parent.fields.name===node||node.parent.name==='scope_resolution'))return;
  if(!ruby&&(ancestor(node,item=>['TypeAnnotation','TypeDef','ImportDeclaration','ImportStatement'].includes(item.name))||['FunctionDefinition','ClassDefinition','FunctionDeclaration','ClassDeclaration'].includes(node.parent?.name)))return;
  const binding=resolve(node,nodeScopes.get(node));if(binding){const ref={...position(node.from),endColumn:position(node.from).column+value(node).length};binding.references.push(ref)}else if(ruby&&['instance_variable','class_variable','constant','global_variable'].includes(node.name))references.push({node,scope:nodeScopes.get(node),...position(node.from),endColumn:position(node.from).column+value(node).length,name:value(node),category:node.name});
 });
 const lines=text.split('\n');
 function publicBinding(binding){
  const {line,column}=position(binding.node.from),annotation=value(binding.annotation).replace(/^:\s*/,''),type=annotation||infer(binding.initializer),snippetStart=Math.max(1,Math.min(line-1,lines.length-2));
  return {id:binding.id,name:binding.name,kind:binding.category==='local'?binding.kind:binding.category.replaceAll('_',' '),owner:binding.scope.owner||null,receiverKind:binding.receiverKind,topLevel:binding.scope.kind==='file',type:type||null,typeSource:annotation?'declared':type?'inferred':null,definition:{path,line,column,start:snippetStart,lines:lines.slice(snippetStart-1,snippetStart+2)},initializer:value(binding.initializer).slice(0,180)||null,occurrences:binding.references,imported:binding.imported,specifier:binding.specifier};
 }
 return {bindings:bindings.map(publicBinding),references:references.map(ref=>({...ref,node:undefined,scope:undefined,owner:ref.category==='global_variable'?null:ref.scope.owner||null,receiverKind:ref.scope.receiverKind})),language};
}

export function variableBindings(files,path,{owners}={}){
 let completed=resolved.get(files);if(!completed){completed=new Map();resolved.set(files,completed)}if(completed.has(path))return completed.get(path);
 let parsed=cache.get(files);if(!parsed){parsed=new Map();cache.set(files,parsed)}
 function get(name){if(!parsed.has(name))parsed.set(name,parseVariables(name,files.get(name)||''));return parsed.get(name)}
 const source=get(path),bindings=source.bindings.map(binding=>({...binding,occurrences:[...binding.occurrences]}));
 // Instance fields/constants can be initialized in another method or a reopened
 // Ruby class. Match the owner, and leave ambiguous definitions unresolved.
 const groups=new Map();for(const reference of source.references){if(reference.category==='constant'&&!/^[A-Z][A-Z\d_]*$/.test(reference.name))continue;const key=JSON.stringify([reference.owner,reference.category,reference.category==='instance_variable'?reference.receiverKind:null,reference.name]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(reference)}
 for(const references of groups.values()){
  const reference=references[0];
  const candidates=[];
  const paths=owners&&reference.owner?new Set(owners.filter(owner=>owner.owner===reference.owner).map(owner=>owner.path)):null;
  for(const [other,text]of files){if(other===path||!other.endsWith('.rb')||paths&&!paths.has(other)||!text.includes(reference.name))continue;for(const binding of get(other).bindings)if(binding.name===reference.name&&binding.owner===reference.owner&&binding.kind===reference.category.replaceAll('_',' ')&&(reference.category!=='instance_variable'||binding.receiverKind===reference.receiverKind))candidates.push(binding)}
  const occurrences=references.map(({line,column,endColumn})=>({line,column,endColumn}));
  if(candidates.length===1){const target=candidates[0],existing=bindings.find(binding=>binding.id===target.id);if(existing)existing.occurrences.push(...occurrences);else bindings.push({...target,occurrences})}
  else bindings.push({id:JSON.stringify([path,reference.owner,reference.category,reference.category==='instance_variable'?reference.receiverKind:null,reference.name]),name:reference.name,kind:reference.category.replaceAll('_',' '),owner:reference.owner,type:null,typeSource:null,definition:null,occurrences});
 }
 for(const binding of bindings.filter(binding=>binding.kind==='import'&&(source.language==='python'||binding.specifier?.startsWith('.')))){
  const segments=path.split('/').slice(0,-1);let target;
  if(source.language==='python'){const dots=binding.specifier.match(/^\.+/)?.[0].length||0;for(let i=1;i<dots;i++)segments.pop();target=[...dots?segments:[],...binding.specifier.slice(dots).split('.')].filter(Boolean).join('/')}
  else{for(const part of binding.specifier.split('/')){if(part==='..')segments.pop();else if(part!=='.')segments.push(part)}target=segments.join('/')}
  const matches=(source.language==='python'?[target+'.py',target+'/__init__.py']:[target,...['ts','tsx','js','jsx','mts','mjs'].flatMap(ext=>[target+'.'+ext,target+'/index.'+ext])]).filter(candidate=>files.has(candidate));
  if(matches.length===1){const found=get(matches[0]).bindings.filter(candidate=>candidate.name===binding.imported&&candidate.topLevel);if(found.length===1){binding.definition=found[0].definition;binding.type=found[0].type;binding.typeSource=found[0].typeSource;binding.initializer=found[0].initializer}}
 }
 completed.set(path,bindings);return bindings;
}
