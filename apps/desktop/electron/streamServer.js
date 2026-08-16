const http = require('http')
const fs = require('fs')
const path = require('path')
const auth = require('./auth')
const history = require('./history')
const mailer = require('./mailer')

const VIDEO_EXTS = ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.m4v', '.webm']
const MIME = {
  mp4: 'video/mp4',
  mkv: 'video/x-matroska',
  webm: 'video/webm',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  wmv: 'video/x-ms-wmv',
  m4v: 'video/mp4'
}
const PORT = 47811
const SESSION_COOKIE = 'movieapp_session'

// in-memory cache of fileName -> TMDB result (or null if no match)
const tmdbCache = new Map()

function encodeId(fileName) {
  return Buffer.from(fileName, 'utf8').toString('base64url')
}
function decodeId(id) {
  return Buffer.from(id, 'base64url').toString('utf8')
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

function cleanTitle(fileName) {
  const noExt = fileName.replace(path.extname(fileName), '')
  return noExt.replace(/[._]/g, ' ').replace(/\b(19|20)\d{2}\b.*$/, '').trim() || noExt
}

function scanMovies(moviesDir) {
  if (!fs.existsSync(moviesDir)) return []
  return fs
    .readdirSync(moviesDir)
    .filter((name) => VIDEO_EXTS.includes(path.extname(name).toLowerCase()))
    .map((name) => ({
      id: encodeId(name),
      name: path.basename(name, path.extname(name)),
      fileName: name
    }))
}

async function tmdbLookup(fileName, key) {
  if (tmdbCache.has(fileName)) return tmdbCache.get(fileName)
  if (!key) return null

  const isV4Token = key.split('.').length === 3
  const query = cleanTitle(fileName)
  const url = isV4Token
    ? `https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(query)}`
    : `https://api.themoviedb.org/3/search/movie?api_key=${key}&query=${encodeURIComponent(query)}`

  try {
    const res = await fetch(url, {
      headers: isV4Token ? { Authorization: `Bearer ${key}`, accept: 'application/json' } : { accept: 'application/json' }
    })
    if (!res.ok) {
      tmdbCache.set(fileName, null)
      return null
    }
    const data = await res.json()
    const match = data.results?.[0] || null
    tmdbCache.set(fileName, match)
    return match
  } catch {
    tmdbCache.set(fileName, null)
    return null
  }
}

function page(body, { narrow } = {}) {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>MovieAPP</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body { background:#0f1115; color:#eee; font-family:-apple-system,Segoe UI,Roboto,sans-serif; margin:0; padding:20px; }
    h2 { margin:0 0 16px; }
    .wrap { max-width: ${narrow ? '380px' : '100%'}; margin: ${narrow ? '40px auto' : '0'}; }
    input, textarea {
      width:100%; padding:12px 14px; font-size:16px; border-radius:8px; border:1px solid #2a2f3a;
      background:#171a21; color:#eee; margin-bottom:12px; font-family:inherit;
    }
    button, .btn {
      display:inline-block; background:#4f9dff; color:#fff; border:none; text-decoration:none;
      padding:12px 18px; border-radius:8px; font-size:15px; font-weight:600; cursor:pointer;
    }
    .btn-secondary { background:#2a2f3a; }
    .grid { display:grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap:14px; }
    .card { background:#171a21; border-radius:10px; overflow:hidden; text-decoration:none; color:inherit; display:block; }
    .card img { width:100%; aspect-ratio:2/3; object-fit:cover; display:block; background:#22262f; }
    .noposter { aspect-ratio:2/3; display:flex; align-items:center; justify-content:center; color:#555; font-size:12px; text-align:center; padding:8px; }
    .meta { padding:8px 10px; }
    .title { font-size:13px; font-weight:600; line-height:1.3; }
    .sub { font-size:11px; color:#8a8f98; margin-top:2px; }
    .empty { color:#8a8f98; text-align:center; margin-top:60px; }
    .muted { color:#8a8f98; font-size:13px; }
    .error { background:#3a1f22; border:1px solid #6b2b30; color:#ff9d9d; padding:10px 14px; border-radius:8px; margin-bottom:14px; font-size:14px; }
    .success { background:#1f3a2a; border:1px solid #2b6b45; color:#9dffb8; padding:10px 14px; border-radius:8px; margin-bottom:14px; font-size:14px; }
    .topbar { display:flex; justify-content:space-between; align-items:center; margin-bottom:18px; }
  </style>
  </head><body>${body}
  <script>
    const q = document.getElementById('q')
    if (q) {
      q.addEventListener('input', () => {
        const term = q.value.toLowerCase()
        document.querySelectorAll('.card').forEach(card => {
          card.style.display = card.dataset.name.includes(term) ? '' : 'none'
        })
      })
    }
  </script>
  </body></html>`
}

async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')
  return Object.fromEntries(new URLSearchParams(raw))
}

function loginPage({ error, success } = {}) {
  return page(
    `<div class="wrap">
      <h2>🎬 MovieAPP</h2>
      ${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
      ${success ? `<div class="success">${escapeHtml(success)}</div>` : ''}
      <form method="POST" action="/login">
        <input name="code" placeholder="Access code (e.g. 7F3K-9QRT)" autocapitalize="characters" required>
        <button type="submit">Log in</button>
      </form>
      <p class="muted" style="margin-top:18px;">
        Don't have a code? <a href="/request-access" style="color:#4f9dff;">Request access</a><br>
        Forgot your code? <a href="/forgot-code" style="color:#4f9dff;">Get a new one</a>
      </p>
    </div>`,
    { narrow: true }
  )
}

function requestAccessPage({ error, submitted } = {}) {
  if (submitted) {
    return page(
      `<div class="wrap">
        <h2>Request sent</h2>
        <div class="success">Thanks! Your request is waiting for approval. You'll get an email with your code once it's approved.</div>
        <a class="btn btn-secondary" href="/login">Back to login</a>
      </div>`,
      { narrow: true }
    )
  }
  return page(
    `<div class="wrap">
      <h2>Request access</h2>
      ${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
      <form method="POST" action="/request-access">
        <input name="name" placeholder="Your name" required maxlength="80">
        <input name="email" type="email" placeholder="Your email" required maxlength="200">
        <textarea name="message" placeholder="Optional message" rows="3" maxlength="300"></textarea>
        <button type="submit">Send request</button>
      </form>
      <p class="muted" style="margin-top:18px;"><a href="/login" style="color:#4f9dff;">Back to login</a></p>
    </div>`,
    { narrow: true }
  )
}

function forgotCodePage({ submitted } = {}) {
  if (submitted) {
    return page(
      `<div class="wrap">
        <h2>Check your email</h2>
        <div class="success">If that email has access, a new code is on its way — your old code stops working once the new one is sent.</div>
        <a class="btn btn-secondary" href="/login">Back to login</a>
      </div>`,
      { narrow: true }
    )
  }
  return page(
    `<div class="wrap">
      <h2>Forgot your code?</h2>
      <p class="muted">Enter the email you signed up with and we'll email you a fresh code.</p>
      <form method="POST" action="/forgot-code">
        <input name="email" type="email" placeholder="Your email" required maxlength="200">
        <button type="submit">Send me a code</button>
      </form>
      <p class="muted" style="margin-top:18px;"><a href="/login" style="color:#4f9dff;">Back to login</a></p>
    </div>`,
    { narrow: true }
  )
}

function startStreamServer({ getMoviesDir, store, log }) {
  const server = http.createServer(async (req, res) => {
    let url
    try {
      url = new URL(req.url, 'http://localhost')
    } catch {
      res.writeHead(400)
      res.end()
      return
    }

    const cookies = auth.parseCookies(req)
    const userId = auth.verifySession(store, cookies[SESSION_COOKIE])

    // --- public, unauthenticated routes ---

    if (url.pathname === '/login' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(loginPage())
      return
    }

    if (url.pathname === '/login' && req.method === 'POST') {
      const { code } = await readBody(req)
      const user = auth.findApprovedUserByCode(store, code)
      if (!user) {
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(loginPage({ error: 'That code is invalid, expired, or has been revoked.' }))
        return
      }
      const session = auth.signSession(store, user.id)
      res.writeHead(302, {
        Location: '/',
        'Set-Cookie': `${SESSION_COOKIE}=${session}; Path=/; Max-Age=${30 * 24 * 60 * 60}; HttpOnly; SameSite=Lax`
      })
      res.end()
      return
    }

    if (url.pathname === '/logout') {
      res.writeHead(302, { Location: '/login', 'Set-Cookie': `${SESSION_COOKIE}=; Path=/; Max-Age=0` })
      res.end()
      return
    }

    if (url.pathname === '/request-access' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(requestAccessPage())
      return
    }

    if (url.pathname === '/request-access' && req.method === 'POST') {
      const { name, email, message } = await readBody(req)
      if (!name || !name.trim() || !email || !email.trim()) {
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(requestAccessPage({ error: 'Please enter your name and email.' }))
        return
      }
      auth.submitAccessRequest(store, name, email, message)

      const adminEmail = store.get('adminNotifyEmail') || store.get('emailUser')
      if (adminEmail) {
        mailer
          .sendMail(store, {
            to: adminEmail,
            subject: `MovieAPP: access request from ${name}`,
            text: `${name} (${email}) is asking for access to your MovieAPP library.\n\n${
              message ? `Message: ${message}\n\n` : ''
            }Open the app's Users tab to approve or deny.`
          })
          .catch(() => {})
      }

      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(requestAccessPage({ submitted: true }))
      return
    }

    if (url.pathname === '/forgot-code' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(forgotCodePage())
      return
    }

    if (url.pathname === '/forgot-code' && req.method === 'POST') {
      const { email } = await readBody(req)
      const user = auth.findApprovedUserByEmail(store, email)
      if (user) {
        const code = auth.regenerateCode(store, user.id)
        mailer
          .sendMail(store, {
            to: user.email,
            subject: 'Your MovieAPP access code',
            text: `Hi ${user.name},\n\nHere's your new MovieAPP access code: ${code}\n\nYour old code no longer works. Log in at the site's "Watch Now" link and enter this code.`
          })
          .catch(() => {})
      }
      // same response either way, so we don't reveal whether an email has access
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(forgotCodePage({ submitted: true }))
      return
    }

    // --- everything below requires a valid session ---

    if (!userId) {
      res.writeHead(302, { Location: '/login' })
      res.end()
      return
    }

    if (url.pathname === '/') {
      const key = store.get('tmdbApiKey') || process.env.TMDB_API_KEY
      const movies = scanMovies(getMoviesDir())
      const enriched = await Promise.all(
        movies.map(async (m) => ({ ...m, tmdb: await tmdbLookup(m.fileName, key) }))
      )

      const cards = enriched
        .map((m) => {
          const t = m.tmdb
          const displayName = escapeHtml(t?.title || m.name)
          const year = t?.release_date?.slice(0, 4) || ''
          const poster = t?.poster_path
            ? `<img src="https://image.tmdb.org/t/p/w300${t.poster_path}" alt="${displayName}">`
            : `<div class="noposter">No poster</div>`
          return `<a class="card" data-name="${escapeHtml(m.name.toLowerCase())}" href="/watch?id=${encodeURIComponent(m.id)}">
            ${poster}
            <div class="meta"><div class="title">${displayName}</div><div class="sub">${year}</div></div>
          </a>`
        })
        .join('')

      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(
        page(`
        <div class="topbar">
          <h2 style="margin:0;">🎬 MovieAPP</h2>
          <a href="/logout" class="muted" style="color:#8a8f98;">Log out</a>
        </div>
        <input id="q" placeholder="Search your library…">
        <div class="grid">${cards || '<p class="empty">No movies found.</p>'}</div>
      `)
      )
      return
    }

    if (url.pathname === '/watch') {
      const id = url.searchParams.get('id') || ''
      let fileName = ''
      try {
        fileName = decodeId(id)
      } catch {
        fileName = ''
      }

      const users = auth.getUsers(store)
      const user = users.find((u) => u.id === userId)
      const key = store.get('tmdbApiKey') || process.env.TMDB_API_KEY
      const tmdb = fileName ? await tmdbLookup(fileName, key) : null
      const title = tmdb?.title || cleanTitle(fileName || 'Unknown')

      const sessionId = history.startSession(store, {
        userId,
        userName: user?.name || 'Unknown',
        fileName,
        title
      })

      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(
        `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head>
        <body style="margin:0;background:#000">
        <video id="v" src="/file?id=${encodeURIComponent(id)}" controls autoplay playsinline style="width:100%;height:100vh"></video>
        <script>
          const v = document.getElementById('v')
          const sessionId = ${JSON.stringify(sessionId)}
          function report() {
            const body = JSON.stringify({ sessionId, currentTime: v.currentTime || 0, duration: v.duration || 0 })
            if (navigator.sendBeacon) {
              navigator.sendBeacon('/progress', new Blob([body], { type: 'application/json' }))
            } else {
              fetch('/progress', { method: 'POST', body, headers: { 'Content-Type': 'application/json' }, keepalive: true })
            }
          }
          setInterval(report, 15000)
          v.addEventListener('pause', report)
          v.addEventListener('ended', report)
          window.addEventListener('pagehide', report)
        </script>
        </body></html>`
      )
      return
    }

    if (url.pathname === '/progress' && req.method === 'POST') {
      let body = {}
      try {
        const chunks = []
        for await (const chunk of req) chunks.push(chunk)
        body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
      } catch {
        body = {}
      }
      history.updateSession(store, body.sessionId, { currentTime: body.currentTime, duration: body.duration })
      res.writeHead(204)
      res.end()
      return
    }

    if (url.pathname === '/file') {
      const id = url.searchParams.get('id') || ''
      let fileName
      try {
        fileName = decodeId(id)
      } catch {
        res.writeHead(400)
        res.end()
        return
      }
      const movies = scanMovies(getMoviesDir())
      const movie = movies.find((m) => m.fileName === fileName)
      if (!movie) {
        res.writeHead(404)
        res.end('Not found')
        return
      }
      const filePath = path.join(getMoviesDir(), movie.fileName)
      const stat = fs.statSync(filePath)
      const mime = MIME[path.extname(filePath).slice(1).toLowerCase()] || 'video/mp4'
      const range = req.headers.range

      if (range) {
        const [startStr, endStr] = range.replace(/bytes=/, '').split('-')
        const start = parseInt(startStr, 10)
        const end = endStr ? parseInt(endStr, 10) : stat.size - 1
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': end - start + 1,
          'Content-Type': mime
        })
        fs.createReadStream(filePath, { start, end }).pipe(res)
      } else {
        res.writeHead(200, { 'Content-Length': stat.size, 'Content-Type': mime, 'Accept-Ranges': 'bytes' })
        fs.createReadStream(filePath).pipe(res)
      }
      return
    }

    res.writeHead(404)
    res.end('Not found')
  })

  server.listen(PORT, '0.0.0.0', () => {
    log(`Stream server listening on 0.0.0.0:${PORT}`)
  })

  return { port: PORT }
}

module.exports = { startStreamServer, PORT }
