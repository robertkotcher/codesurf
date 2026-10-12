const storageKey='codesurf-file-sidebar-width';
let preferredWidth=200;
try{const saved=Number(localStorage.getItem(storageKey));if(saved>=140&&saved<=600)preferredWidth=saved}catch{}
function applyWidth(){document.documentElement.style.setProperty('--file-sidebar-width',preferredWidth+'px')}
applyWidth();
export function attachSidebarResize(sidebar){
 const handle=document.createElement('div');handle.className='file-sidebar-resize';handle.tabIndex=0;
 handle.setAttribute('role','separator');handle.setAttribute('aria-orientation','vertical');handle.setAttribute('aria-label','Resize file browser');handle.title='Drag to resize file browser; double-click to reset';
 const maxWidth=()=>Math.max(140,Math.min(600,sidebar.parentElement.clientWidth-280));
 const sync=()=>{handle.setAttribute('aria-valuemin','140');handle.setAttribute('aria-valuemax',String(maxWidth()));handle.setAttribute('aria-valuenow',String(Math.round(sidebar.getBoundingClientRect().width)))};
 const resize=width=>{preferredWidth=Math.max(140,Math.min(maxWidth(),width));applyWidth();sync();try{localStorage.setItem(storageKey,String(preferredWidth))}catch{}};
 let drag=null;
 handle.onpointerdown=event=>{if(event.button!==0)return;event.preventDefault();drag={x:event.clientX,width:sidebar.getBoundingClientRect().width};handle.setPointerCapture(event.pointerId);handle.classList.add('dragging');document.body.classList.add('resizing-files')};
 handle.onpointermove=event=>{if(drag)resize(drag.width+event.clientX-drag.x)};
 const stop=()=>{drag=null;handle.classList.remove('dragging');document.body.classList.remove('resizing-files')};
 handle.onpointerup=handle.onpointercancel=handle.onlostpointercapture=stop;
 handle.ondblclick=()=>resize(200);
 handle.onkeydown=event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();resize(event.key==='Home'?140:event.key==='End'?maxWidth():sidebar.getBoundingClientRect().width+(event.key==='ArrowRight'?1:-1)*(event.shiftKey?40:10))};
 sidebar.after(handle);sync();
}
