import React, { useEffect, useState } from 'react'

export default function Settings() {
  const [settings, setSettings] = useState({
    moviesDir: '',
    tvShowsDir: '',
    emulatorsDir: '',
    viewerAppDir: '',
    tmdbApiKey: '',
    tmdbCacheDir: '',
    emailUser: '',
    emailAppPassword: '',
    adminNotifyEmail: '',
    emailConfigured: false,
    missingSearchEngine: 'imdb',
    customSearchSites: []
  })
  const [saved, setSaved] = useState(false)
  const [searchEngineSaved, setSearchEngineSaved] = useState(false)
  const [newSiteName, setNewSiteName] = useState('')
  const [newSiteUrl, setNewSiteUrl] = useState('')
  const [customSiteError, setCustomSiteError] = useState('')
  const [emailSaved, setEmailSaved] = useState(false)
  const [testResult, setTestResult] = useState('')
  const [remoteInfo, setRemoteInfo] = useState(null)
  const [copied, setCopied] = useState('')
  const [prefetchProgress, setPrefetchProgress] = useState(null)
  const [prefetchResult, setPrefetchResult] = useState('')
  const [prefetching, setPrefetching] = useState(false)
  const [prefetchTvProgress, setPrefetchTvProgress] = useState(null)
  const [prefetchTvResult, setPrefetchTvResult] = useState('')
  const [prefetchingTv, setPrefetchingTv] = useState(false)

  useEffect(() => {
    window.movieapp.getSettings().then(setSettings)
    window.movieapp.getRemoteAccessInfo().then(setRemoteInfo)
    const unsubscribe = window.movieapp.onPrefetchProgress((data) => setPrefetchProgress(data))
    const unsubscribeTv = window.movieapp.onPrefetchTvProgress((data) => setPrefetchTvProgress(data))
    return () => {
      unsubscribe && unsubscribe()
      unsubscribeTv && unsubscribeTv()
    }
  }, [])

  // force=true re-verifies every movie's TMDB match from scratch, even ones
  // already cached — needed after a matching-logic fix, since a normal run
  // skips anything already cached (by design, to avoid re-querying TMDB for
  // no reason) and would otherwise leave old wrong/mismatched posters stuck
  // forever.
  const runPrefetch = async (force) => {
    if (!settings.tmdbCacheDir) {
      setPrefetchResult('Pick an offline cache folder first.')
      return
    }
    setPrefetching(true)
    setPrefetchResult('')
    setPrefetchProgress(null)
    const result = await window.movieapp.tmdbPrefetchAll(force)
    setPrefetching(false)
    if (result?.ok) {
      setPrefetchResult(`Done ✓ Cached ${result.movies} movies, ${result.posters} posters, ${result.actorPhotos} actor photos.`)
    } else if (result?.error === 'already_running') {
      setPrefetchResult('A download is already in progress.')
    } else if (result?.error === 'no_cache_dir') {
      setPrefetchResult('Pick an offline cache folder first.')
    } else if (result?.error === 'no_api_key') {
      setPrefetchResult('Add a TMDB API key above first.')
    } else {
      setPrefetchResult(`Failed: ${result?.error || 'unknown error'}`)
    }
  }

  const runPrefetchTv = async () => {
    if (!settings.tmdbCacheDir) {
      setPrefetchTvResult('Pick an offline cache folder first.')
      return
    }
    setPrefetchingTv(true)
    setPrefetchTvResult('')
    setPrefetchTvProgress(null)
    const result = await window.movieapp.tmdbPrefetchAllTv()
    setPrefetchingTv(false)
    if (result?.ok) {
      setPrefetchTvResult(`Done ✓ Cached ${result.shows} shows, ${result.posters} posters.`)
    } else if (result?.error === 'already_running') {
      setPrefetchTvResult('A download is already in progress.')
    } else if (result?.error === 'no_cache_dir') {
      setPrefetchTvResult('Pick an offline cache folder first.')
    } else if (result?.error === 'no_api_key') {
      setPrefetchTvResult('Add a TMDB API key above first.')
    } else {
      setPrefetchTvResult(`Failed: ${result?.error || 'unknown error'}`)
    }
  }

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

  const saveEmail = async () => {
    await window.movieapp.setSettings({
      emailUser: settings.emailUser,
      emailAppPassword: settings.emailAppPassword,
      adminNotifyEmail: settings.adminNotifyEmail
    })
    setEmailSaved(true)
    setTimeout(() => setEmailSaved(false), 1500)
  }

  const sendTest = async () => {
    setTestResult('Sending…')
    const result = await window.movieapp.sendTestEmail()
    setTestResult(result.ok ? 'Sent ✓ check your inbox' : `Failed: ${result.error}`)
  }

  const pick = async (key) => {
    const dir = await window.movieapp.pickFolder(key)
    if (dir) setSettings((s) => ({ ...s, [key]: dir }))
  }

  const setSearchEngine = async (value) => {
    setSettings((s) => ({ ...s, missingSearchEngine: value }))
    await window.movieapp.setSettings({ missingSearchEngine: value })
    setSearchEngineSaved(true)
    setTimeout(() => setSearchEngineSaved(false), 1500)
  }

  // Custom search sites — the user supplies a name and a search URL containing
  // a {query} placeholder (e.g. "https://letterboxd.com/search/{query}/"), and
  // it's saved alongside the built-in engines so it shows up in the "Missing
  // item search engine" dropdown from then on.
  const addCustomSite = async () => {
    const name = newSiteName.trim()
    const url = newSiteUrl.trim()
    if (!name || !url) {
      setCustomSiteError('Enter both a name and a search URL.')
      return
    }
    if (!url.includes('{query}')) {
      setCustomSiteError('The URL needs a {query} placeholder — e.g. https://example.com/search?q={query}')
      return
    }
    if (!/^https:\/\//.test(url)) {
      setCustomSiteError('The URL must start with https://')
      return
    }
    setCustomSiteError('')

    const site = { id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name, urlTemplate: url }
    const updated = [...(settings.customSearchSites || []), site]
    setSettings((s) => ({ ...s, customSearchSites: updated }))
    await window.movieapp.setSettings({ customSearchSites: updated })
    setNewSiteName('')
    setNewSiteUrl('')
  }

  const removeCustomSite = async (id) => {
    const updated = (settings.customSearchSites || []).filter((s) => s.id !== id)
    const stillSelected = settings.missingSearchEngine === `custom:${id}`
    setSettings((s) => ({ ...s, customSearchSites: updated, missingSearchEngine: stillSelected ? 'imdb' : s.missingSearchEngine }))
    await window.movieapp.setSettings({
      customSearchSites: updated,
      ...(stillSelected ? { missingSearchEngine: 'imdb' } : {})
    })
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
        <label>TV Shows folder</label>
        <div className="row">
          <input value={settings.tvShowsDir} readOnly style={{ flex: 1 }} />
          <button className="primary" onClick={() => pick('tvShowsDir')}>Change</button>
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
        <label>Viewer app installer folder</label>
        <p style={{ color: '#8a8f98', fontSize: 12, marginTop: -4, marginBottom: 10 }}>
          Point this at the folder where you build the MovieAPP Viewer installer (from{' '}
          <code>apps/viewer</code>, via <code>npm run build</code>) — the newest .exe in that folder is what
          the "Download MovieAPP Viewer" link on your login page will serve.
        </p>
        <div className="row">
          <input value={settings.viewerAppDir} readOnly style={{ flex: 1 }} />
          <button className="primary" onClick={() => pick('viewerAppDir')}>Change</button>
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
        <label>Offline mode (no internet needed, e.g. at a cabin)</label>
        <p style={{ color: '#8a8f98', fontSize: 12, marginTop: -4, marginBottom: 10 }}>
          Pick a folder here, then hit "Download all TMDB info" once <strong>while you still have internet</strong> —
          it saves every poster, title, year, and cast photo to that folder. After that, movies, release dates, and
          actor search (with photos) all keep working with zero internet access, on both this app and your website.
          If this drive is heading somewhere offline, run the download before it leaves.
        </p>
        <div className="row">
          <input value={settings.tmdbCacheDir} readOnly style={{ flex: 1 }} placeholder="No folder chosen yet" />
          <button className="primary" onClick={() => pick('tmdbCacheDir')}>Change</button>
        </div>
        <div className="row" style={{ marginTop: 10, gap: 10 }}>
          <button
            className="primary"
            onClick={() => runPrefetch(false)}
            disabled={prefetching}
            style={{ opacity: prefetching ? 0.7 : 1 }}
          >
            {prefetching ? 'Downloading…' : 'Download all TMDB info for offline use'}
          </button>
          <button
            onClick={() => runPrefetch(true)}
            disabled={prefetching}
            style={{ opacity: prefetching ? 0.7 : 1 }}
            title="Re-verifies every movie's match from scratch, including ones already cached — use this after a wrong/mismatched poster shows up, to fix it (and any others like it) in one pass instead of retrying each by hand."
          >
            {prefetching ? 'Checking…' : '🔄 Re-check all movie matches'}
          </button>
        </div>
        {prefetching && prefetchProgress && (
          <p style={{ color: '#8a8f98', fontSize: 12, marginTop: 8 }}>
            {prefetchProgress.current} / {prefetchProgress.total} — {prefetchProgress.title}
          </p>
        )}
        {!prefetching && prefetchResult && (
          <p style={{ color: '#8a8f98', fontSize: 12, marginTop: 8 }}>{prefetchResult}</p>
        )}

        <div className="row" style={{ marginTop: 14 }}>
          <button
            className="primary"
            onClick={runPrefetchTv}
            disabled={prefetchingTv}
            style={{ opacity: prefetchingTv ? 0.7 : 1 }}
          >
            {prefetchingTv ? 'Downloading…' : 'Download all TV Shows info for offline use'}
          </button>
        </div>
        {prefetchingTv && prefetchTvProgress && (
          <p style={{ color: '#8a8f98', fontSize: 12, marginTop: 8 }}>
            {prefetchTvProgress.current} / {prefetchTvProgress.total} — {prefetchTvProgress.title}
          </p>
        )}
        {!prefetchingTv && prefetchTvResult && (
          <p style={{ color: '#8a8f98', fontSize: 12, marginTop: 8 }}>{prefetchTvResult}</p>
        )}
      </div>

      <div style={{ marginBottom: 20 }}>
        <label>Email notifications</label>
        <p style={{ color: '#8a8f98', fontSize: 12, marginTop: -4, marginBottom: 10 }}>
          Powers two things automatically: you get emailed when someone requests access, and users get emailed their
          code (on approval, or when they use "forgot code") — no manual work either way. Uses your Gmail account
          with an <strong>App Password</strong> (not your normal password) — get one at{' '}
          <a href="#" onClick={(e) => { e.preventDefault(); window.open('https://myaccount.google.com/apppasswords') }} style={{ color: '#4f9dff' }}>
            myaccount.google.com/apppasswords
          </a>{' '}
          (requires 2-Step Verification to be on).
        </p>
        <input
          placeholder="Your Gmail address"
          value={settings.emailUser}
          onChange={(e) => setSettings((s) => ({ ...s, emailUser: e.target.value }))}
        />
        <input
          type="password"
          placeholder="Gmail App Password (16 characters)"
          value={settings.emailAppPassword}
          onChange={(e) => setSettings((s) => ({ ...s, emailAppPassword: e.target.value }))}
        />
        <input
          placeholder="Send admin notifications to (defaults to the address above)"
          value={settings.adminNotifyEmail}
          onChange={(e) => setSettings((s) => ({ ...s, adminNotifyEmail: e.target.value }))}
        />
        <div className="row">
          <button className="primary" onClick={saveEmail}>{emailSaved ? 'Saved ✓' : 'Save'}</button>
          <button onClick={sendTest} style={{ background: '#2a2f3a', color: '#eee', border: 'none', padding: '8px 14px', borderRadius: 6, cursor: 'pointer' }}>
            Send test email
          </button>
          {testResult && <span style={{ color: '#8a8f98', fontSize: 12 }}>{testResult}</span>}
        </div>
      </div>

      <div style={{ marginBottom: 20 }}>
        <label>Missing item search engine</label>
        <p style={{ color: '#8a8f98', fontSize: 12, marginTop: -4, marginBottom: 10 }}>
          When you click a "Missing" episode or movie (in TV Shows or the Movies Sequels tab), this picks which site
          opens in your browser to look it up.
        </p>
        <div className="row" style={{ alignItems: 'center' }}>
          <select
            value={settings.missingSearchEngine}
            onChange={(e) => setSearchEngine(e.target.value)}
            style={{ flex: 1, padding: '8px 10px', borderRadius: 6, background: '#1a1d24', color: '#eee', border: '1px solid #2a2f3a' }}
          >
            <option value="imdb">IMDb</option>
            <option value="tmdb">TMDB</option>
            <option value="google">Google</option>
            <option value="bing">Bing</option>
            <option value="duckduckgo">DuckDuckGo</option>
            {(settings.customSearchSites || []).map((site) => (
              <option key={site.id} value={`custom:${site.id}`}>{site.name}</option>
            ))}
          </select>
          {searchEngineSaved && <span style={{ color: '#8a8f98', fontSize: 12 }}>Saved ✓</span>}
        </div>

        <p style={{ color: '#8a8f98', fontSize: 12, marginTop: 16, marginBottom: 6 }}>
          Add your own site — needs a search URL with a <code>{'{query}'}</code> placeholder where the title should
          go (e.g. <code>https://letterboxd.com/search/{'{query}'}/</code> or{' '}
          <code>https://example.com/search?q={'{query}'}</code>).
        </p>
        <div className="row" style={{ gap: 8 }}>
          <input
            placeholder="Site name (e.g. Letterboxd)"
            value={newSiteName}
            onChange={(e) => setNewSiteName(e.target.value)}
            style={{ flex: 1 }}
          />
          <input
            placeholder="https://example.com/search?q={query}"
            value={newSiteUrl}
            onChange={(e) => setNewSiteUrl(e.target.value)}
            style={{ flex: 2 }}
          />
          <button className="primary" onClick={addCustomSite}>Add</button>
        </div>
        {customSiteError && <p style={{ color: '#ff9d9d', fontSize: 12, marginTop: 6 }}>{customSiteError}</p>}

        {(settings.customSearchSites || []).length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
            {settings.customSearchSites.map((site) => (
              <div key={site.id} className="row" style={{ marginBottom: 0, alignItems: 'center' }}>
                <div style={{ flex: 1, fontSize: 12, color: '#8a8f98', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <strong style={{ color: '#eee' }}>{site.name}</strong> — {site.urlTemplate}
                </div>
                <button
                  onClick={() => removeCustomSite(site.id)}
                  style={{ background: '#2a2f3a', color: '#ff9d9d', border: 'none', padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ marginBottom: 20 }}>
        <label>Local network links</label>
        <p style={{ color: '#8a8f98', fontSize: 12, marginTop: -4 }}>
          Useful for testing on the same WiFi. Your public link (for anywhere access) is the "Watch Now" button on
          your GitHub Pages site — everyone, including you, needs an access code to log in there. Manage who has one
          in the <strong>Users</strong> tab.
        </p>
        {!remoteInfo && <p style={{ color: '#8a8f98', fontSize: 13 }}>Loading…</p>}

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
          </div>
        )}
      </div>
    </div>
  )
}
