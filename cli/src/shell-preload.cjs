const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('runs',{
  ready:()=>ipcRenderer.invoke('runs-ready'),
  select:id=>ipcRenderer.invoke('select-run',id),
  close:id=>ipcRenderer.invoke('close-run',id),
  onChange:callback=>ipcRenderer.on('runs',(_event,state)=>callback(state)),
});
