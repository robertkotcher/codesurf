export function syncFilePanes(panes,paths){
 const known=new Set(panes.flatMap(p=>p.tabs));
 return [...panes,...paths.filter(path=>!known.has(path)).map(path=>({tabs:[path],active:path}))];
}
export function movePaneFile(panes,path,sourceIndex,targetIndex=null){
 if(sourceIndex===targetIndex||!panes[sourceIndex]?.tabs.includes(path)||targetIndex!==null&&!panes[targetIndex])return panes;
 const next=panes.map(p=>({...p,tabs:[...p.tabs]})),source=next[sourceIndex];
 source.tabs=source.tabs.filter(t=>t!==path);if(source.active===path)source.active=source.tabs[0];
 if(targetIndex===null)next.push({tabs:[path],active:path});
 else {const target=next[targetIndex];if(!target.tabs.includes(path))target.tabs.push(path);target.active=path}
 return next.filter(p=>p.tabs.length);
}
export function bindPaneDragging(root,{move,split}){
 const mime='application/x-codesurf-file';let dragged=null;
 const clear=()=>{root.querySelectorAll('.pane-drop-target,.pane-split-target').forEach(el=>el.classList.remove('pane-drop-target','pane-split-target'));root.classList.remove('dragging-file')};
 root.ondragstart=event=>{const tab=event.target.closest('[data-pane-file]');if(!tab)return;dragged={path:tab.dataset.paneFile,source:Number(tab.closest('[data-pane-index]').dataset.paneIndex)};event.dataTransfer.setData(mime,JSON.stringify(dragged));event.dataTransfer.effectAllowed='move';root.classList.add('dragging-file')};
 const destination=event=>{const pane=event.target.closest('[data-pane-index]');if(!pane)return null;const rect=pane.getBoundingClientRect();return {pane,index:Number(pane.dataset.paneIndex),split:event.clientX>rect.right-32}};
 root.ondragover=event=>{if(!dragged||!event.dataTransfer.types.includes(mime))return;const target=destination(event);if(!target)return;event.preventDefault();event.dataTransfer.dropEffect='move';clear();root.classList.add('dragging-file');target.pane.classList.add(target.split?'pane-split-target':'pane-drop-target')};
 root.ondragleave=event=>{if(!root.contains(event.relatedTarget))clear()};
 root.ondrop=event=>{if(!dragged)return;const target=destination(event);event.preventDefault();const file=dragged;dragged=null;clear();if(!target)return;if(target.split)split(file.path,file.source);else move(file.path,file.source,target.index)};
 root.ondragend=()=>{dragged=null;clear()};
}
