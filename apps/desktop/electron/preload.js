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

  tmdbSearch: (query) => ipcRenderer.invoke('tmdb:search', query),

  getRemoteAccessInfo: () => ipcRenderer.invoke('remote:getAccessInfo'),

  listUsers: () => ipcRenderer.invoke('auth:list'),
  createUser: (name, email) => ipcRenderer.invoke('auth:createUser', { name, email }),
  approveRequest: (requestId) => ipcRenderer.invoke('auth:approveRequest', requestId),
  denyRequest: (requestId) => ipcRenderer.invoke('auth:denyRequest', requestId),
  revokeUser: (userId) => ipcRenderer.invoke('auth:revokeUser', userId),
  reactivateUser: (userId) => ipcRenderer.invoke('auth:reactivateUser', userId),
  regenerateCode: (userId) => ipcRenderer.invoke('auth:regenerateCode', userId),
  deleteUser: (userId) => ipcRenderer.invoke('auth:deleteUser', userId),
  setUserAdmin: (userId, isAdmin) => ipcRenderer.invoke('auth:setUserAdmin', { userId, isAdmin }),
  renameUser: (userId, name) => ipcRenderer.invoke('auth:renameUser', { userId, name }),
  setUserEmail: (userId, email) => ipcRenderer.invoke('auth:setUserEmail', { userId, email }),
  setUserCode: (userId, code) => ipcRenderer.invoke('auth:setUserCode', { userId, code }),

  listHistory: () => ipcRenderer.invoke('history:list'),

  sendTestEmail: () => ipcRenderer.invoke('email:sendTest')
})
