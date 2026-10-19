"use strict"
/**
 * Calendar integration (Batch W3): contract deadlines → real calendars.
 *   - openICS: open an .ics in the default calendar app (works everywhere)
 *   - Apple Calendar (macOS): create a "LexVault — <matter>" calendar + events
 *   - Microsoft Outlook (macOS AppleScript / Windows COM): feature-detected
 * Provider is user-chosen in Settings (auto → detect), gated on enabled.
 */

const { execFile } = require('child_process')
const { load, save } = require('./agent-config')

function providerConfig() {
  return load().calendar || { enabled: false, provider: 'auto' }
}

function setProviderConfig(patch) {
  const next = { ...providerConfig(), ...patch }
  save({ calendar: next })
  return next
}

function openICS(filePath) {
  return new Promise((resolve) => {
    if (process.platform === 'darwin') execFile('open', [String(filePath)], () => resolve(true))
    else execFile('cmd.exe', ['/c', 'start', '', `"${filePath}"`], () => resolve(true))
  })
}

function osascript(script) {
  return new Promise((resolve) => execFile('osascript', ['-e', script], (err, out) => resolve(!err ? out : null)))
}

/** Build an AppleScript date assignment for a YYYY-MM-DD string. */
function asDate(year, month, day, hour) {
  return `set d to current date\nset year of d to ${year}\nset month of d to ${month}\nset day of d to ${day}\nset hours of d to ${hour}\nset minutes of d to 0\nset seconds of d to 0`
}

async function addToAppleCalendar(events, matter) {
  if (process.platform !== 'darwin') return false
  const calName = `LexVault — ${String(matter).replace(/"/g, '')}`
  const ensure = `tell application "Calendar"\nif not (exists calendar "${calName}") then make new calendar with properties {name:"${calName}"}\nend tell`
  const created = await osascript(ensure)
  if (created === null) return false
  const parts = [`tell application "Calendar"`, `tell calendar "${calName}"`]
  for (const e of events.slice(0, 50)) {
    if (!e.date) continue
    const [y, mo, d] = String(e.date).split('-').map(Number)
    if (!y || !mo || !d) continue
    parts.push(asDate(y, mo, d, 9))
    parts.push(`make new event at end of events with properties {summary:"${String(e.summary || 'Deadline').replace(/"/g, "'").slice(0, 120)}", start date:d, end date:d}`)
  }
  parts.push('end tell', 'end tell')
  return (await osascript(parts.join('\n'))) !== null
}

async function addToOutlookMac(events, matter) {
  if (process.platform !== 'darwin') return false
  const parts = ['tell application "Microsoft Outlook"']
  for (const e of events.slice(0, 50)) {
    if (!e.date) continue
    const [y, mo, d] = String(e.date).split('-').map(Number)
    if (!y || !mo || !d) continue
    parts.push(asDate(y, mo, d, 9))
    parts.push(`make new calendar event with properties {subject:"${String(e.summary || 'Deadline').replace(/"/g, "'").slice(0, 120)}", start date:d, end date:d}`)
  }
  parts.push('end tell')
  return (await osascript(parts.join('\n'))) !== null
}

function addToOutlookWindows(events) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(false)
    const script = `
$ErrorActionPreference = 'Stop'
try {
  $ol = New-Object -ComObject Outlook.Application
} catch { exit 2 }
$ns = $ol.GetNamespace('MAPI')
$cal = $ns.GetDefaultFolder(9)
${events.filter((e) => e.date && /^\d{4}-\d{2}-\d{2}$/.test(e.date)).slice(0, 50).map((e) => `
$item = $cal.Items.Add(1)
$item.Subject = '${String(e.summary || 'Deadline').replace(/'/g, "''").slice(0, 120)}'
$item.Start = '${e.date} 09:00:00'
$item.End = '${e.date} 10:00:00'
$item.Save()`).join('\n')}
Write-Output 'ok'`
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 60000 }, (err, stdout) => resolve(!err && /ok/.test(stdout)))
  })
}

/** Sync deadline events to the configured provider. Returns a result string. */
async function sync(events, matter) {
  const cfg = providerConfig()
  if (!cfg.enabled) return 'calendar integration disabled — enable it in Settings (or use export_document with format=ics)'
  const dated = (events || []).filter((e) => e.date)
  if (!dated.length) return 'no dated deadlines found — nothing to add'
  const provider = cfg.provider === 'auto'
    ? (process.platform === 'darwin' ? (await osascript('tell application "Microsoft Outlook" to get name') ? 'outlook' : 'apple') : 'outlook')
    : cfg.provider
  let ok = false
  if (provider === 'apple') ok = await addToAppleCalendar(dated, matter)
  else if (provider === 'outlook' && process.platform === 'darwin') ok = await addToOutlookMac(dated, matter)
  else if (provider === 'outlook') ok = await addToOutlookWindows(dated)
  return ok ? `added ${dated.length} deadline(s) to ${provider === 'apple' ? 'Apple Calendar' : 'Outlook'} (calendar: LexVault — ${matter})`
    : `could not reach ${provider === 'apple' ? 'Apple Calendar' : 'Outlook'} — install/enable it, or use the .ics export instead`
}

module.exports = { providerConfig, setProviderConfig, openICS, sync }
