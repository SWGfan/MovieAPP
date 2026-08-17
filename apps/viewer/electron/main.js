const { app, BrowserWindow, Menu, session, dialog, ipcMain } = require('electron')
const Store = require('electron-store')

const store = new Store()
let mainWindow = null

function getServerUrl() {
  return store.get('serverUrl') || ''
}

function setServerUrl(url) {
  const clean = url.trim().replace(/\/+$/, '')
  store.set('serverUrl', clean)
  return clean
}

// A tiny trusted setup window (we author this HTML ourselves, nothing external),
// so nodeIntegration here is a deliberate, contained exception — not used anywhere
// content from the actual MovieAPP server touches.
function promptForServerUrl() {
  return new Promise((resolve) => {
    const promptWin = new BrowserWindow({
      width: 480,
      height: 340,
      resizable: false,
      title: 'Connect to MovieAPP',
      backgroundColor: '#0f1115',
      webPreferences: { nodeIntegration: true, contextIsolation: false }
    })
    promptWin.setMenuBarVisibility(false)

    const existing = getServerUrl()
    const html = `<!doctype html><html><head><meta charset="utf-8">
    <style>
      body { background:#0f1115; color:#eee; font-family:-apple-system,Segoe UI,Roboto,sans-serif; padding:24px; margin:0; }
      h2 { margin:0 0 8px; font-size:18px; }
      p { color:#8a8f98; font-size:13px; margin:0 0 16px; line-height:1.4; }
      input { width:100%; box-sizing:border-box; padding:10px 12px; border-radius:6px; border:1px solid #2a2f3a; background:#171a21; color:#eee; font-size:14px; margin-bottom:14px; }
      button { width:100%; padding:10px; border-radius:6px; border:none; background:#4f9dff; color:#fff; font-weight:600; cursor:pointer; font-size:14px; }
    </style>
    </head><body>
    <h2>Connect to MovieAPP</h2>
    <p>Enter the address your admin gave you — it looks like<br><code>http://something.duckdns.org:47811</code></p>
    <input id="url" placeholder="http://yourdomain.duckdns.org:47811" value="${existing.replace(/"/g, '&quot;')}" autofocus />
    <button id="go">Connect</button>
    <script>
      const { ipcRenderer } = require('electron')
      const input = document.getElementById('url')
      document.getElementById('go').addEventListener('click', submit)
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit() })
      function submit() {
        const val = input.value.trim()
        if (val) ipcRenderer.send('viewer:server-url', val)
      }
    </script>
    </body></html>`
    promptWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))

    const handler = (_e, url) => {
      const clean = setServerUrl(url)
      promptWin.close()
      ipcMain.removeListener('viewer:server-url', handler)
      resolve(clean)
    }
    ipcMain.on('viewer:server-url', handler)

    promptWin.on('closed', () => {
      ipcMain.removeListener('viewer:server-url', handler)
    })
  })
}

function buildMenu() {
  const template = [
    {
      label: 'MovieAPP',
      submenu: [
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => mainWindow?.webContents.reload() },
        { label: 'Back', accelerator: 'Alt+Left', click: () => mainWindow?.webContents.goBack() },
        { label: 'Forward', accelerator: 'Alt+Right', click: () => mainWindow?.webContents.goForward() },
        { type: 'separator' },
        { label: 'Change Server Address…', click: () => changeServerUrl() },
        { label: 'Log Out', click: () => logOut() },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [{ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }]
    },
    {
      label: 'View',
      submenu: [
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function changeServerUrl() {
  promptForServerUrl().then((url) => {
    mainWindow?.loadURL(`${url}/login`)
  })
}

function logOut() {
  const url = getServerUrl()
  if (!url) return
  session.defaultSession
    .clearStorageData({ origin: url })
    .catch(() => {})
    .finally(() => {
      mainWindow?.loadURL(`${url}/login`)
    })
}

function showConnectionError(detail) {
  dialog.showErrorBox(
    "Can't reach MovieAPP",
    `${detail}\n\nCheck your internet connection, or use the MovieAPP menu → "Change Server Address…" if the address has changed.`
  )
}

async function createMainWindow() {
  let url = getServerUrl()
  if (!url) {
    url = await promptForServerUrl()
  }

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#0f1115',
    title: 'MovieAPP',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
      // No preload script on purpose: this window only ever displays your own
      // MovieAPP server's pages, and we don't expose any Node/Electron APIs to it.
      // Login "sticks" across restarts because Electron's default session persists
      // cookies to disk the same way a normal browser profile would.
    }
  })

  buildMenu()

  mainWindow.webContents.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL) => {
    if (errorCode === -3) return // ERR_ABORTED — normal, e.g. a cancelled navigation
    showConnectionError(`Couldn't load ${validatedURL || url} (${errorDescription}).`)
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.loadURL(`${url}/login`)
}

app.whenReady().then(() => {
  createMainWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
