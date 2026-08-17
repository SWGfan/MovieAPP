const fs = require('fs')
const path = require('path')

// Shared on-disk TMDB cache used by both the Electron admin app and the public
// stream server, so a copy of this folder makes the whole app (posters, titles,
// years, cast names/photos) work with zero internet access — built for the "this
// is going in a cabin with no internet" use case.

function paths(cacheDir) {
  return {
    dir: cacheDir,
    postersDir: path.join(cacheDir, 'posters'),
    actorsDir: path.join(cacheDir, 'actors'),
    manifestFile: path.join(cacheDir, 'manifest.json'), // fileName -> tmdb movie summary
    creditsFile: path.join(cacheDir, 'credits.json'), // tmdb movie id -> cast array
    // TV shows use their own poster folder and manifest (keyed by cleaned show name,
    // not filename) since TMDB movie ids and tv ids are separate namespaces and would
    // otherwise collide in a shared posters/ folder.
    tvPostersDir: path.join(cacheDir, 'posters-tv'),
    tvManifestFile: path.join(cacheDir, 'tv-manifest.json') // show name -> tmdb tv summary
  }
}

function ensureDirs(cacheDir) {
  const p = paths(cacheDir)
  fs.mkdirSync(p.postersDir, { recursive: true })
  fs.mkdirSync(p.actorsDir, { recursive: true })
  fs.mkdirSync(p.tvPostersDir, { recursive: true })
  return p
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return {}
  }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2))
}

function getManifest(cacheDir) {
  if (!cacheDir) return {}
  return readJson(paths(cacheDir).manifestFile)
}

function getCreditsMap(cacheDir) {
  if (!cacheDir) return {}
  return readJson(paths(cacheDir).creditsFile)
}

function getTvManifest(cacheDir) {
  if (!cacheDir) return {}
  return readJson(paths(cacheDir).tvManifestFile)
}

// Local poster/photo file path for a cached entry, or null if not cached (or not
// found on TMDB). Callers fall back to a remote TMDB URL when this is null and
// they still have internet.
function localPosterPath(cacheDir, movieId) {
  if (!cacheDir || !movieId) return null
  const file = path.join(paths(cacheDir).postersDir, `${movieId}.jpg`)
  return fs.existsSync(file) ? file : null
}

function localActorPhotoPath(cacheDir, personId) {
  if (!cacheDir || !personId) return null
  const file = path.join(paths(cacheDir).actorsDir, `${personId}.jpg`)
  return fs.existsSync(file) ? file : null
}

function localTvPosterPath(cacheDir, showId) {
  if (!cacheDir || !showId) return null
  const file = path.join(paths(cacheDir).tvPostersDir, `${showId}.jpg`)
  return fs.existsSync(file) ? file : null
}

async function downloadImage(url, destPath) {
  if (fs.existsSync(destPath)) return true
  try {
    const res = await fetch(url)
    if (!res.ok) return false
    const buf = Buffer.from(await res.arrayBuffer())
    fs.writeFileSync(destPath, buf)
    return true
  } catch {
    return false
  }
}

module.exports = {
  paths,
  ensureDirs,
  readJson,
  writeJson,
  getManifest,
  getCreditsMap,
  getTvManifest,
  localPosterPath,
  localActorPhotoPath,
  localTvPosterPath,
  downloadImage
}
