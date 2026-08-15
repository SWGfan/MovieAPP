const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { spawn } = require('child_process')
const Store = require('electron-store')
const { startStreamServer, PORT: STREAM_PORT } = require('./streamServer')

const store = new Store()
let streamServerInfo = null

const VIDEO_EXTS = ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.m4v', '.webm']
const EMULATOR_EXTS = ['.exe']
const ROM_EXTS = ['.zip', '.iso', '.bin', '.n64', '.z64', '.gba', '.gbc', '.gb', '.nes', '.sfc', '.smc', '.chd', '.cue', '.nds', '.3ds']

function defaultDir(key, fallback) {
  return store.get(key) || fallback
}

function getMoviesDir() {
  return defaultDir('moviesDir', process.env.MOVIES_DIR || 'C:\\MovieAPP\\Movies')
}

function getEmulatorsDir() {
  return defaultDir('emulatorsDir', process.env.EMULATORS_DIR || 'C:\\MovieAPP\\Emulators')
}

function scanDir(dir, exts) {
  if (!fs.existsSync(dir)) return []
  const out = []
  const walk = (d) => {
    let entries = []
    try {
      entries = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(d, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else {
        const ext = path.extname(entry.name).toLowerCase()
        if (exts.includes(ext)) {
          out.push({
            name: path.basename(entry.name, ext),
            fileName: entry.name,
            path: full,
            ext,
            size: fs.statSync(full).size
          })
        }
      }
    }
  }
  walk(dir)
  return out
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#0f1115',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else if (!app.isPackaged) {
    win.loadURL('http://localhost:5173')
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  streamServerInfo = startStreamServer({
    getMoviesDir,
    store,
    log: (msg) => console.log('[stream]', msg)
  })
})

function getNetworkAddresses() {
  const nets = os.networkInterfaces()
  const out = []
  for (const [name, addrs] of Object.entries(nets)) {
    for (const addr of addrs || []) {
      if (addr.family === 'IPv4' && !addr.internal) {
        out.push({ interface: name, address: addr.address, isTailscale: /tailscale/i.test(name) || addr.address.startsWith('100.') })
      }
    }
  }
  return out
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// --- IPC handlers ---

ipcMain.handle('settings:get', () => ({
  moviesDir: getMoviesDir(),
  emulatorsDir: getEmulatorsDir(),
  tmdbApiKey: store.get('tmdbApiKey') || process.env.TMDB_API_KEY || ''
}))

ipcMain.handle('settings:set', (_e, partial) => {
  for (const [k, v] of Object.entries(partial)) store.set(k, v)
  return true
})

ipcMain.handle('dialog:pickFolder', async (_e, key) => {
  const res = await dialog.showOpenDialog({ properties: ['openDirectory'] })
  if (res.canceled || !res.filePaths[0]) return null
  store.set(key, res.filePaths[0])
  return res.filePaths[0]
})

ipcMain.handle('movies:scan', () => scanDir(getMoviesDir(), VIDEO_EXTS))

ipcMain.handle('movies:play', (_e, filePath) => {
  shell.openPath(filePath)
  return true
})

ipcMain.handle('emulators:scanApps', () => scanDir(getEmulatorsDir(), EMULATOR_EXTS))

ipcMain.handle('emulators:scanRoms', () => scanDir(getEmulatorsDir(), ROM_EXTS))

ipcMain.handle('emulators:launch', (_e, { emulatorPath, romPath }) => {
  try {
    const child = spawn(emulatorPath, romPath ? [romPath] : [], { detached: true, stdio: 'ignore' })
    child.unref()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
})

ipcMain.handle('tmdb:search', async (_e, query) => {
  const key = store.get('tmdbApiKey') || process.env.TMDB_API_KEY
  if (!key) return { error: 'no_api_key' }

  // TMDB issues two kinds of credentials that both work for read endpoints:
  //  - v3 "API Key": a short alphanumeric string -> passed as ?api_key=
  //  - v4 "Read Access Token": a long JWT (three dot-separated segments) -> passed as a Bearer header
  const isV4Token = key.split('.').length === 3

  const url = isV4Token
    ? `https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(query)}`
    : `https://api.themoviedb.org/3/search/movie?api_key=${key}&query=${encodeURIComponent(query)}`

  try {
    const res = await fetch(url, {
      headers: isV4Token
        ? { Authorization: `Bearer ${key}`, accept: 'application/json' }
        : { accept: 'application/json' }
    })
    if (!res.ok) return { error: `tmdb_http_${res.status}` }
    const data = await res.json()
    return { results: data.results || [] }
  } catch (err) {
    return { error: String(err) }
  }
})

ipcMain.handle('remote:getAccessInfo', () => {
  const addresses = getNetworkAddresses()
  const token = streamServerInfo?.token
  const port = streamServerInfo?.port || STREAM_PORT
  const links = addresses.map((a) => ({
    ...a,
    url: `http://${a.address}:${port}/?t=${token}`
  }))
  return { links, port, hasTailscale: links.some((l) => l.isTailscale) }
})
