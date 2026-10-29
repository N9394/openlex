/* OpenLex Word pane — errors in three parts: what happened · why · what
 * to do. The raw message is kept as `details` (shown only on request).
 * No DOM. */
(function (root, factory) {
  const m = factory()
  if (typeof module === 'object' && module.exports) module.exports = m
  else (root.OpenLexPane = root.OpenLexPane || {}).errors = m
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict'

  const WHAT = {
    answer: 'OpenLex could not finish the answer',
    review: 'The review could not go on',
    apply: 'The change could not be put into the document',
    comment: 'The comment could not be added',
    settings: 'The setting was not saved',
    export: 'The review could not be saved',
    load: 'This could not be loaded',
  }

  // [pattern, why, what to do]
  const RULES = [
    [/Failed to fetch|NetworkError|Load failed|engine offline|ECONNREFUSED 127|cannot reach the engine|engine is not running/i,
      'OpenLex is not running on this computer.', 'Start OpenLex (or restart the computer), then try again. What you typed is kept.'],
    [/Blocked by data policy|POLICY_BLOCKED|local-only|not on the allow-list/i,
      'Your client-data rule does not allow sending this matter to the AI service that is selected.', 'Switch to the AI on this computer (menu → Settings: which AI), or change the rule in Settings: where client data may go.'],
    [/outside the approved regions|no pinned region/i,
      'The selected AI service is not in an approved region (your rule allows EU only).', 'Pick an AI service in an EU region in Settings: which AI.'],
    [/no API key|NO_KEY|no AWS credentials/i,
      'There is no key for the selected AI service yet.', 'Add the key in Settings: which AI.'],
    [/\b401\b|\b403\b|invalid.*key|unauthori[sz]ed|authentication|permission denied/i,
      'The AI service did not accept your key.', 'Copy the key again from your account page and paste it in Settings: which AI.'],
    [/\b429\b|rate limit|quota|insufficient/i,
      'The AI service says your account has reached its limit.', 'Wait a minute and try again, or check your plan with the AI service.'],
    [/model not installed|local engine unavailable|model unavailable|not loaded|no model/i,
      'No AI is ready on this computer yet.', 'Open Settings: which AI and set one up, or use your firm\'s AI service.'],
    [/ENOTFOUND|EAI_AGAIN|ETIMEDOUT|timed? ?out|network|socket hang up/i,
      'The AI service could not be reached.', 'Check the internet connection (or that your firm\'s AI server is running) and try again.'],
    [/no longer present|anchor|not found in document/i,
      'The words it refers to were not found in the document — it may have been edited in the meantime.', 'Use "Insert as comment instead", or select the clause yourself and ask again.'],
    [/Tracked changes are not available|Compatibility Mode/i,
      'This document cannot show tracked changes (it may be an older .doc file in Compatibility Mode).', 'Save it as .docx (File → Save As) and try again, or insert the change as a comment.'],
    [/comments are not available/i,
      'This version of Word cannot add comments from an add-in.', 'Update Word, or apply the change and explain it yourself.'],
    [/body too large/i,
      'The document is too large to send in one piece.', 'Select the part you want reviewed and ask about the selection.'],
    [/privileged/i,
      'This matter is privileged, so its documents stay on this computer.', 'Use the AI on this computer for this matter.'],
  ]

  /** { what, why, todo, details } for any error or message. `doing` picks the first part. */
  function explain(err, doing) {
    const raw = String((err && err.message) || err || '').trim()
    const what = WHAT[doing] || 'Something went wrong'
    for (const [re, why, todo] of RULES) if (re.test(raw)) return { what, why, todo, details: raw }
    return { what, why: 'OpenLex reported a problem it could not explain in plain words.', todo: 'Try again. If it keeps happening, copy the details below for whoever looks after OpenLex at your firm.', details: raw }
  }

  return { explain, WHAT }
})
