import {relationshipSummary} from './canvas-relationships.js';
import {icon} from './canvas-icons.js';
import {highlightCodeLines} from './code-highlighting.js';
export const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const esc=escapeHTML;
function codeRows(path,rows,before=false){const highlighted=highlightCodeLines(path,rows.map(row=>row.text).join('\n'));return `<div class="code-rows">${rows.map((row,i)=>`<div class="code-row ${row.kind}" data-code-line="${(before?row.old??row.line:row.line??row.old)??''}"><span class="line-no">${(before?row.old??row.line:row.line??row.old)??''}</span><span class="line-sign">${row.kind==='added'?'+':row.kind==='removed'?'−':''}</span><code>${highlighted[i]||' '}</code></div>`).join('')}</div>`}
export function createReviewCanvas({viewport,stage,world}){
 world.classList.add('no-wrap');
 let change=null,context={relations:[]},zoom=1,edges=[],drag=null;
 const revealed=new Set();
 function codeBlock(id,path,rows,summary,masked,before=false){const hidden=masked&&!revealed.has(id);return `<div class="code-mask ${hidden?'is-masked':''}" data-mask="${esc(id)}" data-source-side="${before?'before':'after'}">${hidden?`<div class="mask-overview"><button data-reveal="${esc(id)}" aria-label="Reveal code: ${esc(summary)}"><span class="mask-intro">This code</span><span>${esc(summary)}</span></button></div>`:''}${codeRows(path,rows,before)}</div>`}
 function revealButton(id){const open=revealed.has(id);return `<button type="button" class="icon-button" data-reveal="${esc(id)}" aria-label="${open?'Summarize':'Reveal'} code" title="${open?'Show overview':'Reveal code'}" aria-expanded="${open}">${icon(open?'hide':'eye')}</button>`}
 function central(){return `<article class="canvas-card change-card"><div class="card-heading"><div><div class="card-kicker">${icon('pulls')} This change <span class="chunk-counter">${esc(change.counter)}</span></div><h1>${esc(change.title)}</h1>${change.summary&&(change.blocks.length!==1||change.blocks[0].summary!==change.summary||revealed.has(change.blocks[0].id))?`<p class="chunk-summary">${esc(change.summary)}</p>`:''}</div></div>${change.blocks.map(block=>`<section class="change-block" data-block-id="${esc(block.id)}"><div class="block-heading"><span class="block-path">${esc(block.path)}</span><span class="change-counts"><span class="added-count">+${block.added}</span><span class="removed-count">−${block.removed}</span></span>${block.masked?revealButton(block.id):''}</div>${block.metadata?`<p class="metadata-note">${esc(block.summary)}</p>`:codeBlock(block.id,block.path,block.rows,block.summary,block.masked,block.deleted)}</section>`).join('')}${change.unavailable?.length?`<details class="unavailable"><summary>${change.unavailable.length} unavailable file${change.unavailable.length===1?'':'s'}</summary><ul>${change.unavailable.map(f=>`<li>${esc(f.path)} — ${esc(f.reason)}</li>`).join('')}</ul></details>`:''}${change.complete?`<div class="review-end">${icon('check')} All available changes reviewed</div>`:''}</article><div class="context-status" role="status" id="contextStatus"></div>`}
 function related(node){const textRows=node.text.split('\n').map((text,i)=>({text,line:node.start+i,kind:'context'})),summary=relationshipSummary(node);return `<article class="canvas-card context-card ${node.changed?'related-changed':''}" data-node-id="${esc(node.id)}"><div class="context-heading"><div><strong>${esc(node.symbol)}</strong><small>${esc(node.path)}:${node.start}–${node.end}</small></div>${textRows.length>1?revealButton(node.id):''}</div>${codeBlock(node.id,node.path,textRows,summary,textRows.length>1)}<div class="context-caption">${icon(node.direction==='callers'?'right':'left')} ${node.changed?'Also changed in this chunk':'Context · unchanged in this chunk'}${node.ambiguous||node.precision==='heuristic'?' · Possible call':''}${node.snapshot==='Before this change'?' · Before change':''}${node.clipped?' · Source excerpt':''}</div>${node.clipped&&revealed.has(node.id)?`<button class="expand-function" data-expand-node="${esc(node.id)}">Read full function (${node.fullEnd-node.start+1} lines)</button>`:''}</article>`}
 function render(reset=false){
  if(!change)return;
  const callers=context.relations.filter(n=>n.direction==='callers'),callees=context.relations.filter(n=>n.direction==='callees');
  world.innerHTML=`<svg class="canvas-links" aria-hidden="true"></svg><section class="canvas-column callers-column"><h2 class="canvas-column-title">Callers · where it is used</h2>${callers.map(related).join('')||'<div class="context-empty">'+(context.loading?'Tracing incoming calls…':context.error?'Connections unavailable.':'No in-repository callers at this change.')+'</div>'}</section><section class="canvas-column changed-column">${central()}</section><section class="canvas-column callees-column"><h2 class="canvas-column-title">Callees · what it uses</h2>${callees.map(related).join('')||'<div class="context-empty">'+(context.loading?'Tracing outgoing calls…':context.error?'Connections unavailable.':'No resolved in-repository callees at this change.')+'</div>'}</section>`;
  world.querySelectorAll('.code-mask.is-masked .code-rows').forEach(node=>node.setAttribute('aria-hidden','true'));
  edges=context.relations.flatMap(node=>node.edges.map(edge=>({...edge,nodeId:node.id,direction:node.direction,ambiguous:node.ambiguous||node.precision==='heuristic'})));
  references();
  const status=world.querySelector('#contextStatus');status.textContent=context.loading?'Tracing callers and callees…':context.error||context.message||(context.unresolved?context.unresolved+' call'+(context.unresolved===1?'':'s')+' could not be connected.':'');
  if(context.error){const retry=document.createElement('button');retry.textContent='Retry connections';retry.dataset.retryContext='';status.append(document.createElement('br'),retry)}
  if(context.nextPage!=null){const more=document.createElement('button');more.textContent=`Show more connections (${context.relations.length} of ${context.total})`;more.dataset.moreContext='';status.append(document.createElement('br'),more)}
  requestAnimationFrame(()=>{resize();if(reset)fit();else draw()});
 }
 function resize(){stage.style.width=Math.max(viewport.clientWidth,world.offsetWidth*zoom)+'px';stage.style.height=Math.max(viewport.clientHeight,world.offsetHeight*zoom)+'px';world.style.transform=`scale(${zoom})`;draw()}
 function fit(){zoom=Math.max(.35,Math.min(1,(viewport.clientWidth-40)/world.offsetWidth));resize();viewport.scrollTop=0;viewport.scrollLeft=Math.max(0,(stage.offsetWidth-viewport.clientWidth)/2)}
 function setZoom(next){const x=(viewport.scrollLeft+viewport.clientWidth/2)/zoom,y=(viewport.scrollTop+viewport.clientHeight/2)/zoom;zoom=Math.max(.35,Math.min(1.6,next));resize();viewport.scrollLeft=x*zoom-viewport.clientWidth/2;viewport.scrollTop=y*zoom-viewport.clientHeight/2}
 function findLine(container,line){const rows=[...container.querySelectorAll('[data-code-line]')].filter(el=>Number(el.dataset.codeLine)===line);return rows.find(el=>el.classList.contains('removed')===(container.querySelector('.code-mask')?.dataset.sourceSide==='before'))||rows[0]}
 function references(){
  world.querySelectorAll('.connection-reference').forEach(el=>el.remove());
  for(const edge of edges){const changed=[...world.querySelectorAll('[data-block-id]')].find(el=>el.dataset.blockId===edge.blockId),node=[...world.querySelectorAll('[data-node-id]')].find(el=>el.dataset.nodeId===edge.nodeId),left=edge.direction==='callers';
   for(const [container,line,kind]of [[changed,left?edge.targetLine:edge.callLine,left?'Function':'Call'],[node,left?edge.callLine:edge.targetLine,left?'Call':'Function']]){
    if(!container||findLine(container,line)||container.querySelector(`[data-reference-line="${line}"]`))continue;
    const ref=document.createElement('div');ref.className='connection-reference';ref.dataset.referenceLine=line;ref.textContent=`${kind}${kind==='Call'&&edge.scope==='function'?' elsewhere':''} at line ${line} · outside this excerpt`;container.querySelector('.code-mask')?.before(ref);
   }
  }
 }
 function draw(){
  const svg=world.querySelector('svg');if(!svg)return;svg.setAttribute('width',world.offsetWidth);svg.setAttribute('height',world.offsetHeight);svg.setAttribute('viewBox',`0 0 ${world.offsetWidth} ${world.offsetHeight}`);svg.replaceChildren();const base=world.getBoundingClientRect();
  world.querySelectorAll('.connection-line').forEach(el=>el.classList.remove('connection-line'));
  const labels=new Set();
  const endpoint=(container,line)=>{
   const row=findLine(container,line),reference=container.querySelector(`[data-reference-line="${line}"]`),el=row||reference;
   if(!el)return null;
   const rect=el.getBoundingClientRect(),height=row?parseFloat(getComputedStyle(row).lineHeight)*zoom:rect.height;
   const exact=rect.top+height/2;let y=exact,direction='';
   if(row){row.classList.add('connection-line');row.title=`Connected line ${line}`;const clip=row.closest('.code-rows').getBoundingClientRect(),top=clip.top+2*zoom,bottom=clip.bottom-2*zoom;y=Math.max(top,Math.min(bottom,exact));if(exact<top)direction=' ↑';else if(exact>bottom)direction=' ↓'}
   return {y:(y-base.top)/zoom,label:`L${line}${direction}`,outside:!!reference};
  };
  for(const edge of edges){const changed=[...world.querySelectorAll('[data-block-id]')].find(el=>el.dataset.blockId===edge.blockId),node=[...world.querySelectorAll('[data-node-id]')].find(el=>el.dataset.nodeId===edge.nodeId);if(!changed||!node)continue;
   const a=changed.getBoundingClientRect(),b=node.getBoundingClientRect(),left=edge.direction==='callers',root=endpoint(changed,left?edge.targetLine:edge.callLine),related=endpoint(node,left?edge.callLine:edge.targetLine);if(!root||!related)continue;
   const x1=((left?b.right:a.right)-base.left)/zoom,x2=((left?a.left:b.left)-base.left)/zoom,start=left?related:root,end=left?root:related,y1=start.y,y2=end.y,bend=(x1+x2)/2;
   const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',`M ${x1} ${y1} C ${bend} ${y1},${bend} ${y2},${x2} ${y2}`);path.dataset.callLine=edge.callLine;path.dataset.targetLine=edge.targetLine;if(edge.ambiguous)path.classList.add('uncertain');svg.append(path);
   for(const [cx,cy,point,side]of [[x1,y1,start,1],[x2,y2,end,-1]]){const key=`${cx}:${cy}:${point.label}`;if(labels.has(key))continue;labels.add(key);const dot=document.createElementNS(svg.namespaceURI,'circle');dot.setAttribute('cx',cx);dot.setAttribute('cy',cy);dot.setAttribute('r','4');svg.append(dot);const text=document.createElementNS(svg.namespaceURI,'text');text.setAttribute('x',cx+side*8);text.setAttribute('y',cy-6);text.setAttribute('text-anchor',side===1?'start':'end');text.textContent=point.label;svg.append(text)}
  }
 }
 world.onclick=event=>{const target=event.target.closest('[data-reveal]');if(!target)return;const id=target.dataset.reveal;if(revealed.has(id))revealed.delete(id);else revealed.add(id);render()};
 world.addEventListener('scroll',draw,true);
 const observer=new ResizeObserver(resize);observer.observe(world);window.addEventListener('resize',resize);
 viewport.addEventListener('pointerdown',event=>{if(event.button!==0||event.target.closest('button,a,input,textarea,.canvas-card'))return;drag={x:event.clientX,y:event.clientY,left:viewport.scrollLeft,top:viewport.scrollTop};viewport.classList.add('panning');viewport.setPointerCapture(event.pointerId)});
 viewport.addEventListener('pointermove',event=>{if(!drag)return;viewport.scrollLeft=drag.left-event.clientX+drag.x;viewport.scrollTop=drag.top-event.clientY+drag.y});
 const end=()=>{drag=null;viewport.classList.remove('panning')};viewport.addEventListener('pointerup',end);viewport.addEventListener('pointercancel',end);
 return {show(data){change=data;context={relations:[],loading:true};revealed.clear();render(true)},context(data){context=data;render()},fit,wrap(enabled){world.classList.toggle('no-wrap',!enabled);requestAnimationFrame(resize)},zoomIn(){setZoom(zoom+.15)},zoomOut(){setZoom(zoom-.15)}};
}
