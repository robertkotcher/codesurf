import {lineAffordances} from './call-graph.js';
const colorCode=text=>esc(text).replace(/(&#39;.*?&#39;|&quot;.*?&quot;|\b(?:function|return|async|await|const|let|if|else|for|def|export|class|import|from|throw|new)\b)/g,t=>`<span class="${t.startsWith('&')?'str':'kw'}">${t}</span>`);
const arrow=direction=>`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${direction==='left'?'M19 12H5m6-6-6 6 6 6':'M5 12h14m-6-6 6 6-6 6'}"/></svg>`;
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export async function openCallCanvas({host,path,line,load,onSelect,root=null}){
 host.querySelector('.call-canvas')?.remove();const canvas=document.createElement('section');canvas.className='call-canvas';canvas.setAttribute('aria-label','Call canvas');
 canvas.innerHTML='<header><div><b>Function graph</b></div><button data-close>Exit graph mode ×</button></header><div class="canvas-message" role="status">Loading code…</div><div class="canvas-scroll"><div class="canvas-map"><svg class="canvas-edges" aria-hidden="true"></svg><div class="canvas-columns"></div></div></div>';
 canvas.style.setProperty('--graph-card-width',Math.max(260,Math.min(480,(host.clientWidth-64)/2))+'px');host.append(canvas);let alive=true,nodes=[],expanded=new Map(),pending=new Set(),serial=0;
 canvas.querySelector('[data-close]').onclick=()=>{alive=false;canvas.remove()};
 const message=canvas.querySelector('.canvas-message'),columns=canvas.querySelector('.canvas-columns');
 function render(){
 const levels=[...new Set(nodes.map(n=>n.level))].sort((a,b)=>a-b);
 columns.innerHTML=levels.map(level=>`<div class="canvas-column" data-level="${level}">${nodes.filter(n=>n.level===level).map(n=>`<article class="call-node ${n.level===0?'graph-root':''}" data-node="${n.id}"><header><div><b>${esc(n.symbol)}</b><span>${esc(n.path)}:${n.start} · ${esc(n.snapshot||'PR head')}${n.ambiguous?' · possible match':''}${n.precision==='heuristic'?' · heuristic':''}</span></div>${n.parent?`<button data-remove="${n.id}" aria-label="Remove branch">×</button>`:''}</header><div class="call-source">${n.text.split('\n').map((text,i)=>{const line=n.start+i,actions=lineAffordances(text);return `<div class="call-row${n.selected&&line>=n.selected.start&&line<=n.selected.end?' call-selected':line===n.focus?' call-focus':''}" data-row-node="${n.id}" data-row-line="${line}"><span class="call-left">${actions.callers?`<button class="call-icon" data-expand="callers" data-node-id="${n.id}" data-line="${line}" aria-label="Expand callers" title="Expand callers">${arrow('left')}</button>`:''}</span><button data-select="${n.id}" data-line="${line}" aria-label="Select line ${line}"><span>${line}</span><code>${colorCode(text)||' '}</code></button><span class="call-right">${actions.callees?`<button class="call-icon" data-expand="callees" data-node-id="${n.id}" data-line="${line}" aria-label="Expand callees" title="Expand callees">${arrow('right')}</button>`:''}<button class="call-icon call-question" data-ask-line="${n.id}" data-line="${line}" aria-label="Ask about line ${line}" title="Ask about this line"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 0 1-8 8H5l-4 3V11a9 9 0 0 1 19 0Z"/></svg></button></span></div>`}).join('')}</div></article>`).join('')}</div>`).join('');
 requestAnimationFrame(()=>{if(!alive)return;const map=canvas.querySelector('.canvas-map'),box=map.getBoundingClientRect(),svg=canvas.querySelector('.canvas-edges');svg.setAttribute('width',map.scrollWidth);svg.setAttribute('height',map.scrollHeight);svg.innerHTML='<defs><marker id="canvasArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L10 5 L0 10" fill="#b4a0ca"/></marker></defs>';for(const n of nodes.filter(n=>n.parent)){const parent=nodes.find(p=>p.id===n.parent);const left=n.level<parent.level?n:parent,right=left===n?parent:n;const a=columns.querySelector(`[data-node="${left.id}"]`).getBoundingClientRect(),b=columns.querySelector(`[data-node="${right.id}"]`).getBoundingClientRect();const rowY=(node,line,rect)=>{const row=columns.querySelector(`[data-node="${node.id}"] [data-row-line="${line}"]`);const r=row?.getBoundingClientRect();return Math.min(rect.bottom-12,Math.max(rect.top+18,r?r.top+r.height/2:rect.top+30))-box.top;};const x1=a.right-box.left,y1=rowY(left,left===n?n.callLine:n.parentLine,a),x2=b.left-box.left,y2=rowY(right,right.start,b);svg.innerHTML+=`<path d="M${x1} ${y1} C${(x1+x2)/2} ${y1},${(x1+x2)/2} ${y2},${x2} ${y2}" fill="none" stroke="#b4a0ca" stroke-width="1.5" marker-end="url(#canvasArrow)"/>`}});

 }
 function remove(id){for(const child of nodes.filter(n=>n.parent===id))remove(child.id);nodes=nodes.filter(n=>n.id!==id);for(const [key,ids]of expanded)if(ids.includes(id)||key.startsWith(id+':'))expanded.delete(key)}
 canvas.addEventListener('clear-question-selection',()=>{drag=null;for(const node of nodes){if(node.selected){delete node.selected;node.focus=null}}render()});
 function choose(id,start,end,event){const node=nodes.find(n=>n.id===id);if(!node)return;node.focus=start;node.selected={start,end};render();onSelect({path:node.path,start,end,text:node.text.split('\n').slice(start-node.start,end-node.start+1).join('\n'),snapshot:node.snapshot,x:event.clientX,y:event.clientY});}
 let drag=null;
 columns.onpointerdown=e=>{const button=e.target.closest('[data-select]');if(!button)return;e.preventDefault();drag={id:button.dataset.select,start:Number(button.dataset.line),end:Number(button.dataset.line)};button.setPointerCapture(e.pointerId)};
 columns.onpointermove=e=>{if(!drag)return;const row=document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-row-node]');if(row?.dataset.rowNode!==drag.id)return;drag.end=Number(row.dataset.rowLine);for(const el of columns.querySelectorAll('[data-row-node]'))el.classList.toggle('call-selected',el.dataset.rowNode===drag.id&&Number(el.dataset.rowLine)>=Math.min(drag.start,drag.end)&&Number(el.dataset.rowLine)<=Math.max(drag.start,drag.end));};
 columns.onpointerup=e=>{if(!drag)return;const range=drag;drag=null;choose(range.id,Math.min(range.start,range.end),Math.max(range.start,range.end),e)};
 columns.onpointercancel=()=>{drag=null};
 columns.onclick=async e=>{
 const select=e.target.closest('[data-select]'),expand=e.target.closest('[data-expand]'),question=e.target.closest('[data-ask-line]'),close=e.target.closest('[data-remove]');
 if(select&&e.detail===0){choose(select.dataset.select,Number(select.dataset.line),Number(select.dataset.line),e)}
 if(close){remove(close.dataset.remove);render()}
 if(question){const node=nodes.find(n=>n.id===question.dataset.askLine);choose(node.id,Number(question.dataset.line),Number(question.dataset.line),e)}
 if(expand){const node=nodes.find(n=>n.id===expand.dataset.nodeId),direction=expand.dataset.expand,line=Number(expand.dataset.line),key=node.id+':'+direction+':'+line;
 if(pending.has(key))return;
 if(expanded.has(key)){for(const id of expanded.get(key))remove(id);expanded.delete(key);render();return}
 pending.add(key);message.textContent='Finding '+direction+'…';
 try{const result=await load(node.path,line,direction,direction==='callers'?node.symbol:undefined,node);if(!alive||!nodes.includes(node))return;
 const children=result.blocks.map(block=>({...block,id:String(++serial),parent:node.id,parentLine:line,level:node.level+(direction==='callers'?-1:1),focus:direction==='callers'?block.callLine:block.start}));nodes.push(...children);expanded.set(key,children.map(n=>n.id));render();message.textContent=result.total?`${result.total} potential ${direction}${result.total>children.length?' · showing '+children.length:''}`:`No ${direction} found in indexed source.`;
 if(children.length)columns.querySelector(`[data-node="${children[0].id}"]`)?.scrollIntoView({behavior:'smooth',block:'nearest',inline:'center'});
 }catch(error){if(alive)message.textContent=error.message}finally{pending.delete(key)}
 }
 };
 try{
 if(!root)root=(await load(path,line,'root')).blocks[0];if(!alive)return;
 const entry={...root,id:String(++serial),level:0,focus:Math.min(root.end,Math.max(root.start,line))};nodes=[entry];render();message.textContent='Finding callers…';
 const result=await load(root.path,root.start,'callers',root.symbol);if(!alive)return;
 const children=result.blocks.map(block=>({...block,id:String(++serial),parent:entry.id,parentLine:root.start,level:-1,focus:block.callLine}));nodes.push(...children);expanded.set(entry.id+':callers:'+root.start,children.map(n=>n.id));render();message.textContent=result.total?`${result.total} caller${result.total===1?'':'s'} · expand arrows to traverse`:'No callers found at '+(root.snapshot||'this snapshot')+'.';
 }catch(error){if(alive)message.textContent=error.message}
}
