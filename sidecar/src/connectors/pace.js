"use strict"
/**
 * Keeping to a source's rate limit: requests to one source go one at a
 * time, at least `gapMs` apart ("1,500 requests per 5 minutes" → 200 ms;
 * "5 a minute" → 12 s). Each connector names its own pace; tests shorten
 * every gap with OPENLEX_PACE_SCALE=0.
 */

const queues = new Map() // key → { tail, last }
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms))

/** Run fn after the previous call for `key` has finished and `gapMs` has passed since. */
function paced(key, gapMs, fn) {
  const scale = process.env.OPENLEX_PACE_SCALE === undefined ? 1 : Number(process.env.OPENLEX_PACE_SCALE) || 0
  const gap = Math.max(0, gapMs * scale)
  const q = queues.get(key) || { tail: Promise.resolve(), last: 0 }
  queues.set(key, q)
  const run = q.tail.then(async () => {
    const wait = q.last + gap - Date.now()
    if (wait > 0) await sleep(wait)
    try { return await fn() } finally { q.last = Date.now() }
  })
  q.tail = run.catch(() => {})
  return run
}

module.exports = { paced }
