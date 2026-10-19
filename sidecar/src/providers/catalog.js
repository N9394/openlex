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

const PROVIDERS = {
  local: {
    label: 'Local (llama.cpp / Ollama)',
    kind: 'local',
    local: true,
    needsKey: false,
    ctx: null, // RAM-tier + depth preset (agent-config.js)
    defaultModel: null, // config.LLM_MODEL
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
  },
  openrouter: {
    label: 'OpenRouter',
    kind: 'openai',
    local: false,
    needsKey: true,
    baseUrl: 'https://openrouter.ai/api/v1',
    ctx: 128000,
    defaultModel: 'qwen/qwen3.5-9b',
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
  },
}

function getProvider(id) {
  const p = PROVIDERS[id]
  if (!p) throw new Error(`unknown provider: ${id}`)
  return { id, ...p }
}

module.exports = { PROVIDERS, getProvider }
