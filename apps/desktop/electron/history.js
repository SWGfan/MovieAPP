const crypto = require('crypto')

const MAX_ENTRIES = 300

function getHistory(store) {
  return store.get('watchHistory') || []
}

function setHistory(store, entries) {
  // keep it bounded — drop the oldest sessions once we're over the cap
  const trimmed = entries.length > MAX_ENTRIES ? entries.slice(entries.length - MAX_ENTRIES) : entries
  store.set('watchHistory', trimmed)
}

function startSession(store, { userId, userName, fileName, title }) {
  const sessionId = crypto.randomUUID()
  const entries = getHistory(store)
  entries.push({
    sessionId,
    userId,
    userName,
    fileName,
    title,
    startedAt: Date.now(),
    lastUpdate: Date.now(),
    currentTime: 0,
    duration: 0
  })
  setHistory(store, entries)
  return sessionId
}

function updateSession(store, sessionId, { currentTime, duration }) {
  const entries = getHistory(store)
  const entry = entries.find((e) => e.sessionId === sessionId)
  if (!entry) return false
  if (typeof currentTime === 'number' && currentTime >= 0) entry.currentTime = currentTime
  if (typeof duration === 'number' && duration > 0) entry.duration = duration
  entry.lastUpdate = Date.now()
  setHistory(store, entries)
  return true
}

module.exports = { getHistory, startSession, updateSession }
