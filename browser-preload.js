const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('clewBrowser', {
  extractScript: () => ipcRenderer.invoke('extract-script'),
  logPage: (page, note) => ipcRenderer.invoke('add-page', page, note),
  onOpen: (cb) => ipcRenderer.on('browser-open', (e, u) => cb(u))
});
