import {icon} from './canvas-icons.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function formatChatMessage(text){
 return String(text).split(/(```[\s\S]*?(?:```|$))/g).map(part=>part.startsWith('```')?'<pre><code>'+esc(part.replace(/^```[^\n]*\n?/, '').replace(/```$/,''))+'</code></pre>':esc(part).replace(/`([^`\n]+)`/g,'<code>$1</code>').replace(/\*\*([^*\n]+)\*\*/g,'<strong>$1</strong>')).join('');
}
export function createCanvasChats({stage,viewport,geometry,request}){
 const chats=new Map(),layer=document.createElement('div');let step=null,front=1;
 const sizes=new ResizeObserver(()=>layout());
 layer.className='canvas-chats-layer';layer.innerHTML='<svg class="canvas-chat-tethers" aria-hidden="true"></svg>';stage.append(layer);
 function layout(){
  const view=geometry();layer.style.left=view.left+'px';layer.style.transform=`scale(${view.zoom})`;let width=view.width,height=view.height;const visible=[];
  for(const chat of chats.values()){
   const anchor=chat.context.step===step?view.anchor(chat.context):null;chat.element.hidden=!anchor;if(!anchor)continue;
   const x=Math.max(20,anchor.left+chat.dx),y=Math.max(20,anchor.y+chat.dy);chat.element.style.left=x+'px';chat.element.style.top=y+'px';width=Math.max(width,x+chat.element.offsetWidth+40);height=Math.max(height,y+chat.element.offsetHeight+40);visible.push({chat,anchor,x,y});
  }
  layer.style.width=width+'px';layer.style.height=height+'px';stage.style.width=Math.max(viewport.clientWidth,view.left+width*view.zoom)+'px';stage.style.height=Math.max(viewport.clientHeight,height*view.zoom)+'px';
  const svg=layer.querySelector('svg');svg.setAttribute('width',width);svg.setAttribute('height',height);svg.replaceChildren();
  for(const {chat,anchor,x,y}of visible){const left=x+chat.element.offsetWidth/2<anchor.left,from=left?anchor.left:anchor.right,to=left?x+chat.element.offsetWidth:x,end=y+27,bend=(from+to)/2;const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',`M ${from} ${anchor.y} C ${bend} ${anchor.y}, ${bend} ${end}, ${to} ${end}`);svg.append(path);const dot=document.createElementNS(svg.namespaceURI,'circle');dot.setAttribute('cx',from);dot.setAttribute('cy',anchor.y);dot.setAttribute('r','3');svg.append(dot)}
 }
 function activate(chat){chat.element.style.zIndex=++front}
 function close(chat){chat.controller?.abort();sizes.unobserve(chat.element);chat.element.remove();chats.delete(chat.id);layout()}
 function controls(chat){const busy=!!chat.controller;chat.send.innerHTML=icon(busy?'stop':'send');chat.send.setAttribute('aria-label',busy?'Stop answer':'Send question');chat.send.title=busy?'Stop answer':'Send question';chat.send.disabled=!busy&&!chat.input.value.trim();chat.element.setAttribute('aria-busy',String(busy))}
 async function send(chat){
  const question=chat.input.value.trim();if(!question||chat.controller)return;const history=chat.turns.filter(turn=>turn.complete&&!turn.error).flatMap(turn=>[{role:'user',content:turn.question},{role:'assistant',content:turn.answer}]);
  const turn={question,answer:'',complete:false,error:''},controller=new AbortController();chat.controller=controller;chat.turns.push(turn);chat.input.value='';chat.log.querySelector('.canvas-chat-empty')?.remove();
  const article=document.createElement('article');article.className='canvas-chat-turn';article.innerHTML='<p class="canvas-chat-question"></p><div class="canvas-chat-response"></div><p class="canvas-chat-error" hidden></p>';article.querySelector('.canvas-chat-question').textContent=question;chat.log.append(article);chat.log.scrollTop=chat.log.scrollHeight;chat.status.textContent='Finding relevant source…';controls(chat);
  const response=article.querySelector('.canvas-chat-response');
  try{
   await request({context:chat.context,question,history,signal:controller.signal,onEvent(name,data){
    if(!chats.has(chat.id))return;const follow=chat.log.scrollHeight-chat.log.scrollTop-chat.log.clientHeight<70;
    if(name==='delta'){turn.answer+=data.text||'';response.textContent=turn.answer}
    if(name==='activity')chat.status.textContent=data.text;
    if(name==='scope')chat.status.textContent=`Searching ${data.indexedFiles} repository files…`;
    if(name==='done')turn.complete=true;
    if(follow)chat.log.scrollTop=chat.log.scrollHeight;
   }});
   if(!turn.complete)throw new Error('The answer ended early. Please retry.');
  }catch(error){turn.error=error.name==='AbortError'?'Answer stopped.':error.message;if(chats.has(chat.id)){const box=article.querySelector('.canvas-chat-error');box.textContent=turn.error;box.hidden=false;if(error.name!=='AbortError'&&!chat.input.value)chat.input.value=question}}
  finally{if(chats.has(chat.id)){response.innerHTML=formatChatMessage(turn.answer);chat.status.textContent='';if(chat.controller===controller)chat.controller=null;controls(chat);layout()}}
 }
 function open(context){
  const anchor=geometry().anchor(context);if(!anchor)return;
  const element=document.createElement('section'),id=crypto.randomUUID(),offset=[...chats.values()].filter(chat=>chat.context.step===context.step).length*28;
  element.className='canvas-chat';element.dataset.chatId=id;element.setAttribute('aria-label',`AI chat about ${context.path} line ${context.line}`);
  element.innerHTML=`<header class="canvas-chat-heading" tabindex="0" title="Drag to move · Arrow keys to reposition"><span class="canvas-chat-grip" aria-hidden="true">${icon('grip')}</span><div><strong>Ask AI</strong><small></small></div><button class="icon-button" data-close-chat aria-label="Close chat" title="Close chat">${icon('close')}</button></header><div class="canvas-chat-anchor"></div><div class="canvas-chat-log" role="log" aria-label="Conversation"><p class="canvas-chat-empty">Ask about this line, the file, or the repository.</p></div><form class="canvas-chat-form"><textarea rows="2" maxlength="4000" placeholder="Ask a question…" aria-label="Question"></textarea><button class="primary canvas-chat-send" type="submit" aria-label="Send question">${icon('send')}</button></form><div class="canvas-chat-status" role="status"></div>`;
  element.querySelector('.canvas-chat-heading small').textContent=context.path+':'+context.line;element.querySelector('.canvas-chat-heading small').title=context.path+':'+context.line;
  element.querySelector('.canvas-chat-anchor').textContent=`Line ${context.line} · ${context.snapshot==='before'?'Before':'After'} this change`;
  const chat={id,element,context:{...context},dx:anchor.right-anchor.left+80+offset,dy:Math.max(20-anchor.y,-60)+offset,turns:[],controller:null,input:element.querySelector('textarea'),log:element.querySelector('.canvas-chat-log'),send:element.querySelector('.canvas-chat-send'),status:element.querySelector('.canvas-chat-status')};
  chats.set(id,chat);layer.append(element);sizes.observe(element);activate(chat);controls(chat);layout();element.scrollIntoView({block:'nearest',inline:'nearest'});chat.input.focus({preventScroll:true});
  element.querySelector('[data-close-chat]').onclick=()=>close(chat);element.addEventListener('pointerdown',()=>activate(chat));chat.input.oninput=()=>controls(chat);
  element.querySelector('form').onsubmit=event=>{event.preventDefault();if(chat.controller)chat.controller.abort();else send(chat)};
  chat.input.onkeydown=event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();if(!chat.controller)send(chat)}};
  const heading=element.querySelector('header');let drag=null;
  heading.onpointerdown=event=>{if(event.button!==0||event.target.closest('button'))return;event.preventDefault();event.stopPropagation();activate(chat);drag={x:event.clientX,y:event.clientY,dx:chat.dx,dy:chat.dy,zoom:geometry().zoom};heading.setPointerCapture(event.pointerId);heading.classList.add('dragging')};
  heading.onpointermove=event=>{if(!drag)return;chat.dx=drag.dx+(event.clientX-drag.x)/drag.zoom;chat.dy=drag.dy+(event.clientY-drag.y)/drag.zoom;layout()};
  const stopDrag=()=>{drag=null;heading.classList.remove('dragging')};heading.onpointerup=stopDrag;heading.onpointercancel=stopDrag;
  heading.onkeydown=event=>{if(event.target!==heading||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();const amount=event.shiftKey?50:20;chat.dx+=event.key==='ArrowLeft'?-amount:event.key==='ArrowRight'?amount:0;chat.dy+=event.key==='ArrowUp'?-amount:event.key==='ArrowDown'?amount:0;layout()};
  return id;
 }
 return {open,layout,showStep(value){step=value;layout()},clear(){for(const chat of chats.values()){chat.controller?.abort();sizes.unobserve(chat.element);chat.element.remove()}chats.clear();step=null;layout()}};
}
