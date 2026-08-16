let nodemailer
try {
  nodemailer = require('nodemailer')
} catch {
  nodemailer = null
}

function getTransport(store) {
  const user = store.get('emailUser')
  const pass = store.get('emailAppPassword')
  if (!user || !pass || !nodemailer) return null
  return nodemailer.createTransport({ service: 'gmail', auth: { user, pass } })
}

function isConfigured(store) {
  return !!(store.get('emailUser') && store.get('emailAppPassword') && nodemailer)
}

async function sendMail(store, { to, subject, text }) {
  const transport = getTransport(store)
  if (!transport) return { ok: false, error: 'not_configured' }
  try {
    await transport.sendMail({ from: store.get('emailUser'), to, subject, text })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

module.exports = { sendMail, isConfigured }
