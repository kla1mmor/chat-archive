// Minimal bridge for over-the-air updates; everything else runs in the page.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  getText: (url) => ipcRenderer.invoke('update:get-text', url),
  installUpdate: (url, build) => ipcRenderer.invoke('update:install', url, build),
  restart: () => ipcRenderer.send('update:restart'),
});
