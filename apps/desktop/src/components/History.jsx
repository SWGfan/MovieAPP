import React, { useEffect, useState } from 'react'

function formatDuration(seconds) {
  if (!seconds) return '—'
  const m = Math.floor(seconds / 60)
  const h = Math.floor(m / 60)
  if (h > 0) return `${h}h ${m % 60}m`
  return `${m}m`
}

export default function History() {
  const [entries, setEntries] = useState([])

  useEffect(() => {
    window.movieapp.listHistory().then(setEntries)
  }, [])

  return (
    <div style={{ maxWidth: 760 }}>
      <h2>Watch History</h2>
      <p style={{ color: '#8a8f98', fontSize: 13, marginTop: -8, marginBottom: 20 }}>
        What everyone's watched, updated live while they're streaming.
      </p>

      {entries.length === 0 && <p className="empty-state">No viewing activity yet.</p>}

      {entries.map((e) => {
        const percent = e.duration > 0 ? Math.min(100, Math.round((e.currentTime / e.duration) * 100)) : 0
        return (
          <div key={e.sessionId} style={{ background: '#171a21', borderRadius: 8, padding: '12px 16px', marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <div>
                <div style={{ fontWeight: 600 }}>{e.title}</div>
                <div style={{ color: '#8a8f98', fontSize: 12 }}>
                  {e.userName} · started {new Date(e.startedAt).toLocaleString()}
                </div>
              </div>
              <div style={{ textAlign: 'right', fontSize: 12, color: '#8a8f98' }}>
                {percent}% watched
                <div>{formatDuration(e.currentTime)} of {formatDuration(e.duration)}</div>
              </div>
            </div>
            <div style={{ background: '#0f1115', borderRadius: 4, height: 6, marginTop: 8, overflow: 'hidden' }}>
              <div style={{ background: '#4f9dff', height: '100%', width: `${percent}%` }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}
