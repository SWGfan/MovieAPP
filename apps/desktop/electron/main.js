const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { spawn } = require('child_process')
const Store = require('electron-store')
const { startStreamServer, PORT: STREAM_PORT } = require('./streamServer')
const auth = require('./auth')
const history = require('./history')
const mailer = require('./mailer')

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
    getEmulatorsDir,
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
  tmdbApiKey: store.get('tmdbApiKey') || process.env.TMDB_API_KEY || '',
  emailUser: store.get('emailUser') || '',
  emailAppPassword: store.get('emailAppPassword') || '',
  adminNotifyEmail: store.get('adminNotifyEmail') || '',
  emailConfigured: mailer.isConfigured(store)
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
  const port = streamServerInfo?.port || STREAM_PORT
  const links = addresses.map((a) => ({
    ...a,
    url: `http://${a.address}:${port}/login`
  }))
  return { links, port, hasTailscale: links.some((l) => l.isTailscale) }
})

// --- Users / admin (never exposed over HTTP — only reachable from this app) ---

ipcMain.handle('auth:list', () => ({
  users: auth.getUsers(store),
  requests: auth.getRequests(store).filter((r) => r.status === 'pending')
}))

async function emailCodeIfPossible(user, code) {
  if (!user.email || !mailer.isConfigured(store)) return false
  const result = await mailer.sendMail(store, {
    to: user.email,
    subject: 'Your MovieAPP access code',
    text: `Hi ${user.name},\n\nYour MovieAPP username: ${user.username}\nYour access code: ${code}\n\nGo to the site's "Watch Now" link and enter both to log in.`
  })
  return result.ok
}

ipcMain.handle('auth:createUser', async (_e, { name, email } = {}) => {
  const { user, code } = auth.createUser(store, name, email)
  const emailed = await emailCodeIfPossible(user, code)
  return { user, code, emailed }
})

ipcMain.handle('email:sendTest', async () => {
  const to = store.get('adminNotifyEmail') || store.get('emailUser')
  if (!to) return { ok: false, error: 'no_recipient' }
  return mailer.sendMail(store, {
    to,
    subject: 'MovieAPP test email',
    text: 'If you got this, email notifications are working.'
  })
})

ipcMain.handle('auth:approveRequest', async (_e, requestId) => {
  const result = auth.approveRequest(store, requestId)
  if (!result) return result
  const emailed = await emailCodeIfPossible(result.user, result.code)
  return { ...result, emailed }
})

ipcMain.handle('auth:denyRequest', (_e, requestId) => {
  auth.denyRequest(store, requestId)
  return true
})

ipcMain.handle('auth:revokeUser', (_e, userId) => {
  auth.revokeUser(store, userId)
  return true
})

ipcMain.handle('auth:reactivateUser', (_e, userId) => {
  auth.reactivateUser(store, userId)
  return true
})

ipcMain.handle('auth:regenerateCode', async (_e, userId) => {
  const code = auth.regenerateCode(store, userId)
  const user = auth.getUsers(store).find((u) => u.id === userId)
  const emailed = user ? await emailCodeIfPossible(user, code) : false
  return { code, emailed }
})

ipcMain.handle('auth:deleteUser', (_e, userId) => {
  auth.deleteUser(store, userId)
  return true
})

ipcMain.handle('auth:setUserAdmin', (_e, { userId, isAdmin } = {}) => {
  auth.setUserAdmin(store, userId, isAdmin)
  return true
})

ipcMain.handle('auth:renameUser', (_e, { userId, name } = {}) => {
  auth.renameUser(store, userId, name)
  return true
})

ipcMain.handle('auth:setUserEmail', (_e, { userId, email } = {}) => {
  auth.setUserEmail(store, userId, email)
  return true
})

ipcMain.handle('history:list', () => {
  return history.getHistory(store).slice().reverse()
})
