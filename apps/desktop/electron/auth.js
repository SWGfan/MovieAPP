const crypto = require('crypto')

// Shared user-account logic used by both the public stream server (login/session
// checks) and the Electron main process (admin IPC handlers for the Users tab).
// Nothing here is reachable from the public internet except: submitting an access
// request, and logging in with a code you already have. Approving/denying/revoking
// only happens through the desktop app's IPC, never over HTTP.

const SESSION_DAYS = 30

function getSecret(store) {
  let secret = store.get('sessionSecret')
  if (!secret) {
    secret = crypto.randomBytes(32).toString('hex')
    store.set('sessionSecret', secret)
  }
  return secret
}

function normalizeCode(raw) {
  return String(raw || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
}

function hashCode(code) {
  return crypto.createHash('sha256').update(normalizeCode(code)).digest('hex')
}

function generateCode() {
  // e.g. 7F3K — short on purpose since login now also requires the user's username
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O/1/I ambiguity
  return Array.from({ length: 4 }, () => chars[crypto.randomInt(chars.length)]).join('')
}

function slugifyUsername(name) {
  const slug = String(name || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 20)
  return slug || 'user'
}

function normalizeUsername(raw) {
  return String(raw || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '')
}

function uniqueUsername(store, base) {
  const users = getUsers(store)
  let candidate = base
  let n = 1
  while (users.some((u) => u.username === candidate)) {
    n += 1
    candidate = `${base}${n}`
  }
  return candidate
}

function getUsers(store) {
  const users = store.get('authUsers') || []
  // Backfill usernames for users created before login required one.
  let changed = false
  const seen = new Set()
  const withUsernames = users.map((u) => {
    if (u.username) {
      seen.add(u.username)
      return u
    }
    changed = true
    let base = slugifyUsername(u.name)
    let candidate = base
    let n = 1
    while (seen.has(candidate)) {
      n += 1
      candidate = `${base}${n}`
    }
    seen.add(candidate)
    return { ...u, username: candidate }
  })
  if (changed) store.set('authUsers', withUsernames)
  return withUsernames
}
function setUsers(store, users) {
  store.set('authUsers', users)
}
function getRequests(store) {
  return store.get('accessRequests') || []
}
function setRequests(store, reqs) {
  store.set('accessRequests', reqs)
}

function createUser(store, name, email) {
  const users = getUsers(store)
  const code = generateCode()
  const username = uniqueUsername(store, slugifyUsername(name))
  const user = {
    id: crypto.randomUUID(),
    name: name?.trim() || 'Unnamed',
    username,
    email: (email || '').trim().toLowerCase(),
    codeHash: hashCode(code),
    status: 'approved',
    isAdmin: false,
    createdAt: Date.now()
  }
  users.push(user)
  setUsers(store, users)
  return { user, code }
}

function revokeUser(store, userId) {
  const users = getUsers(store).map((u) => (u.id === userId ? { ...u, status: 'revoked' } : u))
  setUsers(store, users)
}

function deleteUser(store, userId) {
  const users = getUsers(store).filter((u) => u.id !== userId)
  setUsers(store, users)
}

function setUserAdmin(store, userId, isAdmin) {
  const users = getUsers(store).map((u) => (u.id === userId ? { ...u, isAdmin: !!isAdmin } : u))
  setUsers(store, users)
}

function renameUser(store, userId, name) {
  const users = getUsers(store).map((u) => (u.id === userId ? { ...u, name: name?.trim() || u.name } : u))
  setUsers(store, users)
}

function setUserEmail(store, userId, email) {
  const users = getUsers(store).map((u) =>
    u.id === userId ? { ...u, email: (email || '').trim().toLowerCase() } : u
  )
  setUsers(store, users)
}

function reactivateUser(store, userId) {
  const users = getUsers(store).map((u) => (u.id === userId ? { ...u, status: 'approved' } : u))
  setUsers(store, users)
}

function regenerateCode(store, userId) {
  const code = generateCode()
  const users = getUsers(store).map((u) => (u.id === userId ? { ...u, codeHash: hashCode(code) } : u))
  setUsers(store, users)
  return code
}

function submitAccessRequest(store, name, email, message) {
  const reqs = getRequests(store)
  const entry = {
    id: crypto.randomUUID(),
    name: (name || 'Anonymous').trim().slice(0, 80),
    email: (email || '').trim().toLowerCase().slice(0, 200),
    message: (message || '').trim().slice(0, 300),
    status: 'pending',
    createdAt: Date.now()
  }
  reqs.push(entry)
  setRequests(store, reqs)
  return entry
}

function approveRequest(store, requestId) {
  const reqs = getRequests(store)
  const reqEntry = reqs.find((r) => r.id === requestId)
  if (!reqEntry) return null
  const { user, code } = createUser(store, reqEntry.name, reqEntry.email)
  setRequests(
    store,
    reqs.map((r) => (r.id === requestId ? { ...r, status: 'approved' } : r))
  )
  return { user, code }
}

function findApprovedUserByEmail(store, email) {
  const normalized = (email || '').trim().toLowerCase()
  if (!normalized) return null
  return getUsers(store).find((u) => u.email === normalized && u.status === 'approved') || null
}

function denyRequest(store, requestId) {
  const reqs = getRequests(store)
  setRequests(
    store,
    reqs.map((r) => (r.id === requestId ? { ...r, status: 'denied' } : r))
  )
}

function findApprovedUserByCode(store, code) {
  const hash = hashCode(code)
  return getUsers(store).find((u) => u.codeHash === hash && u.status === 'approved') || null
}

function findApprovedUserByUsernameAndCode(store, username, code) {
  const uname = normalizeUsername(username)
  const hash = hashCode(code)
  return getUsers(store).find((u) => u.username === uname && u.codeHash === hash && u.status === 'approved') || null
}

function isUserApproved(store, userId) {
  const u = getUsers(store).find((x) => x.id === userId)
  return !!u && u.status === 'approved'
}

// --- session cookie (HMAC-signed, no server-side session storage needed) ---

function signSession(store, userId) {
  const secret = getSecret(store)
  const expires = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000
  const payload = `${userId}.${expires}`
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex')
  return `${payload}.${sig}`
}

function verifySession(store, cookieValue) {
  if (!cookieValue) return null
  const parts = cookieValue.split('.')
  if (parts.length !== 3) return null
  const [userId, expiresStr, sig] = parts
  const secret = getSecret(store)
  const expected = crypto.createHmac('sha256', secret).update(`${userId}.${expiresStr}`).digest('hex')
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
  if (Date.now() > Number(expiresStr)) return null
  if (!isUserApproved(store, userId)) return null
  return userId
}

function parseCookies(req) {
  const header = req.headers.cookie || ''
  const out = {}
  header.split(';').forEach((pair) => {
    const idx = pair.indexOf('=')
    if (idx === -1) return
    out[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim())
  })
  return out
}

module.exports = {
  normalizeCode,
  normalizeUsername,
  getUsers,
  getRequests,
  createUser,
  revokeUser,
  reactivateUser,
  deleteUser,
  setUserAdmin,
  renameUser,
  setUserEmail,
  regenerateCode,
  submitAccessRequest,
  approveRequest,
  denyRequest,
  findApprovedUserByCode,
  findApprovedUserByUsernameAndCode,
  findApprovedUserByEmail,
  signSession,
  verifySession,
  parseCookies
}
