import React, { useEffect, useState } from 'react'

export default function Settings() {
  const [settings, setSettings] = useState({ moviesDir: '', emulatorsDir: '', tmdbApiKey: '' })
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    window.movieapp.getSettings().then(setSettings)
  }, [])

  const save = async () => {
    await window.movieapp.setSettings({ tmdbApiKey: settings.tmdbApiKey })
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  const pick = async (key) => {
    const dir = await window.movieapp.pickFolder(key === 'moviesDir' ? 'moviesDir' : 'emulatorsDir')
    if (dir) setSettings((s) => ({ ...s, [key]: dir }))
  }

  return (
    <div style={{ maxWidth: 480 }}>
      <h2>Settings</h2>

      <div style={{ marginBottom: 20 }}>
        <label>Movies folder</label>
        <div className="row">
          <input value={settings.moviesDir} readOnly style={{ flex: 1 }} />
          <button className="primary" onClick={() => pick('moviesDir')}>Change</button>
        </div>
      </div>

      <div style={{ marginBottom: 20 }}>
        <label>Emulators folder</label>
        <div className="row">
          <input value={settings.emulatorsDir} readOnly style={{ flex: 1 }} />
          <button className="primary" onClick={() => pick('emulatorsDir')}>Change</button>
        </div>
      </div>

      <div style={{ marginBottom: 20 }}>
        <label>TMDB API key / token</label>
        <div className="row">
          <input
            type="password"
            placeholder="Paste your TMDB v3 API key or v4 Read Access Token"
            value={settings.tmdbApiKey}
            onChange={(e) => setSettings((s) => ({ ...s, tmdbApiKey: e.target.value }))}
            style={{ flex: 1 }}
          />
          <button className="primary" onClick={save}>{saved ? 'Saved ✓' : 'Save'}</button>
        </div>
        <p style={{ color: '#8a8f98', fontSize: 12 }}>
          Free at themoviedb.org → Settings → API. Either the short v3 API key or the long v4 Read Access Token works.
        </p>
      </div>
    </div>
  )
}
