import {icon} from './canvas-icons.js';

// Progress reflects completed tasks, rather than an estimated download percentage.
export function createReviewLoading({surface,overlay,regions}){
 let current=null;
 function render(){
  const {tasks}=current,done=tasks.filter(task=>task.status==='done').length;
  overlay.querySelector('progress').value=done;overlay.querySelector('progress').max=tasks.length;
  const list=overlay.querySelector('ol');list.replaceChildren();
  for(const task of tasks){
   const item=document.createElement('li');item.dataset.state=task.status;
   const marker=document.createElement('span');marker.className='review-loading-marker';marker.setAttribute('aria-hidden','true');marker.innerHTML=task.status==='done'?icon('check'):task.status==='error'?icon('close'):task.status==='loading'?'<span class="spinner"></span>':'';
   const label=document.createElement('span');label.textContent=task.label;
   const status=document.createElement('small');status.textContent={done:'Ready',error:'Failed',loading:'Loading…',waiting:'Waiting'}[task.status];
   item.append(marker,label,status);list.append(item);
  }
 }
 function clear(){current=null;overlay.hidden=true;surface.setAttribute('aria-busy','false');for(const region of regions)region.inert=false}
 return {
  begin(tasks){const ticket={tasks:tasks.map(task=>({...task}))};current=ticket;overlay.hidden=false;overlay.querySelector('[data-loading-error]').hidden=true;overlay.querySelector('[data-loading-retry]').hidden=true;overlay.querySelector('h2').textContent='Preparing your review';surface.setAttribute('aria-busy','true');for(const region of regions)region.inert=true;render();overlay.focus({preventScroll:true});return ticket},
  update(ticket,id,status){if(current!==ticket)return;const task=current.tasks.find(task=>task.id===id);if(task){task.status=status;render()}},
  fail(ticket,message,retry){if(current!==ticket)return;overlay.querySelector('h2').textContent='Review preparation paused';const error=overlay.querySelector('[data-loading-error]');error.textContent=message;error.hidden=false;const button=overlay.querySelector('[data-loading-retry]');button.hidden=false;button.onclick=retry},
  finish(ticket){if(current!==ticket||current.tasks.some(task=>task.status!=='done'))return;const focused=overlay.contains(document.activeElement);clear();if(focused){surface.tabIndex=-1;surface.focus({preventScroll:true})}},
  busy:()=>current!==null,
  clear
 };
}
