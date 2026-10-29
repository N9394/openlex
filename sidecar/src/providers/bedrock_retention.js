"use strict"
/**
 * Zero data retention on AWS Bedrock, set from the model picker.
 *
 * Bedrock's account setting per region (no console page for it):
 *   GET / PUT https://bedrock.<region>.amazonaws.com/data-retention   body {"mode":"none"}
 * with the Bedrock API key as bearer token, or SigV4-signed access keys.
 * The key needs bedrock:PutAccountDataRetention; a key made "for
 * exploration" may not have it — then the lawyer gets the manual step.
 * https://docs.aws.amazon.com/bedrock/latest/userguide/data-retention.html
 *
 *   check(p, key)   → { mode, confirmed }   (and remembered, for the picker)
 *   setNone(p, key) → { ok, mode, confirmed } or { ok: false, manual }
 *   remembered(region) → { mode, confirmed, checkedAt } or null
 */

const fs = require('fs')
const path = require('path')
const { DATA_DIR } = require('../config')
const { sigv4, parseCreds } = require('./bedrock')
const { httpError, timeoutSignal } = require('./common')

const STATE = path.join(DATA_DIR, 'bedrock-retention.json')

const urlFor = (p) => `${p.controlUrl || `https://bedrock.${p.region || 'eu-central-1'}.amazonaws.com`}/data-retention`

async function request(p, key, method, body) {
  const url = urlFor(p)
  const payload = body ? JSON.stringify(body) : ''
  const creds = parseCreds(key)
  const headers = creds.bearer
    ? { Authorization: `Bearer ${creds.bearer}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }
    : sigv4({ method, url, body: payload, region: p.region || 'eu-central-1', creds, contentType: body ? 'application/json' : null })
  const res = await fetch(url, { method, headers, ...(body ? { body: payload } : {}), signal: timeoutSignal(20000) })
  if (!res.ok) throw await httpError(res, 'AWS Bedrock data retention')
  return res.json()
}

function remember(region, mode) {
  let all = {}
  try { all = JSON.parse(fs.readFileSync(STATE, 'utf8')) || {} } catch { all = {} }
  all[region] = { mode, confirmed: mode === 'none', checkedAt: new Date().toISOString() }
  fs.mkdirSync(path.dirname(STATE), { recursive: true })
  fs.writeFileSync(STATE, JSON.stringify(all, null, 2))
  return all[region]
}

function remembered(region = 'eu-central-1') {
  try { return JSON.parse(fs.readFileSync(STATE, 'utf8'))[region] || null } catch { return null }
}

async function check(p, key) {
  const r = await request(p, key, 'GET')
  return remember(p.region || 'eu-central-1', r.mode || null)
}

/** The command an AWS administrator can run instead (the key here may lack the permission). */
function manualStep(p) {
  const url = urlFor({ ...p, controlUrl: null })
  return {
    command: `curl -X PUT ${url} -H "Authorization: Bearer ADMIN_BEDROCK_API_KEY" -H "Content-Type: application/json" -d '{"mode":"none"}'`,
    en: `Your key may not change this setting (it needs the AWS permission bedrock:PutAccountDataRetention). Ask whoever manages your firm's AWS account to run this once, with an administrator's Bedrock key for ${p.region || 'eu-central-1'}, then click "Check again":`,
    de: `Ihr Schlüssel darf diese Einstellung nicht ändern (er braucht die AWS-Berechtigung bedrock:PutAccountDataRetention). Bitten Sie die Person, die das AWS-Konto Ihrer Kanzlei verwaltet, dies einmal mit dem Bedrock-Schlüssel eines Administrators für ${p.region || 'eu-central-1'} auszuführen, und klicken Sie dann auf „Erneut prüfen“:`,
  }
}

async function setNone(p, key) {
  try {
    await request(p, key, 'PUT', { mode: 'none' })
  } catch (err) {
    if (err.status === 401 || err.status === 403) return { ok: false, manual: manualStep(p), error: err.message }
    throw err
  }
  const st = await check(p, key)
  return { ok: st.confirmed, ...st, ...(st.confirmed ? {} : { manual: manualStep(p) }) }
}

module.exports = { check, setNone, remembered, manualStep, STATE }
