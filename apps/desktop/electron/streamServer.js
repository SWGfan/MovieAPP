const http = require('http')
const fs = require('fs')
const path = require('path')
const auth = require('./auth')
const history = require('./history')
const mailer = require('./mailer')
// on-disk TMDB cache shared with the desktop app's offline prefetch — lets the
// website itself run with zero internet once that cache is populated. Named
// tmdbFileCache locally to avoid colliding with the in-memory tmdbCache Map below.
const tmdbFileCache = require('./tmdbCache')

const VIDEO_EXTS = ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.m4v', '.webm']
const EMULATOR_EXTS = ['.exe']
const ROM_EXTS = ['.zip', '.iso', '.bin', '.n64', '.z64', '.gba', '.gbc', '.gb', '.nes', '.sfc', '.smc', '.chd', '.cue', '.nds', '.3ds']
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
// in-memory cache of TMDB movie id -> top cast names
const creditsCache = new Map()
// in-memory cache of show key -> TMDB tv result (or null if no match)
const tvCache = new Map()

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

// Walks an emulators/games folder recursively, returning files matching the given
// extensions. relPath is used (instead of an absolute path) so download links never
// leak or trust a raw filesystem path from the browser.
function scanEmuDir(dir, exts) {
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
            relPath: path.relative(dir, full),
            size: fs.statSync(full).size
          })
        }
      }
    }
  }
  walk(dir)
  return out
}

const ALPHABET = ['#', ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split('')]

function alphabetBarTop(availableLetters) {
  return `<div style="position:sticky;top:0;z-index:5;display:flex;flex-wrap:wrap;gap:4px;padding:8px 10px;background:#171a21;border-radius:8px;margin-bottom:16px;box-shadow:0 4px 8px rgba(0,0,0,0.4);">${ALPHABET.map(
    (letter) =>
      availableLetters.has(letter)
        ? `<a href="#letter-${letter}" style="color:#eee;font-size:12px;font-weight:600;padding:3px 6px;border-radius:4px;text-decoration:none;">${letter}</a>`
        : `<span style="color:#4a4f58;font-size:12px;font-weight:600;padding:3px 6px;">${letter}</span>`
  ).join('')}</div>`
}

function alphabetRailSide(availableLetters) {
  return `<div style="position:sticky;top:100px;align-self:flex-start;display:flex;flex-direction:column;align-items:center;gap:1px;padding:6px 4px;background:#171a21;border-radius:8px;flex-shrink:0;font-size:11px;font-weight:600;">${ALPHABET.map(
    (letter) =>
      availableLetters.has(letter)
        ? `<a href="#letter-${letter}" style="color:#eee;text-decoration:none;padding:1px 4px;">${letter}</a>`
        : `<span style="color:#4a4f58;padding:1px 4px;">${letter}</span>`
  ).join('')}</div>`
}

function posterUrl(cacheDir, movieId, posterPath) {
  if (cacheDir && tmdbFileCache.localPosterPath(cacheDir, movieId)) return `/media/poster/${movieId}.jpg`
  return posterPath ? `https://image.tmdb.org/t/p/w300${posterPath}` : null
}

function actorPhotoUrl(cacheDir, personId, profilePath) {
  if (cacheDir && tmdbFileCache.localActorPhotoPath(cacheDir, personId)) return `/media/actor/${personId}.jpg`
  return profilePath ? `https://image.tmdb.org/t/p/w185${profilePath}` : null
}

// Parses show/season/episode out of a filename — mirrors the desktop app's parser
// so both sides group the same messy filenames the same way. Handles S01E01,
// 1x01, and "Season 1 Episode 1" styles, strips scene-release numeric ID
// prefixes ("4574334-stranger-things-2016...") and quality tags (1080p etc);
// anything else becomes its own single-item "show" named after the cleaned
// filename.
function cleanText(raw) {
  return raw.replace(/[._-]/g, ' ').replace(/\s+/g, ' ').trim()
}

function stripLeadingId(raw) {
  return raw.replace(/^\d{4,}[\s._-]+/, '')
}

function extractTrailingYear(raw) {
  const m = raw.match(/^(.*?)[\s._-]*((?:19|20)\d{2})[\s._-]*$/)
  if (!m) return { rest: raw, year: null }
  return { rest: m[1], year: m[2] }
}

const QUALITY_TAG = /^(480p|540p|720p|1080p|1440p|2160p|4k|hdr|hdr10|sdr|web[\s-]?dl|bluray|x264|x265|hevc)$/i

function parseEpisode(fileName) {
  const noExt = fileName.replace(/\.[^./\\]+$/, '')

  let m = noExt.match(/^(.*?)[.\s_-]+[Ss](\d{1,2})[.\s_-]*[Ee](\d{1,3})(.*)$/)
  if (!m) m = noExt.match(/^(.*?)[.\s_-]+(\d{1,2})x(\d{1,3})(.*)$/)
  if (!m) m = noExt.match(/^(.*?)[.\s_-]+[Ss]eason[.\s_-]?(\d{1,2})[.\s_-]+[Ee]pisode[.\s_-]?(\d{1,3})(.*)$/i)

  if (m) {
    const rawShow = stripLeadingId(m[1])
    const { rest, year } = extractTrailingYear(rawShow)
    const show = cleanText(rest) || cleanText(rawShow) || noExt
    const season = parseInt(m[2], 10)
    const episode = parseInt(m[3], 10)
    let extra = cleanText(m[4] || '').replace(/^[-\s]+/, '')
    if (QUALITY_TAG.test(extra)) extra = ''
    return { show, year, season, episode, episodeTitle: extra || null }
  }

  const rawShow = stripLeadingId(noExt)
  const { rest, year } = extractTrailingYear(rawShow)
  const show = cleanText(rest) || cleanText(rawShow) || noExt
  return { show, year, season: null, episode: null, episodeTitle: null }
}

// Files nested in a Show/Season/episode.ext structure get grouped by their
// top-level folder name (far more reliable than parsing every messy filename —
// it also naturally merges a show whose episodes were named inconsistently
// across seasons). Flat files sitting directly in the TV Shows root fall back
// to filename parsing entirely.
function groupKeyAndName(relPath, fileName) {
  const parts = relPath.split(/[\\/]/).filter(Boolean)
  if (parts.length > 1) {
    const folderName = parts[0]
    const { rest, year } = extractTrailingYear(stripLeadingId(folderName))
    return { show: cleanText(rest) || folderName.trim(), year }
  }
  const parsed = parseEpisode(fileName)
  return { show: parsed.show, year: parsed.year }
}

function scanTvShows(dir) {
  return scanEmuDir(dir, VIDEO_EXTS)
}

async function tvSearchOnce(query, year, key, isV4Token) {
  const yearParam = year ? `&first_air_date_year=${encodeURIComponent(year)}` : ''
  const url = isV4Token
    ? `https://api.themoviedb.org/3/search/tv?query=${encodeURIComponent(query)}${yearParam}`
    : `https://api.themoviedb.org/3/search/tv?api_key=${key}&query=${encodeURIComponent(query)}${yearParam}`
  const res = await fetch(url, {
    headers: isV4Token ? { Authorization: `Bearer ${key}`, accept: 'application/json' } : { accept: 'application/json' }
  })
  if (!res.ok) return { ok: false }
  const data = await res.json()
  return { ok: true, match: data.results?.[0] || null }
}

// Tries a few query variations before giving up — folder names aren't always
// clean enough to match on the first attempt (e.g. a folder literally named
// "Survivor 50" won't match TMDB's "Survivor" until the trailing number is
// stripped).
async function searchTvSmart(query, year, key, isV4Token) {
  const r1 = await tvSearchOnce(query, year, key, isV4Token)
  if (!r1.ok) return r1
  if (r1.match) return r1

  if (year) {
    const r2 = await tvSearchOnce(query, null, key, isV4Token)
    if (!r2.ok) return r2
    if (r2.match) return r2
  }

  const trailingNum = query.match(/^(.*?)\s+\d{1,3}$/)
  if (trailingNum) {
    const r3 = await tvSearchOnce(trailingNum[1], year, key, isV4Token)
    if (r3.ok && r3.match) return r3
  }

  return { ok: true, match: null }
}

async function tmdbLookupTv(showName, showKey, key, cacheDir, year) {
  if (cacheDir) {
    const manifest = tmdbFileCache.getTvManifest(cacheDir)
    if (showKey in manifest) return manifest[showKey]
  }
  if (tvCache.has(showKey)) return tvCache.get(showKey)
  if (!key) return null

  const isV4Token = key.split('.').length === 3

  try {
    const result = await searchTvSmart(showName, year, key, isV4Token)
    const match = result.ok ? result.match : null
    tvCache.set(showKey, match)
    return match
  } catch {
    tvCache.set(showKey, null)
    return null
  }
}

function tvPosterUrl(cacheDir, showId, posterPath) {
  if (cacheDir && tmdbFileCache.localTvPosterPath(cacheDir, showId)) return `/media/poster-tv/${showId}.jpg`
  return posterPath ? `https://image.tmdb.org/t/p/w300${posterPath}` : null
}

async function tmdbLookup(fileName, key, cacheDir) {
  // On-disk cache first (populated by the desktop app's "Download all TMDB info
  // for offline use" button) — this is what lets the site run with no internet.
  if (cacheDir) {
    const manifest = tmdbFileCache.getManifest(cacheDir)
    if (fileName in manifest) return manifest[fileName]
  }
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

async function tmdbCredits(movieId, key, cacheDir) {
  if (!movieId) return []
  if (cacheDir) {
    const creditsMap = tmdbFileCache.getCreditsMap(cacheDir)
    if (movieId in creditsMap) return creditsMap[movieId]
  }
  if (creditsCache.has(movieId)) return creditsCache.get(movieId)
  if (!key) return []

  const isV4Token = key.split('.').length === 3
  const url = isV4Token
    ? `https://api.themoviedb.org/3/movie/${movieId}/credits`
    : `https://api.themoviedb.org/3/movie/${movieId}/credits?api_key=${key}`

  try {
    const res = await fetch(url, {
      headers: isV4Token ? { Authorization: `Bearer ${key}`, accept: 'application/json' } : { accept: 'application/json' }
    })
    if (!res.ok) {
      creditsCache.set(movieId, [])
      return []
    }
    const data = await res.json()
    const cast = (data.cast || []).slice(0, 8).map((c) => ({ id: c.id, name: c.name, profilePath: c.profile_path || null }))
    creditsCache.set(movieId, cast)
    return cast
  } catch {
    creditsCache.set(movieId, [])
    return []
  }
}

function sectionNav(active) {
  const sections = [
    { key: 'movies', label: '🎬 Movies', href: '/' },
    { key: 'games', label: '🎮 Games', href: '/games' },
    { key: 'tvshows', label: '📺 TV Shows', href: '/tvshows' }
  ]
  return `<div class="tabs" style="margin-bottom:8px;">${sections
    .map((s) => `<a href="${s.href}" class="tab ${active === s.key ? 'tab-active' : ''}" style="font-size:15px;">${s.label}</a>`)
    .join('')}</div>`
}

function navTabs(active) {
  const tabs = [
    { key: 'all', label: 'All Movies', href: '/' },
    { key: 'year', label: 'By Release Date', href: '/?view=year' },
    { key: 'actor', label: 'By Actor', href: '/?view=actor' }
  ]
  return `<div class="tabs">${tabs
    .map((t) => `<a href="${t.href}" class="tab ${active === t.key ? 'tab-active' : ''}">${t.label}</a>`)
    .join('')}</div>`
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
    .tabs { display:flex; gap:18px; margin-bottom:20px; border-bottom:1px solid #2a2f3a; }
    .tab { padding:0 0 10px; color:#8a8f98; text-decoration:none; font-size:14px; font-weight:600; border-bottom:2px solid transparent; }
    .tab-active { color:#fff; border-bottom-color:#4f9dff; }
    .actor-card { padding:16px 10px; text-align:center; font-size:13px; font-weight:600; }
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
    // Pressing a letter key jumps straight to that A-Z section (ignored while typing).
    document.addEventListener('keydown', (e) => {
      const tag = e.target && e.target.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key.length !== 1 || !/[a-zA-Z]/.test(e.key)) return
      const el = document.getElementById('letter-' + e.key.toUpperCase())
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
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
        <input name="username" placeholder="Username" autocapitalize="none" autocorrect="off" required>
        <input name="code" placeholder="Access code (e.g. 7F3K)" autocapitalize="characters" required>
        <button type="submit">Log in</button>
      </form>
      <p class="muted" style="margin-top:18px;">
        Don't have a code? <a href="/request-access" style="color:#4f9dff;">Request access</a><br>
        Forgot your code? <a href="/forgot-code" style="color:#4f9dff;">Get a new one</a>
      </p>
      <p class="muted" style="margin-top:18px;padding-top:14px;border-top:1px solid #2a2f3a;">
        Prefer a real app instead of a browser tab? <a href="/download/viewer-app" style="color:#4f9dff;">Download MovieAPP Viewer for Windows</a> —
        it opens straight to your library and remembers your login.
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

const HEARTBEAT_SCRIPT = `<script>
  function moviheartbeat() { fetch('/heartbeat', { method: 'POST', keepalive: true }).catch(() => {}) }
  setInterval(moviheartbeat, 20000)
</script>`

// Static reference list — these aren't files in your Emulators folder, just pointers to
// official download pages for well-known emulators that play nicely with a Bluetooth
// PS4 (DualShock 4) controller on Windows.
const RECOMMENDED_EMULATORS = [
  {
    name: 'DS4Windows',
    system: 'Controller driver — install this first',
    note: 'Makes Windows treat a Bluetooth DS4 as a standard Xbox controller, so every emulator below recognizes it reliably.',
    url: 'https://ds4-windows.com/'
  },
  {
    name: 'RetroArch',
    system: 'NES, SNES, N64, Genesis, PS1, GBA, and dozens more — one app',
    note: 'Built-in DS4 autoconfig profile — usually works the moment it’s paired, no setup needed.',
    url: 'https://www.retroarch.com/?page=platforms'
  },
  {
    name: 'Dolphin',
    system: 'GameCube / Wii',
    note: 'Solid native controller support, works well with DS4 directly or through DS4Windows.',
    url: 'https://dolphin-emu.org/download/'
  },
  {
    name: 'PCSX2',
    system: 'PlayStation 2',
    note: 'Works with DS4 over Bluetooth — most consistent when routed through DS4Windows.',
    url: 'https://pcsx2.net/downloads'
  },
  {
    name: 'RPCS3',
    system: 'PlayStation 3',
    note: 'Native/SDL controller input — best behavior via DS4Windows.',
    url: 'https://rpcs3.net/download'
  },
  {
    name: 'Cemu',
    system: 'Wii U',
    note: 'Same setup as the others — pair the DS4, install DS4Windows if it’s not detected right away.',
    url: 'https://cemu.info/'
  }
]

function recommendedEmulatorsSection() {
  const cards = RECOMMENDED_EMULATORS.map(
    (e) => `<div class="card" style="padding:14px;">
      <div class="title">${escapeHtml(e.name)}</div>
      <div class="sub">${escapeHtml(e.system)}</div>
      <div class="sub" style="margin-top:6px;line-height:1.4;">${escapeHtml(e.note)}</div>
      <a class="btn" style="margin-top:10px;display:inline-block;padding:8px 14px;font-size:13px;"
         href="${e.url}" target="_blank" rel="noopener">Official site</a>
    </div>`
  ).join('')

  return `
    <h3 style="margin:28px 0 4px;">Recommended Emulators (Bluetooth PS4 controller friendly)</h3>
    <p class="muted" style="margin:0 0 12px;">
      These aren't in your library yet — they're links to the official sites. Download and install one on the PC
      you'll actually play on, pair your DualShock 4 over Bluetooth (hold PS + Share until the light bar flashes,
      then pick it in Windows Bluetooth settings), then optionally drop the emulator into your Emulators folder
      so it shows up above too.
    </p>
    <div class="grid">${cards}</div>
  `
}

function formatBytes(bytes) {
  if (!bytes) return '0 MB'
  const mb = bytes / (1024 * 1024)
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`
  return `${mb.toFixed(0)} MB`
}

function findLatestInstaller(dir) {
  if (!dir || !fs.existsSync(dir)) return null
  const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.exe'))
  if (!files.length) return null
  const withStats = files.map((f) => ({ f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
  withStats.sort((a, b) => b.mtime - a.mtime)
  return path.join(dir, withStats[0].f)
}

function startStreamServer({ getMoviesDir, getEmulatorsDir, getTvShowsDir, getViewerAppDir, getTmdbCacheDir, store, log }) {
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

    if (url.pathname === '/download/viewer-app') {
      const dir = getViewerAppDir ? getViewerAppDir() : null
      const exe = findLatestInstaller(dir)
      if (!exe) {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end('MovieAPP Viewer isn\'t available for download yet.')
        return
      }
      const stat = fs.statSync(exe)
      res.writeHead(200, {
        'Content-Length': stat.size,
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment; filename="MovieAPP-Viewer-Setup.exe"'
      })
      fs.createReadStream(exe).pipe(res)
      return
    }

    if (
      url.pathname.startsWith('/media/poster/') ||
      url.pathname.startsWith('/media/actor/') ||
      url.pathname.startsWith('/media/poster-tv/')
    ) {
      const cacheDir = getTmdbCacheDir ? getTmdbCacheDir() : null
      const isActor = url.pathname.startsWith('/media/actor/')
      const isTv = url.pathname.startsWith('/media/poster-tv/')
      const idPart = path.basename(url.pathname).replace(/\.jpg$/, '')
      const file = cacheDir
        ? isActor
          ? tmdbFileCache.localActorPhotoPath(cacheDir, idPart)
          : isTv
          ? tmdbFileCache.localTvPosterPath(cacheDir, idPart)
          : tmdbFileCache.localPosterPath(cacheDir, idPart)
        : null
      if (!file) {
        res.writeHead(404)
        res.end()
        return
      }
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=604800' })
      fs.createReadStream(file).pipe(res)
      return
    }

    if (url.pathname === '/login' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(loginPage())
      return
    }

    if (url.pathname === '/login' && req.method === 'POST') {
      const { username, code } = await readBody(req)
      const user = auth.findApprovedUserByUsernameAndCode(store, username, code)
      if (!user) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(loginPage({ error: 'That username/code combination is invalid, expired, or has been revoked.' }))
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
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(requestAccessPage())
      return
    }

    if (url.pathname === '/request-access' && req.method === 'POST') {
      const { name, email, message } = await readBody(req)
      if (!name || !name.trim() || !email || !email.trim()) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
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

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(requestAccessPage({ submitted: true }))
      return
    }

    if (url.pathname === '/forgot-code' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
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
            text: `Hi ${user.name},\n\nYour MovieAPP username: ${user.username}\nYour new access code: ${code}\n\nYour old code no longer works. Log in at the site's "Watch Now" link and enter both.`
          })
          .catch(() => {})
      }
      // same response either way, so we don't reveal whether an email has access
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(forgotCodePage({ submitted: true }))
      return
    }

    // --- everything below requires a valid session ---

    if (!userId) {
      res.writeHead(302, { Location: '/login' })
      res.end()
      return
    }

    auth.touchLastSeen(store, userId)

    if (url.pathname === '/heartbeat' && req.method === 'POST') {
      // touchLastSeen above already recorded this; this route just exists so the
      // browser has something to ping every ~20s while a tab stays open, so
      // "online" reflects an open tab and not just the last page load.
      res.writeHead(204)
      res.end()
      return
    }

    if (url.pathname === '/') {
      const key = store.get('tmdbApiKey') || process.env.TMDB_API_KEY
      const cacheDir = getTmdbCacheDir ? getTmdbCacheDir() : null
      const movies = scanMovies(getMoviesDir())
      const enrichedRaw = await Promise.all(
        movies.map(async (m) => ({ ...m, tmdb: await tmdbLookup(m.fileName, key, cacheDir) }))
      )
      const titleOf = (m) => m.tmdb?.title || m.name
      const enriched = enrichedRaw
        .slice()
        .sort((a, b) => titleOf(a).localeCompare(titleOf(b), undefined, { sensitivity: 'base' }))

      const view = url.searchParams.get('view') || 'all'
      const actorParam = url.searchParams.get('actor') || ''

      const movieCard = (m, anchorId) => {
        const t = m.tmdb
        const displayName = escapeHtml(t?.title || m.name)
        const year = t?.release_date?.slice(0, 4) || ''
        const posterSrc = t ? posterUrl(cacheDir, t.id, t.poster_path) : null
        const poster = posterSrc
          ? `<img src="${posterSrc}" alt="${displayName}">`
          : `<div class="noposter">No poster</div>`
        return `<a class="card"${anchorId ? ` id="${anchorId}"` : ''} data-name="${escapeHtml(m.name.toLowerCase())}" href="/watch?id=${encodeURIComponent(m.id)}">
          ${poster}
          <div class="meta"><div class="title">${displayName}</div><div class="sub">${year}</div></div>
        </a>`
      }

      const letterOf = (m) => {
        const ch = titleOf(m).charAt(0).toUpperCase()
        return /[A-Z]/.test(ch) ? ch : '#'
      }

      let body = ''

      if (view === 'year') {
        if (!enriched.length) {
          body = '<p class="empty">No movies found.</p>'
        } else {
          const sorted = enriched.slice().sort((a, b) => {
            const yearDiff = (b.tmdb?.release_date || '').localeCompare(a.tmdb?.release_date || '')
            return yearDiff !== 0 ? yearDiff : titleOf(a).localeCompare(titleOf(b), undefined, { sensitivity: 'base' })
          })
          const groups = new Map()
          for (const m of sorted) {
            const year = m.tmdb?.release_date?.slice(0, 4) || 'Unknown year'
            if (!groups.has(year)) groups.set(year, [])
            groups.get(year).push(m)
          }
          // Tag the first movie for each letter (in on-page order, across all years)
          // with an anchor id so the side rail can jump straight to it.
          const seenLetters = new Set()
          const availableLetters = new Set(sorted.map(letterOf))
          const sections = Array.from(groups.entries())
            .map(([year, list]) => {
              const cards = list
                .map((m) => {
                  const letter = letterOf(m)
                  let anchorId
                  if (!seenLetters.has(letter)) {
                    seenLetters.add(letter)
                    anchorId = `letter-${letter}`
                  }
                  return movieCard(m, anchorId)
                })
                .join('')
              return `<h3 style="margin:24px 0 10px;">${escapeHtml(year)}</h3><div class="grid">${cards}</div>`
            })
            .join('')
          body = `<div style="display:flex;gap:8px;">
            <div style="flex:1;min-width:0;">${sections}</div>
            ${alphabetRailSide(availableLetters)}
          </div>`
        }
      } else if (view === 'actor') {
        if (!key) {
          body = '<p class="empty">Add a TMDB key in Settings to browse by actor.</p>'
        } else {
          const withCast = await Promise.all(
            enriched.map(async (m) => ({ ...m, cast: m.tmdb ? await tmdbCredits(m.tmdb.id, key, cacheDir) : [] }))
          )
          if (actorParam) {
            const filtered = withCast.filter((m) => m.cast.some((c) => c.name === actorParam))
            body = `
              <a href="/?view=actor" class="muted" style="color:#4f9dff;">← All actors</a>
              <h3 style="margin:14px 0 10px;">${escapeHtml(actorParam)}</h3>
              <div class="grid">${filtered.map(movieCard).join('') || '<p class="empty">No movies found.</p>'}</div>
            `
          } else {
            const actorMap = new Map()
            withCast.forEach((m) => m.cast.forEach((c) => {
              if (!actorMap.has(c.name)) actorMap.set(c.name, c)
            }))
            const actors = Array.from(actorMap.values()).sort((a, b) => a.name.localeCompare(b.name))
            const actorCards = actors
              .map((c) => {
                const photoSrc = actorPhotoUrl(cacheDir, c.id, c.profilePath)
                const photo = photoSrc
                  ? `<img src="${photoSrc}" alt="${escapeHtml(c.name)}" style="width:64px;height:64px;border-radius:50%;object-fit:cover;margin:0 auto 10px;display:block;">`
                  : `<div style="width:64px;height:64px;border-radius:50%;background:#2a2f3a;color:#8a8f98;display:flex;align-items:center;justify-content:center;margin:0 auto 10px;font-size:20px;">${escapeHtml(c.name.charAt(0))}</div>`
                return `<a href="/?view=actor&actor=${encodeURIComponent(c.name)}" class="card actor-card" data-name="${escapeHtml(c.name.toLowerCase())}">${photo}${escapeHtml(c.name)}</a>`
              })
              .join('')
            body = actors.length
              ? `<input id="q" placeholder="Search actors…"><div class="grid">${actorCards}</div>`
              : '<p class="empty">No cast info found for your library.</p>'
          }
        }
      } else {
        if (!enriched.length) {
          body = `<input id="q" placeholder="Search your library…"><p class="empty">No movies found.</p>`
        } else {
          const letterGroups = new Map()
          enriched.forEach((m) => {
            const letter = letterOf(m)
            if (!letterGroups.has(letter)) letterGroups.set(letter, [])
            letterGroups.get(letter).push(m)
          })
          const availableLetters = new Set(letterGroups.keys())
          const sections = Array.from(letterGroups.entries())
            .map(
              ([letter, list]) =>
                `<div id="letter-${letter}"><h3 style="margin:20px 0 10px;">${letter}</h3><div class="grid">${list
                  .map((m) => movieCard(m))
                  .join('')}</div></div>`
            )
            .join('')
          body = `<input id="q" placeholder="Search your library…">
            ${alphabetBarTop(availableLetters)}
            ${sections}`
        }
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(
        page(`
        <div class="topbar">
          <h2 style="margin:0;">MovieAPP</h2>
          <a href="/logout" class="muted" style="color:#8a8f98;">Log out</a>
        </div>
        ${sectionNav('movies')}
        ${navTabs(view)}
        ${body}
        ${HEARTBEAT_SCRIPT}
      `)
      )
      return
    }

    if (url.pathname === '/games') {
      const emuDir = getEmulatorsDir ? getEmulatorsDir() : null
      const apps = emuDir ? scanEmuDir(emuDir, EMULATOR_EXTS) : []
      const roms = emuDir ? scanEmuDir(emuDir, ROM_EXTS) : []
      const ua = req.headers['user-agent'] || ''
      const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua)

      const banner = isMobile
        ? `<div class="muted" style="background:#171a21;border-radius:8px;padding:12px 16px;margin-bottom:20px;line-height:1.5;">
            📱 You're on a phone. The emulator programs below are Windows software and won't run on a phone —
            you'll need to get a compatible emulator app for your phone from your app store instead. The game
            files below will work with that phone app once you download them and open them from it.
          </div>`
        : `<div class="muted" style="background:#171a21;border-radius:8px;padding:12px 16px;margin-bottom:20px;line-height:1.5;">
            💻 You're on a computer. Download an emulator below and install it, then download game files and
            open them with that emulator.
          </div>`

      const appCards = apps
        .map(
          (a) => `<div class="card" style="padding:14px;">
            <div class="title">${escapeHtml(a.name)}</div>
            <div class="sub">${formatBytes(a.size)}</div>
            <a class="btn" style="margin-top:10px;display:inline-block;padding:8px 14px;font-size:13px;"
               href="/download/emulator?id=${encodeURIComponent(encodeId(a.relPath))}">Download</a>
          </div>`
        )
        .join('')

      const romCards = roms
        .map(
          (r) => `<div class="card" style="padding:14px;">
            <div class="title">${escapeHtml(r.name)}</div>
            <div class="sub">${escapeHtml(path.extname(r.fileName).slice(1).toUpperCase())} · ${formatBytes(r.size)}</div>
            <a class="btn" style="margin-top:10px;display:inline-block;padding:8px 14px;font-size:13px;"
               href="/download/rom?id=${encodeURIComponent(encodeId(r.relPath))}">Download</a>
          </div>`
        )
        .join('')

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(
        page(`
        <div class="topbar">
          <h2 style="margin:0;">MovieAPP</h2>
          <a href="/logout" class="muted" style="color:#8a8f98;">Log out</a>
        </div>
        ${sectionNav('games')}
        ${banner}
        <h3 style="margin:0 0 10px;">Emulators</h3>
        <div class="grid">${appCards || '<p class="empty">No emulator apps found.</p>'}</div>
        <h3 style="margin:28px 0 10px;">Games</h3>
        <div class="grid">${romCards || '<p class="empty">No game files found.</p>'}</div>
        ${recommendedEmulatorsSection()}
        ${HEARTBEAT_SCRIPT}
      `)
      )
      return
    }

    if (url.pathname === '/tvshows') {
      const tvDir = getTvShowsDir ? getTvShowsDir() : null
      const key = store.get('tmdbApiKey') || process.env.TMDB_API_KEY
      const cacheDir = getTmdbCacheDir ? getTmdbCacheDir() : null
      const files = tvDir ? scanTvShows(tvDir) : []

      const showMap = new Map()
      files.forEach((f) => {
        const { show: showName, year } = groupKeyAndName(f.relPath, f.fileName)
        const parsed = parseEpisode(f.fileName)
        const showKey = encodeId(showName.toLowerCase())
        if (!showMap.has(showKey)) showMap.set(showKey, { key: showKey, name: showName, year, episodes: [] })
        showMap
          .get(showKey)
          .episodes.push({ season: parsed.season, episode: parsed.episode, episodeTitle: parsed.episodeTitle, relPath: f.relPath, fileName: f.fileName })
      })

      const showParam = url.searchParams.get('show') || ''

      if (showParam && showMap.has(showParam)) {
        const show = showMap.get(showParam)
        const meta = await tmdbLookupTv(show.name, showParam, key, cacheDir, show.year)

        const seasons = new Map()
        show.episodes.forEach((ep) => {
          const seasonKey = ep.season === null ? 'Unsorted' : `Season ${String(ep.season).padStart(2, '0')}`
          if (!seasons.has(seasonKey)) seasons.set(seasonKey, [])
          seasons.get(seasonKey).push(ep)
        })
        const sortedSeasonKeys = Array.from(seasons.keys()).sort((a, b) => {
          if (a === 'Unsorted') return 1
          if (b === 'Unsorted') return -1
          return a.localeCompare(b)
        })
        sortedSeasonKeys.forEach((k) => seasons.get(k).sort((a, b) => (a.episode ?? 999) - (b.episode ?? 999)))

        const seasonSections = sortedSeasonKeys
          .map((seasonKey) => {
            const rows = seasons
              .get(seasonKey)
              .map(
                (ep) => `<a class="card" style="display:flex;align-items:center;padding:10px 14px;text-decoration:none;color:inherit;margin-bottom:6px;"
                  href="/tvwatch?id=${encodeURIComponent(encodeId(ep.relPath))}">
                  <span class="sub" style="min-width:60px;">${ep.episode !== null ? `Ep ${ep.episode}` : '—'}</span>
                  <span class="title">${escapeHtml(ep.episodeTitle || ep.fileName)}</span>
                </a>`
              )
              .join('')
            return `<h4 style="font-size:14px;margin:0 0 10px;color:#8a8f98;">${escapeHtml(seasonKey)}</h4>
              <div style="display:flex;flex-direction:column;">${rows}</div>`
          })
          .join('<div style="height:20px;"></div>')

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(
          page(`
          <div class="topbar">
            <h2 style="margin:0;">MovieAPP</h2>
            <a href="/logout" class="muted" style="color:#8a8f98;">Log out</a>
          </div>
          ${sectionNav('tvshows')}
          <a href="/tvshows" class="muted" style="color:#4f9dff;">← All shows</a>
          <h3 style="margin:14px 0 4px;">${escapeHtml(meta?.name || show.name)}</h3>
          ${meta?.overview ? `<p class="muted" style="max-width:640px;line-height:1.5;margin:0 0 16px;">${escapeHtml(meta.overview)}</p>` : ''}
          ${seasonSections}
          ${HEARTBEAT_SCRIPT}
        `)
        )
        return
      }

      const shows = Array.from(showMap.values()).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
      const letterGroups = new Map()
      shows.forEach((s) => {
        const ch = s.name.charAt(0).toUpperCase()
        const letter = /[A-Z]/.test(ch) ? ch : '#'
        if (!letterGroups.has(letter)) letterGroups.set(letter, [])
        letterGroups.get(letter).push(s)
      })
      const availableLetters = new Set(letterGroups.keys())

      const showCardsFor = async (list) =>
        (
          await Promise.all(
            list.map(async (s) => {
              const meta = await tmdbLookupTv(s.name, s.key, key, cacheDir, s.year)
              const posterSrc = meta ? tvPosterUrl(cacheDir, meta.id, meta.poster_path) : null
              const poster = posterSrc
                ? `<img src="${posterSrc}" alt="${escapeHtml(s.name)}">`
                : `<div class="noposter">No poster</div>`
              const year = meta?.first_air_date?.slice(0, 4) || ''
              return `<a class="card" data-name="${escapeHtml(s.name.toLowerCase())}" href="/tvshows?show=${encodeURIComponent(s.key)}">
                ${poster}
                <div class="meta">
                  <div class="title">${escapeHtml(meta?.name || s.name)}</div>
                  <div class="sub">${s.episodes.length} episode${s.episodes.length === 1 ? '' : 's'}${year ? ` · ${year}` : ''}</div>
                </div>
              </a>`
            })
          )
        ).join('')

      let sections = ''
      if (shows.length) {
        const sectionParts = []
        for (const [letter, list] of letterGroups) {
          sectionParts.push(`<div id="letter-${letter}"><h3 style="margin:20px 0 10px;">${letter}</h3><div class="grid">${await showCardsFor(list)}</div></div>`)
        }
        sections = sectionParts.join('')
      }

      const body = shows.length
        ? `<input id="q" placeholder="Search your TV shows…">${alphabetBarTop(availableLetters)}${sections}`
        : `<input id="q" placeholder="Search your TV shows…"><p class="empty">No TV shows found.</p>`

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(
        page(`
        <div class="topbar">
          <h2 style="margin:0;">MovieAPP</h2>
          <a href="/logout" class="muted" style="color:#8a8f98;">Log out</a>
        </div>
        ${sectionNav('tvshows')}
        ${body}
        ${HEARTBEAT_SCRIPT}
      `)
      )
      return
    }

    if (url.pathname === '/tvwatch') {
      const id = url.searchParams.get('id') || ''
      let relPath = ''
      try {
        relPath = decodeId(id)
      } catch {
        relPath = ''
      }

      const users = auth.getUsers(store)
      const user = users.find((u) => u.id === userId)
      const parsed = relPath ? parseEpisode(path.basename(relPath)) : null
      const title = parsed ? `${parsed.show}${parsed.season !== null ? ` — S${parsed.season}E${parsed.episode}` : ''}` : 'Unknown'

      const sessionId = history.startSession(store, {
        userId,
        userName: user?.name || 'Unknown',
        fileName: relPath,
        title
      })

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(
        `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head>
        <body style="margin:0;background:#000">
        <video id="v" src="/tvfile?id=${encodeURIComponent(id)}" controls autoplay playsinline style="width:100%;height:100vh"></video>
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

    if (url.pathname === '/tvfile') {
      const id = url.searchParams.get('id') || ''
      let relPath
      try {
        relPath = decodeId(id)
      } catch {
        res.writeHead(400)
        res.end()
        return
      }
      const tvDir = getTvShowsDir ? getTvShowsDir() : null
      const files = tvDir ? scanTvShows(tvDir) : []
      const match = files.find((f) => f.relPath === relPath)
      if (!match) {
        res.writeHead(404)
        res.end('Not found')
        return
      }
      const filePath = path.join(tvDir, match.relPath)
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

    if (url.pathname === '/download/emulator' || url.pathname === '/download/rom') {
      const id = url.searchParams.get('id') || ''
      let relPath
      try {
        relPath = decodeId(id)
      } catch {
        res.writeHead(400)
        res.end()
        return
      }
      const emuDir = getEmulatorsDir ? getEmulatorsDir() : null
      const exts = url.pathname === '/download/emulator' ? EMULATOR_EXTS : ROM_EXTS
      const entries = emuDir ? scanEmuDir(emuDir, exts) : []
      const match = entries.find((e) => e.relPath === relPath)
      if (!match) {
        res.writeHead(404)
        res.end('Not found')
        return
      }
      const filePath = path.join(emuDir, match.relPath)
      const stat = fs.statSync(filePath)
      res.writeHead(200, {
        'Content-Length': stat.size,
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${match.fileName.replace(/"/g, '')}"`
      })
      fs.createReadStream(filePath).pipe(res)
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
      const cacheDir = getTmdbCacheDir ? getTmdbCacheDir() : null
      const tmdb = fileName ? await tmdbLookup(fileName, key, cacheDir) : null
      const title = tmdb?.title || cleanTitle(fileName || 'Unknown')

      const sessionId = history.startSession(store, {
        userId,
        userName: user?.name || 'Unknown',
        fileName,
        title
      })

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
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
