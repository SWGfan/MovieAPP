import React, { useEffect, useState, useRef } from 'react'

// Builds a search URL for a missing title on whichever site is currently
// selected (in Settings or the top search bar — they're the same value) —
// opened in the default browser, not an in-app window, so they can quickly
// look up something they don't have yet. Handles saved custom sites
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

// Movie-name cleanup — mirrors parseMovieName in main.js (duplicated the same
// way the TV grouping helpers are, rather than shared). A plain "strip dots,
// cut at the year" pass misses a lot of real scene-release filenames: a
// leading numeric ID ("0120611-blade-1998" — an IMDb id with "tt" cut off),
// hyphen-separated slugs ("blade-ii-2002"), and quality tags stuck right
// after the year ("blade-1998[1080p]") that leak into the search query and
// either return no match or the wrong one.
function cleanText(raw) {
  return raw.replace(/[._-]/g, ' ').replace(/\s+/g, ' ').trim()
}

function stripLeadingId(raw) {
  return raw.replace(/^\d{4,}[\s._-]+/, '')
}

function extractTrailingYear(raw) {
  const m = raw.match(/^(.*?)[\s._-]*[([]?((?:19|20)\d{2})[)\]]?[\s._-]*$/)
  if (!m) return { rest: raw, year: null }
  return { rest: m[1], year: m[2] }
}

function stripQualityTags(raw) {
  return raw.replace(/[([][^)\]]*[)\]]/g, (m) => (/^[([](?:19|20)\d{2}[)\]]$/.test(m) ? m : ' '))
}

// Edition/cut labels ("Director's Cut", "Extended Edition", "Regular Cut",
// etc) aren't part of the actual title — TMDB has one entry for the movie
// regardless of which cut a file is, so these need stripping before search or
// the leftover words either return zero results or throw off the match.
const EDITION_TAGS = /\b((director'?s?|extended|theatrical|unrated|special|ultimate|final|regular|uncut)\s*(cut|edition|version)|redux)\b/gi

function stripEditionTags(raw) {
  return raw.replace(EDITION_TAGS, ' ')
}

function parseMovieName(fileNameNoExt) {
  const noTags = stripEditionTags(stripQualityTags(fileNameNoExt)).trim()
  const noId = stripLeadingId(noTags)
  const { rest, year } = extractTrailingYear(noId)
  const title = cleanText(rest) || cleanText(noId) || fileNameNoExt
  return { title, year }
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

export default function Movies() {
  const [movies, setMovies] = useState([])
  const [enriched, setEnriched] = useState({})
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [view, setView] = useState('all') // 'all' | 'actor' | 'year'

  const [castByPath, setCastByPath] = useState({})
  const [castLoading, setCastLoading] = useState(false)
  const [actorQuery, setActorQuery] = useState('')
  const [selectedActor, setSelectedActor] = useState(null)
  const [showActorPhotos, setShowActorPhotos] = useState(true)

  const [collectionByMovieId, setCollectionByMovieId] = useState({})
  const [sequelsProgress, setSequelsProgress] = useState(null) // { done, total }
  const [collapsedFranchises, setCollapsedFranchises] = useState({})
  // Manual per-file title corrections, for the rare file whose name is too far
  // off from TMDB's actual title for search to find on its own.
  const [titleOverrides, setTitleOverrides] = useState({})
  // path -> true while its description popover is open (ℹ️ button)
  const [infoOpenFor, setInfoOpenFor] = useState({})
  // "Which movie did you mean?" picker — shown when automatic re-matching
  // can't confidently find a poster on its own, so a person can pick the
  // right one from real TMDB candidates (with posters) instead of the app
  // just giving up.
  const [pickerFor, setPickerFor] = useState(null) // the movie object, or null when closed
  const [pickerQuery, setPickerQuery] = useState('')
  const [pickerResults, setPickerResults] = useState([])
  const [pickerSearching, setPickerSearching] = useState(false)
  // externalEngine drives BOTH the top search bar and every "Missing" row's
  // default badge — picking a site in one place changes it everywhere, so a
  // custom site you're actively searching also shows up on all the missing
  // episode/movie rows across the app, not just the search bar.
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

  // Movies remembers its own default site, separate from TV Shows. First time
  // this section has never had one picked, drop straight into "Custom site…"
  // mode and prompt for one instead of silently defaulting to IMDb.
  useEffect(() => {
    window.movieapp.getSettings().then((s) => {
      if (s?.customSearchSites) setCustomSearchSites(s.customSearchSites)
      if (s?.moviesSearchEngine) {
        setExternalEngine(s.moviesSearchEngine)
      } else {
        setExternalEngine('adhoc')
        setNeedsSiteSetup(true)
      }
    })
  }, [])

  // Whatever site is picked in this section's dropdown becomes this section's
  // remembered default — so Movies keeps its own choice separate from TV
  // Shows, and it's there automatically next time you open this tab.
  const updateExternalEngine = (value) => {
    setExternalEngine(value)
    if (value !== 'adhoc') {
      setNeedsSiteSetup(false)
      window.movieapp.setSettings({ moviesSearchEngine: value })
    }
  }

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
    await window.movieapp.setSettings({ customSearchSites: updated, moviesSearchEngine: `custom:${targetId}` })
    setExternalEngine(`custom:${targetId}`)
    setNeedsSiteSetup(false)
    setAdhocUrlTemplate('')
    setAdhocSiteName('')
    setEditingSiteId(null)
    setAdhocSaved(true)
    setTimeout(() => setAdhocSaved(false), 2000)
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
      ...(wasThisSectionsDefault ? { moviesSearchEngine: '' } : {})
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

  // Runs a one-off external search (IMDb/TMDB/Google/etc, or any saved custom
  // site) for whatever's typed in the top search bar — not tied to a specific
  // missing item, so it works no matter which tab you're on. "Custom site…"
  // lets you type any site's search URL right here without visiting Settings
  // first; when "Save this site" is checked it's persisted the same way the
  // Settings page saves one, so it shows up in every dropdown afterward.
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
        await window.movieapp.setSettings({ customSearchSites: updated, moviesSearchEngine: `custom:${site.id}` })
        setExternalEngine(`custom:${site.id}`)
        setNeedsSiteSetup(false)
        setAdhocUrlTemplate('')
        setAdhocSiteName('')
      }
      return
    }

    window.movieapp.openExternal(missingSearchUrl(externalEngine, q, null, customSearchSites))
  }

  // force=true (used by the "Rescan" button) re-verifies every movie's TMDB
  // match from scratch instead of trusting whatever's already cached — so a
  // manual Rescan is also the one-click fix for wrong/missing posters, not
  // just for picking up newly-added files. The initial load on app startup
  // still scans without force, so everyday launches stay fast and don't
  // re-hit TMDB for a library that hasn't changed.
  const scan = async (force) => {
    setLoading(true)
    const files = await window.movieapp.scanMovies()
    setMovies(files)
    setLoading(false)

    // best-effort TMDB enrichment, one at a time, ignore failures/no key
    for (const f of files) {
      const override = titleOverridesRef.current[f.fileName]
      const { title: cleanName, year } = override ? { title: override, year: null } : parseMovieName(f.name)
      const res = await window.movieapp.tmdbSearch(cleanName || f.name, f.fileName || f.name, year, force)
      if (res?.results) {
        setEnriched((prev) => ({ ...prev, [f.path]: res.results[0] || null }))
      }
      if (res?.error === 'no_api_key') break
    }
  }

  // The 🔄 button always opens the picker now, instead of silently applying
  // whatever the automatic search finds — useful both for "No poster"
  // (nothing matched) and for a poster that's just plain wrong (matched the
  // wrong movie), since that case has no visual cue to gate a button on the
  // way "No poster" does. Pressing refresh means "let me see the options,"
  // not "trust the algorithm again."
  const retryArtwork = (m) => {
    const override = titleOverridesRef.current[m.fileName]
    const { title: cleanName } = override ? { title: override } : parseMovieName(m.name)
    openPicker(m, cleanName || m.name)
  }

  // Opens the poster picker for a movie the app couldn't confidently match on
  // its own, and immediately searches with the best guess so there's usually
  // already something to choose from.
  const openPicker = (m, startQuery) => {
    const query = startQuery ?? (parseMovieName(m.name).title || m.name)
    setPickerFor(m)
    setPickerQuery(query)
    setPickerResults([])
    runPickerSearch(query)
  }

  const runPickerSearch = async (queryOverride) => {
    const q = (queryOverride ?? pickerQuery).trim()
    if (!q) return
    setPickerSearching(true)
    const res = await window.movieapp.tmdbSearch(q, null, null, true)
    setPickerResults(res?.results || [])
    setPickerSearching(false)
  }

  // Commits whichever candidate the person clicked as the confirmed match for
  // this file, and remembers the query that found it so future scans (and
  // "Re-check all") land on it automatically without reopening the picker.
  const choosePickerResult = async (choice) => {
    const target = pickerFor
    if (!target) return
    const res = await window.movieapp.tmdbConfirmMatch(target.fileName || target.name, choice)
    if (res?.result) {
      setEnriched((prev) => ({ ...prev, [target.path]: res.result }))
    }
    if (pickerQuery && pickerQuery !== target.name) {
      const updated = { ...titleOverridesRef.current, [target.fileName]: pickerQuery }
      titleOverridesRef.current = updated
      setTitleOverrides(updated)
      await window.movieapp.setSettings({ movieTitleOverrides: updated })
    }
    setPickerFor(null)
  }

  const titleOverridesRef = useRef({})

  useEffect(() => {
    window.movieapp.getSettings().then((s) => {
      titleOverridesRef.current = s?.movieTitleOverrides || {}
      setTitleOverrides(titleOverridesRef.current)
      scan()
    })
  }, [])

  // Only fetch cast info once the actor sub-tab is actually opened, and only for
  // movies we haven't already looked up — keeps this from hitting TMDB on every load.
  useEffect(() => {
    if (view !== 'actor') return
    const toFetch = movies.filter((m) => enriched[m.path]?.id && !castByPath[m.path])
    if (toFetch.length === 0) return

    let cancelled = false
    setCastLoading(true)
    ;(async () => {
      for (const m of toFetch) {
        if (cancelled) break
        const res = await window.movieapp.tmdbCredits(enriched[m.path].id)
        if (cancelled) break
        setCastByPath((prev) => ({ ...prev, [m.path]: res?.cast || [] }))
      }
      if (!cancelled) setCastLoading(false)
    })()

    return () => {
      cancelled = true
    }
  }, [view, movies, enriched, castByPath])

  // Sequels tab — walks every matched movie's TMDB collection (franchise) once
  // the tab is opened, so we can show what else exists in a series you own part
  // of. Sequential and cached in state so revisiting the tab doesn't re-fetch.
  useEffect(() => {
    // Runs in the background regardless of which tab is open (not just while
    // Sequels is active) — that's what lets a "has sequels" icon show up on
    // cards in the main library view before the user has ever opened Sequels.
    const matchedIds = Array.from(new Set(Object.values(enriched).map((m) => m?.id).filter(Boolean)))
    const toFetch = matchedIds.filter((id) => !(id in collectionByMovieId))
    if (toFetch.length === 0) return

    let cancelled = false
    setSequelsProgress({ done: 0, total: toFetch.length })
    ;(async () => {
      for (let i = 0; i < toFetch.length; i++) {
        if (cancelled) break
        const id = toFetch[i]
        const res = await window.movieapp.tmdbMovieCollection(id)
        if (cancelled) break
        setCollectionByMovieId((prev) => ({ ...prev, [id]: res?.collection || null }))
        setSequelsProgress({ done: i + 1, total: toFetch.length })
      }
      if (!cancelled) setSequelsProgress(null)
    })()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, enriched])

  // Jumping to a specific franchise from the "🔗 Sequels" card badge — switch
  // to the Sequels tab, force that franchise open (it may default-collapse),
  // and scroll to it once it's actually in the DOM.
  const [pendingScrollFranchiseId, setPendingScrollFranchiseId] = useState(null)

  const goToSequelsFor = (movieId) => {
    const collection = collectionByMovieId[movieId]
    if (!collection) return
    setCollapsedFranchises((prev) => ({ ...prev, [`franchise:${collection.id}`]: false }))
    setPendingScrollFranchiseId(collection.id)
    setView('sequels')
  }

  useEffect(() => {
    if (view !== 'sequels' || !pendingScrollFranchiseId) return
    const el = document.getElementById(`franchise-${pendingScrollFranchiseId}`)
    const container = el?.closest('.main')
    if (el && container) {
      // Plain scrollIntoView({block:'start'}) lands the target right at the
      // container's top edge — but the search/tabs bar up there is
      // position:sticky and stays pinned over that same spot, so the target
      // ends up a bit hidden underneath it. Offset by the sticky bar's actual
      // height (plus a little breathing room) so it lands just below it.
      const stickyHeight = container.querySelector('.sticky-bar')?.offsetHeight || 0
      const targetTop = el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop
      container.scrollTo({ top: targetTop - stickyHeight - 12, behavior: 'smooth' })
      setPendingScrollFranchiseId(null)
    }
  }, [view, pendingScrollFranchiseId, collectionByMovieId, sequelsProgress])

  const titleOf = (m) => enriched[m.path]?.title || m.name

  const filtered = movies
    .filter((m) => m.name.toLowerCase().includes(query.toLowerCase()))
    .slice()
    .sort((a, b) => titleOf(a).localeCompare(titleOf(b), undefined, { sensitivity: 'base' }))

  const movieCard = (m, anchorId) => {
    const meta = enriched[m.path]
    const collection = meta?.id ? collectionByMovieId[meta.id] : null
    const hasSequels = collection && collection.parts?.length > 1
    const infoOpen = !!infoOpenFor[m.path]
    return (
      <div className="card" id={anchorId} key={m.path} style={{ position: 'relative' }} onClick={() => window.movieapp.playMovie(m.path)}>
        <button
          title={meta?.overview ? 'Show description' : 'No description available'}
          onClick={(e) => {
            e.stopPropagation()
            setInfoOpenFor((prev) => ({ ...prev, [m.path]: !prev[m.path] }))
          }}
          style={{ position: 'absolute', top: 4, left: 4, zIndex: 1, fontSize: 11, padding: '2px 5px', opacity: 0.85 }}
        >
          ℹ️
        </button>
        {hasSequels && (
          <button
            title={`Part of "${collection.name}" — view all ${collection.parts.length} movies`}
            onClick={(e) => {
              e.stopPropagation()
              goToSequelsFor(meta.id)
            }}
            style={{ position: 'absolute', top: 4, left: 26, zIndex: 1, fontSize: 11, padding: '2px 5px', opacity: 0.85 }}
          >
            🔗
          </button>
        )}
        <button
          title="Re-check TMDB artwork for this file"
          onClick={(e) => {
            e.stopPropagation()
            retryArtwork(m)
          }}
          style={{ position: 'absolute', top: 4, right: 4, zIndex: 1, fontSize: 11, padding: '2px 5px', opacity: 0.85 }}
        >
          🔄
        </button>
        {meta?.localPosterPath || meta?.poster_path ? (
          <img src={meta.localPosterPath || `https://image.tmdb.org/t/p/w300${meta.poster_path}`} alt={m.name} />
        ) : (
          <div style={{ aspectRatio: '2/3', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555' }}>
            No poster
          </div>
        )}
        {infoOpen && (
          <div
            onClick={(e) => {
              e.stopPropagation()
              setInfoOpenFor((prev) => ({ ...prev, [m.path]: false }))
            }}
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(0,0,0,0.88)',
              color: '#eee',
              fontSize: 12,
              lineHeight: 1.4,
              padding: 10,
              overflowY: 'auto',
              zIndex: 2,
              cursor: 'pointer'
            }}
          >
            <strong style={{ display: 'block', marginBottom: 6 }}>{meta?.title || m.name}</strong>
            {meta?.overview || 'No description available for this file yet.'}
          </div>
        )}
        <div className="meta">
          <div className="title">{meta?.title || m.name}</div>
          <div className="sub">{meta?.release_date?.slice(0, 4) || m.ext.toUpperCase().slice(1)}</div>
        </div>
      </div>
    )
  }

  const ALPHABET = ['#', ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split('')]

  const letterOf = (m) => {
    const ch = titleOf(m).charAt(0).toUpperCase()
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

  const jumpToLetter = (letter) => scrollToId(`letter-${letter}`)

  // Pressing a letter key while on the All or By Release Date tab jumps straight
  // to that section — ignored while typing in the search box or any other input.
  useEffect(() => {
    if (view !== 'all' && view !== 'year') return
    const onKeyDown = (e) => {
      const tag = e.target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key.length !== 1 || !/[a-zA-Z]/.test(e.key)) return
      jumpToLetter(e.key.toUpperCase())
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [view])

  const AlphabetRailSide = ({ availableLetters }) => (
    <div
      style={{
        position: 'sticky',
        top: 140,
        alignSelf: 'flex-start',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 1,
        padding: '6px 2px',
        background: 'var(--panel)',
        borderRadius: 8,
        flexShrink: 0
      }}
    >
      {ALPHABET.map((letter) => {
        const active = availableLetters.has(letter)
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
              fontSize: 11,
              fontWeight: 600,
              lineHeight: '14px',
              padding: '1px 4px',
              borderRadius: 4
            }}
          >
            {letter}
          </button>
        )
      })}
    </div>
  )

  const AlphabetBarTop = ({ availableLetters }) => (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 4,
        padding: '8px 10px',
        background: 'var(--panel)',
        borderRadius: 8,
        marginTop: 4
      }}
    >
      {ALPHABET.map((letter) => {
        const active = availableLetters.has(letter)
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
  )

  const renderAll = () => {
    if (!loading && filtered.length === 0) {
      return (
        <div className="empty-state">
          <p>No movies found yet.</p>
          <p>Drop video files into your Movies folder (set in Settings) and hit Rescan.</p>
        </div>
      )
    }

    const groups = new Map()
    filtered.forEach((m) => {
      const letter = letterOf(m)
      if (!groups.has(letter)) groups.set(letter, [])
      groups.get(letter).push(m)
    })
    return (
      <div>
        {Array.from(groups.entries()).map(([letter, list]) => (
          <div key={letter} id={`letter-${letter}`}>
            <h3 style={{ fontSize: 15, margin: '20px 0 10px' }}>{letter}</h3>
            <div className="grid">{list.map(movieCard)}</div>
          </div>
        ))}
      </div>
    )
  }

  // Letters available on the All tab's current (filtered) list — used by the
  // alphabet bar that lives in the sticky header so it scrolls with the tabs.
  const allAvailableLetters = new Set(filtered.map(letterOf))

  const renderByYear = () => {
    if (filtered.length === 0) return <p className="empty-state">No movies found.</p>

    const sorted = filtered.slice().sort((a, b) => {
      const yearDiff = (enriched[b.path]?.release_date || '').localeCompare(enriched[a.path]?.release_date || '')
      return yearDiff !== 0 ? yearDiff : titleOf(a).localeCompare(titleOf(b), undefined, { sensitivity: 'base' })
    })
    const groups = new Map()
    for (const m of sorted) {
      const year = enriched[m.path]?.release_date?.slice(0, 4) || 'Unknown year'
      if (!groups.has(year)) groups.set(year, [])
      groups.get(year).push(m)
    }

    // Tag the first movie for each letter (in on-page order, across all years) with
    // an anchor id so the side rail can jump straight to it even though this view
    // is grouped by year, not by letter.
    const seenLetters = new Set()
    const availableLetters = new Set(sorted.map(letterOf))

    return (
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {Array.from(groups.entries()).map(([year, list]) => (
            <div key={year}>
              <h3 style={{ fontSize: 15, margin: '20px 0 10px' }}>{year}</h3>
              <div className="grid">
                {list.map((m) => {
                  const letter = letterOf(m)
                  let anchorId
                  if (!seenLetters.has(letter)) {
                    seenLetters.add(letter)
                    anchorId = `letter-${letter}`
                  }
                  return movieCard(m, anchorId)
                })}
              </div>
            </div>
          ))}
        </div>
        <AlphabetRailSide availableLetters={availableLetters} />
      </div>
    )
  }

  const renderByActor = () => {
    if (selectedActor) {
      const inRole = movies
        .filter((m) => (castByPath[m.path] || []).some((c) => c.name === selectedActor))
        .slice()
        .sort((a, b) => titleOf(a).localeCompare(titleOf(b), undefined, { sensitivity: 'base' }))
      return (
        <>
          <button
            onClick={() => setSelectedActor(null)}
            style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 13, padding: 0, marginBottom: 10 }}
          >
            ← All actors
          </button>
          <h3 style={{ fontSize: 15, margin: '0 0 10px' }}>{selectedActor}</h3>
          <div className="grid">{inRole.map(movieCard)}</div>
        </>
      )
    }

    // name -> profilePath (first one seen wins; TMDB returns the same photo for a
    // given person across movies anyway)
    const actorMap = new Map()
    movies.forEach((m) =>
      (castByPath[m.path] || []).forEach((c) => {
        if (!actorMap.has(c.name)) actorMap.set(c.name, { profilePath: c.profilePath, localPhotoPath: c.localPhotoPath })
      })
    )
    const actors = Array.from(actorMap.entries())
      .filter(([name]) => name.toLowerCase().includes(actorQuery.toLowerCase()))
      .sort((a, b) => a[0].localeCompare(b[0]))

    return (
      <>
        <div className="row" style={{ marginBottom: 16 }}>
          <input
            placeholder="Search actors…"
            value={actorQuery}
            onChange={(e) => setActorQuery(e.target.value)}
            style={{ flex: 1, marginBottom: 0 }}
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap', cursor: 'pointer' }}>
            <input type="checkbox" checked={showActorPhotos} onChange={(e) => setShowActorPhotos(e.target.checked)} />
            Show photos
          </label>
        </div>
        {castLoading && actorMap.size === 0 && <p className="empty-state">Looking up cast info…</p>}
        {!castLoading && actorMap.size === 0 && (
          <p className="empty-state">No cast info found yet — make sure a TMDB key is set in Settings.</p>
        )}
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
          {actors.map(([name, photo]) => (
            <div
              key={name}
              className="card"
              style={{ padding: 16, textAlign: 'center', fontSize: 13, fontWeight: 600 }}
              onClick={() => setSelectedActor(name)}
            >
              {showActorPhotos && (
                photo.localPhotoPath || photo.profilePath ? (
                  <img
                    src={photo.localPhotoPath || `https://image.tmdb.org/t/p/w185${photo.profilePath}`}
                    alt={name}
                    style={{ width: 64, height: 64, borderRadius: '50%', objectFit: 'cover', margin: '0 auto 10px', display: 'block' }}
                  />
                ) : (
                  <div
                    style={{
                      width: 64,
                      height: 64,
                      borderRadius: '50%',
                      background: '#2a2f3a',
                      color: 'var(--muted)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      margin: '0 auto 10px',
                      fontSize: 20
                    }}
                  >
                    {name.charAt(0)}
                  </div>
                )
              )}
              {name}
            </div>
          ))}
        </div>
      </>
    )
  }

  // Franchises the user owns at least one movie from, each with owned + missing
  // parts listed together — mirrors the TV Shows "missing episodes" layout.
  const renderSequels = () => {
    const matchedEntries = Object.entries(enriched).filter(([, m]) => m?.id)
    const pathByMovieId = new Map(matchedEntries.map(([path, m]) => [m.id, path]))
    const ownedIds = new Set(pathByMovieId.keys())

    const franchises = []
    const seen = new Set()
    Object.values(collectionByMovieId).forEach((collection) => {
      if (!collection || seen.has(collection.id)) return
      seen.add(collection.id)
      const parts = collection.parts
        .slice()
        .sort((a, b) => (a.release_date || '9999').localeCompare(b.release_date || '9999'))
      const ownedCount = parts.filter((p) => ownedIds.has(p.id)).length
      if (ownedCount === 0) return // only show franchises you actually own part of
      franchises.push({ id: collection.id, name: collection.name, parts, ownedCount })
    })
    franchises.sort((a, b) => a.name.localeCompare(b.name))

    if (!sequelsProgress && franchises.length === 0) {
      return (
        <p className="empty-state">
          {Object.keys(collectionByMovieId).length === 0
            ? 'Checking your library for franchises…'
            : 'No franchises found — none of your matched movies belong to a TMDB collection.'}
        </p>
      )
    }

    return (
      <div>
        {sequelsProgress && (
          <p className="empty-state" style={{ marginTop: 0 }}>
            Checking TMDB for franchises… {sequelsProgress.done}/{sequelsProgress.total}
          </p>
        )}
        {franchises.map((f) => {
          const missingCount = f.parts.length - f.ownedCount
          const collapseKey = `franchise:${f.id}`
          // Default collapsed once a franchise is complete (nothing to act on);
          // any franchise can be toggled open/closed manually.
          const collapsed = collapseKey in collapsedFranchises ? collapsedFranchises[collapseKey] : missingCount === 0
          const toggleCollapsed = () => setCollapsedFranchises((prev) => ({ ...prev, [collapseKey]: !collapsed }))

          return (
            <div key={f.id} id={`franchise-${f.id}`} style={{ marginBottom: 20 }}>
              <h4
                onClick={toggleCollapsed}
                style={{
                  fontSize: 14,
                  margin: '0 0 10px',
                  color: '#4caf50',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  userSelect: 'none'
                }}
              >
                <span style={{ display: 'inline-block', transition: 'transform 0.15s', transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}>▾</span>
                {f.name}
                <span style={{ fontWeight: 400, color: 'var(--muted)' }}>
                  {' '}
                  — {f.ownedCount} / {f.parts.length} movies
                </span>
              </h4>
              {!collapsed && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {f.parts.map((p) => {
                    const path = pathByMovieId.get(p.id)
                    const year = p.release_date ? p.release_date.slice(0, 4) : ''
                    return path ? (
                      <div
                        key={p.id}
                        className="card"
                        style={{ display: 'flex', alignItems: 'center', padding: '10px 14px', cursor: 'pointer' }}
                        onClick={() => window.movieapp.playMovie(path)}
                      >
                        <span style={{ fontSize: 13, fontWeight: 600 }}>
                          {p.title}
                          {year ? ` (${year})` : ''}
                        </span>
                      </div>
                    ) : (
                      <div
                        key={p.id}
                        className="card"
                        onClick={() => {
                          // Custom sites search by title alone — most trackers/search
                          // pages don't handle a trailing year well, so leave it out
                          // there while still including it for IMDb/TMDB/etc.
                          const isCustom = externalEngine === 'adhoc' || externalEngine.startsWith('custom:')
                          const url = missingSearchUrl(externalEngine, p.title, isCustom ? null : year, customSearchSites, adhocUrlTemplate)
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
                        <span style={{ fontSize: 13, fontWeight: 600 }}>
                          Missing — {p.title}
                          {year ? ` (${year})` : ''}
                        </span>
                        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                          <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                            🔍 {engineLabel(externalEngine, customSearchSites)}
                          </span>
                          {externalEngine !== 'google' && (
                            <span
                              onClick={(e) => {
                                e.stopPropagation()
                                window.movieapp.openExternal(missingSearchUrl('google', p.title, year))
                              }}
                              title="Search Google"
                              style={{ fontSize: 11, color: 'var(--muted)', cursor: 'pointer' }}
                            >
                              🔎 Google
                            </span>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div>
      <div className="sticky-bar">
        <div className="row" style={{ marginBottom: 12 }}>
          <input
            placeholder="Search your library…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ flex: 1 }}
          />
          <button className="primary" onClick={() => scan(true)}>Rescan</button>
        </div>
        <div className="row" style={{ marginBottom: 12, justifyContent: 'space-between' }}>
          <div className="subtabs" style={{ marginBottom: 0 }}>
            {[
              ['all', 'All'],
              ['year', 'By Release Date'],
              ['actor', 'By Actor'],
              ['sequels', 'Sequels']
            ].map(([key, label]) => (
              <button
                key={key}
                className={`subtab ${view === key ? 'active' : ''}`}
                onClick={() => {
                  setView(key)
                  setSelectedActor(null)
                }}
              >
                {label}
                {key === 'sequels' && sequelsProgress && ` (${sequelsProgress.done}/${sequelsProgress.total})`}
              </button>
            ))}
          </div>
        </div>
        {needsSiteSetup && externalEngine === 'adhoc' && (
          <p style={{ color: 'var(--accent)', fontSize: 12, margin: '12px 0 0' }}>
            👋 Set up your default search site for Movies — enter a title and search URL below, then hit Save.
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
        {!loading && view === 'all' && filtered.length > 0 && (
          <AlphabetBarTop availableLetters={allAvailableLetters} />
        )}
      </div>

      {loading && <p className="empty-state">Scanning your Movies folder…</p>}

      {!loading && view === 'all' && renderAll()}
      {!loading && view === 'year' && renderByYear()}
      {!loading && view === 'actor' && renderByActor()}
      {!loading && view === 'sequels' && renderSequels()}

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
            <h3 style={{ marginTop: 0 }}>Which movie is "{pickerFor.name}"?</h3>
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
                      alt={r.title}
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
                  <div style={{ fontSize: 11, marginTop: 4, fontWeight: 600 }}>{r.title}</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)' }}>
                    {r.release_date ? r.release_date.slice(0, 4) : ''}
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
