import React, { useEffect, useState } from 'react'
import Movies from './components/Movies.jsx'
import TVShows from './components/TVShows.jsx'
import Emulators from './components/Emulators.jsx'
import Users from './components/Users.jsx'
import History from './components/History.jsx'
import Settings from './components/Settings.jsx'

const TABS = [
  { id: 'movies', label: '🎬 Movies', countKey: 'movies' },
  { id: 'tvshows', label: '📺 TV Shows', countKey: 'tvshows' },
  { id: 'emulators', label: '🕹️ Emulators', countKey: 'games' },
  { id: 'users', label: '👤 Users' },
  { id: 'history', label: '📊 History' },
  { id: 'settings', label: '⚙️ Settings' }
]

export default function App() {
  const [tab, setTab] = useState('movies')
  const [counts, setCounts] = useState({ movies: null, tvshows: null, games: null })

  useEffect(() => {
    let cancelled = false
    const loadCounts = async () => {
      try {
        const movies = await window.movieapp.scanMovies()
        if (!cancelled) setCounts((c) => ({ ...c, movies: movies.length }))
      } catch {
        /* ignore — folder may not be set yet */
      }
      try {
        const tvFiles = await window.movieapp.scanTvShows()
        if (!cancelled) setCounts((c) => ({ ...c, tvshows: tvFiles.length }))
      } catch {
        /* ignore — folder may not be set yet */
      }
      try {
        const roms = await window.movieapp.scanRoms()
        if (!cancelled) setCounts((c) => ({ ...c, games: roms.length }))
      } catch {
        /* ignore — folder may not be set yet */
      }
    }
    loadCounts()
    // Keep the sidebar counts fresh without needing to plumb a refresh callback
    // through every tab that can add/remove files (rescans, folder changes, etc).
    const interval = setInterval(loadCounts, 15000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  return (
    <div className="app">
      <div className="sidebar">
        <h1>MovieAPP</h1>
        {TABS.map((t) => {
          const count = t.countKey ? counts[t.countKey] : null
          return (
            <button
              key={t.id}
              className={`nav-btn ${tab === t.id ? 'active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              <span>{t.label}</span>
              {count !== null && count !== undefined && <span className="nav-count">{count}</span>}
            </button>
          )
        })}
      </div>
      <div className="main">
        {tab === 'movies' && <Movies />}
        {tab === 'tvshows' && <TVShows />}
        {tab === 'emulators' && <Emulators />}
        {tab === 'users' && <Users />}
        {tab === 'history' && <History />}
        {tab === 'settings' && <Settings />}
      </div>
    </div>
  )
}
