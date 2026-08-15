import React, { useEffect, useState } from 'react'

export default function Settings() {
  const [settings, setSettings] = useState({ moviesDir: '', emulatorsDir: '', tmdbApiKey: '' })
  const [saved, setSaved] = useState(false)
  const [remoteInfo, setRemoteInfo] = useState(null)
  const [copied, setCopied] = useState('')

  useEffect(() => {
    window.movieapp.getSettings().then(setSettings)
    window.movieapp.getRemoteAccessInfo().then(setRemoteInfo)
  }, [])

  const copyLink = (url) => {
    navigator.clipboard.writeText(url)
    setCopied(url)
    setTimeout(() => setCopied(''), 1500)
  }

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

      <div style={{ marginBottom: 20 }}>
        <label>Watch on your phone</label>
        {!remoteInfo && <p style={{ color: '#8a8f98', fontSize: 13 }}>Loading…</p>}

        {remoteInfo && !remoteInfo.hasTailscale && (
          <p style={{ color: '#8a8f98', fontSize: 13 }}>
            No Tailscale address detected yet. Install Tailscale on this PC and your phone, sign into both with the
            same account, then reopen this tab — a link will appear here that works from anywhere.
          </p>
        )}

        {remoteInfo?.links?.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {remoteInfo.links.map((l) => (
              <div key={l.address} className="row" style={{ marginBottom: 0 }}>
                <input readOnly value={l.url} style={{ flex: 1, fontSize: 12 }} />
                <button className="primary" onClick={() => copyLink(l.url)}>
                  {copied === l.url ? 'Copied ✓' : 'Copy'}
                </button>
              </div>
            ))}
            <p style={{ color: '#8a8f98', fontSize: 12 }}>
              {remoteInfo.hasTailscale
                ? 'The 100.x.x.x link works from anywhere once Tailscale is installed on your phone too. Other links only work on the same WiFi.'
                : 'This link only works on the same WiFi as this PC.'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
