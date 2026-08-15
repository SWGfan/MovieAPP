import React, { useState } from 'react'
import Movies from './components/Movies.jsx'
import Emulators from './components/Emulators.jsx'
import Settings from './components/Settings.jsx'

const TABS = [
  { id: 'movies', label: '🎬 Movies' },
  { id: 'emulators', label: '🕹️ Emulators' },
  { id: 'settings', label: '⚙️ Settings' }
]

export default function App() {
  const [tab, setTab] = useState('movies')

  return (
    <div className="app">
      <div className="sidebar">
        <h1>MovieAPP</h1>
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`nav-btn ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="main">
        {tab === 'movies' && <Movies />}
        {tab === 'emulators' && <Emulators />}
        {tab === 'settings' && <Settings />}
      </div>
    </div>
  )
}
