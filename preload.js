const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('clew', {
  state: () => ipcRenderer.invoke('state'),
  onState: (cb) => ipcRenderer.on('state', (e, s) => cb(s)),
  addText: (t) => ipcRenderer.invoke('add-text', t),
  addLink: (u, n) => ipcRenderer.invoke('add-link', u, n),
  addShot: (d, c) => ipcRenderer.invoke('add-shot', d, c),
  retry: (id) => ipcRenderer.invoke('retry', id),
  deleteItem: (id) => ipcRenderer.invoke('delete-item', id),
  addNote: (id, t) => ipcRenderer.invoke('add-note', id, t),
  reminder: (id, a, d) => ipcRenderer.invoke('reminder', id, a, d),
  addReminder: (id, d, t) => ipcRenderer.invoke('add-reminder', id, d, t),
  markViewed: (ids) => ipcRenderer.invoke('mark-viewed', ids),
  updateTopic: (id, n, a) => ipcRenderer.invoke('update-topic', id, n, a),
  saveProvider: (id, f) => ipcRenderer.invoke('save-provider', id, f),
  testProvider: (id) => ipcRenderer.invoke('test-provider', id),
  setRole: (r, id) => ipcRenderer.invoke('set-role', r, id),
  setRule: (k, v) => ipcRenderer.invoke('set-rule', k, v),
  openDataFolder: () => ipcRenderer.invoke('open-data-folder'),
  openBrowser: (u) => ipcRenderer.invoke('open-browser', u)
});
