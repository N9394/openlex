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
  { name: 'model', args: '[local | anthropic | openrouter:MODEL]', en: 'where the AI runs: on this computer, with an EU provider or in the cloud', de: 'wo die KI läuft: auf diesem Computer, bei einem EU-Anbieter oder in der Cloud', surfaces: ALL },
  { name: 'key', args: '[service]', en: 'add or replace a key, then check it', de: 'Schlüssel hinzufügen oder ersetzen, dann prüfen', surfaces: ['tui'] },
  { name: 'data', args: '', en: 'where client data may go', de: 'wohin Mandantendaten gehen dürfen', surfaces: ALL },
  { name: 'matter', args: '[name]', en: 'choose the matter you work on', de: 'die Akte wählen, an der Sie arbeiten', surfaces: ['app'] },
  { name: 'as', args: '[role]', en: 'who OpenLex works as', de: 'als wer OpenLex arbeitet', surfaces: ALL },
  { name: 'privileged', args: 'on|off', en: 'keep this matter on this computer', de: 'diese Akte auf diesem Computer behalten', surfaces: ['tui', 'app'] },
  { name: 'permissions', args: '', en: 'what OpenLex may do without asking', de: 'was OpenLex ohne Nachfrage darf', surfaces: ['tui', 'app'] },
  { name: 'folder', args: '[path | none]', en: 'the folder OpenLex works in', de: 'der Ordner, in dem OpenLex arbeitet', surfaces: ['tui'] },
  { name: 'sources', args: '', en: 'what the last answer is based on, in full', de: 'worauf die letzte Antwort beruht, vollständig', surfaces: ['tui', 'app'] },
  { name: 'law', args: '', en: 'where OpenLex looks up the law: switch a law database on or off, paste a key', de: 'wo OpenLex das Recht nachschlägt: Rechtsdatenbanken ein- oder ausschalten, Schlüssel einfügen', surfaces: ['tui', 'app'] },
  { name: 'analyse', args: '[document]', en: 'full analysis of a document: summary, risks, deadlines, obligations, clauses — export to Word, PDF or CSV', de: 'vollständige Analyse eines Dokuments: Zusammenfassung, Risiken, Fristen, Pflichten, Klauseln — Export nach Word, PDF oder CSV', surfaces: ALL },
  { name: 'investigate', args: '[question | liability | exit | obligations | advantages]', en: 'one question across several documents: findings quoted per document, compared and double-checked — export to Word, PDF or CSV', de: 'eine Frage über mehrere Dokumente: Feststellungen mit Zitat je Dokument, verglichen und gegengeprüft — Export nach Word, PDF oder CSV', surfaces: ['tui', 'app'] },
  { name: 'diligence', args: '[buyer | seller] [share | asset | merger]', en: 'due diligence of a data room: a review grid per document, red flags, what is missing — export to Excel, CSV, Word or PDF', de: 'Due Diligence eines Datenraums: Prüfraster je Dokument, Red Flags, was fehlt — Export nach Excel, CSV, Word oder PDF', surfaces: ['tui', 'app'] },
  { name: 'draft', args: '[what to write]', en: 'write a draft, or work on an attached document: fill-ins, changes by instruction, a law check — export to Word or PDF, send to Word', de: 'einen Entwurf schreiben oder ein angehängtes Dokument bearbeiten: Platzhalter, Änderungen auf Anweisung, Rechtsprüfung — Export nach Word oder PDF, an Word senden', surfaces: ['tui', 'app'] },
  { name: 'saved', args: '', en: 'what is saved with this matter: answers, notes, clauses, documents, drafts', de: 'was bei dieser Akte gespeichert ist: Antworten, Notizen, Klauseln, Dokumente, Entwürfe', surfaces: ['tui', 'app'] },
  { name: 'agent', args: '[new | edit NAME | from-chat]', en: 'make your own agent, or change one: its name, what it does, which sources it uses, where it runs', de: 'einen eigenen Agenten anlegen oder ändern: Name, Aufgabe, Quellen, wo er läuft', surfaces: ['tui', 'app'] },
  { name: 'team', args: '[parallel | debate | review] [agents…]', en: 'a panel: several agents answer at once, argue a question out, or draft and review', de: 'ein Panel: mehrere Agenten antworten gleichzeitig, streiten eine Frage aus oder entwerfen und prüfen', surfaces: ['tui', 'app'] },
  { name: 'judge', args: 'on|off', en: 'check answers with a second pass (recommended)', de: 'Antworten in einem zweiten Durchgang prüfen (empfohlen)', surfaces: ['tui', 'app'] },
  { name: 'copy', args: '', en: 'copy the last answer', de: 'die letzte Antwort kopieren', surfaces: ['tui', 'app'] },
  { name: 'save', args: '[title]', en: 'keep the last answer with the matter (Saved; in the terminal also as a file)', de: 'die letzte Antwort bei der Akte behalten (Gespeichert; im Terminal auch als Datei)', surfaces: ['tui', 'app'] },
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
