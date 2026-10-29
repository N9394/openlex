"use strict"
/**
 * The model label every window shows above (or next to) the question
 * field: which AI and where it runs, in a few words, never a raw model id.
 *
 *   "On this computer · Qwen3 8B"     "Claude · AWS Bedrock (EU)"
 *   "Mistral (EU)"                    "Claude · OpenRouter (via the USA)"
 *
 *   label(provider, { localModel })  → { en, de, local, viaUs }
 *   prettyModel('qwen3:8b')          → 'Qwen3 8B'
 */

const SERVICE = {
  mistral: 'Mistral', scaleway: 'Scaleway', ovhcloud: 'OVHcloud', stackit: 'STACKIT', ionos: 'IONOS',
  azure: 'Azure OpenAI', bedrock: 'AWS Bedrock', vertex: 'Google Vertex', openrouter: 'OpenRouter',
  anthropic: 'Anthropic', openai: 'OpenAI',
}
const FAMILIES = [
  [/gpt-oss/i, 'GPT-OSS'], [/claude|anthropic/i, 'Claude'], [/gpt|^(openai\/)?o\d/i, 'GPT'],
  [/mistral|mixtral|magistral|codestral/i, 'Mistral'], [/gemini/i, 'Gemini'], [/gemma/i, 'Gemma'],
  [/llama/i, 'Llama'], [/qwen/i, 'Qwen'], [/deepseek/i, 'DeepSeek'],
]
const isEu = (r) => /^(eu|europe)/i.test(String(r || ''))

/** A model id in words: 'qwen3:8b' → 'Qwen3 8B', 'lotus-2-reasoning-q4_k_m' → 'Lotus 2'. */
function prettyModel(id) {
  let s = String(id || '').trim()
  if (!s) return ''
  s = s.replace(/^.*\//, '').replace(/:latest$/i, '')
  if (/^lotus/i.test(s)) { const v = /^lotus[-_ ]?(\d+)(?![\d.]*b)/i.exec(s); return v ? `Lotus ${v[1]}` : 'Lotus' }
  s = s.replace(/[-_.:](gguf|q\d|fp\d|bf16|int\d|awq|gptq|instruct|it\b|dynamic).*$/i, '')
  s = s.replace(/[:_-]+/g, ' ').replace(/\b(\d+(?:\.\d+)?)b\b/gi, '$1B').replace(/\s+/g, ' ').trim()
  s = s.replace(/^gpt oss\b/i, 'GPT-OSS')
  return s.replace(/(^|\s)([a-z])/g, (_, sp, c) => sp + c.toUpperCase())
}

function family(model) {
  const hit = FAMILIES.find(([re]) => re.test(String(model || '')))
  return hit ? hit[1] : ''
}

/** The label for a resolved provider (settings.resolve). */
function label(p, { localModel = null } = {}) {
  if (!p) return { en: 'Not set up yet', de: 'Noch nicht eingerichtet', local: true, viaUs: false }
  if (p.local) {
    const m = prettyModel(p.kind === 'local' ? localModel : (p.model || localModel))
    return { en: `On this computer${m ? ` · ${m}` : ''}`, de: `Auf diesem Computer${m ? ` · ${m}` : ''}`, local: true, viaUs: false }
  }
  if (p.id === 'custom') {
    const m = prettyModel(p.model)
    return { en: `Your firm's server${m ? ` · ${m}` : ''}`, de: `Server Ihrer Kanzlei${m ? ` · ${m}` : ''}`, local: false, viaUs: false }
  }
  const service = SERVICE[p.id] || p.label || p.id
  const fam = p.id === 'anthropic' ? 'Claude' : family(p.model)
  const viaUs = p.id === 'openrouter' && p.plan !== 'business'
  const where = viaUs ? { en: ' (via the USA)', de: ' (über die USA)' } : isEu(p.region) ? { en: ' (EU)', de: ' (EU)' } : /^us/i.test(String(p.region || '')) ? { en: ' (USA)', de: ' (USA)' } : { en: '', de: '' }
  const head = fam && fam !== service ? `${fam} · ${service}` : service
  return { en: `${head}${where.en}`, de: `${head}${where.de}`, local: false, viaUs }
}

module.exports = { label, prettyModel, family }
