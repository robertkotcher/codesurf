import {icon} from './canvas-icons.js';
import {highlightCodeLines} from './code-highlighting.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function createCanvasVariables({world,viewport,zoom:scale,fileURL}){
 let popup=null,anchor=null,pinned=null,hovered=null;
 const bindings=new Map();
 function highlight(key){for(const button of world.querySelectorAll('[data-variable-id]'))button.classList.toggle('variable-occurrence',button.dataset.variableId===key)}
 function close(){anchor?.setAttribute('aria-expanded','false');popup?.remove();popup=null;anchor=null;pinned=null;highlight(hovered)}
 function mark(sourceForRow){
  bindings.clear();
  for(const row of world.querySelectorAll('.code-row')){
   const info=sourceForRow(row),code=row.querySelector('code');if(!info||!code)continue;
   const tokens=[];
   for(const binding of info.source.variables||[]){const key=JSON.stringify([info.snapshot,binding.id]);bindings.set(key,binding);for(const token of binding.occurrences)if(token.line===info.line)tokens.push({...token,key,name:binding.name})}
   for(const token of tokens.sort((a,b)=>b.column-a.column)){
    if(code.textContent.slice(token.column,token.endColumn)!==token.name)continue;
    const nodes=[],walker=document.createTreeWalker(code,NodeFilter.SHOW_TEXT);let offset=0,node;while(node=walker.nextNode()){nodes.push({node,start:offset,end:offset+node.length});offset+=node.length}
    const first=nodes.find(item=>item.start<=token.column&&item.end>token.column),last=nodes.find(item=>item.start<token.endColumn&&item.end>=token.endColumn);if(!first||!last||first.node.parentElement.closest('[data-function-call],[data-variable-id]')||last.node.parentElement.closest('[data-function-call],[data-variable-id]'))continue;
    const range=document.createRange();range.setStart(first.node,token.column-first.start);range.setEnd(last.node,token.endColumn-last.start);
    const button=document.createElement('button');button.type='button';button.className='variable-token';button.dataset.variableId=token.key;button.setAttribute('aria-label','Inspect variable '+token.name);button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-expanded','false');button.append(range.extractContents());range.insertNode(button);
   }
  }
  highlight(hovered||pinned);
 }
 function position(){
  if(!popup)return;if(!anchor?.isConnected){close();return}
  const zoom=scale(),base=world.getBoundingClientRect(),rect=anchor.getBoundingClientRect(),clip=anchor.closest('.code-rows').getBoundingClientRect(),view=viewport.getBoundingClientRect();
  if(rect.bottom<clip.top||rect.top>clip.bottom||rect.right<clip.left||rect.left>clip.right){close();return}
  const width=popup.offsetWidth*zoom,height=popup.offsetHeight*zoom,x=Math.max(view.left+8,Math.min(rect.left,view.right-width-8)),y=Math.max(view.top+8,rect.bottom+6*zoom+height>view.bottom-8?rect.top-height-6*zoom:rect.bottom+6*zoom);
  popup.style.left=(x-base.left)/zoom+'px';popup.style.top=(y-base.top)/zoom+'px';
 }
 function open(button){
  const key=button.dataset.variableId,binding=bindings.get(key);if(!binding)return;const same=anchor===button;close();if(same)return;
  pinned=key;anchor=button;button.setAttribute('aria-expanded','true');popup=document.createElement('div');popup.className='variable-tooltip';popup.setAttribute('role','dialog');popup.setAttribute('aria-label','Variable '+binding.name);popup.tabIndex=-1;
  const definition=binding.definition,href=definition&&fileURL(definition.path),snippet=definition?highlightCodeLines(definition.path,definition.lines.join('\n')):[];
  popup.innerHTML=`<header><strong>${esc(binding.name)}</strong><button type="button" class="icon-button" aria-label="Close variable details">${icon('close')}</button></header><div class="variable-meta"><span>${esc(binding.kind)}</span><span>${key.startsWith('["before"')?'Before this change':''}</span></div><div class="variable-type">${binding.type?`<code>${esc(binding.type)}</code><span>${binding.typeSource==='declared'?'Declared type':'Inferred from definition'}</span>`:'<span>Type unavailable</span>'}</div>${definition?`<div class="variable-definition"><span>Defined at</span>${href?`<a href="${esc(href)}" target="_blank" rel="noopener">${esc(definition.path)}:${definition.line}</a>`:`<span>${esc(definition.path)}:${definition.line}</span>`}</div><pre>${snippet.map((line,index)=>`<span class="variable-definition-line${definition.start+index===definition.line?' is-definition':''}"><span>${definition.start+index}</span><code>${line||' '}</code></span>`).join('')}</pre>`:'<p class="variable-unknown">Definition not found in this review snapshot.</p>'}`;
  popup.querySelector('button').onclick=()=>{const prior=anchor;close();prior?.focus({preventScroll:true})};world.append(popup);position();highlight(key);popup.focus({preventScroll:true});
 }
 world.addEventListener('pointerover',event=>{const button=event.target.closest('[data-variable-id]');if(button){hovered=button.dataset.variableId;highlight(hovered)}});
 world.addEventListener('pointerout',event=>{if(event.target.closest('[data-variable-id]')&&!event.relatedTarget?.closest?.('[data-variable-id]')){hovered=null;highlight(pinned)}});
 world.addEventListener('focusin',event=>{const button=event.target.closest('[data-variable-id]');if(button){hovered=button.dataset.variableId;highlight(hovered)}});
 world.addEventListener('focusout',event=>{if(event.target.closest('[data-variable-id]')){hovered=null;highlight(pinned)}});
 world.addEventListener('click',event=>{const button=event.target.closest('[data-variable-id]');if(button){event.preventDefault();open(button)}});
 world.addEventListener('keydown',event=>{if(event.key==='Escape'&&popup){const prior=anchor;close();prior?.focus({preventScroll:true});event.stopPropagation()}});
 document.addEventListener('pointerdown',event=>{if(popup&&!popup.contains(event.target)&&!event.target.closest('[data-variable-id]'))close()});
 viewport.addEventListener('scroll',position);world.addEventListener('scroll',position,true);
 return {mark,position,close,reset(){close();hovered=null;bindings.clear();highlight(null)}};
}
