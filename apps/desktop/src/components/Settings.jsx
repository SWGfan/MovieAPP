import React, { useEffect, useState } from 'react'

export default function Settings() {
  const [settings, setSettings] = useState({
    moviesDir: '',
    emulatorsDir: '',
    tmdbApiKey: '',
    emailUser: '',
    emailAppPassword: '',
    adminNotifyEmail: '',
    emailConfigured: false
  })
  const [saved, setSaved] = useState(false)
  const [emailSaved, setEmailSaved] = useState(false)
  const [testResult, setTestResult] = useState('')
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
