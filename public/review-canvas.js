import {callerDefinitionForBlock} from './canvas-affordances.js';
import {displayCodeRows} from './canvas-preview.js';
import {canvasCommentary} from './canvas-commentary.js';
import {icon} from './canvas-icons.js';
import {highlightCodeLines} from './code-highlighting.js';
export const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const esc=escapeHTML;
let nextCanvas=0;
function codeRows(path,rows,before=false,id='',expandedRemoved=new Set()){const highlighted=highlightCodeLines(path,rows.map(row=>row.text).join('\n')),visible=displayCodeRows(rows,{expandedRemoved});return `<div class="code-rows">${visible.map(item=>{if(item.removed)return `<div class="removed-fold" data-removed-from="${item.from}" data-removed-to="${item.to}" data-removed-expanded="${item.expanded}"><button type="button" class="removed-toggle" data-toggle-removed="${esc(id)}" data-removed-index="${item.index}" aria-label="${item.expanded?'Collapse':'Expand'} ${item.count} removed line${item.count===1?'':'s'}" aria-expanded="${item.expanded}" title="${item.expanded?'Collapse':'Expand'} ${item.count} removed line${item.count===1?'':'s'}"><span class="fold-gutter">${icon(item.expanded?'fold':'unfold')}</span><span class="fold-caption">${item.expanded?'Hide ':''}${item.count} removed line${item.count===1?'':'s'}</span></button></div>`;const {row,index}=item;return `<div class="code-row ${row.kind}${item.removedExpanded?' removed-expanded':''}" tabindex="0" data-row-kind="${row.kind}" data-code-line="${(before?row.old??row.line:row.line??row.old)??''}"><span class="line-no">${(before?row.old??row.line:row.line??row.old)??''}</span><span class="line-sign">${row.kind==='added'?'+':row.kind==='removed'?'−':''}</span><code>${highlighted[index]||' '}</code></div>`}).join('')}</div>`}

export function createReviewCanvas({viewport,stage,world,fileURL=()=>null,onExpand=()=>{},onChat=()=>{},onLayout=()=>{}}){
 world.classList.add('no-wrap');
 let change=null,context={relations:[]},zoom=1,edges=[],drag=null,affordances={},hovered=null,lastHovered=null,commentary=[];
 const dismissedCommentary=new Set(),removedExpanded=new Map(),arrowId='canvas-note-arrow-'+(++nextCanvas);
 function codeBlock(id,path,rows,before=false){return `<div class="code-source" data-source-block="${esc(id)}" data-source-side="${before?'before':'after'}">${codeRows(path,rows,before,id,removedExpanded.get(id))}</div>`}
 function fileLink(path,className=''){const href=fileURL(path);return href?`<a class="${className}" href="${esc(href)}" target="_blank" rel="noopener" title="Browse ${esc(path)} in a new tab">${esc(path)}</a>`:`<span class="${className}">${esc(path)}</span>`}
 function fileGroups(){
  const files=new Map();
  for(const block of change.blocks){const key=block.key||block.path;if(!files.has(key))files.set(key,[]);files.get(key).push(block)}
  return files;
 }
 function fileCard(key,blocks){
  return `<article class="canvas-card change-card file-card" data-file-card="${esc(key)}"><div class="block-heading file-card-heading">${fileLink(blocks[0].path,'block-path')}<span class="change-counts"><span class="added-count">+${blocks.reduce((sum,block)=>sum+block.added,0)}</span><span class="removed-count">−${blocks.reduce((sum,block)=>sum+block.removed,0)}</span></span></div>${blocks.map(block=>`<section class="change-block" data-block-id="${esc(block.id)}" data-file-key="${esc(block.key)}">${block.metadata?`<p class="metadata-note">${esc(block.summary)}</p>`:codeBlock(block.id,block.path,block.rows,block.deleted)}</section>`).join('')}</article>`;
 }
 function central(){return `<header class="card-heading change-heading"><div><div class="card-kicker">${icon('pulls')} This change <span aria-hidden="true">·</span><span class="chunk-counter">${esc(change.counter)}</span></div><h1>${esc(change.title)}</h1></div></header>${[...fileGroups()].map(([key,blocks])=>fileCard(key,blocks)).join('')}${change.unavailable?.length?`<details class="unavailable"><summary>${change.unavailable.length} unavailable file${change.unavailable.length===1?'':'s'}</summary><ul>${change.unavailable.map(f=>`<li>${esc(f.path)} — ${esc(f.reason)}</li>`).join('')}</ul></details>`:''}${change.complete?`<div class="review-end">${icon('check')} All available changes reviewed</div>`:''}`}
 function related(node){const textRows=node.text.split('\n').map((text,i)=>({text,line:node.start+i,kind:'context'}));return `<article class="canvas-card context-card ${node.changed?'related-changed':''}" data-node-id="${esc(node.id)}"><div class="context-heading"><div><strong>${esc(node.symbol)}</strong><small>${fileLink(node.path)}:${node.start}–${node.end}</small></div></div>${codeBlock(node.id,node.path,textRows,node.snapshot==='Before this change')}<div class="context-caption">${icon(node.direction==='callers'?'right':'left')} ${node.changed?'Also changed in this chunk':'Context · unchanged in this chunk'}${node.ambiguous||node.precision==='heuristic'?' · Possible call':''}${node.snapshot==='Before this change'?' · Before change':''}${node.clipped?' · Source excerpt':''}</div>${node.clipped?`<button class="expand-function" data-expand-node="${esc(node.id)}">Read full function (${node.fullEnd-node.start+1} lines)</button>`:''}</article>`}
 function requestCard(request){const type=request.selection.direction,failed=request.status==='error',loading=request.status==='loading';return `<div class="connection-load" role="status">${loading?'<span class="spinner" aria-hidden="true"></span>':''}<strong>${loading?'Finding '+type+'…':failed?'Could not load '+type:request.total?'Loaded '+request.total+' '+type:'No '+type+' found'}</strong><small>${esc(request.selection.path)}:${request.selection.line}</small>${failed?`<p>${esc(request.error)}</p><button data-retry-request="${esc(request.id)}">Try again</button>`:request.nextPage!=null?`<button data-more-request="${esc(request.id)}">Show more ${type}</button>`:''}</div>`}
 function render(reset=false){
  if(!change)return;hideHover();
  const scroll=new Map([...world.querySelectorAll('[data-source-block]')].map(el=>[el.dataset.sourceBlock,{top:el.querySelector('.code-rows').scrollTop,left:el.querySelector('.code-rows').scrollLeft}]));
  const requests=context.requests||[],levelOf=node=>node.level??(node.direction==='callers'?-1:1),requestLevel=request=>request.selection.level+(request.selection.direction==='callers'?-1:1);
  const levels=[...new Set([0,...context.relations.map(levelOf),...requests.map(requestLevel)])].sort((a,b)=>a-b);
  const slots=levels.flatMap(level=>level===0&&commentary.length?(levels.some(value=>value<0)?[0,'notes']:['notes',0]):[level]),widthOf=slot=>slot==='notes'?280:slot===0?600:330;
  world.style.gridTemplateColumns=slots.map(slot=>widthOf(slot)+'px').join(' ');world.style.width=(160+slots.reduce((sum,slot)=>sum+widthOf(slot),0)+95*(slots.length-1))+'px';world.style.minHeight='';
  world.innerHTML=`<svg class="canvas-links" aria-hidden="true"></svg>${slots.map(level=>level==='notes'?'<section class="canvas-column commentary-column" aria-hidden="true"></section>':`<section class="canvas-column ${level===0?'changed-column':level<0?'callers-column':'callees-column'}" data-level="${level}">${level===0?central():`<h2 class="canvas-column-title">${level<0?'Callers · where it is used':'Callees · what it uses'}</h2>`}${context.relations.filter(node=>levelOf(node)===level).map(related).join('')}${requests.filter(request=>requestLevel(request)===level&&(request.status!=='done'||!request.total||request.nextPage!=null)).map(requestCard).join('')}</section>`).join('')}<button class="connection-plus primary" data-expand-connection="callers" hidden>${icon('plus')}</button><button class="connection-plus primary" data-expand-connection="callees" hidden>${icon('plus')}</button><button class="connection-plus connection-chat" data-chat-line hidden aria-label="Ask AI about this line" title="Ask AI about this line">${icon('chat')}</button>${commentary.filter(note=>!dismissedCommentary.has(note.anchorId)).map(note=>`<aside class="step-commentary" data-commentary="${esc(note.anchorId)}" role="note" aria-label="AI commentary for ${esc(note.path)} line ${note.line}"><div class="step-commentary-heading"><span title="${esc(note.path)}:${note.line}">AI note · ${esc(note.path.split('/').at(-1))}:${note.line}</span><button class="primary" data-dismiss-commentary="${esc(note.anchorId)}">OK</button></div><p>${esc(note.text)}</p></aside>`).join('')}`;
  world.querySelectorAll('[data-source-block]').forEach(el=>{const prior=scroll.get(el.dataset.sourceBlock);if(prior){el.querySelector('.code-rows').scrollTop=prior.top;el.querySelector('.code-rows').scrollLeft=prior.left}});
  edges=context.relations.flatMap(node=>node.edges.map(edge=>({...edge,sourceSide:node.snapshot==='Before this change'?'before':'after',nodeId:node.id,direction:node.direction,ambiguous:node.ambiguous||node.precision==='heuristic'})));
  references();requestAnimationFrame(()=>{resize();if(reset)fit();else draw()});
 }
 function resize(){stage.style.width=Math.max(viewport.clientWidth,world.offsetWidth*zoom)+'px';stage.style.height=Math.max(viewport.clientHeight,world.offsetHeight*zoom)+'px';world.style.left=Math.max(0,(viewport.clientWidth-world.offsetWidth*zoom)/2)+'px';world.style.transform=`scale(${zoom})`;draw();positionHover()}
 function fit(){zoom=Math.max(.35,Math.min(1,(viewport.clientWidth-40)/world.offsetWidth));resize();viewport.scrollTop=0;viewport.scrollLeft=Math.max(0,(stage.offsetWidth-viewport.clientWidth)/2)}
 function setZoom(next){const x=(viewport.scrollLeft+viewport.clientWidth/2)/zoom,y=(viewport.scrollTop+viewport.clientHeight/2)/zoom;zoom=Math.max(.35,Math.min(1.6,next));resize();viewport.scrollLeft=x*zoom-viewport.clientWidth/2;viewport.scrollTop=y*zoom-viewport.clientHeight/2}
 function findLine(container,line,before=container.querySelector('.code-source')?.dataset.sourceSide==='before'){
  const rows=[...container.querySelectorAll('[data-code-line]')].filter(el=>Number(el.dataset.codeLine)===line),fold=before?[...container.querySelectorAll('.removed-fold[data-removed-expanded="false"]')].find(el=>line>=Number(el.dataset.removedFrom)&&line<=Number(el.dataset.removedTo)):null;
  return (before?rows.find(el=>el.dataset.rowKind==='removed')||fold:rows.find(el=>el.dataset.rowKind!=='removed'))||rows.find(el=>el.dataset.rowKind==='context');
 }

 function references(){
  world.querySelectorAll('.connection-reference').forEach(el=>el.remove());
  for(const edge of edges){const changed=[...world.querySelectorAll('[data-block-id]')].find(el=>el.dataset.blockId===edge.blockId)||[...world.querySelectorAll('[data-node-id]')].find(el=>el.dataset.nodeId===edge.blockId),node=[...world.querySelectorAll('[data-node-id]')].find(el=>el.dataset.nodeId===edge.nodeId),left=edge.direction==='callers';
   for(const [container,line,kind]of [[changed,edge.anchorLine??(left?edge.targetLine:edge.callLine),left?'Function':'Call'],[node,left?edge.callLine:edge.targetLine,left?'Call':'Function']]){
    if(!container||findLine(container,line,edge.sourceSide==='before')||container.querySelector(`[data-reference-line="${line}"]`))continue;
    const ref=document.createElement('div');ref.className='connection-reference';ref.dataset.referenceLine=line;ref.textContent=`${kind}${kind==='Call'&&edge.scope==='function'?' elsewhere':''} at line ${line} · outside this excerpt`;container.querySelector('.code-source')?.before(ref);
   }
  }
 }
 function draw(){
  const svg=world.querySelector('svg');if(!svg)return;svg.setAttribute('width',world.offsetWidth);svg.setAttribute('height',world.offsetHeight);svg.setAttribute('viewBox',`0 0 ${world.offsetWidth} ${world.offsetHeight}`);svg.replaceChildren();const base=world.getBoundingClientRect();
  world.querySelectorAll('.connection-line').forEach(el=>el.classList.remove('connection-line'));
  const labels=new Set();
  const endpoint=(container,line,before)=>{
   const row=findLine(container,line,before),reference=container.querySelector(`[data-reference-line="${line}"]`),el=row||reference;
   if(!el)return null;
   const rect=el.getBoundingClientRect(),height=row&&!row.classList.contains('removed-fold')?parseFloat(getComputedStyle(row).lineHeight)*zoom:rect.height;
   const exact=rect.top+height/2;let y=exact,direction='';
   if(row){row.classList.add('connection-line');row.title=`Connected line ${line}`;const clip=row.closest('.code-rows').getBoundingClientRect(),top=clip.top+2*zoom,bottom=clip.bottom-2*zoom;y=Math.max(top,Math.min(bottom,exact));if(exact<top)direction=' ↑';else if(exact>bottom)direction=' ↓'}
   return {y:(y-base.top)/zoom,label:`L${line}${direction}`,outside:!!reference};
  };
  for(const edge of edges){const changed=[...world.querySelectorAll('[data-block-id]')].find(el=>el.dataset.blockId===edge.blockId)||[...world.querySelectorAll('[data-node-id]')].find(el=>el.dataset.nodeId===edge.blockId),node=[...world.querySelectorAll('[data-node-id]')].find(el=>el.dataset.nodeId===edge.nodeId);if(!changed||!node)continue;
   const a=changed.getBoundingClientRect(),b=node.getBoundingClientRect(),left=edge.direction==='callers',root=endpoint(changed,edge.anchorLine??(left?edge.targetLine:edge.callLine),edge.sourceSide==='before'),related=endpoint(node,left?edge.callLine:edge.targetLine,edge.sourceSide==='before');if(!root||!related)continue;
   const x1=((left?b.right:a.right)-base.left)/zoom,x2=((left?a.left:b.left)-base.left)/zoom,start=left?related:root,end=left?root:related,y1=start.y,y2=end.y,bend=(x1+x2)/2;
   const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',`M ${x1} ${y1} C ${bend} ${y1},${bend} ${y2},${x2} ${y2}`);path.dataset.callLine=edge.callLine;path.dataset.targetLine=edge.targetLine;if(edge.ambiguous)path.classList.add('uncertain');svg.append(path);
   for(const [cx,cy,point,side]of [[x1,y1,start,1],[x2,y2,end,-1]]){const key=`${cx}:${cy}:${point.label}`;if(labels.has(key))continue;labels.add(key);const dot=document.createElementNS(svg.namespaceURI,'circle');dot.setAttribute('cx',cx);dot.setAttribute('cy',cy);dot.setAttribute('r','4');svg.append(dot);const text=document.createElementNS(svg.namespaceURI,'text');text.setAttribute('x',cx+side*8);text.setAttribute('y',cy-6);text.setAttribute('text-anchor',side===1?'start':'end');text.textContent=point.label;svg.append(text)}
  }
  drawCommentary(svg,base);onLayout();
 }
 function drawCommentary(svg,base){
  world.querySelectorAll('.commentary-line').forEach(row=>row.classList.remove('commentary-line'));
  const rail=world.querySelector('.commentary-column');if(!rail)return;
  const defs=document.createElementNS(svg.namespaceURI,'defs'),marker=document.createElementNS(svg.namespaceURI,'marker');marker.id=arrowId;marker.setAttribute('viewBox','0 0 10 10');marker.setAttribute('refX','9');marker.setAttribute('refY','5');marker.setAttribute('markerWidth','6');marker.setAttribute('markerHeight','6');marker.setAttribute('orient','auto');const tip=document.createElementNS(svg.namespaceURI,'path');tip.classList.add('commentary-arrowhead');tip.setAttribute('d','M 0 0 L 10 5 L 0 10 z');marker.append(tip);defs.append(marker);svg.append(defs);
  const railRect=rail.getBoundingClientRect(),x=(railRect.left-base.left)/zoom;
  let bottom=(railRect.top-base.top)/zoom;
  const notes=commentary.filter(note=>!dismissedCommentary.has(note.anchorId)).map(note=>({note,anchor:lineAnchor(note)})).filter(item=>item.anchor).sort((a,b)=>a.anchor.y-b.anchor.y);
  for(const {note,anchor}of notes){
   const element=[...world.querySelectorAll('[data-commentary]')].find(el=>el.dataset.commentary===note.anchorId),container=[...world.querySelectorAll('[data-block-id]')].find(el=>el.dataset.blockId===note.anchorId),row=container&&findLine(container,note.line,false);
   if(!element||!row)continue;
   const rowRect=row.getBoundingClientRect(),clip=row.closest('.code-rows').getBoundingClientRect(),lineY=rowRect.top+parseFloat(getComputedStyle(row).lineHeight)*zoom/2;
   element.hidden=lineY<clip.top||lineY>clip.bottom;if(element.hidden)continue;
   const height=element.offsetHeight,y=Math.max(bottom,anchor.y-height/2);element.style.left=x+'px';element.style.top=y+'px';bottom=y+height+16;row.classList.add('commentary-line');
   const left=x<anchor.left,from=left?x+element.offsetWidth:x,to=left?anchor.left:anchor.right,noteY=y+height/2,bend=(from+to)/2;
   const path=document.createElementNS(svg.namespaceURI,'path');path.classList.add('commentary-connector');path.dataset.commentaryAnchor=note.anchorId;path.dataset.targetLine=note.line;path.setAttribute('d',`M ${from} ${noteY} C ${bend} ${noteY},${bend} ${anchor.y},${to} ${anchor.y}`);path.setAttribute('marker-end',`url(#${arrowId})`);svg.append(path);
  }
  world.style.minHeight=bottom+104+'px';
 }
 function hideHover(){hovered=null;lastHovered=null;world.querySelectorAll('[data-expand-connection],[data-chat-line]').forEach(button=>button.hidden=true)}
 function hover(row){
  if(!row||!row.querySelector('code')){hideHover();return}
  const blockElement=row.closest('[data-block-id]'),nodeElement=row.closest('[data-node-id]'),block=change?.blocks.find(block=>block.id===blockElement?.dataset.blockId),node=context.relations.find(node=>node.id===nodeElement?.dataset.nodeId);
  if(!block&&!node){hideHover();return}
  const snapshot=row.dataset.rowKind==='removed'||row.closest('.code-source').dataset.sourceSide==='before'?'before':'after',source=block?affordances[snapshot]?.[block.key]:node.affordances,line=Number(row.dataset.codeLine),fn=source?.functions.filter(fn=>fn.start<=line&&fn.end>=line).sort((a,b)=>(a.end-a.start)-(b.end-b.start))[0];
  const changed=!!block&&['added','removed'].includes(row.dataset.rowKind);
  const actions={callers:!!callerDefinitionForBlock(block,source?.functions||[],line,snapshot),callees:changed&&source?.calls.includes(line)};
  lastHovered=row;hovered={row,container:blockElement||nodeElement,actions,selection:{path:block?(source?.path||(snapshot==='before'?block.previousPath||block.path:block.path)):node.path,line,snapshot,anchorId:block?.id||node.id,level:block?0:node.level??(node.direction==='callers'?-1:1),symbol:fn?.symbol||node?.symbol||'this line'}};
  for(const button of world.querySelectorAll('[data-expand-connection]')){const direction=button.dataset.expandConnection,requested=(context.requests||[]).some(request=>['loading','done'].includes(request.status)&&request.selection.direction===direction&&['path','line','snapshot','anchorId','level'].every(key=>request.selection[key]===hovered.selection[key]));button.hidden=!actions[direction]||requested;button.setAttribute('aria-label',`Show ${button.dataset.expandConnection} for ${hovered.selection.symbol} at line ${line}`);button.title=`Show ${button.dataset.expandConnection}`}
  world.querySelector('[data-chat-line]').hidden=false;positionHover();
 }
 function positionHover(){if(!hovered)return;if(!hovered.row.isConnected){hideHover();return}const base=world.getBoundingClientRect(),rect=hovered.container.closest('.canvas-card').getBoundingClientRect(),row=hovered.row.getBoundingClientRect(),clip=hovered.row.closest('.code-rows').getBoundingClientRect(),y=row.top+parseFloat(getComputedStyle(hovered.row).lineHeight)*zoom/2;if(y<clip.top||y>clip.bottom){hideHover();return}for(const button of world.querySelectorAll('[data-expand-connection],[data-chat-line]')){const caller=button.dataset.expandConnection==='callers',offset=button.hasAttribute('data-chat-line')?20:-12;button.style.left=((caller?rect.left:rect.right)-base.left)/zoom+offset+'px';button.style.top=(y-base.top)/zoom-12+'px'}}
 function lineAnchor(selection){const container=[...world.querySelectorAll('[data-block-id],[data-node-id]')].find(el=>(el.dataset.blockId||el.dataset.nodeId)===selection.anchorId);if(!container)return null;const row=findLine(container,selection.line,selection.snapshot==='before'),base=world.getBoundingClientRect(),rect=container.getBoundingClientRect();let y=rect.top+35*zoom;if(row){const line=row.getBoundingClientRect(),clip=row.closest('.code-rows').getBoundingClientRect(),height=row.classList.contains('removed-fold')?line.height:parseFloat(getComputedStyle(row).lineHeight)*zoom;y=Math.max(clip.top+2*zoom,Math.min(clip.bottom-2*zoom,line.top+height/2))}return {x:(rect.right-base.left)/zoom,y:(y-base.top)/zoom,left:(rect.left-base.left)/zoom,right:(rect.right-base.left)/zoom,top:(rect.top-base.top)/zoom,bottom:(rect.bottom-base.top)/zoom}}

 world.addEventListener('pointerover',event=>{if(event.target.closest('.removed-fold')){hideHover();return}if(event.target.closest('[data-expand-connection],[data-chat-line]')){return}const row=event.target.closest('.code-row');if(row)hover(row)});
 world.addEventListener('pointermove',event=>{if(event.target.closest('.code-row,[data-expand-connection],[data-chat-line]'))return;if(!hovered){lastHovered=null;return}const rect=hovered.container.getBoundingClientRect(),row=hovered.row.getBoundingClientRect(),y=row.top+parseFloat(getComputedStyle(hovered.row).lineHeight)*zoom/2;if(event.clientX<rect.left-40*zoom||event.clientX>rect.right+70*zoom||Math.abs(event.clientY-y)>16*zoom)hideHover()});
 world.addEventListener('pointerleave',hideHover);
 world.addEventListener('focusin',event=>{if(event.target.closest('[data-expand-connection],[data-chat-line]'))return;hover(event.target.closest('.code-row'))});
 world.addEventListener('focusout',event=>{if(world.contains(event.relatedTarget))return;hideHover()});
 world.onclick=event=>{const removed=event.target.closest('[data-toggle-removed]');if(removed){const id=removed.dataset.toggleRemoved,index=Number(removed.dataset.removedIndex),expanded=removedExpanded.get(id)||new Set();if(expanded.has(index))expanded.delete(index);else expanded.add(index);removedExpanded.set(id,expanded);render();world.querySelectorAll('[data-toggle-removed]').forEach(button=>{if(button.dataset.toggleRemoved===id&&Number(button.dataset.removedIndex)===index)button.focus({preventScroll:true})});return}const dismiss=event.target.closest('[data-dismiss-commentary]');if(dismiss){dismissedCommentary.add(dismiss.dataset.dismissCommentary);dismiss.closest('.step-commentary').remove();draw();return}const chat=event.target.closest('[data-chat-line]');if(chat&&hovered){const selection={...hovered.selection};hideHover();onChat(selection);return}const expand=event.target.closest('[data-expand-connection]');if(expand&&hovered){const selection={...hovered.selection,direction:expand.dataset.expandConnection};hideHover();onExpand(selection);return}};
 world.addEventListener('scroll',()=>{draw();positionHover()},true);
 const observer=new ResizeObserver(resize);observer.observe(world);window.addEventListener('resize',resize);
 viewport.addEventListener('pointerdown',event=>{if(event.button!==0||event.target.closest('button,a,input,textarea,.canvas-card,.connection-load,.canvas-chat,.step-commentary'))return;drag={x:event.clientX,y:event.clientY,left:viewport.scrollLeft,top:viewport.scrollTop};viewport.classList.add('panning');viewport.setPointerCapture(event.pointerId)});
 viewport.addEventListener('pointermove',event=>{if(!drag)return;viewport.scrollLeft=drag.left-event.clientX+drag.x;viewport.scrollTop=drag.top-event.clientY+drag.y});
 const end=()=>{drag=null;viewport.classList.remove('panning')};viewport.addEventListener('pointerup',end);viewport.addEventListener('pointercancel',end);
 return {show(data){change=data;commentary=canvasCommentary(data);dismissedCommentary.clear();context={relations:[],requests:[]};affordances={};removedExpanded.clear();render(true)},context(data){context=data;render()},affordances(data){affordances=data;if(lastHovered?.isConnected)hover(lastHovered)},geometry(){const notes=[...world.querySelectorAll('.step-commentary:not([hidden])')];return {zoom,left:parseFloat(world.style.left)||0,width:Math.max(world.offsetWidth,...notes.map(note=>note.offsetLeft+note.offsetWidth+40)),height:Math.max(world.offsetHeight,...notes.map(note=>note.offsetTop+note.offsetHeight+40)),anchor:lineAnchor}},fit,wrap(enabled){world.classList.toggle('no-wrap',!enabled);requestAnimationFrame(resize)},zoomIn(){setZoom(zoom+.15)},zoomOut(){setZoom(zoom-.15)}};
}
