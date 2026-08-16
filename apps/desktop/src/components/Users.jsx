import React, { useEffect, useState } from 'react'

function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return '0m'
  const totalMinutes = Math.round(seconds / 60)
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function watchedSeconds(entry) {
  return Math.max(0, entry.currentTime || 0)
}

function computeUserStats(entries) {
  const now = Date.now()
  const DAY = 24 * 60 * 60 * 1000
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const hourAgo = now - 60 * 60 * 1000
  const weekAgo = now - 7 * DAY
  const monthAgo = now - 30 * DAY

  let total = 0
  let lastHour = 0
  let today = 0
  let week = 0
  let month = 0

  entries.forEach((e) => {
    const t = watchedSeconds(e)
    total += t
    if (e.startedAt >= hourAgo) lastHour += t
    if (e.startedAt >= startOfToday.getTime()) today += t
    if (e.startedAt >= weekAgo) week += t
    if (e.startedAt >= monthAgo) month += t
  })

  return { total, lastHour, today, week, month, count: entries.length }
}

export default function Users() {
  const [users, setUsers] = useState([])
  const [requests, setRequests] = useState([])
  const [newName, setNewName] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [lastCode, setLastCode] = useState(null)
  const [error, setError] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editingName, setEditingName] = useState('')
  const [editingEmail, setEditingEmail] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [history, setHistory] = useState([])
  const [statsUserId, setStatsUserId] = useState(null)

  const refresh = async () => {
    try {
      const data = await window.movieapp.listUsers()
      setUsers(data.users)
      setRequests(data.requests)
    } catch (err) {
      setError(`Couldn't load users: ${err?.message || err}`)
    }
    try {
      const entries = await window.movieapp.listHistory()
      setHistory(entries)
    } catch (err) {
      setError(`Couldn't load watch history: ${err?.message || err}`)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  const toggleStats = (id) => {
    setStatsUserId((cur) => (cur === id ? null : id))
  }

  const addUser = async () => {
    setError('')
    if (!newName.trim()) {
      setError("Enter their name too — the name box can't be left blank, even if you filled in an email.")
      return
    }
    try {
      const { user, code, emailed } = await window.movieapp.createUser(newName.trim(), newEmail.trim())
      setNewName('')
      setNewEmail('')
      setLastCode({ name: user.name, username: user.username, code, emailed })
      await refresh()
    } catch (err) {
      setError(`Couldn't create user: ${err?.message || err}`)
    }
  }

  const approve = async (id) => {
    setError('')
    try {
      const result = await window.movieapp.approveRequest(id)
      if (result) setLastCode({ name: result.user.name, username: result.user.username, code: result.code, emailed: result.emailed })
      await refresh()
    } catch (err) {
      setError(`Couldn't approve request: ${err?.message || err}`)
    }
  }

  const deny = async (id) => {
    setError('')
    try {
      await window.movieapp.denyRequest(id)
      await refresh()
    } catch (err) {
      setError(`Couldn't deny request: ${err?.message || err}`)
    }
  }

  const revoke = async (id) => {
    setError('')
    try {
      await window.movieapp.revokeUser(id)
      await refresh()
    } catch (err) {
      setError(`Couldn't revoke user: ${err?.message || err}`)
    }
  }

  const reactivate = async (id) => {
    setError('')
    try {
      await window.movieapp.reactivateUser(id)
      await refresh()
    } catch (err) {
      setError(`Couldn't reactivate user: ${err?.message || err}`)
    }
  }

  const regenerate = async (id, name, username) => {
    setError('')
    try {
      const { code, emailed } = await window.movieapp.regenerateCode(id)
      setLastCode({ name, username, code, emailed })
      await refresh()
    } catch (err) {
      setError(`Couldn't generate a code: ${err?.message || err}`)
    }
  }

  const requestDelete = (id) => {
    setError('')
    setConfirmDeleteId(id)
  }

  const cancelDelete = () => {
    setConfirmDeleteId(null)
  }

  const confirmDelete = async (id) => {
    setError('')
    try {
      await window.movieapp.deleteUser(id)
      setConfirmDeleteId(null)
      await refresh()
    } catch (err) {
      setError(`Couldn't delete user: ${err?.message || err}`)
    }
  }

  const toggleAdmin = async (id, isAdmin) => {
    setError('')
    try {
      await window.movieapp.setUserAdmin(id, isAdmin)
      await refresh()
    } catch (err) {
      setError(`Couldn't update admin status: ${err?.message || err}`)
    }
  }

  const startEditing = (u) => {
    setEditingId(u.id)
    setEditingName(u.name)
    setEditingEmail(u.email || '')
  }

  const cancelEditing = () => {
    setEditingId(null)
    setEditingName('')
    setEditingEmail('')
  }

  const saveEditing = async (id) => {
    setError('')
    if (!editingName.trim()) return
    try {
      await window.movieapp.renameUser(id, editingName.trim())
      await window.movieapp.setUserEmail(id, editingEmail.trim())
      setEditingId(null)
      setEditingName('')
      setEditingEmail('')
      await refresh()
    } catch (err) {
      setError(`Couldn't update user: ${err?.message || err}`)
    }
  }

  return (
    <div style={{ maxWidth: 640 }}>
      <h2>Users</h2>
      <p style={{ color: '#8a8f98', fontSize: 13, marginTop: -8, marginBottom: 24 }}>
        Anyone visiting your streaming link needs one of these codes to log in. Approve requests or add people
        directly — none of this is reachable from the internet, only from this app.
      </p>

      {error && (
        <div
          style={{
            background: '#3a1f22',
            border: '1px solid #6b2b2b',
            borderRadius: 8,
            padding: '10px 14px',
            marginBottom: 20,
            fontSize: 13,
            color: '#ff9d9d'
          }}
        >
          {error}
        </div>
      )}

      {lastCode && (
        <div
          style={{
            background: '#1f3a2a',
            border: '1px solid #2b6b45',
            borderRadius: 8,
            padding: '12px 16px',
            marginBottom: 20,
            fontSize: 14
          }}
        >
          Login for <strong>{lastCode.name}</strong> — username: <span style={{ fontFamily: 'monospace', fontSize: 16 }}>{lastCode.username}</span>, code: <span style={{ fontFamily: 'monospace', fontSize: 16 }}>{lastCode.code}</span>
          <div style={{ color: '#8a8f98', fontSize: 12, marginTop: 4 }}>
            {lastCode.emailed
              ? "Emailed to them automatically — you don't need to do anything else."
              : "The code won't be shown again (you can always generate a new one below). Add an email notification setup so this gets sent automatically."}
          </div>
        </div>
      )}

      <div style={{ marginBottom: 28 }}>
        <label>Add a user directly</label>
        <div className="row">
          <input
            placeholder="Their name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            style={{ flex: 1 }}
            onKeyDown={(e) => e.key === 'Enter' && addUser()}
          />
          <input
            placeholder="Their email (optional)"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            style={{ flex: 1 }}
            onKeyDown={(e) => e.key === 'Enter' && addUser()}
          />
          <button className="primary" onClick={addUser}>Generate code</button>
        </div>
      </div>

      {requests.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <h3 style={{ fontSize: 15, marginBottom: 10 }}>Pending requests</h3>
          {requests.map((r) => (
            <div key={r.id} style={{ background: '#171a21', borderRadius: 8, padding: '10px 14px', marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{r.name}</div>
                  <div style={{ color: '#8a8f98', fontSize: 12 }}>{r.email}</div>
                  {r.message && <div style={{ color: '#8a8f98', fontSize: 12 }}>{r.message}</div>}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="primary" onClick={() => approve(r.id)}>Approve</button>
                  <button onClick={() => deny(r.id)} style={{ background: '#3a1f22', color: '#ff9d9d', border: 'none', padding: '8px 14px', borderRadius: 6, cursor: 'pointer' }}>
                    Deny
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div>
        <h3 style={{ fontSize: 15, marginBottom: 10 }}>All users</h3>
        {users.length === 0 && <p className="empty-state">No users yet — add one above.</p>}
        {users.map((u) => (
          <div key={u.id} style={{ background: '#171a21', borderRadius: 8, padding: '10px 14px', marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <div style={{ flex: 1, minWidth: 180 }}>
                {editingId === u.id ? (
                  <div className="row" style={{ marginBottom: 0, flexWrap: 'wrap' }}>
                    <input
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && saveEditing(u.id)}
                      placeholder="Name"
                      style={{ flex: 1, minWidth: 120 }}
                      autoFocus
                    />
                    <input
                      value={editingEmail}
                      onChange={(e) => setEditingEmail(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && saveEditing(u.id)}
                      placeholder="Email (optional)"
                      style={{ flex: 1, minWidth: 160 }}
                    />
                    <button className="primary" onClick={() => saveEditing(u.id)}>Save</button>
                    <button onClick={cancelEditing} style={{ background: '#2a2f3a', color: '#eee', border: 'none', padding: '8px 14px', borderRadius: 6, cursor: 'pointer' }}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div style={{ fontWeight: 600 }}>
                    {u.name}{' '}
                    <span style={{ fontSize: 11, color: u.status === 'approved' ? '#9dffb8' : '#ff9d9d', fontWeight: 400 }}>
                      {u.status}
                    </span>{' '}
                    {u.isAdmin && (
                      <span style={{ fontSize: 11, color: '#ffd27a', fontWeight: 400 }}>admin</span>
                    )}
                    <button
                      onClick={() => startEditing(u)}
                      style={{ marginLeft: 8, background: 'none', border: 'none', color: '#8a8f98', cursor: 'pointer', fontSize: 11, textDecoration: 'underline' }}
                    >
                      rename
                    </button>
                  </div>
                )}
                <div style={{ color: '#8a8f98', fontSize: 12, marginTop: 2 }}>
                  Username: <span style={{ fontFamily: 'monospace' }}>{u.username}</span> · Added {new Date(u.createdAt).toLocaleDateString()}
                </div>
                <div style={{ color: '#8a8f98', fontSize: 12, marginTop: 2 }}>
                  {u.email || 'No email on file'}
                </div>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 6, fontSize: 12, color: '#c7cad1', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={!!u.isAdmin}
                    onChange={(e) => toggleAdmin(u.id, e.target.checked)}
                  />
                  Admin
                </label>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button onClick={() => toggleStats(u.id)} style={{ background: statsUserId === u.id ? '#4f9dff' : '#2a2f3a', color: '#fff', border: 'none', padding: '8px 14px', borderRadius: 6, cursor: 'pointer' }}>
                  {statsUserId === u.id ? 'Hide stats' : 'View stats'}
                </button>
                <button onClick={() => regenerate(u.id, u.name, u.username)} style={{ background: '#2a2f3a', color: '#eee', border: 'none', padding: '8px 14px', borderRadius: 6, cursor: 'pointer' }}>
                  New code
                </button>
                {u.status === 'approved' ? (
                  <button onClick={() => revoke(u.id)} style={{ background: '#3a1f22', color: '#ff9d9d', border: 'none', padding: '8px 14px', borderRadius: 6, cursor: 'pointer' }}>
                    Revoke
                  </button>
                ) : (
                  <button className="primary" onClick={() => reactivate(u.id)}>Reactivate</button>
                )}
                {confirmDeleteId === u.id ? (
                  <>
                    <span style={{ fontSize: 12, color: '#ff9d9d', alignSelf: 'center' }}>Delete {u.name}?</span>
                    <button onClick={() => confirmDelete(u.id)} style={{ background: '#6b2b2b', color: '#fff', border: 'none', padding: '8px 14px', borderRadius: 6, cursor: 'pointer' }}>
                      Yes, delete
                    </button>
                    <button onClick={cancelDelete} style={{ background: '#2a2f3a', color: '#eee', border: 'none', padding: '8px 14px', borderRadius: 6, cursor: 'pointer' }}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <button onClick={() => requestDelete(u.id)} style={{ background: '#3a1f22', color: '#ff9d9d', border: '1px solid #6b2b2b', padding: '8px 14px', borderRadius: 6, cursor: 'pointer' }}>
                    Delete
                  </button>
                )}
              </div>
            </div>

            {statsUserId === u.id && (() => {
              const userEntries = history.filter((e) => e.userId === u.id)
              const stats = computeUserStats(userEntries)
              const sorted = userEntries.slice().sort((a, b) => b.startedAt - a.startedAt)
              return (
                <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid #2a2f3a' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 8, marginBottom: 14 }}>
                    {[
                      ['Last hour', stats.lastHour],
                      ['Today', stats.today],
                      ['This week', stats.week],
                      ['This month', stats.month],
                      ['All time', stats.total]
                    ].map(([label, seconds]) => (
                      <div key={label} style={{ background: '#0f1115', borderRadius: 8, padding: '10px 12px', textAlign: 'center' }}>
                        <div style={{ fontSize: 16, fontWeight: 700 }}>{formatDuration(seconds)}</div>
                        <div style={{ fontSize: 11, color: '#8a8f98', marginTop: 2 }}>{label}</div>
                      </div>
                    ))}
                  </div>

                  <div style={{ fontSize: 12, color: '#8a8f98', marginBottom: 8 }}>
                    {stats.count} viewing session{stats.count === 1 ? '' : 's'}
                  </div>

                  {sorted.length === 0 && <p className="empty-state">No viewing activity yet.</p>}
                  {sorted.map((e) => {
                    const percent = e.duration > 0 ? Math.min(100, Math.round((e.currentTime / e.duration) * 100)) : 0
                    return (
                      <div key={e.sessionId} style={{ background: '#0f1115', borderRadius: 8, padding: '10px 12px', marginBottom: 6 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{e.title}</div>
                          <div style={{ fontSize: 11, color: '#8a8f98', whiteSpace: 'nowrap' }}>{new Date(e.startedAt).toLocaleString()}</div>
                        </div>
                        <div style={{ fontSize: 12, color: '#8a8f98', marginTop: 2 }}>
                          {formatDuration(e.currentTime)} watched of {formatDuration(e.duration)} ({percent}%)
                        </div>
                        <div style={{ background: '#171a21', borderRadius: 4, height: 5, marginTop: 6, overflow: 'hidden' }}>
                          <div style={{ background: '#4f9dff', height: '100%', width: `${percent}%` }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            })()}
          </div>
        ))}
      </div>
    </div>
  )
}
