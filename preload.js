const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  fetchRates: () => ipcRenderer.invoke('fetch-rates'),
  quit: () => ipcRenderer.send('quit-app'),
});
