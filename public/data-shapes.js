import {sourceBlocks} from './call-graph.js';
export function splitArguments(text){let depth=0,quote='',start=0,result=[];for(let i=0;i<text.length;i++){const c=text[i];if(quote){if(c===quote&&text[i-1]!=='\\')quote='';continue}if('"\'`'.includes(c)){quote=c;continue}if('([{<'.includes(c))depth++;if(')]}>'.includes(c))depth--;if(c===','&&depth===0){result.push(text.slice(start,i).trim());start=i+1}}const last=text.slice(start).trim();if(last)result.push(last);return result;}
export function functionParameters(block){const signature=block.text.split('\n')[0],start=signature.indexOf('(');if(start<0)return [];let depth=1,end=start+1;for(;end<signature.length;end++){if(signature[end]==='(')depth++;if(signature[end]===')'&&!--depth)break}return splitArguments(signature.slice(start+1,end)).map(raw=>{const [binding,...rest]=raw.split(':');return {name:binding.replace(/\?.*|=.*$/g,'').trim(),type:rest.join(':').split('=')[0].trim()||'unknown',declaration:raw}});}
export function selectedFunction(files,path,start,end=start){return sourceBlocks(files).filter(b=>b.path===path&&b.start<=start&&b.end>=end).sort((a,b)=>(a.end-a.start)-(b.end-b.start))[0]||null;}
const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
function typeFields(files,type){for(const text of files.values()){const match=text.match(new RegExp('(?:interface|type)\\s+'+escape(type)+'(?:\\s*=)?\\s*\\{([\\s\\S]*?)\\}'));if(match)return [...match[1].matchAll(/([\w$]+)\??\s*:\s*([^;\n]+)/g)].map(m=>({name:m[1],type:m[2].trim()}))}return [];}
function sample(type,files,depth=0){if(depth>3)return null;if(/\[\]$/.test(type))return [sample(type.slice(0,-2),files,depth+1)];if(/Record|object|dict/.test(type))return {};if(/string/.test(type))return 'example';if(/number|\bint\b|\bfloat\b/.test(type))return 1;if(/boolean|bool/.test(type))return true;const fields=typeFields(files,type);if(fields.length)return Object.fromEntries(fields.map(f=>[f.name,sample(f.type,files,depth+1)]));if(/Record|object|dict/.test(type))return {};return null;}
export function functionData(files,{path,line}){
 const block=selectedFunction(files,path,Number(line));if(!block)throw new Error('Select code inside a function.');const parameters=functionParameters(block);if(!parameters.length)throw new Error('This function has no input parameters.');
 const inputs=parameters.map(p=>{let value=sample(p.type,files);const fields=typeFields(files,p.type);
 if(value===null){const properties=[...block.text.matchAll(new RegExp('\\b'+escape(p.name)+'\\.([\\w$]+)','g'))].map(m=>m[1]);if(properties.length)value=Object.fromEntries([...new Set(properties)].map(name=>[name,null]));}
 return {...p,fields,sample:value};});
 const calls=[],symbols=sourceBlocks(files);const text=block.text;
 // Extract balanced call arguments, retaining expressions rather than executing repository code.
 for(const match of text.matchAll(/\b([\w$]+(?:\.[\w$]+)*)\s*\(/g)){const name=match[1],line=block.start+text.slice(0,match.index).split('\n').length-1;if(line===block.start||['if','for','while','switch','catch','with'].includes(name))continue;
 const start=match.index+match[0].length;let depth=1,quote='',end=start;for(;end<text.length;end++){const c=text[end];if(quote){if(c===quote&&text[end-1]!=='\\')quote='';continue}if('"\'`'.includes(c)){quote=c;continue}if(c==='(')depth++;if(c===')'&&!--depth)break}if(depth)continue;
 const candidates=symbols.filter(b=>b.symbol===name.split('.').at(-1));calls.push({name,line,arguments:splitArguments(text.slice(start,end)),targets:candidates.slice(0,8).map(b=>({path:b.path,start:b.start,symbol:b.symbol,parameters:functionParameters(b)}))});
 }
 const locals=[...text.matchAll(/\b(?:const|let|var)\s+([\w$]+)\s*=\s*([^;\n]+);/g)].map(m=>({name:m[1],expression:m[2].trim()}));
 return {block,inputs,locals,calls:calls.slice(0,60),sample:Object.fromEntries(inputs.map(p=>[p.name,p.sample]))};
}
export function inspectExpression(expression,inputs){
 const expr=expression.trim();if(Object.hasOwn(inputs,expr))return {known:true,value:inputs[expr]};
 if(/^[\w$]+(?:\.[\w$]+)+$/.test(expr)){const parts=expr.split('.');let value=inputs;for(const part of parts){if(value===null||typeof value!=='object'||!Object.hasOwn(value,part))return {known:false};value=value[part]}return {known:true,value};}
 try{if(/^(?:-?\d+(?:\.\d+)?|true|false|null|".*")$/.test(expr))return {known:true,value:JSON.parse(expr)}}catch{}
 if(/^'.*'$/.test(expr))return {known:true,value:expr.slice(1,-1)};
 const arithmetic=expr.match(/^([\w$.]+)\s*([+*\/-])\s*(-?\d+(?:\.\d+)?)$/);if(arithmetic){const left=inspectExpression(arithmetic[1],inputs);if(left.known&&typeof left.value==='number'){const n=Number(arithmetic[3]),value=arithmetic[2]==='+'?left.value+n:arithmetic[2]==='-'?left.value-n:arithmetic[2]==='*'?left.value*n:left.value/n;if(Number.isFinite(value))return {known:true,value};}}
 const stringify=expr.match(/^JSON\.stringify\(([\s\S]*)\)$/);if(stringify){const value=inspectExpression(stringify[1],inputs);if(value.known)return {known:true,value:JSON.stringify(value.value)}}
 return {known:false};
}
export function valueShape(value){if(value===null)return 'unknown / null';if(Array.isArray(value))return value.length?'Array<'+valueShape(value[0])+'>':'Array';if(typeof value==='object')return '{ '+Object.entries(value).map(([k,v])=>k+': '+valueShape(v)).join(', ')+' }';return typeof value;}
