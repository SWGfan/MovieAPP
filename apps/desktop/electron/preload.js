const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('movieapp', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (partial) => ipcRenderer.invoke('settings:set', partial),
  pickFolder: (key) => ipcRenderer.invoke('dialog:pickFolder', key),

  scanMovies: () => ipcRenderer.invoke('movies:scan'),
  playMovie: (filePath) => ipcRenderer.invoke('movies:play', filePath),

  scanEmulatorApps: () => ipcRenderer.invoke('emulators:scanApps'),
  scanRoms: () => ipcRenderer.invoke('emulators:scanRoms'),
  launchEmulator: (emulatorPath, romPath) => ipcRenderer.invoke('emulators:launch', { emulatorPath, romPath }),

  tmdbSearch: (query) => ipcRenderer.invoke('tmdb:search', query)
})
