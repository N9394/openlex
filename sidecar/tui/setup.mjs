/**
 * Setup: where the AI runs, the key (kept in the computer's own keychain),
 * and whether client documents may be sent to it. Opens on first run when
 * nothing is set up; also reachable from Settings. The most private answer
 * is always the first one.
 */

import fs from 'node:fs'
import { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { html, Frame, Menu, TextField, Field, Spinner, Note, sym } from './ui.mjs'
import { useAppCtx } from './context.mjs'
import { nameOf, log, friendly } from './api.mjs'
import { cleanPath } from './paths.mjs'

const KEY_SERVICES = [
  { value: 'anthropic', label: 'Anthropic (Claude)', hint: 'Key from console.anthropic.com → API keys' },
  { value: 'openai', label: 'OpenAI', hint: 'Key from platform.openai.com → API keys' },
  { value: 'mistral', label: 'Mistral (hosted in the EU)', hint: 'Key from console.mistral.ai → API keys' },
  { value: 'openrouter', label: 'OpenRouter (many models, one key)', hint: 'Key from openrouter.ai → Keys' },
]
const FIRM_CLOUDS = [
  { value: 'azure', label: 'Azure OpenAI (your firm\'s Microsoft tenant)', hint: 'Needs the address of your deployment and its key' },
  { value: 'bedrock', label: 'AWS Bedrock (your firm\'s Amazon account)', hint: 'Needs a Bedrock key and the region (Frankfurt by default)' },
  { value: 'vertex', label: 'Google Vertex AI (your firm\'s Google Cloud project)', hint: 'Needs the project name; a service-account key file is optional' },
]

/** The questions asked for each kind of AI service, one per page. */
function fieldsFor(id) {
  const key = { id: 'key', label: 'Your key', help: 'Paste it here (it stays hidden). It is stored in this computer\'s keychain, never in a file.', mask: true }
  if (id === 'azure') {
    return [
      { id: 'baseUrl', label: 'Address of your Azure OpenAI deployment', help: 'Looks like https://NAME.openai.azure.com/openai/deployments/DEPLOYMENT — your IT team has it.' },
      key,
    ]
  }
  if (id === 'bedrock') {
    return [
      { id: 'region', label: 'Region', help: 'Where the AI runs. eu-central-1 is Frankfurt.', initial: 'eu-central-1' },
      { ...key, help: 'A Bedrock API key, or ACCESS_KEY_ID:SECRET_ACCESS_KEY. Stored in this computer\'s keychain.' },
    ]
  }
  if (id === 'vertex') {
    return [
      { id: 'project', label: 'Google Cloud project name (ID)', help: 'Your IT team has it.' },
      { id: 'region', label: 'Region', help: 'europe-west1 is Belgium, europe-west3 is Frankfurt.', initial: 'europe-west1' },
      { id: 'keyFile', label: 'Service-account key file (optional)', help: 'Drag the .json file here, or leave empty to use the Google Cloud login on this computer.', optional: true, path: true },
    ]
  }
  if (id === 'custom') {
    return [
      { id: 'baseUrl', label: 'Address of the server', help: 'For example https://ai.yourfirm.example/v1 — your IT team has it.' },
      { id: 'model', label: 'Name of the AI model on that server', help: 'As your IT team calls it, for example llama-3.3-70b.', optional: true },
      { id: 'inside', label: 'Is this server run by your firm, inside the firm?', yesno: true, help: 'Answer Yes only if documents sent to it never leave the firm.' },
      { ...key, label: 'Key (optional)', optional: true },
    ]
  }
  if (id === 'local-server') {
    return [
      { id: 'baseUrl', label: 'Address of the AI program on this computer', help: 'Ollama: http://127.0.0.1:11434/v1 · LM Studio: http://127.0.0.1:1234/v1', initial: 'http://127.0.0.1:11434/v1' },
      { id: 'model', label: 'Name of the model', help: 'As shown by Ollama or LM Studio, for example qwen3:14b.' },
    ]
  }
  return [key]
}

const RULES = [
  { value: 'none', label: 'No — keep everything on this computer', hint: 'Most private. Questions about client documents need the AI on this computer.' },
  { value: 'matters', label: 'Only for matters I choose', hint: 'Nothing is sent until you allow it for a matter (asked when you create one).' },
  { value: 'all', label: 'Yes, for all matters', hint: 'Privileged matters still stay on this computer.' },
]

export function Setup({ firstRun = false, dataOnly = false }) {
  const ctx = useAppCtx()
  const [step, setStep] = useState(dataOnly ? 'data' : 'where')
  const [service, setService] = useState(dataOnly ? ctx.info.providers?.active : null) // provider id
  const [fieldIdx, setFieldIdx] = useState(0)
  const [values, setValues] = useState({})
  const [input, setInput] = useState('')
  const [rule, setRule] = useState(null)
  const [extras, setExtras] = useState({ eu: false, redact: false })
  const [busy, setBusy] = useState('')
  const [result, setResult] = useState(null) // { ok, text, warn? }
  const [localState, setLocalState] = useState(null)

  const finish = async () => {
    ctx.setPrefs({ setupDone: true })
    await ctx.refresh().catch(() => {})
    if (firstRun) ctx.replace('home')
    else ctx.back()
  }

  const fields = service ? fieldsFor(service) : []
  const field = fields[fieldIdx]
  const label = service === 'local-server' ? 'the AI on this computer' : nameOf(service)

  useInput((_, key) => {
    if (!key.escape || busy) return
    if (dataOnly || step === 'where') return firstRun ? finish() : ctx.back()
    if (step === 'field' && fieldIdx > 0) { setFieldIdx(fieldIdx - 1); return setInput(values[fields[fieldIdx - 1].id] || '') }
    setStep('where')
  })

  // ── step: where should the AI run? ──
  const where = [
    { value: 'local', label: 'On this computer', hint: 'Most private; needs a capable machine (16 GB memory or more).' },
    { value: 'key', label: 'With my own key', hint: 'Anthropic, OpenAI, Mistral, OpenRouter …' },
    { value: 'cloud', label: 'With my firm\'s cloud account', hint: 'Azure OpenAI, AWS Bedrock, Google Vertex' },
    { value: 'custom', label: 'Another server my firm runs (OpenAI-compatible)', hint: 'For example a firm gateway or an on-premises server' },
    ...(firstRun ? [{ value: 'skip', label: 'Skip for now', hint: 'You can set this up any time in Settings.' }] : []),
  ]

  const startFields = (id) => { setService(id); setFieldIdx(0); setValues({}); setInput(fieldsFor(id)[0].initial || ''); setStep('field') }

  const chooseWhere = async (it) => {
    if (it.value === 'skip') return finish()
    if (it.value === 'key') return setStep('pickKey')
    if (it.value === 'cloud') return setStep('pickCloud')
    if (it.value === 'custom') return startFields('custom')
    // On this computer: switch to it and look at what is installed.
    setService('local')
    setStep('local')
    setBusy('Checking the AI on this computer…')
    try {
      await ctx.api.useProvider('local')
      const st = await ctx.api.status()
      setLocalState(st)
    } catch (err) { setLocalState({ error: err.message }) }
    setBusy('')
  }

  const submitField = (raw) => {
    let v = String(raw || '').trim()
    if (field.path && v) v = cleanPath(v)
    if (!v && !field.optional && !field.yesno) return
    const next = { ...values, [field.id]: v }
    setValues(next)
    if (fieldIdx + 1 < fields.length) { setFieldIdx(fieldIdx + 1); setInput(fields[fieldIdx + 1].initial || ''); return }
    save(next)
  }

  const save = async (v) => {
    setStep('saving')
    setBusy('Saving…')
    try {
      const id = service === 'local-server' ? 'local' : service
      const overrides = {}
      for (const k of ['baseUrl', 'model', 'region', 'project']) if (v[k]) overrides[k] = v[k]
      if (service === 'custom') overrides.local = v.inside === 'yes'
      await ctx.api.useProvider(id, overrides)
      let key = v.key
      if (v.keyFile) key = fs.readFileSync(v.keyFile, 'utf8')
      if (key) await ctx.api.saveKey(id, key)
      await ctx.refresh()
      setBusy('')
      // Nothing leaves the computer for the local AI or a server inside the firm.
      if (service === 'local-server' || (service === 'custom' && v.inside === 'yes')) return test(null)
      setStep('data')
    } catch (err) {
      log('setup save failed:', err)
      setBusy('')
      setResult({ ok: false, text: err.message })
      setStep('result')
    }
  }

  const saveRule = async (choice, ex) => {
    setStep('testing')
    setBusy('Saving your choice…')
    try {
      const allow = { mode: 'allow-list', providers: [service], ...(ex.eu ? { regions: ['eu'] } : {}), ...(ex.redact ? { redact: true } : {}) }
      if (choice === 'all') await ctx.api.setPolicy(allow)
      else await ctx.api.setPolicy({ mode: 'local-only' })
      // "Only for matters I choose": remembered here; New matter asks and sets it per matter.
      ctx.setPrefs({ cloudForMatters: choice === 'matters' ? allow : null })
      await ctx.refresh()
    } catch (err) {
      setBusy('')
      setResult({ ok: false, text: err.message })
      return setStep('result')
    }
    test(choice)
  }

  const test = async (choice) => {
    setStep('testing')
    setBusy('Checking that the AI answers…')
    const id = service === 'local-server' ? 'local' : service
    try {
      const r = await ctx.api.testProvider(id)
      if (r.ok) setResult({ ok: true, text: `${service === 'local-server' || service === 'local' ? 'The AI on this computer' : nameOf(id)} answered. Everything is ready.` })
      else if (r.code === 'POLICY_BLOCKED' && choice !== 'all') setResult({ ok: true, text: 'Saved. Your key will be checked the first time you use it on a matter you allow.' })
      else setResult({ ok: false, text: friendly(r.error || 'the test did not work') })
    } catch (err) { setResult({ ok: false, text: err.message }) }
    const prov = ctx.info.providers?.providers?.find((p) => p.id === id)
    setResult((r) => (r && extras.eu && prov && !prov.local && !/^(eu|europe)/i.test(prov.region || '') ? { ...r, warn: `${nameOf(id)} has no EU region set, so "EU data centres only" will block it. Mistral, or your firm's Azure/AWS/Google account in an EU region, keep data in the EU.` } : r))
    setBusy('')
    setStep('result')
  }

  const status = ctx.status()
  const keys = step === 'field' ? `Enter continue ${sym.sep} Esc back ${sym.sep} Ctrl+C quit` : undefined
  let body = null

  if (busy) body = html`<${Spinner} label=${busy} />`
  else if (step === 'where') {
    body = html`<${Box} flexDirection="column">
      ${firstRun ? html`<${Text} wrap="wrap">Welcome to OpenLex. Two questions and you are ready.<//>` : null}
      <${Text} bold>Where should the AI run?<//>
      <${Box} marginTop=${1}><${Menu} items=${where} onSelect=${chooseWhere} describe />
      <//>
    <//>`
  } else if (step === 'pickKey' || step === 'pickCloud') {
    body = html`<${Box} flexDirection="column">
      <${Text} bold>${step === 'pickKey' ? 'Which service is your key from?' : 'Which cloud account does your firm use?'}<//>
      <${Box} marginTop=${1}><${Menu} items=${step === 'pickKey' ? KEY_SERVICES : FIRM_CLOUDS} onSelect=${(it) => startFields(it.value)} describe /><//>
    <//>`
  } else if (step === 'field' && field) {
    body = field.yesno
      ? html`<${Field} label=${field.label} help=${field.help}>
          <${Menu} items=${[{ value: 'no', label: 'No (or not sure)' }, { value: 'yes', label: 'Yes, it runs inside the firm' }]} onSelect=${(it) => submitField(it.value)} />
        <//>`
      : html`<${Box} flexDirection="column">
          <${Text} dimColor>${label} ${sym.sep} step ${fieldIdx + 1} of ${fields.length}<//>
          <${Box} marginTop=${1}>
            <${Field} label=${field.label} help=${field.help}>
              <${TextField} key=${field.id} value=${input} onChange=${setInput} onSubmit=${submitField} mask=${!!field.mask} placeholder=${field.optional ? '(optional — Enter to skip)' : ''} />
            <//>
          <//>
        <//>`
  } else if (step === 'data') {
    body = html`<${Box} flexDirection="column">
      <${Text} bold wrap="wrap">May client documents be sent to ${label}?<//>
      <${Text} dimColor wrap="wrap">This decides what leaves this computer. You can change it any time in Settings.<//>
      <${Box} marginTop=${1}><${Menu} items=${RULES} describe onSelect=${(it) => { setRule(it.value); if (it.value === 'none') saveRule('none', extras); else setStep('extras') }} /><//>
    <//>`
  } else if (step === 'extras') {
    const items = [
      { value: 'eu', label: `${extras.eu ? sym.on : sym.off} EU data centres only`, hint: 'Block the AI if it would run outside the EU.' },
      { value: 'redact', label: `${extras.redact ? sym.on : sym.off} Hide client names before sending`, hint: 'Names you list for a matter are replaced by placeholders and put back in the answer.' },
      { value: 'go', label: 'Continue' },
    ]
    body = html`<${Box} flexDirection="column">
      <${Text} bold>Extra safeguards (Enter switches them on or off)<//>
      <${Box} marginTop=${1}><${Menu} items=${items} describe initial=${2} onSelect=${(it) => (it.value === 'go' ? saveRule(rule, extras) : setExtras({ ...extras, [it.value]: !extras[it.value] }))} /><//>
    <//>`
  } else if (step === 'local') {
    const ready = localState?.model?.loaded
    const options = [
      { value: 'done', label: ready ? 'Continue' : 'Continue without an AI for now' },
      { value: 'server', label: 'Use Ollama or LM Studio on this computer', hint: 'If you already run one of them' },
      { value: 'back', label: 'Choose a different way' },
    ]
    body = html`<${Box} flexDirection="column">
      ${ready
        ? html`<${Note} kind="ok">The AI on this computer is ready (${localState.model.name}). Nothing leaves this computer.<//>`
        : html`<${Box} flexDirection="column">
            <${Note} kind="warn">No AI model is installed on this computer yet.<//>
            <${Text} wrap="wrap">It is a large download (several GB), so OpenLex does not fetch it by itself. Two ways to get one:<//>
            <${Text} wrap="wrap">  1. Install the OpenLex desktop app and download the model in its Settings.<//>
            <${Text} wrap="wrap">  2. If you already use Ollama or LM Studio, choose it below.<//>
          <//>`}
      <${Box} marginTop=${1}><${Menu} items=${options} onSelect=${(it) => (it.value === 'done' ? finish() : it.value === 'server' ? startFields('local-server') : setStep('where'))} /><//>
    <//>`
  } else if (step === 'result' && result) {
    const options = result.ok
      ? [{ value: 'done', label: 'Done' }]
      : [{ value: 'retry', label: 'Try again' }, { value: 'fields', label: 'Change what I entered' }, { value: 'where', label: 'Choose a different way' }, { value: 'done', label: 'Leave it for now' }]
    body = html`<${Box} flexDirection="column">
      <${Note} kind=${result.ok ? 'ok' : 'bad'}>${result.text}<//>
      ${result.warn ? html`<${Note} kind="warn">${result.warn}<//>` : null}
      <${Box} marginTop=${1}><${Menu} items=${options} onSelect=${(it) => {
        if (it.value === 'done') return finish()
        if (it.value === 'retry') return test(rule)
        if (it.value === 'fields') return startFields(service)
        setStep('where')
      }} /><//>
    <//>`
  }
  return html`<${Frame} title=${firstRun ? 'Getting started' : 'Set up the AI'} status=${status} keys=${keys}>${body}<//>`
}

export { fieldsFor }
