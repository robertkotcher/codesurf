export function createSidebarResizer({sidebar,handle,container}){
 const defaultWidth=264,key='codesurf-review-sidebar-width';let preferred=defaultWidth,drag=null;
 try{const saved=localStorage.getItem(key);if(saved!==null&&Number.isFinite(Number(saved)))preferred=Number(saved)}catch{}
 function bounds(){const available=container.clientWidth,min=Math.min(220,Math.floor(available/2));return {min,max:Math.min(480,Math.max(min,available-160))}}
 function apply(){const {min,max}=bounds(),width=Math.round(Math.max(min,Math.min(max,preferred)));container.style.setProperty('--outline-width',width+'px');handle.setAttribute('aria-valuemin',min);handle.setAttribute('aria-valuemax',max);handle.setAttribute('aria-valuenow',width);handle.setAttribute('aria-valuetext',width+' pixels');return width}
 function save(){try{localStorage.setItem(key,String(preferred))}catch{}}
 function finish(cancel=false){if(!drag)return;const prior=drag;drag=null;if(cancel){preferred=prior.preferred;apply()}else save();document.body.classList.remove('resizing-outline');if(handle.hasPointerCapture(prior.id))handle.releasePointerCapture(prior.id)}
 handle.addEventListener('pointerdown',event=>{if(event.button!==0||drag)return;event.preventDefault();handle.focus({preventScroll:true});drag={id:event.pointerId,x:event.clientX,width:sidebar.getBoundingClientRect().width,preferred};handle.setPointerCapture(event.pointerId);document.body.classList.add('resizing-outline')});
 handle.addEventListener('pointermove',event=>{if(!drag||event.pointerId!==drag.id)return;const {min,max}=bounds();preferred=Math.max(min,Math.min(max,drag.width+event.clientX-drag.x));apply()});
 handle.addEventListener('pointerup',event=>{if(event.pointerId===drag?.id)finish()});handle.addEventListener('pointercancel',event=>{if(event.pointerId===drag?.id)finish(true)});handle.addEventListener('lostpointercapture',()=>finish(true));window.addEventListener('blur',()=>finish(true));
 handle.addEventListener('keydown',event=>{const {min,max}=bounds(),current=sidebar.getBoundingClientRect().width,step=event.shiftKey?40:16;if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();preferred=event.key==='Home'?min:event.key==='End'?max:Math.max(min,Math.min(max,current+(event.key==='ArrowLeft'?-step:step)));apply();save()});
 handle.addEventListener('dblclick',()=>{preferred=defaultWidth;apply();save()});
 const observer=new ResizeObserver(apply);observer.observe(container);apply();
}
