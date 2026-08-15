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

function encodeId(fileName) {
  return Buffer.from(fileName, 'utf8').toString('base64url')
}
function decodeId(id) {
  return Buffer.from(id, 'base64url').toString('utf8')
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

function page(body) {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>MovieAPP</title>
  <style>
    body { background:#0f1115; color:#eee; font-family:-apple-system,Segoe UI,Roboto,sans-serif; margin:0; padding:24px; }
    h2 { margin-top:0; }
    ul { list-style:none; padding:0; }
    li a { display:block; color:#4f9dff; text-decoration:none; padding:14px 0; border-bottom:1px solid #222; font-size:16px; }
    video { background:#000; }
  </style>
  </head><body>${body}</body></html>`
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

  const server = http.createServer((req, res) => {
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
      const movies = scanMovies(getMoviesDir())
      const items = movies
        .map((m) => `<li><a href="/watch?id=${encodeURIComponent(m.id)}&t=${token}">🎬 ${m.name}</a></li>`)
        .join('')
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(page(`<h2>MovieAPP</h2><ul>${items || '<li>No movies found.</li>'}</ul>`))
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
