"use strict"
/**
 * Provider catalog — every model backend OpenLex can talk to.
 *
 * `kind` picks the wire protocol:
 *   local      — llama.cpp / Ollama on LLM_BASE (providers/local.js)
 *   openai     — OpenAI-compatible /chat/completions (providers/openai.js)
 *   azure      — Azure OpenAI deployment URL + api-key header (openai.js)
 *   anthropic  — Anthropic Messages API (providers/anthropic.js)
 *
 * `local: true` means data never leaves the machine — the only kind the
 * default `local-only` data policy allows. `ctx` is the context window the
 * agent may budget against; `needsKey` gates the key prompt in the pane.
 *   bedrock    — AWS Bedrock Converse API, SigV4 or Bedrock API key (bedrock.js)
 *   vertex     — Google Vertex AI: Claude (rawPredict) or Gemini (OpenAI-
 *                compatible endpoint), service-account key or gcloud login
 *
 * `region` pins where the data is processed (EU defaults); it is part of
 * the audit entry and shown in the pane.
 */

// The order below is the order the picker shows (recommended first):
//   local       on this computer — the only option without third-party disclosure
//   eu          EU providers without a US parent (OpenAI-compatible base URLs)
//   firm-cloud  big models through the firm's own cloud account, EU region
//   gateway     OpenRouter, strict preset (ZDR, no data collection, no fallbacks)
//   direct      the model makers' own APIs (US companies)
//   other       a server the firm names itself
// `about` is the one plain line under each choice (English and German; the
// windows fall back to English). `company` names who receives the data
// (the cloud notice, cloud_notice.js); `usParent` marks US companies
// (CLOUD Act exposure even in an EU region).
const PROVIDERS = {
  local: {
    label: 'Local (llama.cpp / Ollama)',
    kind: 'local',
    local: true,
    needsKey: false,
    ctx: null, // RAM-tier + depth preset (agent-config.js)
    defaultModel: null, // config.LLM_MODEL
    group: 'local',
    about: { en: 'OpenLex\'s own AI on this computer. Nothing leaves it.', de: 'Die KI von OpenLex auf diesem Computer. Nichts verlässt ihn.' },
  },
  'local-server': {
    // An AI program the lawyer runs on this computer: Ollama (default
    // address) or llama.cpp's llama-server (http://127.0.0.1:8080/v1).
    // Loopback only — settings.js refuses any other host for it.
    label: 'Ollama or llama.cpp on this computer',
    kind: 'openai',
    local: true,
    needsKey: false,
    baseUrl: 'http://127.0.0.1:11434/v1',
    ctx: 8192,
    defaultModel: null, // the model pulled or named in the picker
    group: 'local',
    about: { en: 'An AI program you run on this computer (Ollama or llama.cpp). Nothing leaves it.', de: 'Ein KI-Programm auf diesem Computer (Ollama oder llama.cpp). Nichts verlässt ihn.' },
  },
  mistral: {
    label: 'Mistral (EU)',
    kind: 'openai',
    local: false,
    needsKey: true,
    baseUrl: 'https://api.mistral.ai/v1',
    region: 'eu', // La Plateforme is hosted in the EU
    ctx: 128000,
    defaultModel: 'mistral-large-latest',
    group: 'eu',
    company: { en: 'Mistral AI (France)', de: 'Mistral AI (Frankreich)' },
    keyHelp: { en: 'Key from console.mistral.ai → API keys', de: 'Schlüssel unter console.mistral.ai → API keys' },
    about: { en: 'French company, EU data centres. Ask Mistral to switch on zero data retention.', de: 'Französisches Unternehmen, Rechenzentren in der EU. Zero-Data-Retention bei Mistral beantragen.' },
  },
  // https://www.scaleway.com/en/docs/generative-apis/quickstart/ (base_url)
  scaleway: {
    label: 'Scaleway (France)',
    kind: 'openai',
    local: false,
    needsKey: true,
    baseUrl: 'https://api.scaleway.ai/v1',
    region: 'eu-fr', // Paris
    ctx: 128000,
    defaultModel: 'gpt-oss-120b',
    group: 'eu',
    company: { en: 'Scaleway (France)', de: 'Scaleway (Frankreich)' },
    keyHelp: { en: 'Key from console.scaleway.com → IAM → API keys', de: 'Schlüssel unter console.scaleway.com → IAM → API-Schlüssel' },
    about: { en: 'French company without a US parent, data centres in Paris. Keeps no prompts by default.', de: 'Französisches Unternehmen ohne US-Mutterkonzern, Rechenzentren in Paris. Speichert Eingaben standardmäßig nicht.' },
  },
  // https://www.ovhcloud.com/en/public-cloud/ai-endpoints/catalog/ (OpenAI-compatible endpoint)
  ovhcloud: {
    label: 'OVHcloud AI Endpoints (France)',
    kind: 'openai',
    local: false,
    needsKey: true,
    baseUrl: 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1',
    region: 'eu-fr',
    ctx: 128000,
    defaultModel: 'gpt-oss-120b',
    group: 'eu',
    company: { en: 'OVHcloud (France)', de: 'OVHcloud (Frankreich)' },
    keyHelp: { en: 'Key from the OVHcloud Control Panel → Public Cloud → AI Endpoints → API keys', de: 'Schlüssel im OVHcloud Control Panel → Public Cloud → AI Endpoints → API keys' },
    about: { en: 'French company without a US parent, EU data centres. Keeps only billing data.', de: 'Französisches Unternehmen ohne US-Mutterkonzern, Rechenzentren in der EU. Speichert nur Abrechnungsdaten.' },
  },
  // https://docs.stackit.cloud/products/data-and-ai/ai-model-serving/basics/available-shared-models/
  stackit: {
    label: 'STACKIT (Germany)',
    kind: 'openai',
    local: false,
    needsKey: true,
    baseUrl: 'https://api.openai-compat.model-serving.eu01.onstackit.cloud/v1',
    region: 'eu-de',
    ctx: 128000,
    defaultModel: 'openai/gpt-oss-120b',
    group: 'eu',
    company: { en: 'STACKIT (Germany)', de: 'STACKIT (Deutschland)' },
    keyHelp: { en: 'An AI Model Serving token from the STACKIT portal', de: 'Ein Token für AI Model Serving aus dem STACKIT-Portal' },
    about: { en: 'German company (Schwarz group), servers in Germany. Stores no request data.', de: 'Deutsches Unternehmen (Schwarz-Gruppe), Server in Deutschland. Speichert keine Anfragedaten.' },
  },
  // https://docs.ionos.com/cloud/ai/ai-model-hub/how-tos/text-generation
  ionos: {
    label: 'IONOS AI Model Hub (Germany)',
    kind: 'openai',
    local: false,
    needsKey: true,
    baseUrl: 'https://openai.inference.de-txl.ionos.com/v1',
    region: 'eu-de', // Berlin
    ctx: 128000,
    defaultModel: 'openai/gpt-oss-120b',
    group: 'eu',
    company: { en: 'IONOS (Germany)', de: 'IONOS (Deutschland)' },
    keyHelp: { en: 'An API token from the IONOS Data Center Designer (Token Manager)', de: 'Ein API-Token aus dem IONOS Data Center Designer (Token Manager)' },
    about: { en: 'German company (United Internet), servers in Germany. Ask IONOS how long it keeps requests.', de: 'Deutsches Unternehmen (United Internet), Server in Deutschland. Fragen Sie IONOS, wie lange Anfragen gespeichert werden.' },
  },
  azure: {
    label: 'Azure OpenAI (your tenant)',
    kind: 'azure',
    local: false,
    needsKey: true,
    // https://<resource>.openai.azure.com/openai/deployments/<deployment>
    baseUrl: null,
    apiVersion: '2024-10-21',
    ctx: 128000,
    defaultModel: null, // deployment decides the model
    maxTokensField: 'max_completion_tokens',
    group: 'firm-cloud',
    usParent: true,
    company: { en: 'Microsoft, through your firm\'s Azure account', de: 'Microsoft, über das Azure-Konto Ihrer Kanzlei' },
    about: { en: 'GPT in your firm\'s own Microsoft account; choose a deployment in the EU Data Zone. US company.', de: 'GPT im eigenen Microsoft-Konto Ihrer Kanzlei; Bereitstellung in der EU-Datenzone wählen. US-Unternehmen.' },
  },
  bedrock: {
    label: 'AWS Bedrock (your account)',
    kind: 'bedrock',
    local: false,
    needsKey: true,
    baseUrl: null, // https://bedrock-runtime.<region>.amazonaws.com
    region: 'eu-central-1',
    ctx: 200000,
    defaultModel: 'eu.anthropic.claude-sonnet-4-5-20250929-v1:0',
    group: 'firm-cloud',
    usParent: true,
    company: { en: 'Amazon Web Services, through your firm\'s AWS account', de: 'Amazon Web Services, über das AWS-Konto Ihrer Kanzlei' },
    about: { en: 'Claude in your firm\'s own AWS account, EU region (Frankfurt by default). US company.', de: 'Claude im eigenen AWS-Konto Ihrer Kanzlei, EU-Region (standardmäßig Frankfurt). US-Unternehmen.' },
  },
  vertex: {
    label: 'Google Vertex AI (your project)',
    kind: 'vertex',
    local: false,
    // Service-account JSON in the keychain, or the local gcloud login.
    needsKey: false,
    baseUrl: null,
    region: 'europe-west1',
    project: null,
    ctx: 200000,
    defaultModel: 'claude-sonnet-4-5@20250929',
    group: 'firm-cloud',
    usParent: true,
    company: { en: 'Google, through your firm\'s Google Cloud project', de: 'Google, über das Google-Cloud-Projekt Ihrer Kanzlei' },
    about: { en: 'Gemini or Claude in your firm\'s own Google Cloud project, EU region. US company.', de: 'Gemini oder Claude im eigenen Google-Cloud-Projekt Ihrer Kanzlei, EU-Region. US-Unternehmen.' },
  },
  openrouter: {
    // Strict preset (providers/openai.js): zero data retention, no data
    // collection, EU model hosts only, no fallbacks. `plan: 'business'`
    // switches to the EU gateway (settings.resolve).
    label: 'OpenRouter',
    kind: 'openai',
    local: false,
    needsKey: true,
    baseUrl: 'https://openrouter.ai/api/v1',
    euBaseUrl: 'https://eu.openrouter.ai/api/v1',
    ctx: 128000,
    defaultModel: 'anthropic/claude-sonnet-4.5',
    group: 'gateway',
    usParent: true,
    company: { en: 'OpenRouter, Inc. (New York, USA) as the go-between, and the company that runs the model (e.g. AWS, Google, Microsoft, Mistral)', de: 'OpenRouter, Inc. (New York, USA) als Vermittler und der jeweilige Modellanbieter (z. B. AWS, Google, Microsoft, Mistral)' },
    keyHelp: { en: 'Key from openrouter.ai → Keys', de: 'Schlüssel unter openrouter.ai → Keys' },
    about: { en: 'Many models with one key, with strict settings: zero data retention, no data collection, no fallbacks. US company.', de: 'Viele Modelle mit einem Schlüssel, streng eingestellt: Zero-Data-Retention, keine Datensammlung, keine Ausweichanbieter. US-Unternehmen.' },
  },
  anthropic: {
    label: 'Anthropic (Claude)',
    kind: 'anthropic',
    local: false,
    needsKey: true,
    baseUrl: 'https://api.anthropic.com',
    ctx: 200000,
    defaultModel: 'claude-sonnet-5-5',
    models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5-20251001'],
    group: 'direct',
    usParent: true,
    company: { en: 'Anthropic (USA)', de: 'Anthropic (USA)' },
    keyHelp: { en: 'Key from console.anthropic.com → API keys', de: 'Schlüssel unter console.anthropic.com → API keys' },
    about: { en: 'Claude directly from Anthropic. US company; data is not kept in the EU.', de: 'Claude direkt von Anthropic. US-Unternehmen; Daten bleiben nicht in der EU.' },
  },
  openai: {
    label: 'OpenAI',
    kind: 'openai',
    local: false,
    needsKey: true,
    baseUrl: 'https://api.openai.com/v1',
    ctx: 128000,
    defaultModel: 'gpt-5.1',
    // Official OpenAI rejects max_tokens on reasoning models.
    maxTokensField: 'max_completion_tokens',
    group: 'direct',
    usParent: true,
    company: { en: 'OpenAI (USA)', de: 'OpenAI (USA)' },
    keyHelp: { en: 'Key from platform.openai.com → API keys', de: 'Schlüssel unter platform.openai.com → API keys' },
    about: { en: 'GPT directly from OpenAI. US company.', de: 'GPT direkt von OpenAI. US-Unternehmen.' },
  },
  custom: {
    label: 'Custom OpenAI-compatible endpoint',
    kind: 'openai',
    // A firm gateway may be on-prem (vLLM, LM Studio, LiteLLM) or cloud —
    // the user declares which in Settings; default to NOT local so the
    // local-only policy blocks it until they say otherwise.
    local: false,
    needsKey: false,
    baseUrl: null,
    ctx: 32768,
    defaultModel: null,
    group: 'other',
    company: { en: 'the server you entered', de: 'der Server, den Sie eingetragen haben' },
    about: { en: 'A server your firm runs or chooses (OpenAI-compatible).', de: 'Ein Server, den Ihre Kanzlei betreibt oder auswählt (OpenAI-kompatibel).' },
  },
}

/** The picker's sections, in the recommended order. */
const GROUPS = ['local', 'eu', 'firm-cloud', 'gateway', 'direct', 'other']

function getProvider(id) {
  const p = PROVIDERS[id]
  if (!p) throw new Error(`unknown provider: ${id}`)
  return { id, ...p }
}

module.exports = { PROVIDERS, GROUPS, getProvider }
