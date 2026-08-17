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
const tmdbCache = require('./tmdbCache')

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

function getViewerAppDir() {
  return store.get('viewerAppDir') || ''
}

function getTmdbCacheDir() {
  return store.get('tmdbCacheDir') || ''
}

function getEmulatorsDir() {
  return defaultDir('emulatorsDir', process.env.EMULATORS_DIR || 'C:\\MovieAPP\\Emulators')
}

function getTvShowsDir() {
  return defaultDir('tvShowsDir', process.env.TVSHOWS_DIR || 'D:\\MovieAPP\\TVShows')
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
            relPath: path.relative(dir, full),
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
    getTvShowsDir,
    getViewerAppDir,
    getTmdbCacheDir,
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
  tvShowsDir: getTvShowsDir(),
  viewerAppDir: getViewerAppDir(),
  tmdbCacheDir: getTmdbCacheDir(),
  tmdbApiKey: store.get('tmdbApiKey') || process.env.TMDB_API_KEY || '',
  emailUser: store.get('emailUser') || '',
  emailAppPassword: store.get('emailAppPassword') || '',
  adminNotifyEmail: store.get('adminNotifyEmail') || '',
  emailConfigured: mailer.isConfigured(store),
  missingSearchEngine: store.get('missingSearchEngine') || 'imdb',
  customSearchSites: store.get('customSearchSites') || [],
  // Separate remembered search-site choice per section, so TV Shows and
  // Movies can each stick to their own default (e.g. different trackers) —
  // empty until the user picks one in that section.
  tvShowsSearchEngine: store.get('tvShowsSearchEngine') || '',
  moviesSearchEngine: store.get('moviesSearchEngine') || '',
  // Manual per-file title corrections — used when a filename is too far off
  // from TMDB's actual title for search to find it on its own (e.g. a file
  // named "...Whitecastle" when TMDB has it as "...White Castle"). Set via
  // the 🔄 retry button on a movie card when the automatic re-check still
  // finds nothing.
  movieTitleOverrides: store.get('movieTitleOverrides') || {}
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

ipcMain.handle('tvshows:scan', () => scanDir(getTvShowsDir(), VIDEO_EXTS))

// Opens a URL in the user's default browser (not an in-app window) — used for
// "look this up on IMDb" links on missing episodes/sequels.
ipcMain.handle('app:openExternal', (_e, url) => {
  if (typeof url !== 'string' || !/^https:\/\//.test(url)) return false
  shell.openExternal(url)
  return true
})

// Used for the "🗑 Delete this copy" action on duplicate episodes/movies —
// only allows deleting a file that's actually inside one of the app's own
// managed folders (Movies/TV Shows), as a guardrail against deleting
// anything else on the user's machine.
ipcMain.handle('file:delete', (_e, filePath) => {
  if (typeof filePath !== 'string' || !filePath) return { ok: false, error: 'invalid_path' }
  const resolved = path.resolve(filePath)
  const allowedRoots = [getMoviesDir(), getTvShowsDir()].filter(Boolean).map((d) => path.resolve(d))
  const isAllowed = allowedRoots.some((root) => resolved === root || resolved.startsWith(root + path.sep))
  if (!isAllowed) return { ok: false, error: 'outside_managed_folders' }
  try {
    fs.unlinkSync(resolved)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
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

// TMDB issues two kinds of credentials that both work for read endpoints:
//  - v3 "API Key": a short alphanumeric string -> passed as ?api_key=
//  - v4 "Read Access Token": a long JWT (three dot-separated segments) -> passed as a Bearer header
function tmdbAuth(key) {
  const isV4Token = key.split('.').length === 3
  return {
    isV4Token,
    headers: isV4Token ? { Authorization: `Bearer ${key}`, accept: 'application/json' } : { accept: 'application/json' }
  }
}

function withLocalPoster(result) {
  if (!result) return result
  const cacheDir = getTmdbCacheDir()
  const local = tmdbCache.localPosterPath(cacheDir, result.id)
  // Served over the local stream server, not a file:// link — Chromium blocks
  // file:// image loads from a page whose own origin is http:// (which this
  // renderer is, both in dev at localhost:5173 and once packaged), so a
  // file:// src here would just silently fail to load.
  return { ...result, localPosterPath: local ? `http://localhost:${STREAM_PORT}/media/poster/${result.id}.jpg` : null }
}

async function movieSearchOnce(query, year, headers, isV4Token, key) {
  const yearParam = year ? `&year=${encodeURIComponent(year)}` : ''
  const url = isV4Token
    ? `https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(query)}${yearParam}`
    : `https://api.themoviedb.org/3/search/movie?api_key=${key}&query=${encodeURIComponent(query)}${yearParam}`
  const res = await fetch(url, { headers })
  if (!res.ok) return { ok: false, status: res.status }
  const data = await res.json()
  return { ok: true, results: data.results || [] }
}

// Tries with the year first (disambiguates short/common titles — otherwise a
// query like "blade" can come back as "Blade II" instead of "Blade"), then
// falls back to the plain title if that comes up empty.
async function searchMovieSmart(query, year, key, headers, isV4Token) {
  if (year) {
    const r1 = await movieSearchOnce(query, year, headers, isV4Token, key)
    if (!r1.ok) return r1
    if (r1.results.length) return r1
  }
  return movieSearchOnce(query, null, headers, isV4Token, key)
}

const ROMAN_NUMERALS = { i: '1', ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9', x: '10' }

// Normalizes for comparison only (not for the actual TMDB query) — lowercase,
// punctuation collapsed to spaces, and small roman numerals converted to
// digits, so "Jurassic Park III" and "Jurassic Park 3" are recognized as the
// same title even though TMDB's search wouldn't otherwise treat them as one.
function normalizeTitle(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .map((w) => ROMAN_NUMERALS[w] || w)
    .join(' ')
}

// TMDB's search endpoint sorts by popularity, not by how well a result
// actually matches the query — a search for "blade" can come back with
// "Blade II" ranked above "Blade" itself. Prefer a result whose title is an
// exact (normalized) match to the query before falling back to TMDB's own
// top result.
function pickBestMatch(query, results) {
  if (!results || !results.length) return null
  const q = normalizeTitle(query)
  const exact = results.find((r) => normalizeTitle(r.title) === q || normalizeTitle(r.original_title) === q)
  return exact || results[0]
}

ipcMain.handle('tmdb:search', async (_e, { query, fileName, year, forceRefresh } = {}) => {
  const cacheDir = getTmdbCacheDir()

  // Cached first — this is what makes offline mode work: once a fileName has been
  // looked up, we never touch the network for it again.
  if (fileName && !forceRefresh) {
    const manifest = tmdbCache.getManifest(cacheDir)
    if (fileName in manifest) {
      return { results: manifest[fileName] ? [withLocalPoster(manifest[fileName])] : [] }
    }
  }

  const key = store.get('tmdbApiKey') || process.env.TMDB_API_KEY
  if (!key) return { error: 'no_api_key' }

  const { headers, isV4Token } = tmdbAuth(key)

  try {
    const result = await searchMovieSmart(query, year, key, headers, isV4Token)
    if (!result.ok) return { error: `tmdb_http_${result.status}` }
    const match = pickBestMatch(query, result.results)
    // Put the picked match first so callers that just read results[0] (the
    // common case) still get the right one even when it wasn't TMDB's top hit.
    const results = (match ? [match, ...result.results.filter((r) => r.id !== match.id)] : result.results).map(withLocalPoster)

    // Write straight into the offline cache as soon as this movie is looked
    // up — not just when "Download all TMDB info" is run — so a newly added
    // movie's poster is already saved to disk the first time it's scanned,
    // and every scan after that is free (no repeat network call).
    if (fileName && cacheDir) {
      const paths = tmdbCache.ensureDirs(cacheDir)
      const manifest = tmdbCache.getManifest(cacheDir)
      manifest[fileName] = match
      tmdbCache.writeJson(paths.manifestFile, manifest)
      if (match?.poster_path) {
        const posterFile = path.join(paths.postersDir, `${match.id}.jpg`)
        await tmdbCache.downloadImage(`https://image.tmdb.org/t/p/w300${match.poster_path}`, posterFile)
      }
    }

    return { results }
  } catch (err) {
    return { error: String(err) }
  }
})

// Commits a specific TMDB movie a person picked by hand (from the "which
// movie did you mean?" picker) straight into the cache — no search involved,
// since the picking already happened client-side.
ipcMain.handle('tmdb:confirmMatch', async (_e, { fileName, movie } = {}) => {
  const cacheDir = getTmdbCacheDir()
  if (!fileName || !movie) return { ok: false }
  if (cacheDir) {
    const paths = tmdbCache.ensureDirs(cacheDir)
    const manifest = tmdbCache.getManifest(cacheDir)
    manifest[fileName] = movie
    tmdbCache.writeJson(paths.manifestFile, manifest)
    if (movie.poster_path) {
      const posterFile = path.join(paths.postersDir, `${movie.id}.jpg`)
      await tmdbCache.downloadImage(`https://image.tmdb.org/t/p/w300${movie.poster_path}`, posterFile)
    }
  }
  return { ok: true, result: withLocalPoster(movie) }
})

// Mirrors the grouping logic in TVShows.jsx / streamServer.js — needed here so
// the offline prefetch can figure out unique show names from scanned files
// the same way the TV Shows tab does (folder-name-first, filename fallback).
function cleanText(raw) {
  return raw.replace(/[._-]/g, ' ').replace(/\s+/g, ' ').trim()
}

function stripLeadingId(raw) {
  return raw.replace(/^\d{4,}[\s._-]+/, '')
}

function extractTrailingYear(raw) {
  // Tolerates the year being wrapped in parens/brackets at the very end too
  // ("Movie Name (1995)"), not just bare ("Show Name 2026").
  const m = raw.match(/^(.*?)[\s._-]*[([]?((?:19|20)\d{2})[)\]]?[\s._-]*$/)
  if (!m) return { rest: raw, year: null }
  return { rest: m[1], year: m[2] }
}

// Scene-release quality/source tags in brackets or parens ("[1080p]",
// "(WEB-DL)") get dropped entirely — they're never part of the title. A
// bracket/paren block that's ONLY a 4-digit year is left alone so
// extractTrailingYear can still find it afterward.
function stripQualityTags(raw) {
  return raw.replace(/[([][^)\]]*[)\]]/g, (m) => (/^[([](?:19|20)\d{2}[)\]]$/.test(m) ? m : ' '))
}

// Edition/cut labels ("Director's Cut", "Extended Edition", "Theatrical Cut",
// "Redux", etc) aren't part of the actual title — TMDB has one entry for the
// movie regardless of which cut a file is, so a file like
// "Donnie Darko 2001 - Regular Cut" needs this stripped before searching, or
// the leftover words either return zero results or throw off the match.
const EDITION_TAGS = /\b((director'?s?|extended|theatrical|unrated|special|ultimate|final|regular|uncut)\s*(cut|edition|version)|redux)\b/gi

function stripEditionTags(raw) {
  return raw.replace(EDITION_TAGS, ' ')
}

// Movie-name cleanup used both for live TMDB search and offline prefetch.
// Handles the messy cases a plain "strip dots, cut at the year" approach
// misses: a leading scene-release numeric ID ("0120611-blade-1998" — the
// digits are an IMDb id with "tt" cut off), hyphen-separated slugs
// ("blade-ii-2002"), quality tags stuck right after the year
// ("blade-1998[1080p]"), and edition/cut labels ("Donnie Darko - Director's
// Cut") — all of which would otherwise leak into the search query.
function parseMovieName(fileNameNoExt) {
  const noTags = stripEditionTags(stripQualityTags(fileNameNoExt)).trim()
  const noId = stripLeadingId(noTags)
  const { rest, year } = extractTrailingYear(noId)
  const title = cleanText(rest) || cleanText(noId) || fileNameNoExt
  return { title, year }
}

function parseShowFromFileName(fileName) {
  const noExt = fileName.replace(/\.[^./\\]+$/, '')
  let m = noExt.match(/^(.*?)[.\s_-]+[Ss]\d{1,2}[.\s_-]*[Ee]\d{1,3}(.*)$/)
  if (!m) m = noExt.match(/^(.*?)[.\s_-]+\d{1,2}x\d{1,3}(.*)$/)
  if (!m) m = noExt.match(/^(.*?)[.\s_-]+[Ss]eason[.\s_-]?\d{1,2}[.\s_-]+[Ee]pisode[.\s_-]?\d{1,3}(.*)$/i)
  const rawShow = stripLeadingId(m ? m[1] : noExt)
  const { rest, year } = extractTrailingYear(rawShow)
  return { show: cleanText(rest) || rawShow || noExt, year }
}

function groupKeyAndName(relPath, fileName) {
  const parts = relPath.split(/[\\/]/).filter(Boolean)
  if (parts.length > 1) {
    const folderName = parts[0]
    const { rest, year } = extractTrailingYear(stripLeadingId(folderName))
    return { show: cleanText(rest) || folderName.trim(), year }
  }
  return parseShowFromFileName(fileName)
}

function withLocalTvPoster(result) {
  if (!result) return result
  const cacheDir = getTmdbCacheDir()
  const local = tmdbCache.localTvPosterPath(cacheDir, result.id)
  return { ...result, localPosterPath: local ? `http://localhost:${STREAM_PORT}/media/poster-tv/${result.id}.jpg` : null }
}

async function tvSearchOnce(query, year, headers, isV4Token, key) {
  const yearParam = year ? `&first_air_date_year=${encodeURIComponent(year)}` : ''
  const url = isV4Token
    ? `https://api.themoviedb.org/3/search/tv?query=${encodeURIComponent(query)}${yearParam}`
    : `https://api.themoviedb.org/3/search/tv?api_key=${key}&query=${encodeURIComponent(query)}${yearParam}`
  const res = await fetch(url, { headers })
  if (!res.ok) return { ok: false, status: res.status }
  const data = await res.json()
  return { ok: true, match: data.results?.[0] || null, results: data.results || [] }
}

// Tries a few query variations before giving up — folder/filenames aren't always
// clean enough to match on the first attempt (e.g. a folder literally named
// "Survivor 50" won't match TMDB's "Survivor" until the trailing number is
// stripped). Order: name+year, name alone, name with a trailing season-like
// number removed.
async function searchTvSmart(query, year, key, headers, isV4Token) {
  const r1 = await tvSearchOnce(query, year, headers, isV4Token, key)
  if (!r1.ok) return r1
  if (r1.match) return r1

  if (year) {
    const r2 = await tvSearchOnce(query, null, headers, isV4Token, key)
    if (!r2.ok) return r2
    if (r2.match) return r2
  }

  const trailingNum = query.match(/^(.*?)\s+\d{1,3}$/)
  if (trailingNum) {
    const r3 = await tvSearchOnce(trailingNum[1], year, headers, isV4Token, key)
    if (r3.ok && r3.match) return r3
  }

  return { ok: true, match: null }
}

// TV show lookup, keyed by cleaned show name (not per-episode) — one lookup per
// show, cached to disk the first time so re-scans and offline use don't re-hit
// TMDB. Note: unlike movies, this isn't yet wired into the "Download all TMDB
// info" offline prefetch button — it caches lazily as shows are browsed instead.
ipcMain.handle('tmdb:searchTv', async (_e, { query, showKey, year, altQuery, forceRefresh } = {}) => {
  const cacheDir = getTmdbCacheDir()

  if (showKey && !forceRefresh) {
    const manifest = tmdbCache.getTvManifest(cacheDir)
    if (showKey in manifest) {
      return { result: manifest[showKey] ? withLocalTvPoster(manifest[showKey]) : null }
    }
  }

  const key = store.get('tmdbApiKey') || process.env.TMDB_API_KEY
  if (!key) return { error: 'no_api_key' }

  const { headers, isV4Token } = tmdbAuth(key)

  try {
    let result = await searchTvSmart(query, year, key, headers, isV4Token)
    if (!result.ok) return { error: `tmdb_http_${result.status}` }
    // Folder names aren't always the real title (typos, worded slightly
    // differently than TMDB, etc) — if the primary query came up empty, try
    // the filename-derived title before giving up.
    if (!result.match && altQuery) {
      const altResult = await searchTvSmart(altQuery, year, key, headers, isV4Token)
      if (altResult.ok && altResult.match) result = altResult
    }
    const match = result.match

    if (showKey && cacheDir) {
      const paths = tmdbCache.ensureDirs(cacheDir)
      const manifest = tmdbCache.getTvManifest(cacheDir)
      manifest[showKey] = match
      tmdbCache.writeJson(paths.tvManifestFile, manifest)
      if (match?.poster_path) {
        const posterFile = path.join(paths.tvPostersDir, `${match.id}.jpg`)
        await tmdbCache.downloadImage(`https://image.tmdb.org/t/p/w300${match.poster_path}`, posterFile)
      }
    }

    return { result: match ? withLocalTvPoster(match) : null }
  } catch (err) {
    return { error: String(err) }
  }
})

// Plain multi-result TV search for the "which show did you mean?" picker —
// unlike tmdb:searchTv above, this doesn't touch the cache or try to guess a
// single best match; it just hands back candidates (with posters) for a
// person to choose from directly.
ipcMain.handle('tmdb:searchTvMulti', async (_e, { query, year } = {}) => {
  const key = store.get('tmdbApiKey') || process.env.TMDB_API_KEY
  if (!key) return { error: 'no_api_key' }
  const { headers, isV4Token } = tmdbAuth(key)
  try {
    const result = await tvSearchOnce(query, year, headers, isV4Token, key)
    if (!result.ok) return { error: `tmdb_http_${result.status}` }
    return { results: (result.results || []).map(withLocalTvPoster) }
  } catch (err) {
    return { error: String(err) }
  }
})

// Commits a specific TMDB show a person picked by hand (from the "which show
// did you mean?" picker) straight into the cache — no search involved, since
// the picking already happened client-side.
ipcMain.handle('tmdb:confirmMatchTv', async (_e, { showKey, show } = {}) => {
  const cacheDir = getTmdbCacheDir()
  if (!showKey || !show) return { ok: false }
  if (cacheDir) {
    const paths = tmdbCache.ensureDirs(cacheDir)
    const manifest = tmdbCache.getTvManifest(cacheDir)
    manifest[showKey] = show
    tmdbCache.writeJson(paths.tvManifestFile, manifest)
    if (show.poster_path) {
      const posterFile = path.join(paths.tvPostersDir, `${show.id}.jpg`)
      await tmdbCache.downloadImage(`https://image.tmdb.org/t/p/w300${show.poster_path}`, posterFile)
    }
  }
  return { ok: true, result: withLocalTvPoster(show) }
})

// Season episode counts, for the "show missing episodes" checkbox — lets us tell
// the difference between "you have every episode you own" and "you have every
// episode that exists." In-memory only (needs live internet to check anyway, so
// there's no offline case to support here).
const seasonInfoCache = new Map()

ipcMain.handle('tmdb:tvSeasonInfo', async (_e, { tvId, season } = {}) => {
  if (!tvId || season === null || season === undefined) return { episodes: [] }
  const cacheKey = `${tvId}-${season}`
  if (seasonInfoCache.has(cacheKey)) return { episodes: seasonInfoCache.get(cacheKey) }

  const key = store.get('tmdbApiKey') || process.env.TMDB_API_KEY
  if (!key) return { episodes: [], error: 'no_api_key' }

  const { headers, isV4Token } = tmdbAuth(key)
  const url = isV4Token
    ? `https://api.themoviedb.org/3/tv/${tvId}/season/${season}`
    : `https://api.themoviedb.org/3/tv/${tvId}/season/${season}?api_key=${key}`

  try {
    const res = await fetch(url, { headers })
    if (!res.ok) { seasonInfoCache.set(cacheKey, []); return { episodes: [] } }
    const data = await res.json()
    const episodes = (data.episodes || []).map((e) => ({ episode_number: e.episode_number, name: e.name }))
    seasonInfoCache.set(cacheKey, episodes)
    return { episodes }
  } catch (err) {
    return { episodes: [], error: String(err) }
  }
})

// Full season list for a show (season numbers + episode counts), used to
// detect seasons the user owns zero episodes of (e.g. Season 4 when only 3
// and 5 are on disk) — the per-season episode endpoint alone can't tell us
// that a season exists at all if we never ask about it.
const tvShowSeasonsCache = new Map()

ipcMain.handle('tmdb:tvShowSeasons', async (_e, tvId) => {
  if (!tvId) return { seasons: [] }
  if (tvShowSeasonsCache.has(tvId)) return { seasons: tvShowSeasonsCache.get(tvId) }

  const key = store.get('tmdbApiKey') || process.env.TMDB_API_KEY
  if (!key) return { seasons: [], error: 'no_api_key' }

  const { headers, isV4Token } = tmdbAuth(key)
  const url = isV4Token
    ? `https://api.themoviedb.org/3/tv/${tvId}`
    : `https://api.themoviedb.org/3/tv/${tvId}?api_key=${key}`

  try {
    const res = await fetch(url, { headers })
    if (!res.ok) { tvShowSeasonsCache.set(tvId, []); return { seasons: [] } }
    const data = await res.json()
    const seasons = (data.seasons || [])
      .filter((s) => s.season_number > 0)
      .map((s) => ({ season_number: s.season_number, episode_count: s.episode_count, name: s.name }))
    tvShowSeasonsCache.set(tvId, seasons)
    return { seasons }
  } catch (err) {
    return { seasons: [], error: String(err) }
  }
})

// Movie collection lookups, for the "check for missing sequels" checkbox. Two
// TMDB calls per new movie the first time it's checked: movie details (to learn
// its belongs_to_collection) then the collection itself (to list every part).
// Both cached in-memory for the app session so re-toggling the checkbox is free.
const movieCollectionCache = new Map()
const collectionDetailsCache = new Map()

ipcMain.handle('tmdb:movieCollection', async (_e, movieId) => {
  if (!movieId) return { collection: null }
  if (movieCollectionCache.has(movieId)) return { collection: movieCollectionCache.get(movieId) }

  const key = store.get('tmdbApiKey') || process.env.TMDB_API_KEY
  if (!key) return { collection: null, error: 'no_api_key' }

  const { headers, isV4Token } = tmdbAuth(key)

  try {
    const detailsUrl = isV4Token
      ? `https://api.themoviedb.org/3/movie/${movieId}`
      : `https://api.themoviedb.org/3/movie/${movieId}?api_key=${key}`
    const detailsRes = await fetch(detailsUrl, { headers })
    if (!detailsRes.ok) { movieCollectionCache.set(movieId, null); return { collection: null } }
    const details = await detailsRes.json()
    const collectionRef = details.belongs_to_collection
    if (!collectionRef) { movieCollectionCache.set(movieId, null); return { collection: null } }

    if (collectionDetailsCache.has(collectionRef.id)) {
      const cached = collectionDetailsCache.get(collectionRef.id)
      movieCollectionCache.set(movieId, cached)
      return { collection: cached }
    }

    const collectionUrl = isV4Token
      ? `https://api.themoviedb.org/3/collection/${collectionRef.id}`
      : `https://api.themoviedb.org/3/collection/${collectionRef.id}?api_key=${key}`
    const collectionRes = await fetch(collectionUrl, { headers })
    if (!collectionRes.ok) { movieCollectionCache.set(movieId, null); return { collection: null } }
    const collectionData = await collectionRes.json()
    const collection = {
      id: collectionData.id,
      name: collectionData.name,
      parts: (collectionData.parts || []).map((p) => ({ id: p.id, title: p.title, release_date: p.release_date || null }))
    }
    collectionDetailsCache.set(collectionRef.id, collection)
    movieCollectionCache.set(movieId, collection)
    return { collection }
  } catch (err) {
    return { collection: null, error: String(err) }
  }
})

const creditsCache = new Map()

ipcMain.handle('tmdb:credits', async (_e, movieId) => {
  if (!movieId) return { cast: [] }

  const cacheDir = getTmdbCacheDir()
  const creditsMap = tmdbCache.getCreditsMap(cacheDir)
  const withLocalPhotos = (cast) =>
    cast.map((c) => {
      const local = tmdbCache.localActorPhotoPath(cacheDir, c.id)
      return { ...c, localPhotoPath: local ? `http://localhost:${STREAM_PORT}/media/actor/${c.id}.jpg` : null }
    })

  if (creditsMap[movieId]) return { cast: withLocalPhotos(creditsMap[movieId]) }
  if (creditsCache.has(movieId)) return { cast: withLocalPhotos(creditsCache.get(movieId)) }

  const key = store.get('tmdbApiKey') || process.env.TMDB_API_KEY
  if (!key) return { cast: [] }
  const { headers, isV4Token } = tmdbAuth(key)
  const url = isV4Token
    ? `https://api.themoviedb.org/3/movie/${movieId}/credits`
    : `https://api.themoviedb.org/3/movie/${movieId}/credits?api_key=${key}`

  try {
    const res = await fetch(url, { headers })
    if (!res.ok) {
      creditsCache.set(movieId, [])
      return { cast: [] }
    }
    const data = await res.json()
    const cast = (data.cast || []).slice(0, 8).map((c) => ({ id: c.id, name: c.name, profilePath: c.profile_path || null }))
    creditsCache.set(movieId, cast)

    // Same write-through-cache idea as tmdb:search/tmdb:searchTv — save cast +
    // actor photos to disk the moment they're looked up, not just during a
    // full "Download all" run.
    if (cacheDir) {
      const paths = tmdbCache.ensureDirs(cacheDir)
      const diskCreditsMap = tmdbCache.getCreditsMap(cacheDir)
      diskCreditsMap[movieId] = cast
      tmdbCache.writeJson(paths.creditsFile, diskCreditsMap)
      for (const c of cast) {
        if (!c.profilePath) continue
        const photoFile = path.join(paths.actorsDir, `${c.id}.jpg`)
        await tmdbCache.downloadImage(`https://image.tmdb.org/t/p/w185${c.profilePath}`, photoFile)
      }
    }

    return { cast: withLocalPhotos(cast) }
  } catch (err) {
    creditsCache.set(movieId, [])
    return { cast: [], error: String(err) }
  }
})

// --- Offline prefetch: downloads every movie's TMDB match, poster, cast, and cast
// photos to disk once, so the app can run with zero internet access afterward
// (e.g. at a cabin with no connectivity). ---

let prefetchRunning = false

ipcMain.handle('tmdb:prefetchAll', async (event, { force } = {}) => {
  if (prefetchRunning) return { ok: false, error: 'already_running' }
  const cacheDir = getTmdbCacheDir()
  if (!cacheDir) return { ok: false, error: 'no_cache_dir' }
  const key = store.get('tmdbApiKey') || process.env.TMDB_API_KEY
  if (!key) return { ok: false, error: 'no_api_key' }

  prefetchRunning = true
  try {
    const paths = tmdbCache.ensureDirs(cacheDir)
    const manifest = tmdbCache.getManifest(cacheDir)
    const creditsMap = tmdbCache.getCreditsMap(cacheDir)
    const { headers, isV4Token } = tmdbAuth(key)

    const files = scanDir(getMoviesDir(), VIDEO_EXTS)
    const total = files.length
    let done = 0
    let posterCount = 0
    let actorCount = 0

    const send = (title) => {
      done += 1
      event.sender.send('tmdb:prefetchProgress', { current: done, total, title })
    }

    for (const f of files) {
      const override = store.get('movieTitleOverrides')?.[f.fileName]
      const { title: cleanName, year } = override ? { title: override, year: null } : parseMovieName(f.fileName.replace(path.extname(f.fileName), ''))

      // `in` check, not truthiness — a movie already cached as "no TMDB match"
      // (null) must stay skipped, or every prefetch run re-queries it forever.
      // `force` (the "Re-check all movie matches" button) bypasses this
      // entirely, so matches picked before a matching-logic improvement (or
      // before a manual title override was set) get re-verified instead of
      // staying stuck on a stale/wrong result forever.
      let match = !force && f.fileName in manifest ? manifest[f.fileName] : undefined
      if (match === undefined) {
        try {
          const result = await searchMovieSmart(cleanName || f.name, year, key, headers, isV4Token)
          match = result.ok ? pickBestMatch(cleanName || f.name, result.results) : null
        } catch {
          match = null
        }
        manifest[f.fileName] = match
        tmdbCache.writeJson(paths.manifestFile, manifest)
      }

      if (match?.poster_path) {
        const posterFile = path.join(paths.postersDir, `${match.id}.jpg`)
        const ok = await tmdbCache.downloadImage(`https://image.tmdb.org/t/p/w300${match.poster_path}`, posterFile)
        if (ok) posterCount += 1
      }

      if (match?.id && !creditsMap[match.id]) {
        const creditsUrl = isV4Token
          ? `https://api.themoviedb.org/3/movie/${match.id}/credits`
          : `https://api.themoviedb.org/3/movie/${match.id}/credits?api_key=${key}`
        try {
          const res = await fetch(creditsUrl, { headers })
          if (res.ok) {
            const data = await res.json()
            const cast = (data.cast || []).slice(0, 8).map((c) => ({ id: c.id, name: c.name, profilePath: c.profile_path || null }))
            creditsMap[match.id] = cast
            tmdbCache.writeJson(paths.creditsFile, creditsMap)

            for (const c of cast) {
              if (!c.profilePath) continue
              const photoFile = path.join(paths.actorsDir, `${c.id}.jpg`)
              const ok = await tmdbCache.downloadImage(`https://image.tmdb.org/t/p/w185${c.profilePath}`, photoFile)
              if (ok) actorCount += 1
            }
          }
        } catch {
          // leave uncached — a normal run later (with internet) will retry it
        }
      }

      send(match?.title || f.name)
    }

    return { ok: true, movies: total, posters: posterCount, actorPhotos: actorCount }
  } catch (err) {
    return { ok: false, error: String(err) }
  } finally {
    prefetchRunning = false
  }
})

// Same idea as tmdb:prefetchAll above, but for TV Shows — groups scanned
// episode files into unique shows (same folder-name-first logic the TV Shows
// tab uses), looks up each show once, and downloads its poster to disk.
let prefetchTvRunning = false

ipcMain.handle('tmdb:prefetchAllTv', async (event) => {
  if (prefetchTvRunning) return { ok: false, error: 'already_running' }
  const cacheDir = getTmdbCacheDir()
  if (!cacheDir) return { ok: false, error: 'no_cache_dir' }
  const key = store.get('tmdbApiKey') || process.env.TMDB_API_KEY
  if (!key) return { ok: false, error: 'no_api_key' }

  prefetchTvRunning = true
  try {
    const paths = tmdbCache.ensureDirs(cacheDir)
    const manifest = tmdbCache.getTvManifest(cacheDir)
    const { headers, isV4Token } = tmdbAuth(key)

    const files = scanDir(getTvShowsDir(), VIDEO_EXTS)
    const shows = new Map()
    files.forEach((f) => {
      const { show, year } = groupKeyAndName(f.relPath || f.fileName, f.fileName)
      const showKey = show.toLowerCase()
      if (!shows.has(showKey)) shows.set(showKey, { name: show, year })
    })

    const total = shows.size
    let done = 0
    let posterCount = 0

    const send = (title) => {
      done += 1
      event.sender.send('tmdb:prefetchTvProgress', { current: done, total, title })
    }

    for (const [showKey, { name, year }] of shows) {
      let match = manifest[showKey]
      if (!(showKey in manifest)) {
        try {
          const result = await searchTvSmart(name, year, key, headers, isV4Token)
          match = result.ok ? result.match : null
        } catch {
          match = null
        }
        manifest[showKey] = match
        tmdbCache.writeJson(paths.tvManifestFile, manifest)
      }

      if (match?.poster_path) {
        const posterFile = path.join(paths.tvPostersDir, `${match.id}.jpg`)
        const ok = await tmdbCache.downloadImage(`https://image.tmdb.org/t/p/w300${match.poster_path}`, posterFile)
        if (ok) posterCount += 1
      }

      send(match?.name || name)
    }

    return { ok: true, shows: total, posters: posterCount }
  } catch (err) {
    return { ok: false, error: String(err) }
  } finally {
    prefetchTvRunning = false
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
  requests: auth.getRequests(store).filter((r) => r.status === 'pending'),
  lastSeen: auth.getLastSeenMap(store)
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

ipcMain.handle('auth:setUserCode', async (_e, { userId, code } = {}) => {
  const newCode = auth.setUserCode(store, userId, code)
  if (!newCode) return { ok: false, error: 'empty_code' }
  const user = auth.getUsers(store).find((u) => u.id === userId)
  const emailed = user ? await emailCodeIfPossible(user, newCode) : false
  return { ok: true, code: newCode, emailed }
})

ipcMain.handle('history:list', () => {
  return history.getHistory(store).slice().reverse()
})
