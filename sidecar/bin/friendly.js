"use strict"
/**
 * Whatever went wrong, in a lawyer's words — in three parts: what
 * happened, why (as far as we can tell), what to do. Shared by the
 * terminal app (tui/api.mjs) and the plain CLI (bin/openlex.js): no stack
 * traces, no error codes, no engine jargon on screen. The raw message goes
 * to the log (and behind "show details").
 */

const RULES = [
  [/Blocked by data policy|POLICY_BLOCKED|local-only|not on the allow-list/i, {
    what: 'Your client-data rule does not allow sending this to the AI service.',
    why: 'The rule keeps client documents on this computer, or allows other services only.',
    todo: 'Change it in Settings → Where client data may go, or use the AI on this computer.',
  }],
  [/outside the approved regions|no pinned region/i, {
    what: 'This AI service is not in an approved region (EU only).',
    why: 'Your client-data rule allows EU data centres only.',
    todo: 'Pick an EU service in Settings, or change the client-data rule.',
  }],
  [/no API key|NO_KEY|no AWS credentials/i, {
    what: 'There is no key for this AI service yet.',
    why: 'An online AI service needs a key from your account with it.',
    todo: 'Add it in Settings → Which AI.',
  }],
  [/401|403|invalid.*key|unauthori[sz]ed|authentication|permission denied/i, {
    what: 'The AI service did not accept your key.',
    why: 'The key may be incomplete, expired or for another service.',
    todo: 'Check the key in Settings → Which AI (copy it again from your account page).',
  }],
  [/429|rate limit|quota|insufficient/i, {
    what: 'The AI service says the account has reached its limit.',
    why: 'Too many requests in a short time, or the plan is used up.',
    todo: 'Try again in a minute, or check your plan with the provider of your key.',
  }],
  [/cannot reach the engine|engine is not running|registry is stale|did not start/i, {
    what: 'OpenLex is not running in the background.',
    why: 'It may have stopped or not started yet.',
    todo: 'Restart this app; if it keeps happening, see the log file.',
  }],
  [/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|timed? ?out|network|socket hang up|fetch failed/i, {
    what: 'The AI service could not be reached.',
    why: 'The internet connection may be off, or the firm server may not be running.',
    todo: 'Check the connection and try again.',
  }],
  [/model not installed|local engine unavailable/i, {
    what: 'No AI model is installed on this computer yet.',
    why: 'The AI on this computer needs a one-time download.',
    todo: 'Choose Settings → Which AI to set one up (or use your own key).',
  }],
  [/model unavailable|not loaded|no model|llama/i, {
    what: 'The AI is not ready.',
    why: 'It is still starting, or it has not been set up.',
    todo: 'Open Settings → Which AI to set it up.',
  }],
  [/home folder|whole computer|folderConfirmed/i, {
    what: 'That folder is too broad to work in.',
    why: 'It is your whole home folder or the whole computer.',
    todo: 'Choose the folder of one client or matter (/folder), or confirm it when asked.',
  }],
  [/not a folder|ENOENT|no such file|was not found/i, {
    what: 'That file or folder was not found.',
    why: 'It may have been moved or renamed, or the path has a typing error.',
    todo: 'Check the path (you can drag the file into this window).',
  }],
  [/matter title is required/i, { what: 'Please give the matter a name.', why: '', todo: '' }],
  [/privileged/i, {
    what: 'This matter is privileged, so its documents stay on this computer.',
    why: '',
    todo: 'Turn "Privileged" off first if that is really intended.',
  }],
]

/** { what, why, todo, details } for any error or message. */
function errorParts(err) {
  const m = String(err?.raw || err?.message || err || '')
  for (const [re, parts] of RULES) {
    // Network words inside an engine message mean the engine, not the AI service.
    if (re.test(m)) return { ...parts, details: m.split('\n')[0].slice(0, 300) }
  }
  const first = m.split('\n')[0].replace(/^Error:\s*/, '').trim()
  return { what: first.length > 160 ? `${first.slice(0, 157)}…` : first || 'Something went wrong.', why: '', todo: '', details: '' }
}

/** The same in one line ("what — todo"). */
function friendly(err) {
  const p = errorParts(err)
  return [p.what, p.todo].filter(Boolean).join(' ')
}

module.exports = { errorParts, friendly }
