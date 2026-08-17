import React, { useEffect, useState } from 'react'

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

  const scan = async () => {
    setLoading(true)
    const files = await window.movieapp.scanMovies()
    setMovies(files)
    setLoading(false)

    // best-effort TMDB enrichment, one at a time, ignore failures/no key
    for (const f of files) {
      const cleanName = f.name.replace(/[._]/g, ' ').replace(/\b(19|20)\d{2}\b.*$/, '').trim()
      const res = await window.movieapp.tmdbSearch(cleanName || f.name)
      if (res?.results?.[0]) {
        setEnriched((prev) => ({ ...prev, [f.path]: res.results[0] }))
      }
      if (res?.error === 'no_api_key') break
    }
  }

  useEffect(() => {
    scan()
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

  const filtered = movies.filter((m) => m.name.toLowerCase().includes(query.toLowerCase()))

  const movieCard = (m) => {
    const meta = enriched[m.path]
    return (
      <div className="card" key={m.path} onClick={() => window.movieapp.playMovie(m.path)}>
        {meta?.poster_path ? (
          <img src={`https://image.tmdb.org/t/p/w300${meta.poster_path}`} alt={m.name} />
        ) : (
          <div style={{ aspectRatio: '2/3', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555' }}>
            No poster
          </div>
        )}
        <div className="meta">
          <div className="title">{meta?.title || m.name}</div>
          <div className="sub">{meta?.release_date?.slice(0, 4) || m.ext.toUpperCase().slice(1)}</div>
        </div>
      </div>
    )
  }

  const renderAll = () => (
    <>
      {!loading && filtered.length === 0 && (
        <div className="empty-state">
          <p>No movies found yet.</p>
          <p>Drop video files into your Movies folder (set in Settings) and hit Rescan.</p>
        </div>
      )}
      <div className="grid">{filtered.map(movieCard)}</div>
    </>
  )

  const renderByYear = () => {
    const sorted = filtered.slice().sort((a, b) => (enriched[b.path]?.release_date || '').localeCompare(enriched[a.path]?.release_date || ''))
    const groups = new Map()
    for (const m of sorted) {
      const year = enriched[m.path]?.release_date?.slice(0, 4) || 'Unknown year'
      if (!groups.has(year)) groups.set(year, [])
      groups.get(year).push(m)
    }
    if (filtered.length === 0) return <p className="empty-state">No movies found.</p>
    return Array.from(groups.entries()).map(([year, list]) => (
      <div key={year}>
        <h3 style={{ fontSize: 15, margin: '20px 0 10px' }}>{year}</h3>
        <div className="grid">{list.map(movieCard)}</div>
      </div>
    ))
  }

  const renderByActor = () => {
    if (selectedActor) {
      const inRole = movies.filter((m) => (castByPath[m.path] || []).some((c) => c.name === selectedActor))
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
        if (!actorMap.has(c.name)) actorMap.set(c.name, c.profilePath)
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
          {actors.map(([name, profilePath]) => (
            <div
              key={name}
              className="card"
              style={{ padding: 16, textAlign: 'center', fontSize: 13, fontWeight: 600 }}
              onClick={() => setSelectedActor(name)}
            >
              {showActorPhotos && (
                profilePath ? (
                  <img
                    src={`https://image.tmdb.org/t/p/w185${profilePath}`}
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
          <button className="primary" onClick={scan}>Rescan</button>
        </div>
        <div className="subtabs">
          {[
            ['all', 'All'],
            ['year', 'By Release Date'],
            ['actor', 'By Actor']
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
            </button>
          ))}
        </div>
      </div>

      {loading && <p className="empty-state">Scanning your Movies folder…</p>}

      {!loading && view === 'all' && renderAll()}
      {!loading && view === 'year' && renderByYear()}
      {!loading && view === 'actor' && renderByActor()}
    </div>
  )
}
