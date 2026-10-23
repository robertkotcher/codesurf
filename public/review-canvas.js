import {renderCanvasComments} from './canvas-comments.js';
import {createCanvasVariables} from './canvas-variables.js';
import {mergeVariableBindings} from './variable-data.js';
import {displayCodeRows} from './canvas-preview.js';
import {icon} from './canvas-icons.js';
import {highlightCodeLines} from './code-highlighting.js';
export const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const esc=escapeHTML;
function codeRows(path,rows,before=false,id='',expandedRemoved=new Set()){const highlighted=highlightCodeLines(path,rows.map(row=>row.text).join('\n')),visible=displayCodeRows(rows,{expandedRemoved:new Set(rows.flatMap((row,index)=>expandedRemoved.has(row.old??row.line)?[index]:[]))});return `<div class="code-rows">${visible.map(item=>{if(item.removed)return `<div class="removed-fold" data-removed-from="${item.from}" data-removed-to="${item.to}" data-removed-expanded="${item.expanded}"><button type="button" class="removed-toggle" data-toggle-removed="${esc(id)}" data-removed-index="${item.from}" aria-label="${item.expanded?'Collapse':'Expand'} ${item.count} removed line${item.count===1?'':'s'}" aria-expanded="${item.expanded}" title="${item.expanded?'Collapse':'Expand'} ${item.count} removed line${item.count===1?'':'s'}"><span class="fold-gutter">${icon(item.expanded?'fold':'unfold')}</span><span class="fold-caption">${item.expanded?'Hide ':''}${item.count} removed line${item.count===1?'':'s'}</span></button></div>`;const {row,index}=item;return `<div class="code-row ${row.kind}${item.removedExpanded?' removed-expanded':''}" tabindex="0" data-row-kind="${row.kind}" data-code-line="${(before?row.old??row.line:row.line??row.old)??''}"><span class="line-no">${(before?row.old??row.line:row.line??row.old)??''}</span><span class="line-sign">${row.kind==='added'?'+':row.kind==='removed'?'−':''}</span><code>${highlighted[index]||' '}</code></div>`}).join('')}</div>`}

export function createReviewCanvas({viewport,stage,world,fileURL=()=>null,onExpand=()=>{},onChat=()=>{},onExcerpt=()=>{},commentActions={},onLayout=()=>{}}){
 world.classList.add('no-wrap');
 let change=null,context={relations:[]},zoom=1,edges=[],drag=null,affordances={},hovered=null,lastHovered=null,centeredScroll=0,sourceRanges={};
 const removedExpanded=new Map(),expandedThreads=new Set();
 const variables=createCanvasVariables({world,viewport,zoom:()=>zoom,fileURL});
 function codeBlock(id,path,original,before=false,metadata=sourceRanges[id]){
  const extra=context.excerpts?.[id],coordinate=row=>before?row.old:row.line,numbers=original.map(coordinate).filter(Number.isInteger),from=Math.min(...numbers),to=Math.max(...numbers),added=extra?.rows||[],rows=[...added.filter(row=>coordinate(row)<from),...original,...added.filter(row=>coordinate(row)>to)];
  const range=metadata?{...metadata,...extra?{start:Math.min(metadata.start,extra.start),end:Math.max(metadata.end,extra.end)}:{} }:null,loading=!!context.excerptLoading?.[id];
  const controls=direction=>range&&((direction==='up'&&range.start>1)||(direction==='down'&&range.end<range.totalLines))?`<div class="source-expansion"><button type="button" data-expand-excerpt="${esc(id)}" data-excerpt-direction="${direction}" ${loading?'disabled':''}>${loading?'<span class="spinner" aria-hidden="true"></span>':icon(direction==='up'?'up':'down')}<span>Expand ${direction==='up'?'above':'below'}</span></button></div>`:'';
  return `<div class="code-source" data-source-block="${esc(id)}" data-source-side="${before?'before':'after'}" ${range?`data-source-range="${esc(JSON.stringify(range))}"`:''}>${controls('up')}${codeRows(path,rows,before,id,removedExpanded.get(id))}${controls('down')}${context.excerptErrors?.[id]?`<p class="source-expansion-error" role="status">${esc(context.excerptErrors[id])}</p>`:''}</div>`;
 }
 function rowSource(row){
  const element=row.closest('[data-block-id],[data-node-id]'),block=change?.blocks.find(block=>block.id===element?.dataset.blockId),node=context.relations.find(node=>node.id===element?.dataset.nodeId),snapshot=row.dataset.rowKind==='removed'||row.closest('.code-source').dataset.sourceSide==='before'?'before':'after';
  const base=block?affordances[snapshot]?.[block.key]:node?.affordances,extra=context.excerpts?.[block?.id||node?.id],matching=extra&&snapshot===(block?(block.deleted?'before':'after'):node?.snapshot==='Before this change'?'before':'after')?extra.affordances:null;
  if(!block&&!node)return null;
  const source={...base,...matching,calls:[...new Set([...(base?.calls||[]),...matching?.calls||[]])],functions:matching?.functions||base?.functions||[],variables:mergeVariableBindings(base?.variables,matching?.variables),tokens:[...new Map([...(base?.tokens||[]),...matching?.tokens||[]].map(token=>[token.line+':'+token.column,token])).values()]};
  return {element,block,node,source,snapshot,line:Number(row.dataset.codeLine),selection:{path:source.path||node?.path||(snapshot==='before'?block.previousPath||block.path:block.path),line:Number(row.dataset.codeLine),snapshot,anchorId:block?.id||node.id,level:block?0:node.level??(node.direction==='callers'?-1:1)}};
 }
 function fileLink(path,className=''){const href=fileURL(path);return href?`<a class="${className}" href="${esc(href)}" target="_blank" rel="noopener" title="Browse ${esc(path)} in a new tab">${esc(path)}</a>`:`<span class="${className}">${esc(path)}</span>`}
 function fileGroups(){
  const files=new Map();
  for(const block of change.blocks){const key=block.key||block.path;if(!files.has(key))files.set(key,[]);files.get(key).push(block)}
  return files;
 }
 function fileCard(key,blocks){
  return `<article class="canvas-card change-card file-card" data-file-card="${esc(key)}"><div class="block-heading file-card-heading">${fileLink(blocks[0].path,'block-path')}<span class="change-counts"><span class="added-count">+${blocks.reduce((sum,block)=>sum+block.added,0)}</span><span class="removed-count">−${blocks.reduce((sum,block)=>sum+block.removed,0)}</span></span></div>${blocks.map(block=>`<section class="change-block" data-block-id="${esc(block.id)}" data-file-key="${esc(block.key)}">${block.metadata?`<p class="metadata-note">${esc(block.summary)}</p>`:codeBlock(block.id,block.path,block.rows,block.deleted)}</section>`).join('')}</article>`;
 }
 function central(){return `${[...fileGroups()].map(([key,blocks])=>fileCard(key,blocks)).join('')}${change.unavailable?.length?`<details class="unavailable"><summary>${change.unavailable.length} unavailable file${change.unavailable.length===1?'':'s'}</summary><ul>${change.unavailable.map(f=>`<li>${esc(f.path)} — ${esc(f.reason)}</li>`).join('')}</ul></details>`:''}${change.complete?`<div class="review-end">${icon('check')} All available changes reviewed</div>`:''}`}
 function related(node){if(node.library)return `<article class="canvas-card context-card library-card" data-node-id="${esc(node.id)}" data-library-line="${node.start}"><div class="context-heading"><div><strong>${esc(node.symbol)}</strong><small>${esc(node.library.name)} · ${esc(node.library.version)} · Library function</small></div></div><div class="library-details"><p>${esc(node.library.explanation||node.library.description)}</p><small>${esc(node.library.owner)}</small><a href="${esc(node.library.url)}" target="_blank" rel="noopener">About ${esc(node.library.name)}</a></div></article>`;const textRows=node.text.split('\n').map((text,i)=>({text,line:node.start+i,kind:'context'}));return `<article class="canvas-card context-card ${node.changed?'related-changed':''}" data-node-id="${esc(node.id)}"><div class="context-heading"><div><strong>${esc(node.symbol)}</strong><small>${fileLink(node.path)}:${node.start}–${node.end}</small></div></div>${codeBlock(node.id,node.path,textRows,node.snapshot==='Before this change',{path:node.path,snapshot:node.snapshot==='Before this change'?'before':'after',anchorId:node.id,level:node.level,start:node.start,end:node.end,totalLines:node.totalLines||node.end})}<div class="context-caption">${icon(node.direction==='callers'?'right':'left')} ${node.changed?'Also changed in this chunk':'Context · unchanged in this chunk'}${node.ambiguous||node.precision==='heuristic'?' · Possible call':''}${node.snapshot==='Before this change'?' · Before change':''}${node.clipped?' · Source excerpt':''}</div>${node.clipped?`<button class="expand-function" data-expand-node="${esc(node.id)}">Read full function (${node.fullEnd-node.start+1} lines)</button>`:''}</article>`}
 function requestCard(request){const type=request.selection.direction,failed=request.status==='error',loading=request.status==='loading';return `<div class="connection-load" role="status">${loading?'<span class="spinner" aria-hidden="true"></span>':''}<strong>${loading?'Finding '+type+'…':failed?'Could not load '+type:request.total?'Loaded '+request.total+' '+type:'No '+type+' found'}</strong><small>${esc(request.selection.path)}:${request.selection.line}</small>${failed?`<p>${esc(request.error)}</p><button data-retry-request="${esc(request.id)}">Try again</button>`:request.nextPage!=null?`<button data-more-request="${esc(request.id)}">Show more ${type}</button>`:''}</div>`}
 function render(reset=false){
  if(!change)return;variables.reset();closeFunctionMenu();hideHover();
  const active=document.activeElement,editing=world.contains(active)&&active.matches('[data-comment-input]')?{key:active.dataset.commentInput,start:active.selectionStart,end:active.selectionEnd}:null;
  const scroll=new Map([...world.querySelectorAll('[data-source-block]')].map(el=>[el.dataset.sourceBlock,{top:el.querySelector('.code-rows').scrollTop,left:el.querySelector('.code-rows').scrollLeft}]));
  const requests=(context.requests||[]).filter(request=>request.status!=='empty'&&!(request.status==='done'&&!request.total)),levelOf=node=>node.level??(node.direction==='callers'?-1:1),requestLevel=request=>request.selection.level+(request.selection.direction==='callers'?-1:1);
  const levels=[...new Set([0,...context.relations.map(levelOf),...requests.map(requestLevel)])].sort((a,b)=>a-b);
  const slots=levels,widthOf=slot=>slot===0?600:330;
  const main=slots.indexOf(0),left=slots.slice(0,main).reduce((sum,slot)=>sum+widthOf(slot)+95,0),right=slots.slice(main+1).reduce((sum,slot)=>sum+widthOf(slot)+95,0),side=Math.max(left,right);
  // Keep the change column centered as related function cards are opened.
  world.style.paddingLeft=80+side-left+'px';world.style.paddingRight=80+side-right+'px';
  world.style.gridTemplateColumns=slots.map(slot=>widthOf(slot)+'px').join(' ');world.style.width=(760+side*2)+'px';world.style.minHeight='';
  world.innerHTML=`<svg class="canvas-links" aria-hidden="true"></svg>${slots.map(level=>`<section class="canvas-column ${level===0?'changed-column':level<0?'callers-column':'callees-column'}" data-level="${level}">${level===0?central():''}${context.relations.filter(node=>levelOf(node)===level).map(related).join('')}${requests.filter(request=>requestLevel(request)===level&&(request.status!=='done'||!request.total||request.nextPage!=null)).map(requestCard).join('')}</section>`).join('')}<button class="connection-plus primary" data-expand-connection="callers" hidden>${icon('plus')}</button><button class="connection-plus primary" data-expand-connection="callees" hidden>${icon('plus')}</button><button class="connection-plus connection-chat" data-chat-line hidden aria-label="Ask AI or leave a comment" title="Ask AI or leave a comment" aria-haspopup="menu" aria-expanded="false">${icon('chat')}</button>`;
  world.querySelectorAll('[data-source-block]').forEach(el=>{const prior=scroll.get(el.dataset.sourceBlock);if(prior){el.querySelector('.code-rows').scrollTop=prior.top;el.querySelector('.code-rows').scrollLeft=prior.left}});
  markFunctions();variables.mark(rowSource);renderCanvasComments({world,threads:context.threads,drafts:context.commentDrafts,user:context.commentUser,sourceForRow:rowSource,...commentActions,expandedThreads,onToggle:()=>{hideHover();resize()}});
  if(editing){const input=[...world.querySelectorAll('[data-comment-input]')].find(input=>input.dataset.commentInput===editing.key);if(input){input.focus({preventScroll:true});input.setSelectionRange(editing.start,editing.end)}}
  edges=context.relations.flatMap(node=>node.edges.map(edge=>({...edge,sourceSide:node.snapshot==='Before this change'?'before':'after',nodeId:node.id,direction:node.direction,ambiguous:node.ambiguous||node.precision==='heuristic'})));
  references();requestAnimationFrame(()=>{resize();if(reset)fit();else draw()});
 }
 function resize(){world.style.paddingTop=Math.max(64,64/zoom)+'px';const pan=viewport.scrollLeft-centeredScroll;centeredScroll=Math.max(0,(world.offsetWidth*zoom-viewport.clientWidth)/2);stage.style.width=Math.max(viewport.clientWidth,world.offsetWidth*zoom)+'px';stage.style.height=Math.max(viewport.clientHeight,world.offsetHeight*zoom)+'px';world.style.left=Math.max(0,(viewport.clientWidth-world.offsetWidth*zoom)/2)+'px';world.style.transform=`scale(${zoom})`;viewport.scrollLeft=centeredScroll+pan;draw();positionHover();variables.position()}
 function fit(){zoom=Math.max(.35,Math.min(1,(viewport.clientWidth-40)/world.offsetWidth));resize();viewport.scrollTop=0;viewport.scrollLeft=centeredScroll}
 function setZoom(next){closeFunctionMenu();const pan=(viewport.scrollLeft-centeredScroll)/zoom,y=(viewport.scrollTop+viewport.clientHeight/2)/zoom;zoom=Math.max(.35,Math.min(1.6,next));resize();viewport.scrollLeft=centeredScroll+pan*zoom;viewport.scrollTop=y*zoom-viewport.clientHeight/2}
 function findLine(container,line,before=container.querySelector('.code-source')?.dataset.sourceSide==='before'){
  const rows=[...container.querySelectorAll('[data-code-line]')].filter(el=>Number(el.dataset.codeLine)===line),fold=before?[...container.querySelectorAll('.removed-fold[data-removed-expanded="false"]')].find(el=>line>=Number(el.dataset.removedFrom)&&line<=Number(el.dataset.removedTo)):null;
  return (before?rows.find(el=>el.dataset.rowKind==='removed')||fold:rows.find(el=>el.dataset.rowKind!=='removed'))||rows.find(el=>el.dataset.rowKind==='context');
 }

 function references(){
  world.querySelectorAll('.connection-reference').forEach(el=>el.remove());
  for(const edge of edges){const changed=[...world.querySelectorAll('[data-block-id]')].find(el=>el.dataset.blockId===edge.blockId)||[...world.querySelectorAll('[data-node-id]')].find(el=>el.dataset.nodeId===edge.blockId),node=[...world.querySelectorAll('[data-node-id]')].find(el=>el.dataset.nodeId===edge.nodeId),left=edge.direction==='callers';
   for(const [container,line,kind]of [[changed,edge.anchorLine??(left?edge.targetLine:edge.callLine),left?'Function':'Call'],[node,left?edge.callLine:edge.targetLine,left?'Call':'Function']]){
    if(!container||container.hasAttribute('data-library-line')||findLine(container,line,edge.sourceSide==='before')||container.querySelector(`[data-reference-line="${line}"]`))continue;
    const ref=document.createElement('div');ref.className='connection-reference';ref.dataset.referenceLine=line;ref.textContent=`${kind}${kind==='Call'&&edge.scope==='function'?' elsewhere':''} at line ${line} · outside this excerpt`;container.querySelector('.code-source')?.before(ref);
   }
  }
 }
 function draw(){
  const svg=world.querySelector('svg');if(!svg)return;svg.setAttribute('width',world.offsetWidth);svg.setAttribute('height',world.offsetHeight);svg.setAttribute('viewBox',`0 0 ${world.offsetWidth} ${world.offsetHeight}`);svg.replaceChildren();const base=world.getBoundingClientRect();
  world.querySelectorAll('.connection-line').forEach(el=>el.classList.remove('connection-line'));
  const points=new Set();
  const endpoint=(container,line,before)=>{
   if(container.hasAttribute('data-library-line')){const rect=container.querySelector('.context-heading').getBoundingClientRect();return {y:(rect.top+rect.height/2-base.top)/zoom}}
   const row=findLine(container,line,before),reference=container.querySelector(`[data-reference-line="${line}"]`),el=row||reference;
   if(!el)return null;
   const rect=el.getBoundingClientRect(),height=row&&!row.classList.contains('removed-fold')?parseFloat(getComputedStyle(row).lineHeight)*zoom:rect.height;
   const exact=rect.top+height/2;let y=exact;
   if(row){row.classList.add('connection-line');row.title=`Connected line ${line}`;const clip=row.closest('.code-rows').getBoundingClientRect(),top=clip.top+2*zoom,bottom=clip.bottom-2*zoom;y=Math.max(top,Math.min(bottom,exact))}
   return {y:(y-base.top)/zoom};
  };
  for(const edge of edges){const changed=[...world.querySelectorAll('[data-block-id]')].find(el=>el.dataset.blockId===edge.blockId)||[...world.querySelectorAll('[data-node-id]')].find(el=>el.dataset.nodeId===edge.blockId),node=[...world.querySelectorAll('[data-node-id]')].find(el=>el.dataset.nodeId===edge.nodeId);if(!changed||!node)continue;
   const a=changed.getBoundingClientRect(),b=node.getBoundingClientRect(),left=edge.direction==='callers',root=endpoint(changed,edge.anchorLine??(left?edge.targetLine:edge.callLine),edge.sourceSide==='before'),related=endpoint(node,left?edge.callLine:edge.targetLine,edge.sourceSide==='before');if(!root||!related)continue;
   const x1=((left?b.right:a.right)-base.left)/zoom,x2=((left?a.left:b.left)-base.left)/zoom,start=left?related:root,end=left?root:related,y1=start.y,y2=end.y,bend=(x1+x2)/2;
   const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',`M ${x1} ${y1} C ${bend} ${y1},${bend} ${y2},${x2} ${y2}`);path.dataset.callLine=edge.callLine;path.dataset.targetLine=edge.targetLine;if(edge.ambiguous)path.classList.add('uncertain');svg.append(path);
   for(const [cx,cy]of [[x1,y1],[x2,y2]]){const key=`${cx}:${cy}`;if(points.has(key))continue;points.add(key);const dot=document.createElementNS(svg.namespaceURI,'circle');dot.setAttribute('cx',cx);dot.setAttribute('cy',cy);dot.setAttribute('r','4');svg.append(dot)}
  }
  onLayout();
 }
 let functionMenu=null;
 function closeFunctionMenu(){functionMenu?.sourceButton?.setAttribute('aria-expanded','false');functionMenu?.remove();functionMenu=null}
 function markFunctions(){
  for(const row of world.querySelectorAll('.code-row')){
   const info=rowSource(row);if(!info||info.selection.level>=8)continue;const {source,line,selection}=info,code=row.querySelector('code');
   if(!code||code.querySelector('[data-function-call]'))continue;
   for(const token of (source?.tokens||[]).filter(token=>token.line===line).sort((a,b)=>b.column-a.column)){
    if(code.textContent.slice(token.column,token.endColumn)!==token.symbol)continue;
    const walker=document.createTreeWalker(code,NodeFilter.SHOW_TEXT),nodes=[];let offset=0,node;
    while(node=walker.nextNode()){nodes.push({node,start:offset,end:offset+node.length});offset+=node.length}
    const first=nodes.find(item=>item.start<=token.column&&item.end>token.column),last=nodes.find(item=>item.start<token.endColumn&&item.end>=token.endColumn);if(!first||!last)continue;
    const range=document.createRange();range.setStart(first.node,token.column-first.start);range.setEnd(last.node,token.endColumn-last.start);
    const button=document.createElement('button');button.type='button';button.className='function-call';button.dataset.functionCall=JSON.stringify({...selection,column:token.column,symbol:token.symbol,direction:'callees'});button.setAttribute('aria-label',`Expand function ${token.symbol}`);button.setAttribute('aria-haspopup','menu');button.setAttribute('aria-expanded','false');button.append(range.extractContents());range.insertNode(button);
   }
  }
 }
 function openFunctionMenu(button){
  closeFunctionMenu();const selection=JSON.parse(button.dataset.functionCall),menu=document.createElement('div');menu.className='function-menu';menu.setAttribute('role','menu');menu.innerHTML='<button type="button" role="menuitem">Expand function</button>';menu.querySelector('button').onclick=()=>{closeFunctionMenu();onExpand(selection,{confirmed:true})};
  functionMenu=menu;menu.sourceButton=button;button.setAttribute('aria-expanded','true');world.append(menu);positionFunctionMenu();menu.querySelector('button').focus({preventScroll:true});
 }
 function openLineMenu(button,selection){
  closeFunctionMenu();const menu=document.createElement('div');menu.className='function-menu line-action-menu';menu.setAttribute('role','menu');menu.setAttribute('aria-label','Line actions');menu.innerHTML='<button type="button" role="menuitem" data-line-ai>Ask AI</button><button type="button" role="menuitem" data-line-comment>Leave comment</button>';
  menu.querySelector('[data-line-ai]').onclick=()=>{closeFunctionMenu();hideHover();onChat(selection)};menu.querySelector('[data-line-comment]').onclick=()=>{closeFunctionMenu();hideHover();commentActions.onOpen?.(selection)};
  functionMenu=menu;menu.sourceButton=button;button.setAttribute('aria-expanded','true');world.append(menu);positionFunctionMenu();menu.querySelector('button').focus({preventScroll:true});
 }
 function positionFunctionMenu(){
  if(!functionMenu)return;const button=functionMenu.sourceButton;if(!button?.isConnected){closeFunctionMenu();return}
  const base=world.getBoundingClientRect(),rect=button.getBoundingClientRect(),clip=(button.closest('.code-rows')||viewport).getBoundingClientRect(),view=viewport.getBoundingClientRect();if(rect.bottom<clip.top||rect.top>clip.bottom){closeFunctionMenu();return}
  const height=functionMenu.offsetHeight*zoom,width=functionMenu.offsetWidth*zoom,x=Math.max(view.left+8,Math.min(rect.left,view.right-width-8)),y=rect.bottom+5*zoom+height>view.bottom-8?rect.top-height-5*zoom:rect.bottom+5*zoom;
  functionMenu.style.left=(x-base.left)/zoom+'px';functionMenu.style.top=(y-base.top)/zoom+'px';
 }
 viewport.addEventListener('scroll',positionFunctionMenu);
 document.addEventListener('pointerdown',event=>{if(functionMenu&&!functionMenu.contains(event.target)&&!event.target.closest('[data-function-call],[data-chat-line]'))closeFunctionMenu()});
 world.addEventListener('keydown',event=>{if(event.key==='Escape'&&functionMenu){const button=functionMenu.sourceButton;closeFunctionMenu();button?.focus({preventScroll:true});event.stopPropagation()}});
 function hideHover(){lastHovered?.classList.remove('chat-line-hover');hovered=null;lastHovered=null;world.querySelectorAll('[data-expand-connection],[data-chat-line]').forEach(button=>button.hidden=true)}
 function hover(row){
  if(!row||!row.querySelector('code')){hideHover();return}
  const info=rowSource(row);if(!info){hideHover();return}const {source,line,snapshot,selection,element,node}=info,fn=source.functions.filter(fn=>fn.start<=line&&fn.end>=line).sort((a,b)=>(a.end-a.start)-(b.end-b.start))[0];
  const actions={callers:selection.level>-8&&source.functions.some(fn=>fn.start===line),callees:selection.level<8&&source.calls.includes(line)};
  if(lastHovered!==row)lastHovered?.classList.remove('chat-line-hover');row.classList.toggle('chat-line-hover',row.dataset.rowKind!=='removed');lastHovered=row;hovered={row,container:element,actions,selection:{...selection,symbol:fn?.symbol||node?.symbol||'this line'}};
  for(const button of world.querySelectorAll('[data-expand-connection]')){const direction=button.dataset.expandConnection,requested=(context.requests||[]).some(request=>['loading','done'].includes(request.status)&&request.selection.direction===direction&&['path','line','snapshot','anchorId','level'].every(key=>request.selection[key]===hovered.selection[key]));button.hidden=!actions[direction]||requested;button.setAttribute('aria-label',`Show ${button.dataset.expandConnection} for ${hovered.selection.symbol} at line ${line}`);button.title=`Show ${button.dataset.expandConnection}`}
  world.querySelector('[data-chat-line]').hidden=row.dataset.rowKind==='removed';positionHover();
 }
 function positionHover(){
  if(!hovered)return;if(!hovered.row.isConnected){hideHover();return}
  const base=world.getBoundingClientRect(),rect=hovered.container.closest('.canvas-card').getBoundingClientRect(),row=hovered.row.getBoundingClientRect(),clip=hovered.row.closest('.code-rows').getBoundingClientRect(),gutter=hovered.row.querySelector('.line-no').getBoundingClientRect(),y=row.top+parseFloat(getComputedStyle(hovered.row).lineHeight)*zoom/2;
  if(y<clip.top||y>clip.bottom){hideHover();return}
  for(const button of world.querySelectorAll('[data-expand-connection],[data-chat-line]')){
   const chat=button.hasAttribute('data-chat-line'),caller=button.dataset.expandConnection==='callers',x=chat?Math.max(clip.left+24*zoom,gutter.right-15*zoom):(caller?rect.left:rect.right);
   button.style.left=(x-base.left)/zoom-(chat?11:12)+'px';button.style.top=(y-base.top)/zoom-(chat?11:12)+'px';
  }
 }
 function lineAnchor(selection){const container=[...world.querySelectorAll('[data-block-id],[data-node-id]')].find(el=>(el.dataset.blockId||el.dataset.nodeId)===selection.anchorId);if(!container)return null;const row=findLine(container,selection.line,selection.snapshot==='before'),base=world.getBoundingClientRect(),rect=container.getBoundingClientRect();let y=rect.top+35*zoom;if(row){const line=row.getBoundingClientRect(),clip=row.closest('.code-rows').getBoundingClientRect(),height=row.classList.contains('removed-fold')?line.height:parseFloat(getComputedStyle(row).lineHeight)*zoom;y=Math.max(clip.top+2*zoom,Math.min(clip.bottom-2*zoom,line.top+height/2))}return {x:(rect.right-base.left)/zoom,y:(y-base.top)/zoom,left:(rect.left-base.left)/zoom,right:(rect.right-base.left)/zoom,top:(rect.top-base.top)/zoom,bottom:(rect.bottom-base.top)/zoom}}

 world.addEventListener('pointerover',event=>{if(event.target.closest('.removed-fold')){hideHover();return}if(event.target.closest('[data-expand-connection],[data-chat-line],.line-action-menu')){return}const row=event.target.closest('.code-row');if(row)hover(row)});
 world.addEventListener('pointermove',event=>{if(event.target.closest('.code-row,[data-expand-connection],[data-chat-line],.line-action-menu'))return;if(functionMenu?.classList.contains('line-action-menu'))return;if(!hovered){lastHovered=null;return}const rect=hovered.container.getBoundingClientRect(),row=hovered.row.getBoundingClientRect(),y=row.top+parseFloat(getComputedStyle(hovered.row).lineHeight)*zoom/2;if(event.clientX<rect.left-40*zoom||event.clientX>rect.right+70*zoom||Math.abs(event.clientY-y)>16*zoom)hideHover()});
 world.addEventListener('pointerleave',()=>{if(!functionMenu?.classList.contains('line-action-menu'))hideHover()});
 world.addEventListener('focusin',event=>{if(event.target.closest('[data-expand-connection],[data-chat-line],.line-action-menu'))return;hover(event.target.closest('.code-row'))});
 world.addEventListener('focusout',event=>{if(world.contains(event.relatedTarget))return;hideHover()});
 world.onclick=event=>{const excerpt=event.target.closest('[data-expand-excerpt]');if(excerpt){const source=excerpt.closest('.code-source'),range=JSON.parse(source.dataset.sourceRange);onExcerpt({selection:{path:range.path,anchorId:range.anchorId,level:range.level,snapshot:range.snapshot,line:range.start,direction:'callees'},range:{start:range.start,end:range.end},direction:excerpt.dataset.excerptDirection});return}const functionCall=event.target.closest('[data-function-call]');if(functionCall){openFunctionMenu(functionCall);return}const removed=event.target.closest('[data-toggle-removed]');if(removed){const id=removed.dataset.toggleRemoved,index=Number(removed.dataset.removedIndex),expanded=removedExpanded.get(id)||new Set();if(expanded.has(index))expanded.delete(index);else expanded.add(index);removedExpanded.set(id,expanded);render();world.querySelectorAll('[data-toggle-removed]').forEach(button=>{if(button.dataset.toggleRemoved===id&&Number(button.dataset.removedIndex)===index)button.focus({preventScroll:true})});return}const chat=event.target.closest('[data-chat-line]');if(chat&&hovered){const selection={...hovered.selection};openLineMenu(chat,selection);return}const expand=event.target.closest('[data-expand-connection]');if(expand&&hovered){const selection={...hovered.selection,direction:expand.dataset.expandConnection};hideHover();onExpand(selection);return}};
 world.addEventListener('scroll',()=>{positionFunctionMenu();draw();positionHover()},true);
 const observer=new ResizeObserver(resize);observer.observe(world);observer.observe(viewport);window.addEventListener('resize',resize);
 viewport.addEventListener('pointerdown',event=>{if(event.button!==0||event.target.closest('button,a,input,textarea,.canvas-card,.connection-load,.canvas-chat'))return;drag={x:event.clientX,y:event.clientY,left:viewport.scrollLeft,top:viewport.scrollTop};viewport.classList.add('panning');viewport.setPointerCapture(event.pointerId)});
 viewport.addEventListener('pointermove',event=>{if(!drag)return;viewport.scrollLeft=drag.left-event.clientX+drag.x;viewport.scrollTop=drag.top-event.clientY+drag.y});
 const end=()=>{drag=null;viewport.classList.remove('panning')};viewport.addEventListener('pointerup',end);viewport.addEventListener('pointercancel',end);
 return {show(data){change=data;context={relations:[],requests:[]};affordances={};sourceRanges={};removedExpanded.clear();render(true)},context(data){context=data;render()},affordances(data,ranges){affordances=data;if(ranges){sourceRanges=ranges;render()}else{markFunctions();variables.mark(rowSource)}if(lastHovered?.isConnected)hover(lastHovered)},reveal(id,direction){const source=[...world.querySelectorAll('[data-source-block]')].find(el=>el.dataset.sourceBlock===id),rows=source?.querySelector('.code-rows');if(rows){rows.scrollTop=direction==='up'?0:rows.scrollHeight;draw()}},focusComment(key){const input=[...world.querySelectorAll('[data-comment-input]')].find(input=>input.dataset.commentInput===key);if(input){input.scrollIntoView({block:'nearest',inline:'nearest'});input.focus({preventScroll:true})}},geometry(){return {zoom,left:parseFloat(world.style.left)||0,width:world.offsetWidth,height:world.offsetHeight,anchor:lineAnchor}},fit,wrap(enabled){world.classList.toggle('no-wrap',!enabled);requestAnimationFrame(resize)},zoomIn(){setZoom(zoom+.15)},zoomOut(){setZoom(zoom-.15)}};
}
