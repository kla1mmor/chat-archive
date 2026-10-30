// Minimal bridge for over-the-air updates; everything else runs in the page.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  checkVersion: () => ipcRenderer.invoke('update:check'),
  installUpdate: (build) => ipcRenderer.invoke('update:install', build),
  restart: () => ipcRenderer.send('update:restart'),
});
