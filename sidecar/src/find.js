"use strict"
/**
 * The app's search (Ctrl+K / ⌘K outside the chat; the old palette searched
 * the legacy server's documents and vault). One call finds, by name and
 * words, on this computer:
 *
 *   matters        title, number, client
 *   conversations  the first question (every window: terminal, Word, app)
 *   saved          saved items of the matters (saved.js)
 *   drafts         drafts (draft.js)
 *   panels         panels of agents (panel.js), by question and agents
 *   documents      files in the matters' folders and the workspace's matter folders
 *   commands       the chat's "/" commands (commands.js), in the app's language
 *
 *   GET /api/find?q=…[&matterId=…&lang=de&limit=8]
 *     → { q, groups: [{ kind, items: [{ id, title, detail, matterId?, target }] }] }
 *
 * `target` says what the window opens: { page: '/research', matterId, sessionId }
 * for a conversation, { page: '/vault', matterId, id } for a saved item, a
 * command's name … Matching is plain (every word must occur), titles first.
 */

const path = require('path')

const words = (q) => String(q || '').toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8)
const hit = (ws, ...fields) => { const hay = fields.join('\n').toLowerCase(); return ws.every((w) => hay.includes(w)) }
const titleHit = (ws, title) => ws.every((w) => String(title).toLowerCase().includes(w))

function find({ q = '', matterId = null, lang = 'en', limit = 8 } = {}) {
  const ws = words(q)
  const groups = []
  if (!ws.length) return { q, groups }
  const lim = Math.max(1, Math.min(25, +limit || 8))
  const add = (kind, items) => { if (items.length) groups.push({ kind, items: items.slice(0, lim) }) }
  let matters = []
  try { matters = require('./matters').list({ includeClosed: true }) } catch { matters = [] }
  const titleOf = (id) => matters.find((m) => m.id === id)?.title || ''

  add('matter', matters.filter((m) => hit(ws, m.title, m.number || '', m.client || ''))
    .map((m) => ({ id: m.id, title: m.title, detail: [m.number, m.client, m.status && m.status !== 'open' ? m.status : ''].filter(Boolean).join(' · '), matterId: m.id, target: { page: '/research', matterId: m.id } })))

  try {
    // Every question of a conversation counts, not only its first.
    const session = require('./session')
    const asked = (id) => { try { return session.read(id).messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n') } catch { return '' } }
    const convs = session.list({ all: true, limit: 500 }).filter((c) => hit(ws, c.title) || hit(ws, asked(c.id)))
    // In the current matter first.
    convs.sort((a, b) => (b.matterId === matterId) - (a.matterId === matterId))
    add('conversation', convs.map((c) => ({ id: c.id, title: c.title, detail: [titleOf(c.matterId), c.updatedAt ? c.updatedAt.slice(0, 10) : ''].filter(Boolean).join(' · '), matterId: c.matterId || null, target: { page: '/research', matterId: c.matterId || null, sessionId: c.id } })))
  } catch { /* no conversations */ }

  try {
    add('saved', require('./saved').search(q, { limit: lim })
      .sort((a, b) => (b.matterId === matterId) - (a.matterId === matterId))
      .map((s) => ({ id: s.id, title: s.title, detail: [s.kind, titleOf(s.matterId), s.snippet].filter(Boolean).join(' · ').slice(0, 160), matterId: s.matterId, target: { page: '/vault', matterId: s.matterId, id: s.id } })))
  } catch { /* none */ }

  try {
    add('draft', require('./draft').list().filter((d) => titleHit(ws, d.title))
      .map((d) => ({ id: d.id, title: d.title, detail: [titleOf(d.matterId), `${d.versions} version${d.versions === 1 ? '' : 's'}`].filter(Boolean).join(' · '), matterId: d.matterId, target: { page: '/vault', matterId: d.matterId, draftId: d.id } })))
  } catch { /* none */ }

  try {
    // Panels (agents working together): by their question and who took part.
    add('panel', require('./panel').list({ limit: 200 }).filter((x) => hit(ws, x.question, x.members.join(' ')))
      .sort((a, b) => (b.matterId === matterId) - (a.matterId === matterId))
      .map((x) => ({ id: x.id, title: x.question, detail: [`Panel: ${x.members.join(', ')}`, titleOf(x.matterId), String(x.at).slice(0, 10)].filter(Boolean).join(' · ').slice(0, 160), matterId: x.matterId || null, target: { page: '/research', matterId: x.matterId || null, panelId: x.id } })))
  } catch { /* none */ }

  // Documents: the matters' folders (library) and the matter folders in the workspace.
  const docs = []
  const seen = new Set()
  try {
    const wf = require('./workflows')
    const lib = require('./library').status()
    for (const f of lib.folders || []) {
      for (const p of wf.listDocs([f.path])) {
        if (seen.has(p) || !titleHit(ws, path.basename(p))) continue
        seen.add(p)
        docs.push({ id: p, title: path.basename(p), detail: [titleOf(f.matterId), path.dirname(p)].filter(Boolean).join(' · '), matterId: f.matterId || null, target: { file: p, matterId: f.matterId || null } })
        if (docs.length >= lim * 3) break
      }
    }
  } catch { /* no library */ }
  try {
    const wsMod = require('./workspace')
    for (const m of matters) {
      const folder = wsMod.matterFolder(require('./workflows').matterLabel(m.id))
      for (const f of wsMod.listFiles(folder)) {
        const full = wsMod.resolve(f.path)
        if (seen.has(full) || !titleHit(ws, path.basename(f.path))) continue
        seen.add(full)
        docs.push({ id: full, title: path.basename(f.path), detail: m.title, matterId: m.id, target: { file: full, matterId: m.id } })
      }
    }
  } catch { /* no workspace */ }
  docs.sort((a, b) => (b.matterId === matterId) - (a.matterId === matterId))
  add('document', docs)

  try {
    add('command', require('./commands').list({ surface: 'app', lang }).filter((c) => hit(ws, c.name, c.help))
      .map((c) => ({ id: c.name, title: `/${c.name}${c.args ? ` ${c.args}` : ''}`, detail: c.help, target: { page: '/research', command: c.name } })))
  } catch { /* none */ }
  return { q, groups }
}

function handle(method, p, params) {
  if (p !== '/api/find') return null
  if (method !== 'GET') return { status: 405, json: { error: 'use GET' } }
  const g = (k) => (params && typeof params.get === 'function' ? params.get(k) : params?.[k]) || null
  return { status: 200, json: find({ q: g('q') || '', matterId: g('matterId'), lang: g('lang') || 'en', limit: g('limit') || 8 }) }
}

module.exports = { find, handle }
