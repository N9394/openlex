"use strict"
/**
 * The cloud notice: shown once per AI service, the first time a lawyer
 * chooses a model outside this computer, and again from "About data".
 * Plain words in German and English; short on screen (title + summary),
 * the rest behind "Details". Built per service: who receives the data,
 * that retention and location settings are the providers' promises, the
 * US CLOUD Act for US companies, the BRAK guidance, and the checks under
 * § 43e BRAO, § 9 RAO and the GDPR. OpenLex is not legal advice.
 *
 *   notice(provider)       → { provider, version, en: {...}, de: {...} }
 *   seen(id) / acknowledge(id) / acks()   per service, in DATA_DIR/cloud-notice.json
 *
 * Bump VERSION when the wording changes in substance: everyone sees it again.
 */

const fs = require('fs')
const path = require('path')
const { DATA_DIR } = require('./config')

const VERSION = 1
const ACK_PATH = path.join(DATA_DIR, 'cloud-notice.json')

const pick = (v, lang) => (v && typeof v === 'object' ? v[lang] || v.en : v) || ''

function words(p, lang) {
  const de = lang === 'de'
  const name = (lang === 'de' && p.labelDe) || p.label || p.id
  const company = pick(p.company, lang) || name
  const or = p.id === 'openrouter'
  const standard = or && p.plan !== 'business'
  const eu = or && p.euProviders !== false
  const details = []
  if (or) {
    details.push(de
      ? `OpenLex stellt standardmäßig ein: Zero-Data-Retention, ${eu ? 'ausschließlich EU-Rechenzentren ' : ''}und den Ausschluss von Anbietern, die Daten speichern oder zum Training nutzen. Diese Zusagen beruhen auf Angaben der Anbieter, die OpenLex nicht überprüfen kann.`
      : `OpenLex sets by default: zero data retention, ${eu ? 'EU data centres only, ' : ''}and no providers that store your data or train on it. These are the providers' own promises; OpenLex cannot check them.`)
  } else {
    details.push(de
      ? 'Zusagen zu Speicherung und Serverstandort beruhen auf Angaben des Anbieters, die OpenLex nicht überprüfen kann.'
      : 'What the provider promises about storing your data and where its servers are is its own statement; OpenLex cannot check it.')
  }
  if (p.usParent) {
    details.push(de
      ? 'US-Unternehmen können trotz EU-Serverstandort US-Behördenzugriffen (CLOUD Act) unterliegen.'
      : 'US companies may have to give US authorities access (CLOUD Act), even when the servers are in the EU.')
  }
  if (standard) {
    details.push(de
      ? 'Bei OpenRouter ohne Business-Plan wird jede Anfrage zunächst in den USA verarbeitet.'
      : 'Without a Business plan, OpenRouter handles every request in the USA first.')
  }
  details.push(de
    ? 'Die BRAK empfiehlt, Mandatsgeheimnisse nur anonymisiert zu übermitteln und Anbieter mit Servern in Deutschland oder Europa zu bevorzugen (Hinweise zum KI-Einsatz, 12/2024).'
    : 'The German Federal Bar (BRAK) advises sending client secrets only in anonymised form and preferring providers with servers in Germany or Europe (guidance on using AI, 12/2024).')
  return {
    title: de ? 'Hinweis zur Cloud-Nutzung' : 'Before you use a cloud model',
    summary: de
      ? `Wenn Sie ${name} wählen, werden Ihre Eingaben an Dritte übermittelt: ${company}. OpenLex leistet keine Rechtsberatung. Für die Einhaltung Ihrer berufs- und datenschutzrechtlichen Pflichten bleiben Sie verantwortlich.`
      : `If you choose ${name}, what you type and send goes to others: ${company}. OpenLex is not legal advice. You remain responsible for your professional and data-protection duties.`,
    usGateway: standard
      ? (de ? 'Anfragen laufen über die USA. Nur für anonymisierte oder öffentlich-rechtliche Recherche verwenden.' : 'Requests pass through the US. Use only for anonymised or public-law work.')
      : null,
    details,
    checksIntro: de
      ? 'Bevor Sie mandatsbezogene Informationen übermitteln, prüfen Sie bitte eigenverantwortlich:'
      : 'Before you send anything about a client matter, please check for yourself:',
    checks: de
      ? [
        'die Voraussetzungen des § 43e BRAO: Vertrag in Textform mit Verschwiegenheitsverpflichtung, vergleichbares Schutzniveau im Ausland, gegebenenfalls Einwilligung des Mandanten nach Abs. 5;',
        'in Österreich § 9 RAO;',
        'die DSGVO: Auftragsverarbeitung und Drittlandübermittlung.',
      ]
      : [
        'in Germany, § 43e BRAO: a contract in text form with a duty of confidentiality, comparable protection abroad, and the client\'s consent where para. 5 requires it;',
        'in Austria, § 9 RAO;',
        'the GDPR: a data processing agreement, and any transfer outside the EU.',
      ],
    closing: de
      ? 'Für höchste Vertraulichkeit nutzen Sie ein lokales Modell oder einen EU-Anbieter ohne US-Mutterkonzern.'
      : 'For the highest confidentiality, use a model on this computer or an EU provider without a US parent company.',
    accept: de ? `Verstanden – ${name} verwenden` : `I understand – use ${name}`,
  }
}

/** The notice for one resolved provider (providers/settings.resolve). Null for local ones. */
function notice(p) {
  if (!p || p.local) return null
  return { provider: p.id, version: VERSION, en: words(p, 'en'), de: words(p, 'de') }
}

function acks() {
  try {
    const j = JSON.parse(fs.readFileSync(ACK_PATH, 'utf8'))
    return j && typeof j.acks === 'object' && j.acks ? j.acks : {}
  } catch { return {} }
}

function seen(id) {
  const a = acks()[id]
  return !!a && a.version >= VERSION
}

function acknowledge(id) {
  if (!/^[a-z0-9_-]{1,40}$/.test(String(id || ''))) throw new Error(`unknown provider: ${id}`)
  const all = acks()
  all[id] = { at: new Date().toISOString(), version: VERSION }
  fs.mkdirSync(path.dirname(ACK_PATH), { recursive: true })
  fs.writeFileSync(ACK_PATH, JSON.stringify({ acks: all }, null, 2))
  return all[id]
}

module.exports = { notice, seen, acknowledge, acks, VERSION, ACK_PATH }
