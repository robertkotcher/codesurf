const { contextBridge, ipcRenderer } = require("electron");
const api = {
  trace: (question) => ipcRenderer.invoke("trace", question),
  inspect: (selection) => ipcRenderer.invoke("inspect-token", selection),
  onProgress: (callback) =>
    ipcRenderer.on("trace-progress", (_event, message) => callback(message)),
  onInspect: (callback) =>
    ipcRenderer.on("inspect-progress", (_event, message) => callback(message)),
};
contextBridge.exposeInMainWorld("codesurf", api);
// Keep previously exported report snapshots usable after the rename.
contextBridge.exposeInMainWorld("codetrail", api);
