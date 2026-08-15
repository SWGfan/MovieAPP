const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const { spawn } = require('child_process')
const Store = require('electron-store')

const store = new Store()

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
})

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
  const apiKey = store.get('tmdbApiKey') || process.env.TMDB_API_KEY
  if (!apiKey) return { error: 'no_api_key' }
  const url = `https://api.themoviedb.org/3/search/movie?api_key=${apiKey}&query=${encodeURIComponent(query)}`
  try {
    const res = await fetch(url)
    const data = await res.json()
    return { results: data.results || [] }
  } catch (err) {
    return { error: String(err) }
  }
})
