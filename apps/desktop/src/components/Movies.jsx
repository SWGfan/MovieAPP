import React, { useEffect, useState } from 'react'

export default function Movies() {
  const [movies, setMovies] = useState([])
  const [enriched, setEnriched] = useState({})
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')

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

  const filtered = movies.filter((m) => m.name.toLowerCase().includes(query.toLowerCase()))

  return (
    <div>
      <div className="row">
        <input
          placeholder="Search your library…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ flex: 1 }}
        />
        <button className="primary" onClick={scan}>Rescan</button>
      </div>

      {loading && <p className="empty-state">Scanning your Movies folder…</p>}

      {!loading && filtered.length === 0 && (
        <div className="empty-state">
          <p>No movies found yet.</p>
          <p>Drop video files into your Movies folder (set in Settings) and hit Rescan.</p>
        </div>
      )}

      <div className="grid">
        {filtered.map((m) => {
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
        })}
      </div>
    </div>
  )
}
