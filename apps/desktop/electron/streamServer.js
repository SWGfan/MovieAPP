const http = require('http')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

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

// in-memory cache of fileName -> TMDB result (or null if no match), so we don't
// re-hit the API on every page load
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

function page(body) {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>MovieAPP</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body { background:#0f1115; color:#eee; font-family:-apple-system,Segoe UI,Roboto,sans-serif; margin:0; padding:20px; }
    h2 { margin:0 0 16px; }
    input#q {
      width:100%; padding:12px 14px; font-size:16px; border-radius:8px; border:1px solid #2a2f3a;
      background:#171a21; color:#eee; margin-bottom:18px;
    }
    .grid { display:grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap:14px; }
    .card { background:#171a21; border-radius:10px; overflow:hidden; text-decoration:none; color:inherit; display:block; }
    .card img { width:100%; aspect-ratio:2/3; object-fit:cover; display:block; background:#22262f; }
    .noposter { aspect-ratio:2/3; display:flex; align-items:center; justify-content:center; color:#555; font-size:12px; text-align:center; padding:8px; }
    .meta { padding:8px 10px; }
    .title { font-size:13px; font-weight:600; line-height:1.3; }
    .sub { font-size:11px; color:#8a8f98; margin-top:2px; }
    .empty { color:#8a8f98; text-align:center; margin-top:60px; }
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

function startStreamServer({ getMoviesDir, store, log }) {
  let token = store.get('remoteAccessToken')
  if (!token) {
    token = crypto.randomBytes(16).toString('hex')
    store.set('remoteAccessToken', token)
  }

  function authed(url) {
    return url.searchParams.get('t') === token
  }

  const server = http.createServer(async (req, res) => {
    let url
    try {
      url = new URL(req.url, 'http://localhost')
    } catch {
      res.writeHead(400)
      res.end()
      return
    }

    if (!authed(url)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' })
      res.end('Forbidden — missing or wrong access link.')
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
          return `<a class="card" data-name="${escapeHtml(m.name.toLowerCase())}" href="/watch?id=${encodeURIComponent(m.id)}&t=${token}">
            ${poster}
            <div class="meta"><div class="title">${displayName}</div><div class="sub">${year}</div></div>
          </a>`
        })
        .join('')

      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(
        page(`
        <h2>🎬 MovieAPP</h2>
        <input id="q" placeholder="Search your library…">
        <div class="grid">${cards || '<p class="empty">No movies found.</p>'}</div>
      `)
      )
      return
    }

    if (url.pathname === '/watch') {
      const id = url.searchParams.get('id') || ''
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(
        `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head>
        <body style="margin:0;background:#000">
        <video src="/file?id=${encodeURIComponent(id)}&t=${token}" controls autoplay playsinline style="width:100%;height:100vh"></video>
        </body></html>`
      )
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

  return { token, port: PORT }
}

module.exports = { startStreamServer, PORT }
