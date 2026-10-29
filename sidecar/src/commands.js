"use strict"
/**
 * The chat commands ("/model", "/record", "/help" …) — one list for every
 * window, so a lawyer meets the same commands in the terminal app, the
 * Word pane and the desktop app ("one OpenLex, three windows").
 *
 * Each front end reads this list and runs the commands it supports:
 *   tui    the terminal app (tui/matter.mjs: requires this file)
 *   word   the Word pane ("/" menu in taskpane.js: GET /api/commands?surface=word)
 *   app    the desktop app (chat "/" menu: GET /api/commands?surface=app)
 * `surfaces` says where a command works, so /help never promises one a
 * window cannot run. Descriptions are plain words (English and German;
 * other languages fall back to English). A command wins over a firm skill
 * of the same name; anything else after "/" runs the firm's instructions.
 *
 *   list({ surface, lang })        → [{ name, args, help, description: { en, de }, surfaces }]
 *   find(name)                     → the command or null
 *   handle(method, path, params)   the local API route (server.js)
 */

const SURFACES = ['tui', 'word', 'app']
const ALL = SURFACES

/** In the order they are shown. `args` is what the command takes (empty: nothing). */
const COMMANDS = [
  { name: 'model', args: '[local | anthropic | openrouter:MODEL]', en: 'where the AI runs', de: 'wo die KI läuft', surfaces: ALL },
  { name: 'key', args: '[service]', en: 'add or replace a key, then check it', de: 'Schlüssel hinzufügen oder ersetzen, dann prüfen', surfaces: ['tui'] },
  { name: 'data', args: '', en: 'where client data may go', de: 'wohin Mandantendaten gehen dürfen', surfaces: ALL },
  { name: 'matter', args: '[name]', en: 'choose the matter you work on', de: 'die Akte wählen, an der Sie arbeiten', surfaces: ['app'] },
  { name: 'as', args: '[role]', en: 'who OpenLex works as', de: 'als wer OpenLex arbeitet', surfaces: ALL },
  { name: 'privileged', args: 'on|off', en: 'keep this matter on this computer', de: 'diese Akte auf diesem Computer behalten', surfaces: ['tui', 'app'] },
  { name: 'permissions', args: '', en: 'what OpenLex may do without asking', de: 'was OpenLex ohne Nachfrage darf', surfaces: ['tui', 'app'] },
  { name: 'folder', args: '[path | none]', en: 'the folder OpenLex works in', de: 'der Ordner, in dem OpenLex arbeitet', surfaces: ['tui'] },
  { name: 'sources', args: '', en: 'what the last answer is based on, in full', de: 'worauf die letzte Antwort beruht, vollständig', surfaces: ['tui', 'app'] },
  { name: 'law', args: '', en: 'where OpenLex looks up the law: switch a law database on or off, paste a key', de: 'wo OpenLex das Recht nachschlägt: Rechtsdatenbanken ein- oder ausschalten, Schlüssel einfügen', surfaces: ['tui', 'app'] },
  { name: 'copy', args: '', en: 'copy the last answer', de: 'die letzte Antwort kopieren', surfaces: ['tui', 'app'] },
  { name: 'save', args: '[name]', en: 'save the last answer as a file (asks first)', de: 'die letzte Antwort als Datei speichern (fragt vorher)', surfaces: ['tui', 'app'] },
  { name: 'word', args: '', en: 'send the last answer to Word', de: 'die letzte Antwort an Word senden', surfaces: ['app'] },
  { name: 'transcript', args: '', en: 'print this conversation in the terminal when you quit', de: 'dieses Gespräch beim Beenden im Terminal ausgeben', surfaces: ['tui'] },
  { name: 'activity', args: '', en: 'what OpenLex did recently, and where data went', de: 'was OpenLex zuletzt getan hat und wohin Daten gingen', surfaces: ['tui', 'app'] },
  { name: 'record', args: '[all]', en: 'the AI record: what the AI did, to show a client', de: 'das KI-Protokoll: was die KI getan hat, zum Vorzeigen', surfaces: ALL },
  { name: 'clear', args: '', en: 'start a new conversation', de: 'ein neues Gespräch beginnen', surfaces: ALL },
  { name: 'help', args: '', en: 'these commands', de: 'diese Befehle', surfaces: ALL },
]

const langOf = (lang) => (/^de\b/i.test(String(lang || '')) ? 'de' : 'en')

/** The commands for one window (all when no surface is given), described in `lang`. */
function list({ surface = null, lang = 'en' } = {}) {
  if (surface && !SURFACES.includes(surface)) throw new Error(`unknown window "${surface}" (one of: ${SURFACES.join(', ')})`)
  const l = langOf(lang)
  return COMMANDS
    .filter((c) => !surface || c.surfaces.includes(surface))
    .map((c) => ({ name: c.name, args: c.args, help: c[l], description: { en: c.en, de: c.de }, surfaces: [...c.surfaces] }))
}

/** A command by name ("/Model" and "model" both work), or null. */
function find(name) {
  const n = String(name || '').replace(/^\//, '').toLowerCase()
  const c = COMMANDS.find((x) => x.name === n)
  return c ? list().find((x) => x.name === c.name) : null
}

/** GET /api/commands[?surface=app&lang=de] → { commands, surfaces }. */
function handle(method, p, params) {
  if (p !== '/api/commands') return null
  if (method !== 'GET') return { status: 405, json: { error: 'use GET' } }
  const get = (k) => (params && typeof params.get === 'function' ? params.get(k) : params?.[k]) || null
  try {
    return { status: 200, json: { commands: list({ surface: get('surface'), lang: get('lang') }), surfaces: SURFACES } }
  } catch (err) {
    return { status: 400, json: { error: err.message } }
  }
}

module.exports = { list, find, handle, SURFACES }
