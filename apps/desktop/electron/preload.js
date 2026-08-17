const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('movieapp', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (partial) => ipcRenderer.invoke('settings:set', partial),
  pickFolder: (key) => ipcRenderer.invoke('dialog:pickFolder', key),
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
  deleteFile: (filePath) => ipcRenderer.invoke('file:delete', filePath),

  scanMovies: () => ipcRenderer.invoke('movies:scan'),
  playMovie: (filePath) => ipcRenderer.invoke('movies:play', filePath),

  scanTvShows: () => ipcRenderer.invoke('tvshows:scan'),
  tmdbSearchTv: (query, showKey, year, altQuery, forceRefresh) =>
    ipcRenderer.invoke('tmdb:searchTv', { query, showKey, year, altQuery, forceRefresh }),
  tmdbSearchTvMulti: (query, year) => ipcRenderer.invoke('tmdb:searchTvMulti', { query, year }),
  tmdbConfirmMatchTv: (showKey, show) => ipcRenderer.invoke('tmdb:confirmMatchTv', { showKey, show }),
  tmdbTvSeasonInfo: (tvId, season) => ipcRenderer.invoke('tmdb:tvSeasonInfo', { tvId, season }),
  tmdbTvShowSeasons: (tvId) => ipcRenderer.invoke('tmdb:tvShowSeasons', tvId),
  tmdbMovieCollection: (movieId) => ipcRenderer.invoke('tmdb:movieCollection', movieId),

  scanEmulatorApps: () => ipcRenderer.invoke('emulators:scanApps'),
  scanRoms: () => ipcRenderer.invoke('emulators:scanRoms'),
  launchEmulator: (emulatorPath, romPath) => ipcRenderer.invoke('emulators:launch', { emulatorPath, romPath }),

  tmdbSearch: (query, fileName, year, forceRefresh) =>
    ipcRenderer.invoke('tmdb:search', { query, fileName, year, forceRefresh }),
  tmdbConfirmMatch: (fileName, movie) => ipcRenderer.invoke('tmdb:confirmMatch', { fileName, movie }),
  tmdbCredits: (movieId) => ipcRenderer.invoke('tmdb:credits', movieId),
  tmdbPrefetchAll: (force) => ipcRenderer.invoke('tmdb:prefetchAll', { force }),
  onPrefetchProgress: (cb) => {
    const listener = (_e, data) => cb(data)
    ipcRenderer.on('tmdb:prefetchProgress', listener)
    return () => ipcRenderer.removeListener('tmdb:prefetchProgress', listener)
  },
  tmdbPrefetchAllTv: () => ipcRenderer.invoke('tmdb:prefetchAllTv'),
  onPrefetchTvProgress: (cb) => {
    const listener = (_e, data) => cb(data)
    ipcRenderer.on('tmdb:prefetchTvProgress', listener)
    return () => ipcRenderer.removeListener('tmdb:prefetchTvProgress', listener)
  },

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
