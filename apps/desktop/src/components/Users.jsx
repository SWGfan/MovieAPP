import React, { useEffect, useState } from 'react'

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

  const refresh = async () => {
    try {
      const data = await window.movieapp.listUsers()
      setUsers(data.users)
      setRequests(data.requests)
    } catch (err) {
      setError(`Couldn't load users: ${err?.message || err}`)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

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

  const removeUser = async (id, name) => {
    setError('')
    if (!window.confirm(`Delete ${name}? This can't be undone — their code will stop working right away.`)) return
    try {
      await window.movieapp.deleteUser(id)
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
                <button onClick={() => removeUser(u.id, u.name)} style={{ background: '#3a1f22', color: '#ff9d9d', border: '1px solid #6b2b2b', padding: '8px 14px', borderRadius: 6, cursor: 'pointer' }}>
                  Delete
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
