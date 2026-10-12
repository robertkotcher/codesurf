// Source-attached previews: no canvas, guessed call edges or replacement of the review.
export function createCodePeeks({host,locate,mountEditor,icon,onSelect,onExpand,onError=()=>{}}){
 const records=new Map();let currentStep=0,serial=0,frame;
 const layer=document.createElement('div');layer.className='code-peek-layer';layer.setAttribute('aria-label','Connected code previews');
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.classList.add('code-peek-links');svg.setAttribute('aria-hidden','true');layer.append(svg);host.append(layer);
 const visible=record=>record.step===currentStep;
 function source(record){const parent=records.get(record.anchor.peekId);if(parent){if(parent.expanded&&parent.view)return parent.view.sourceRange(record.anchor.start,record.anchor.end);return source(parent)}return locate(record.anchor)}
 function redraw(){cancelAnimationFrame(frame);frame=requestAnimationFrame(position)}
 function position(){
  const bounds=host.getBoundingClientRect(),height=Math.max(100,layer.clientHeight),width=bounds.width,opened=[...records.values()].filter(r=>visible(r)&&r.expanded);
  svg.setAttribute('viewBox',`0 0 ${width} ${height}`);svg.replaceChildren();
  const occupied={left:[],right:[]};
  for(const record of records.values()){
   const range=visible(record)?source(record):null;
   record.marker.hidden=!range;record.card.hidden=!range||!record.expanded;if(!range)continue;
   const side=record.side,sourceX=(side==='left'?range.left:range.right)-bounds.left;
   const start=Math.max(42,range.top-bounds.top),end=Math.min(height-12,range.bottom-bounds.top),y=Math.max(42,Math.min(height-20,(start+Math.max(start,end))/2));
   const siblings=[...records.values()].filter(r=>visible(r)&&r.side===side&&r.anchor.path===record.anchor.path&&r.anchor.start===record.anchor.start),slot=siblings.indexOf(record);
   record.marker.style.left=Math.max(0,Math.min(width-24,sourceX+(side==='left'?-25:1)))+'px';record.marker.style.top=Math.min(height-24,y-11+slot*25)+'px';
   record.marker.setAttribute('aria-expanded',String(record.expanded));if(!record.expanded)continue;
   const cardWidth=Math.min(340,Math.max(220,width*.38));record.card.style.width=cardWidth+'px';
   const x=Math.max(4,Math.min(width-cardWidth-4,side==='left'?sourceX-cardWidth-34:sourceX+34));
   const cardHeight=Math.min(240,height-45);record.card.style.maxHeight=cardHeight+'px';
   let top=Math.max(42,Math.min(height-150,y-65));for(const item of occupied[side])if(top<item.bottom+10&&top+150>item.top)top=item.bottom+10;
   if(top+150>height)top=Math.max(42,height-150);record.card.style.left=x+'px';record.card.style.top=top+'px';
   const rect=record.card.getBoundingClientRect();occupied[side].push({top,bottom:top+rect.height});
   const targetX=side==='left'?x+cardWidth:x,targetY=top+Math.min(60,rect.height/2),bend=(sourceX+targetX)/2;
   const line=document.createElementNS(svg.namespaceURI,'path');line.setAttribute('d',`M ${sourceX} ${start} v ${Math.max(0,end-start)} M ${sourceX} ${y} C ${bend} ${y}, ${bend} ${targetY}, ${targetX} ${targetY}`);svg.append(line);
  }
 }
 function reserve(){const open=[...records.values()].filter(r=>visible(r)&&r.expanded);host.classList.toggle('has-caller-peeks',open.some(r=>r.side==='left'));host.classList.toggle('has-callee-peeks',open.some(r=>r.side==='right'));redraw();setTimeout(redraw,120)}
 function minimize(record){record.expanded=false;record.card.hidden=true;if(record.view){record.scrollTop=record.view.scrollDOM.scrollTop;record.view.destroy();record.view=null;record.mount.replaceChildren()}}
 function expand(record){if(record.expanded){minimize(record);reserve();return}record.expanded=true;record.card.hidden=false;if(!record.view){
  const block=record.block;record.view=mountEditor(record.mount,{after:block.text||'',path:block.path,firstLine:block.start,diff:false,onSelect:value=>onSelect({...value,path:block.path,start:value.start+block.start-1,end:value.end+block.start-1,intermediate:block.snapshot?.startsWith('Review step'),peekId:record.id})});
  if(record.scrollTop)requestAnimationFrame(()=>{if(record.view)record.view.scrollDOM.scrollTop=record.scrollTop});
  record.view.flashRange(Math.max(1,(block.callLine||block.start)-block.start+1),Math.max(1,(block.callLine||block.start)-block.start+1));
 }reserve()}
 function add({block,anchor,direction='body',step=currentStep,expanded=true}){
  const key=[step,anchor.path,anchor.start,anchor.peekId||'',direction,block.path,block.start,block.snapshot].join(':');
  let record=[...records.values()].find(r=>r.key===key);if(record){if(!record.expanded)expand(record);return record}
  const id=String(++serial),side=direction==='callers'?'left':'right';
  const card=document.createElement('section');card.className='code-peek '+side;card.setAttribute('role','dialog');card.setAttribute('aria-label',`${direction==='callers'?'Caller':direction==='callees'?'Callee':'Function body'}: ${block.symbol||block.path}`);
  const heading=document.createElement('div');heading.className='code-peek-heading';
  const badge=document.createElement('small');badge.textContent=direction==='callers'?'Caller':direction==='callees'?'Callee':'Source';
  const title=document.createElement('strong');title.textContent=block.symbol||block.path.split('/').pop();heading.append(badge,title);
  const minimize=document.createElement('button');minimize.type='button';minimize.textContent='−';minimize.title='Minimize preview';minimize.setAttribute('aria-label','Minimize '+title.textContent);heading.append(minimize);
  const subtitle=document.createElement('div');subtitle.className='code-peek-path';subtitle.textContent=block.path+':'+block.start+'–'+block.end;subtitle.title=subtitle.textContent;
  const mount=document.createElement('div');mount.className='code-peek-source';
  const footer=document.createElement('div');footer.className='code-peek-footer';
  const snapshot=document.createElement('small');snapshot.textContent=(block.snapshot||'PR head')+(block.ambiguous?' · Possible match':block.precision==='heuristic'?' · Approximate match':'');footer.append(snapshot);
  for(const [direction,label]of [['callers','Show callers'],['callees','Show callees']]){const button=document.createElement('button');button.type='button';button.innerHTML=icon(direction==='callers'?'left':'right');button.title=label;button.setAttribute('aria-label',label+' of '+title.textContent);button.onclick=()=>Promise.resolve(onExpand({path:block.path,start:block.start,end:block.end,intermediate:block.snapshot?.startsWith('Review step'),peekId:id},direction)).catch(e=>onError(e.message));footer.append(button)}
  card.append(heading,subtitle,mount,footer);layer.append(card);
  const marker=document.createElement('button');marker.type='button';marker.className='code-peek-marker '+side;marker.innerHTML=icon(direction==='callers'?'left':direction==='callees'?'right':'code');marker.setAttribute('aria-label',`Open ${direction==='callers'?'caller':direction==='callees'?'callee':'source'} ${title.textContent}`);marker.title=marker.getAttribute('aria-label');layer.append(marker);
  record={id,key,side,block,anchor,step,card,mount,marker,expanded:false};records.set(id,record);marker.onclick=()=>expand(record);minimize.onclick=()=>expand(record);if(expanded)expand(record);else redraw();return record;
 }
 function collapse(){for(const record of records.values())minimize(record);reserve()}
 function clear(){for(const record of records.values()){record.view?.destroy();record.card.remove();record.marker.remove()}records.clear();reserve()}
 const observer=new ResizeObserver(redraw);observer.observe(host);host.addEventListener('scroll',redraw,true);window.addEventListener('resize',redraw);
 function refresh(){observer.disconnect();observer.observe(host);host.querySelectorAll('.review-document,.editor-lines').forEach(node=>observer.observe(node));redraw()}
 return {add,collapse,clear,refresh,clearSelection(){for(const record of records.values())record.view?.clearQuestionSelection?.()},setStep(step){currentStep=step;reserve()},get records(){return [...records.values()]},destroy(){clear();observer.disconnect();host.removeEventListener('scroll',redraw,true);window.removeEventListener('resize',redraw);cancelAnimationFrame(frame);layer.remove()}};
}
