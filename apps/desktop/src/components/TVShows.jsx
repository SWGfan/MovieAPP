import React, { useEffect, useState } from 'react'

// Builds a search URL for a missing episode/show on whichever site is
// currently selected (in Settings or the top search bar — they're the same
// value) — opened in the default browser, not an in-app window, so they can
// quickly look up something they don't have yet. Handles saved custom sites
// (engine === "custom:<id>", looked up from customSites) and the live,
// not-yet-saved "adhoc" custom site typed into the top search bar.
function missingSearchUrl(engine, title, extra, customSites, adhocUrl) {
  const q = extra ? `${title} ${extra}` : title
  if (engine === 'adhoc') {
    if (adhocUrl && adhocUrl.includes('{query}')) return adhocUrl.replace('{query}', encodeURIComponent(q))
    return null
  }
  if (typeof engine === 'string' && engine.startsWith('custom:')) {
    const id = engine.slice('custom:'.length)
    const site = (customSites || []).find((s) => s.id === id)
    if (site?.urlTemplate) return site.urlTemplate.replace('{query}', encodeURIComponent(q))
  }
  switch (engine) {
    case 'tmdb':
      return `https://www.themoviedb.org/search?query=${encodeURIComponent(q)}`
    case 'google':
      return `https://www.google.com/search?q=${encodeURIComponent(q)}`
    case 'bing':
      return `https://www.bing.com/search?q=${encodeURIComponent(q)}`
    case 'duckduckgo':
      return `https://duckduckgo.com/?q=${encodeURIComponent(q)}`
    case 'imdb':
    default:
      return `https://www.imdb.com/find/?q=${encodeURIComponent(q)}&s=tt`
  }
}

const SEARCH_ENGINE_LABELS = { imdb: 'IMDb', tmdb: 'TMDB', google: 'Google', bing: 'Bing', duckduckgo: 'DuckDuckGo' }

// Resolves a display label for the engine badge — built-ins come from the map
// above, saved custom sites come from the customSites list, and the live
// not-yet-saved site just reads as "Custom".
function engineLabel(engine, customSites) {
  if (engine === 'adhoc') return 'Custom'
  if (typeof engine === 'string' && engine.startsWith('custom:')) {
    const id = engine.slice('custom:'.length)
    return (customSites || []).find((s) => s.id === id)?.name || 'Custom'
  }
  return SEARCH_ENGINE_LABELS[engine] || 'IMDb'
}

// Parses show/season/episode out of a filename. Handles the common naming
// styles (S01E01, 1x01, "Season 1 Episode 1"), strips scene-release numeric ID
// prefixes ("4574334-stranger-things-2016...") and quality tags (1080p, etc),
// and falls back to treating the whole cleaned filename as its own single-item
// "show" when nothing matches.
function cleanText(raw) {
  return raw.replace(/[._-]/g, ' ').replace(/\s+/g, ' ').trim()
}

function stripLeadingId(raw) {
  return raw.replace(/^\d{4,}[\s._-]+/, '')
}

// Pulls a trailing (19xx/20xx) year token off a raw (pre-cleanText) name, e.g.
// "stranger-things-2016" -> { rest: "stranger-things", year: "2016" }.
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

// Files that live in a Show/Season/episode.ext folder structure get grouped by
// their top-level folder name (far more reliable than parsing every messy
// filename) — season/episode numbers still come from the filename itself.
// Flat files sitting directly in the TV Shows root fall back to filename
// parsing entirely.
function groupKeyAndName(relPath, fileName) {
  const parts = relPath.split(/[\\/]/).filter(Boolean)
  if (parts.length > 1) {
    const folderName = parts[0]
    const { rest, year } = extractTrailingYear(stripLeadingId(folderName))
    return { show: cleanText(rest) || folderName.trim(), year, fromFolder: true }
  }
  const parsed = parseEpisode(fileName)
  return { show: parsed.show, year: parsed.year, fromFolder: false }
}

export default function TVShows() {
  const [files, setFiles] = useState([])
  const [enrichedShows, setEnrichedShows] = useState({})
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [selectedShow, setSelectedShow] = useState(null)
  const [showMissingEpisodes, setShowMissingEpisodes] = useState(false)
  const [seasonInfo, setSeasonInfo] = useState({}) // `${tvId}-${season}` -> episode list from TMDB
  const [seasonInfoLoading, setSeasonInfoLoading] = useState(false)
  const [showSeasons, setShowSeasons] = useState({}) // tvId -> full [{season_number, episode_count, name}] from TMDB
  const [collapsedSeasons, setCollapsedSeasons] = useState({}) // `${showKey}:${season}` -> true/false override
  // externalEngine drives BOTH the top search bar and every "Missing" row's
  // default badge — picking a site in one place changes it everywhere, so a
  // custom site you're actively searching also shows up on all the missing
  // episode rows across every show, not just the search bar.
  const [customSearchSites, setCustomSearchSites] = useState([])
  const [externalQuery, setExternalQuery] = useState('')
  const [externalEngine, setExternalEngine] = useState('imdb')
  const [adhocUrlTemplate, setAdhocUrlTemplate] = useState('')
  const [adhocSiteName, setAdhocSiteName] = useState('')
  const [adhocSaveSite, setAdhocSaveSite] = useState(true)
  const [adhocError, setAdhocError] = useState('')
  const [adhocSaved, setAdhocSaved] = useState(false)
  const [editingSiteId, setEditingSiteId] = useState(null) // set while editing an existing saved custom site
  const [needsSiteSetup, setNeedsSiteSetup] = useState(false) // true until this section has its own default site
  // "Which show did you mean?" picker — shown when automatic re-matching
  // can't confidently find artwork on its own, so a person can pick the
  // right show from real TMDB candidates (with posters) instead of the app
  // just giving up.
  const [pickerFor, setPickerFor] = useState(null) // the show entry ({key, name}), or null when closed
  const [pickerQuery, setPickerQuery] = useState('')
  const [pickerResults, setPickerResults] = useState([])
  const [pickerSearching, setPickerSearching] = useState(false)

  // Saves the typed custom site to the dropdown WITHOUT needing to run a
  // search first — previously saving only happened as a side effect of
  // clicking "Search" with a query typed in, so leaving the query box empty
  // silently did nothing and the site never got saved. When editingSiteId is
  // set (via the ✎ Edit button), this updates that site in place instead of
  // adding a new one.
  const saveAdhocSite = async () => {
    const url = adhocUrlTemplate.trim()
    if (!url) { setAdhocError('Enter the site’s search URL first.'); return }
    if (!url.includes('{query}')) { setAdhocError('The URL needs a {query} placeholder — e.g. https://example.com/search?q={query}'); return }
    if (!/^https:\/\//.test(url)) { setAdhocError('The URL must start with https://'); return }
    setAdhocError('')

    let name = adhocSiteName.trim()
    if (!name) {
      try { name = new URL(url).hostname.replace(/^www\./, '') } catch { name = 'Custom site' }
    }

    let updated
    let targetId
    if (editingSiteId) {
      targetId = editingSiteId
      updated = customSearchSites.map((s) => (s.id === editingSiteId ? { ...s, name, urlTemplate: url } : s))
    } else {
      const site = { id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name, urlTemplate: url }
      targetId = site.id
      updated = [...customSearchSites, site]
    }

    setCustomSearchSites(updated)
    await window.movieapp.setSettings({ customSearchSites: updated, tvShowsSearchEngine: `custom:${targetId}` })
    setExternalEngine(`custom:${targetId}`)
    setNeedsSiteSetup(false)
    setAdhocUrlTemplate('')
    setAdhocSiteName('')
    setEditingSiteId(null)
    setAdhocSaved(true)
    setTimeout(() => setAdhocSaved(false), 2000)
  }

  // Whatever site is picked in this section's dropdown becomes this section's
  // remembered default — so TV Shows keeps its own choice separate from
  // Movies, and it's there automatically next time you open this tab.
  const updateExternalEngine = (value) => {
    setExternalEngine(value)
    if (value !== 'adhoc') {
      setNeedsSiteSetup(false)
      window.movieapp.setSettings({ tvShowsSearchEngine: value })
    }
  }

  const startEditingSite = (site) => {
    setAdhocSiteName(site.name)
    setAdhocUrlTemplate(site.urlTemplate)
    setEditingSiteId(site.id)
    setAdhocError('')
    setExternalEngine('adhoc')
  }

  const deleteCustomSite = async (id) => {
    const updated = customSearchSites.filter((s) => s.id !== id)
    setCustomSearchSites(updated)
    const wasThisSectionsDefault = externalEngine === `custom:${id}`
    await window.movieapp.setSettings({
      customSearchSites: updated,
      ...(wasThisSectionsDefault ? { tvShowsSearchEngine: '' } : {})
    })
    if (wasThisSectionsDefault) {
      setExternalEngine('adhoc')
      setNeedsSiteSetup(true)
    }
    if (editingSiteId === id) {
      setEditingSiteId(null)
      setAdhocSiteName('')
      setAdhocUrlTemplate('')
    }
  }

  // TV Shows remembers its own default site, separate from Movies. First time
  // this section has never had one picked, drop straight into "Custom site…"
  // mode and prompt for one instead of silently defaulting to IMDb.
  useEffect(() => {
    window.movieapp.getSettings().then((s) => {
      if (s?.customSearchSites) setCustomSearchSites(s.customSearchSites)
      if (s?.tvShowsSearchEngine) {
        setExternalEngine(s.tvShowsSearchEngine)
      } else {
        setExternalEngine('adhoc')
        setNeedsSiteSetup(true)
      }
    })
  }, [])

  // Runs a one-off external search (IMDb/TMDB/Google/etc, or any saved custom
  // site) for whatever's typed in the top search bar — not tied to a specific
  // missing episode, so it works no matter which show or tab you're on.
  // "Custom site…" lets you type any site's search URL right here without
  // visiting Settings first; when "Save this site" is checked it's persisted
  // the same way the Settings page saves one, so it shows up in every
  // dropdown afterward.
  const runExternalSearch = async () => {
    const q = externalQuery.trim()
    if (!q) return

    if (externalEngine === 'adhoc') {
      const url = adhocUrlTemplate.trim()
      if (!url) { setAdhocError('Enter the site’s search URL first.'); return }
      if (!url.includes('{query}')) { setAdhocError('The URL needs a {query} placeholder — e.g. https://example.com/search?q={query}'); return }
      if (!/^https:\/\//.test(url)) { setAdhocError('The URL must start with https://'); return }
      setAdhocError('')

      window.movieapp.openExternal(url.replace('{query}', encodeURIComponent(q)))

      if (adhocSaveSite) {
        let name = adhocSiteName.trim()
        if (!name) {
          try { name = new URL(url).hostname.replace(/^www\./, '') } catch { name = 'Custom site' }
        }
        const site = { id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name, urlTemplate: url }
        const updated = [...customSearchSites, site]
        setCustomSearchSites(updated)
        await window.movieapp.setSettings({ customSearchSites: updated, tvShowsSearchEngine: `custom:${site.id}` })
        setExternalEngine(`custom:${site.id}`)
        setNeedsSiteSetup(false)
        setAdhocUrlTemplate('')
        setAdhocSiteName('')
      }
      return
    }

    window.movieapp.openExternal(missingSearchUrl(externalEngine, q, null, customSearchSites))
  }

  // force=true (used by the "Rescan" button) re-verifies every show's TMDB
  // match from scratch instead of trusting whatever's already cached/enriched
  // — so a manual Rescan is also the one-click fix for a wrong/missing show
  // poster, not just for picking up newly-added episodes.
  const scan = async (force) => {
    setLoading(true)
    const found = await window.movieapp.scanTvShows()
    setFiles(found)
    setLoading(false)

    const shows = new Map()
    found.forEach((f) => {
      const { show, year, fromFolder } = groupKeyAndName(f.relPath || f.fileName, f.fileName)
      const key = show.toLowerCase()
      if (!shows.has(key)) {
        // Folder names don't always match the real show title (typos, "About
        // To" vs "Going To", etc). When the show came from a folder, also work
        // out what the filename itself implies the title is — scene-release
        // filenames are usually closer to the actual title — and pass it along
        // as a fallback query to try if the folder name comes up empty.
        let altName = null
        if (fromFolder) {
          const parsed = parseEpisode(f.fileName)
          if (parsed.show && parsed.show.toLowerCase() !== key) altName = parsed.show
        }
        shows.set(key, { name: show, year, altName })
      }
    })

    for (const [key, { name, year, altName }] of shows) {
      if (!force && enrichedShows[key]) continue
      const res = await window.movieapp.tmdbSearchTv(name, key, year, altName, force)
      if (res?.result !== undefined) {
        setEnrichedShows((prev) => ({ ...prev, [key]: res.result }))
      }
      if (res?.error === 'no_api_key') break
    }
  }

  // The 🔄 button always opens the picker now, instead of silently applying
  // whatever the automatic search finds — pressing refresh means "let me see
  // the options," not "trust the algorithm again." Still works out the
  // filename-derived alt name first (folder names aren't always the real
  // title), so the picker's search box starts from the best guess.
  const retryArtwork = (s) => {
    let altName = null
    const first = files.find((f) => {
      const { show } = groupKeyAndName(f.relPath || f.fileName, f.fileName)
      return show.toLowerCase() === s.key
    })
    if (first) {
      const { fromFolder } = groupKeyAndName(first.relPath || first.fileName, first.fileName)
      if (fromFolder) {
        const parsed = parseEpisode(first.fileName)
        if (parsed.show && parsed.show.toLowerCase() !== s.key) altName = parsed.show
      }
    }
    openPicker(s, altName || s.name)
  }

  // Opens the poster picker for a show the app couldn't confidently match on
  // its own, and immediately searches with the best guess so there's usually
  // already something to choose from.
  const openPicker = (s, startQuery) => {
    setPickerFor(s)
    setPickerQuery(startQuery || s.name)
    setPickerResults([])
    runPickerSearch(startQuery || s.name)
  }

  const runPickerSearch = async (queryOverride) => {
    const q = (queryOverride ?? pickerQuery).trim()
    if (!q) return
    setPickerSearching(true)
    const res = await window.movieapp.tmdbSearchTvMulti(q)
    setPickerResults(res?.results || [])
    setPickerSearching(false)
  }

  // Commits whichever candidate the person clicked as the confirmed match for
  // this show.
  const choosePickerResult = async (choice) => {
    const target = pickerFor
    if (!target) return
    const res = await window.movieapp.tmdbConfirmMatchTv(target.key, choice)
    if (res?.result) {
      setEnrichedShows((prev) => ({ ...prev, [target.key]: res.result }))
    }
    setPickerFor(null)
  }

  useEffect(() => {
    scan()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // group episodes by show
  const showMap = new Map()
  files.forEach((f) => {
    const relPath = f.relPath || f.fileName
    const { show } = groupKeyAndName(relPath, f.fileName)
    const parsedEpisode = parseEpisode(f.fileName)
    const key = show.toLowerCase()
    if (!showMap.has(key)) showMap.set(key, { key, name: show, episodes: [] })
    showMap.get(key).episodes.push({
      season: parsedEpisode.season,
      episode: parsedEpisode.episode,
      episodeTitle: parsedEpisode.episodeTitle,
      path: f.path,
      fileName: f.fileName
    })
  })

  const allShows = Array.from(showMap.values()).sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  )
  const filteredShows = allShows.filter((s) => s.name.toLowerCase().includes(query.toLowerCase()))

  const ALPHABET = ['#', ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split('')]
  const letterOf = (s) => {
    const ch = s.name.charAt(0).toUpperCase()
    return /[A-Z]/.test(ch) ? ch : '#'
  }
  // Scrolls an element into view accounting for the sticky search/tabs bar
  // pinned at the top of the page — plain scrollIntoView({block:'start'})
  // lands the target right at the container's top edge, but the sticky bar
  // stays pinned over that same spot and ends up covering part of it.
  const scrollToId = (id) => {
    const el = document.getElementById(id)
    const container = el?.closest('.main')
    if (!el || !container) return
    const stickyHeight = container.querySelector('.sticky-bar')?.offsetHeight || 0
    const targetTop = el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop
    container.scrollTo({ top: targetTop - stickyHeight - 12, behavior: 'smooth' })
  }

  const jumpToLetter = (letter) => scrollToId(`tvletter-${letter}`)

  useEffect(() => {
    if (selectedShow) return
    const onKeyDown = (e) => {
      const tag = e.target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key.length !== 1 || !/[a-zA-Z]/.test(e.key)) return
      jumpToLetter(e.key.toUpperCase())
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedShow])

  // Fetch TMDB's real per-season episode list for every season the selected show
  // has on disk — this gives us proper episode names (instead of raw filenames)
  // for display at all times. When the "missing episodes" checkbox is on, we
  // additionally fetch the show's FULL season list from TMDB so we can also
  // surface seasons the user owns zero episodes of (e.g. Season 4 when only
  // 3 and 5 are on disk) rather than just gaps within owned seasons.
  useEffect(() => {
    const show = showMap.get(selectedShow)
    const meta = enrichedShows[selectedShow]
    if (!show || !meta?.id) return

    let cancelled = false
    ;(async () => {
      let fullSeasonNums = []
      if (showMissingEpisodes) {
        if (meta.id in showSeasons) {
          fullSeasonNums = showSeasons[meta.id].map((s) => s.season_number)
        } else {
          const res = await window.movieapp.tmdbTvShowSeasons(meta.id)
          if (cancelled) return
          const list = (res?.seasons || []).filter((s) => s.season_number > 0)
          setShowSeasons((prev) => ({ ...prev, [meta.id]: list }))
          fullSeasonNums = list.map((s) => s.season_number)
        }
      }

      const ownedSeasonNums = Array.from(new Set(show.episodes.map((ep) => ep.season).filter((s) => s !== null)))
      const seasonNumbers = Array.from(new Set([...ownedSeasonNums, ...fullSeasonNums]))
      const toFetch = seasonNumbers.filter((s) => !(`${meta.id}-${s}` in seasonInfo))
      if (toFetch.length === 0) return

      setSeasonInfoLoading(true)
      for (const s of toFetch) {
        if (cancelled) break
        const res = await window.movieapp.tmdbTvSeasonInfo(meta.id, s)
        if (cancelled) break
        setSeasonInfo((prev) => ({ ...prev, [`${meta.id}-${s}`]: res?.episodes || [] }))
      }
      if (!cancelled) setSeasonInfoLoading(false)
    })()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showMissingEpisodes, selectedShow, enrichedShows])

  const showCard = (s) => {
    const meta = enrichedShows[s.key]
    return (
      <div className="card" key={s.key} onClick={() => setSelectedShow(s.key)}>
        {meta?.localPosterPath || meta?.poster_path ? (
          <img
            src={meta.localPosterPath || `https://image.tmdb.org/t/p/w300${meta.poster_path}`}
            alt={s.name}
          />
        ) : (
          <div style={{ aspectRatio: '2/3', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, color: '#555' }}>
            No poster
            <button
              onClick={(e) => {
                e.stopPropagation()
                retryArtwork(s)
              }}
              style={{ fontSize: 12 }}
            >
              🔄 Retry
            </button>
          </div>
        )}
        <div className="meta">
          <div className="title">{meta?.name || s.name}</div>
          <div className="sub">
            {s.episodes.length} episode{s.episodes.length === 1 ? '' : 's'}
            {meta?.first_air_date ? ` · ${meta.first_air_date.slice(0, 4)}` : ''}
          </div>
        </div>
      </div>
    )
  }

  // Back button, title, overview, and the "show missing episodes" checkbox —
  // lives in the sticky bar so it stays pinned at the top while the season
  // list underneath scrolls.
  const renderShowDetailHeader = () => {
    const show = showMap.get(selectedShow)
    if (!show) return null
    const meta = enrichedShows[show.key]
    return (
      <>
        <button
          onClick={() => setSelectedShow(null)}
          style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 13, padding: 0, marginBottom: 10 }}
        >
          ← All shows
        </button>
        <h3 style={{ fontSize: 18, margin: '0 0 4px' }}>{meta?.name || show.name}</h3>
        {meta?.overview && (
          <p style={{ color: 'var(--muted)', fontSize: 13, maxWidth: 640, lineHeight: 1.5, margin: '0 0 12px' }}>{meta.overview}</p>
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--muted)', marginBottom: 0, cursor: 'pointer', width: 'fit-content' }}>
          <input type="checkbox" checked={showMissingEpisodes} onChange={(e) => setShowMissingEpisodes(e.target.checked)} />
          Show missing episodes
          {!meta?.id && showMissingEpisodes && ' (needs a TMDB match first)'}
          {seasonInfoLoading && ' — checking TMDB…'}
        </label>
      </>
    )
  }

  const renderShowDetail = () => {
    const show = showMap.get(selectedShow)
    if (!show) return null
    const meta = enrichedShows[show.key]

    const seasons = new Map() // season number (or 'Unsorted') -> episodes owned
    show.episodes.forEach((ep) => {
      const key = ep.season === null ? 'Unsorted' : ep.season
      if (!seasons.has(key)) seasons.set(key, [])
      seasons.get(key).push(ep)
    })

    // Surface seasons the user owns zero episodes of (e.g. Season 4 when only
    // 3 and 5 are on disk) so they don't silently vanish from the list.
    if (showMissingEpisodes && meta?.id && showSeasons[meta.id]) {
      showSeasons[meta.id].forEach((s) => {
        if (!seasons.has(s.season_number)) seasons.set(s.season_number, [])
      })
    }

    const sortedSeasonNums = Array.from(seasons.keys()).sort((a, b) => {
      if (a === 'Unsorted') return 1
      if (b === 'Unsorted') return -1
      return a - b
    })
    sortedSeasonNums.forEach((num) => {
      seasons.get(num).sort((a, b) => (a.episode ?? 999) - (b.episode ?? 999))
    })

    return (
      <>
        {sortedSeasonNums.map((num) => {
          const owned = seasons.get(num)
          const seasonLabel = num === 'Unsorted' ? 'Unsorted' : `Season ${String(num).padStart(2, '0')}`
          const info = num !== 'Unsorted' ? seasonInfo[`${meta?.id}-${num}`] : null
          const nameByEpisode = new Map((info || []).map((e) => [e.episode_number, e.name]))

          // Flag episode numbers with more than one file on disk (usually a
          // duplicate/re-download, e.g. Windows appending " (1)" to a repeat
          // download) — easy to miss otherwise since the list just quietly
          // shows the same episode number twice with no explanation.
          const episodeCounts = {}
          owned.forEach((ep) => {
            if (ep.episode !== null) episodeCounts[ep.episode] = (episodeCounts[ep.episode] || 0) + 1
          })

          let rows = owned.map((ep) => ({ kind: 'owned', ep }))
          if (showMissingEpisodes && meta?.id && num !== 'Unsorted' && info) {
            const ownedNums = new Set(owned.map((ep) => ep.episode))
            const missing = info
              .filter((e) => e.episode_number && !ownedNums.has(e.episode_number))
              .map((e) => ({ kind: 'missing', episode: e.episode_number, name: e.name }))
            rows = [...rows, ...missing].sort((a, b) => {
              const aNum = a.kind === 'owned' ? a.ep.episode ?? 999 : a.episode
              const bNum = b.kind === 'owned' ? b.ep.episode ?? 999 : b.episode
              return aNum - bNum
            })
          } else if (num !== 'Unsorted') {
            // Gaps *within* what you already own (e.g. you have 1-6 and 8, so 7
            // is obviously missing) don't need a TMDB lookup to spot — flag them
            // even with "Show missing episodes" off, so a hole like this isn't
            // silently invisible unless that's switched on. (Whether the season
            // has MORE episodes past what you own still needs TMDB, hence that
            // stays behind the checkbox above.)
            const ownedNums = new Set(owned.map((ep) => ep.episode).filter((n) => n !== null))
            if (ownedNums.size > 1) {
              const sorted = Array.from(ownedNums).sort((a, b) => a - b)
              const gaps = []
              for (let n = sorted[0]; n <= sorted[sorted.length - 1]; n++) {
                if (!ownedNums.has(n)) gaps.push({ kind: 'missing', episode: n, name: nameByEpisode.get(n) || null })
              }
              if (gaps.length) {
                rows = [...rows, ...gaps].sort((a, b) => {
                  const aNum = a.kind === 'owned' ? a.ep.episode ?? 999 : a.episode
                  const bNum = b.kind === 'owned' ? b.ep.episode ?? 999 : b.episode
                  return aNum - bNum
                })
              }
            }
          }

          const collapseKey = `${show.key}:${num}`
          // Default collapsed for seasons with nothing owned yet (keeps the list
          // from ballooning); any season can be toggled open/closed manually.
          const collapsed = collapseKey in collapsedSeasons ? collapsedSeasons[collapseKey] : owned.length === 0
          const toggleCollapsed = () =>
            setCollapsedSeasons((prev) => ({ ...prev, [collapseKey]: !collapsed }))
          const hasOwned = owned.length > 0

          return (
            <div key={num} style={{ marginBottom: 20 }}>
              <h4
                onClick={toggleCollapsed}
                style={{
                  fontSize: 14,
                  margin: '0 0 10px',
                  color: hasOwned ? '#4caf50' : 'var(--muted)',
                  fontWeight: hasOwned ? 700 : 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  userSelect: 'none'
                }}
              >
                <span style={{ display: 'inline-block', transition: 'transform 0.15s', transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}>▾</span>
                {seasonLabel}
                {showMissingEpisodes && meta?.id && info && (
                  <span style={{ fontWeight: 400, color: hasOwned ? '#4caf50' : 'var(--muted)' }}>
                    {' '}
                    — {owned.length} / {info.length} episodes
                  </span>
                )}
              </h4>
              {!collapsed && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {rows.map((row) =>
                    row.kind === 'missing' ? (
                      <div
                        key={`missing-${row.episode}`}
                        className="card"
                        onClick={() => {
                          // Search by show name only — episode titles/numbers make
                          // for noisier, less reliable results on most sites.
                          const url = missingSearchUrl(
                            externalEngine,
                            meta?.name || show.name,
                            null,
                            customSearchSites,
                            adhocUrlTemplate
                          )
                          if (url) window.movieapp.openExternal(url)
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '10px 14px',
                          border: '1px dashed #6b2b30',
                          background: 'transparent',
                          color: '#ff9d9d',
                          cursor: 'pointer'
                        }}
                        title={`Look this up on ${engineLabel(externalEngine, customSearchSites)}`}
                      >
                        <div style={{ display: 'flex', alignItems: 'center' }}>
                          <span style={{ fontSize: 12, minWidth: 60 }}>Ep {row.episode}</span>
                          <span style={{ fontSize: 13, fontWeight: 600 }}>Missing{row.name ? ` — ${row.name}` : ''}</span>
                        </div>
                        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                          <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                            🔍 {engineLabel(externalEngine, customSearchSites)}
                          </span>
                          {externalEngine !== 'google' && (
                            <span
                              onClick={(e) => {
                                e.stopPropagation()
                                window.movieapp.openExternal(missingSearchUrl('google', meta?.name || show.name, null))
                              }}
                              title="Search Google"
                              style={{ fontSize: 11, color: 'var(--muted)', cursor: 'pointer' }}
                            >
                              🔎 Google
                            </span>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div
                        key={row.ep.path}
                        className="card"
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '10px 14px',
                          cursor: 'pointer',
                          border: row.ep.episode !== null && episodeCounts[row.ep.episode] > 1 ? '1px solid #6b5b2b' : undefined
                        }}
                        onClick={() => window.movieapp.playMovie(row.ep.path)}
                      >
                        <div style={{ display: 'flex', alignItems: 'center' }}>
                          <span style={{ color: 'var(--muted)', fontSize: 12, minWidth: 60 }}>
                            {row.ep.episode !== null ? `Ep ${row.ep.episode}` : '—'}
                          </span>
                          <span style={{ fontSize: 13, fontWeight: 600 }}>
                            {(row.ep.episode !== null && nameByEpisode.get(row.ep.episode)) || row.ep.episodeTitle || row.ep.fileName}
                          </span>
                        </div>
                        {row.ep.episode !== null && episodeCounts[row.ep.episode] > 1 && (
                          <div
                            style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                            title={`${episodeCounts[row.ep.episode]} files found for Episode ${row.ep.episode} — likely a duplicate download. This file: ${row.ep.fileName}`}
                          >
                            <span style={{ fontSize: 11, color: '#e0b34d' }}>⚠️ Duplicate Ep {row.ep.episode}</span>
                            <button
                              onClick={async (e) => {
                                e.stopPropagation()
                                if (!window.confirm(`Delete this copy?\n\n${row.ep.fileName}\n\nThe other file for Episode ${row.ep.episode} will be kept.`)) return
                                const res = await window.movieapp.deleteFile(row.ep.path)
                                if (res?.ok) scan()
                                else window.alert(`Couldn't delete file: ${res?.error || 'unknown error'}`)
                              }}
                              style={{ fontSize: 11, padding: '2px 6px' }}
                            >
                              🗑 Delete this copy
                            </button>
                          </div>
                        )}
                      </div>
                    )
                  )}
                </div>
              )}
            </div>
          )
        })}
      </>
    )
  }

  const renderAllShows = () => {
    if (!loading && filteredShows.length === 0) {
      return (
        <div className="empty-state">
          <p>No TV shows found yet.</p>
          <p>Drop video files into your TV Shows folder (set in Settings) and hit Rescan.</p>
        </div>
      )
    }

    const groups = new Map()
    filteredShows.forEach((s) => {
      const letter = letterOf(s)
      if (!groups.has(letter)) groups.set(letter, [])
      groups.get(letter).push(s)
    })
    const availableLetters = new Set(groups.keys())

    return (
      <div>
        {Array.from(groups.entries()).map(([letter, list]) => (
          <div key={letter} id={`tvletter-${letter}`}>
            <h3 style={{ fontSize: 15, margin: '20px 0 10px' }}>{letter}</h3>
            <div className="grid">{list.map(showCard)}</div>
          </div>
        ))}
      </div>
    )
  }

  const groupsForAlphabet = new Map()
  filteredShows.forEach((s) => {
    const letter = letterOf(s)
    if (!groupsForAlphabet.has(letter)) groupsForAlphabet.set(letter, [])
    groupsForAlphabet.get(letter).push(s)
  })
  const availableAlphabetLetters = new Set(groupsForAlphabet.keys())

  return (
    <div>
      <div className="sticky-bar">
        {selectedShow ? (
          renderShowDetailHeader()
        ) : (
          <div className="row" style={{ marginBottom: 0 }}>
            <input
              placeholder="Search your TV shows…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ flex: 1 }}
            />
            <button className="primary" onClick={() => scan(true)}>Rescan</button>
          </div>
        )}
        {needsSiteSetup && externalEngine === 'adhoc' && (
          <p style={{ color: 'var(--accent)', fontSize: 12, margin: '12px 0 0' }}>
            👋 Set up your default search site for TV Shows — enter a title and search URL below, then hit Save.
          </p>
        )}
        <div className="row" style={{ marginBottom: 0, marginTop: 12, gap: 6 }}>
          <select
            value={externalEngine}
            onChange={(e) => updateExternalEngine(e.target.value)}
            style={{ padding: '8px 10px', borderRadius: 6, background: '#1a1d24', color: '#eee', border: '1px solid #2a2f3a' }}
          >
            <option value="imdb">IMDb</option>
            <option value="tmdb">TMDB</option>
            <option value="google">Google</option>
            <option value="bing">Bing</option>
            <option value="duckduckgo">DuckDuckGo</option>
            {customSearchSites.map((site) => (
              <option key={site.id} value={`custom:${site.id}`}>{site.name}</option>
            ))}
            <option value="adhoc">🌐 Custom site…</option>
          </select>
          {externalEngine.startsWith('custom:') && (
            <>
              <button
                onClick={() => {
                  const site = customSearchSites.find((s) => `custom:${s.id}` === externalEngine)
                  if (site) startEditingSite(site)
                }}
                title="Edit this site"
                style={{ background: '#2a2f3a', color: '#eee', border: 'none', padding: '8px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}
              >
                ✎ Edit
              </button>
              <button
                onClick={() => deleteCustomSite(externalEngine.slice('custom:'.length))}
                title="Delete this site"
                style={{ background: '#2a2f3a', color: '#ff9d9d', border: 'none', padding: '8px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}
              >
                🗑 Delete
              </button>
            </>
          )}
          {externalEngine === 'adhoc' && (
            <>
              <input
                placeholder="Title (e.g. Letterboxd)"
                value={adhocSiteName}
                onChange={(e) => setAdhocSiteName(e.target.value)}
                style={{ width: 160 }}
              />
              <input
                placeholder="https://example.com/search?q={query}"
                value={adhocUrlTemplate}
                onChange={(e) => setAdhocUrlTemplate(e.target.value)}
                style={{ flex: 1 }}
              />
            </>
          )}
          <input
            placeholder="Search any title on the site above…"
            value={externalQuery}
            onChange={(e) => setExternalQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && runExternalSearch()}
            style={{ flex: 1 }}
          />
          <button className="primary" onClick={runExternalSearch}>🔍 Search</button>
        </div>
        {externalEngine === 'adhoc' && (
          <div className="row" style={{ marginBottom: 0, marginTop: 6, alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--muted)', cursor: 'pointer' }}>
              <input type="checkbox" checked={adhocSaveSite} onChange={(e) => setAdhocSaveSite(e.target.checked)} />
              Also save when I hit Search{adhocSaveSite && !adhocSiteName.trim() ? " (uses the site's domain as the title if left blank)" : ''}
            </label>
            <button
              onClick={saveAdhocSite}
              style={{ background: '#2a2f3a', color: '#eee', border: 'none', padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 12, marginLeft: 12 }}
            >
              {adhocSaved ? 'Saved ✓' : editingSiteId ? '💾 Update site' : '💾 Save site (no search needed)'}
            </button>
            {editingSiteId && (
              <button
                onClick={() => {
                  setEditingSiteId(null)
                  setAdhocSiteName('')
                  setAdhocUrlTemplate('')
                  updateExternalEngine('imdb')
                }}
                style={{ background: 'none', color: 'var(--muted)', border: 'none', cursor: 'pointer', fontSize: 12, marginLeft: 8 }}
              >
                Cancel
              </button>
            )}
            {adhocError && <span style={{ color: '#ff9d9d', fontSize: 12, marginLeft: 12 }}>{adhocError}</span>}
          </div>
        )}
        {!loading && !selectedShow && filteredShows.length > 0 && (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 4,
              padding: '8px 10px',
              background: 'var(--panel)',
              borderRadius: 8,
              marginTop: 12
            }}
          >
            {ALPHABET.map((letter) => {
              const active = availableAlphabetLetters.has(letter)
              return (
                <button
                  key={letter}
                  onClick={() => active && jumpToLetter(letter)}
                  disabled={!active}
                  title={active ? `Jump to ${letter}` : undefined}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: active ? 'var(--text)' : 'var(--muted)',
                    opacity: active ? 1 : 0.35,
                    cursor: active ? 'pointer' : 'default',
                    fontSize: 12,
                    fontWeight: 600,
                    padding: '3px 6px',
                    borderRadius: 4,
                    minWidth: 20
                  }}
                >
                  {letter}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {loading && <p className="empty-state">Scanning your TV Shows folder…</p>}
      {!loading && (selectedShow ? renderShowDetail() : renderAllShows())}

      {pickerFor && (
        <div
          onClick={() => setPickerFor(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.75)',
            zIndex: 50,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#181b22',
              border: '1px solid #2a2f3a',
              borderRadius: 8,
              padding: 20,
              width: 680,
              maxWidth: '100%',
              maxHeight: '82vh',
              overflowY: 'auto'
            }}
          >
            <h3 style={{ marginTop: 0 }}>Which show is "{pickerFor.name}"?</h3>
            <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: -8 }}>
              We couldn't confidently match this one automatically. Search and pick the right one below.
            </p>
            <div className="row">
              <input
                value={pickerQuery}
                onChange={(e) => setPickerQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && runPickerSearch()}
                style={{ flex: 1 }}
                autoFocus
              />
              <button className="primary" onClick={() => runPickerSearch()} disabled={pickerSearching}>
                {pickerSearching ? 'Searching…' : 'Search'}
              </button>
            </div>
            {!pickerSearching && pickerResults.length === 0 && (
              <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 14 }}>
                No results — try a different spelling or drop the year.
              </p>
            )}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))',
                gap: 12,
                marginTop: 16
              }}
            >
              {pickerResults.map((r) => (
                <div
                  key={r.id}
                  onClick={() => choosePickerResult(r)}
                  style={{ cursor: 'pointer' }}
                  title={r.overview || ''}
                >
                  {r.poster_path ? (
                    <img
                      src={`https://image.tmdb.org/t/p/w185${r.poster_path}`}
                      alt={r.name}
                      style={{ width: '100%', borderRadius: 4, display: 'block' }}
                    />
                  ) : (
                    <div
                      style={{
                        aspectRatio: '2/3',
                        background: '#222',
                        borderRadius: 4,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 11,
                        color: '#666',
                        textAlign: 'center',
                        padding: 6
                      }}
                    >
                      No poster
                    </div>
                  )}
                  <div style={{ fontSize: 11, marginTop: 4, fontWeight: 600 }}>{r.name}</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)' }}>
                    {r.first_air_date ? r.first_air_date.slice(0, 4) : ''}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 16, textAlign: 'right' }}>
              <button onClick={() => setPickerFor(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
