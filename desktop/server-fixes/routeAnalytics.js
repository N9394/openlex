/**
 * Append-only analytics log for the research-chat route. Phase 1 of the
 * "learned query-routing registry" idea.
 *
 * Writes one JSONL row per completed research call to a flat file (no
 * database dependency). Stays purely observational — nothing in the live
 * retrieval path reads this file. Goal: collect a month of data, then a
 * separate offline analysis decides if there are stable preferred-chunk
 * buckets per query cluster. If yes, productize. If no, the data tells
 * us the routing layer isn't worth building.
 *
 * Why NDJSON not SQLite: the container doesn't have better-sqlite3 /
 * sqlite3, and adding a Prisma model + migration for a write-only log is
 * overkill. JSONL is trivially ingestable later (`jq`, pandas, or import
 * into a SQLite once for offline analysis).
 *
 * Path: LEXVAULT_ROUTE_LOG_FILE or /app/data/route-analytics.ndjson
 *
 * Row shape (per JSONL line):
 *   { ts, user_id, query_text, query_chars, jurisdictions, interpretive,
 *     source_count, primary_count, overflow_count, case_law_count,
 *     statute_count, chunk_ids_used, judge_total, judge_supported,
 *     judge_unsupported, judge_regenerated, judge_removed,
 *     judge_supported_ratio, judge_confidence, response_chars,
 *     duration_ms, pack_versions }
 *
 * Failures are swallowed — observability must never break user-facing
 * search.
 */

const fs = require('fs')
const path = require('path')

const LOG_PATH = process.env.LEXVAULT_ROUTE_LOG_FILE
  || path.join(process.env.LEXVAULT_DATA_DIR || '/app/data', 'route-analytics.ndjson')

let _stream = null
let _disabled = false

function _ensure() {
  if (_disabled || _stream) return _stream
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true })
    _stream = fs.createWriteStream(LOG_PATH, { flags: 'a', mode: 0o640 })
    _stream.on('error', (e) => {
      console.warn('[routeAnalytics] write stream error:', e.message)
      _disabled = true
      try { _stream?.end() } catch {}
      _stream = null
    })
    return _stream
  } catch (e) {
    console.warn('[routeAnalytics] init failed, logging disabled:', e.message)
    _disabled = true
    return null
  }
}

function logQueryRoute(row) {
  const stream = _ensure()
  if (!stream) return
  try {
    const total = (row.judge_total ?? row.judgeTotal) || 0
    const supported = (row.judge_supported ?? row.judgeSupported) || 0
    const ratio = total > 0 ? +(supported / total).toFixed(4) : null
    const chunkIds = Array.isArray(row.chunk_ids_used) ? row.chunk_ids_used.slice(0, 30) : []
    const jurisdictions = Array.isArray(row.jurisdictions)
      ? row.jurisdictions
      : (row.jurisdictions ? [row.jurisdictions] : [])
    const entry = {
      ts: new Date().toISOString(),
      user_id: row.user_id || row.userId || null,
      query_text: (row.query_text || row.queryText || '').slice(0, 4000),
      query_chars: (row.query_text || row.queryText || '').length,
      jurisdictions,
      interpretive: !!row.interpretive,
      source_count: row.source_count ?? row.sourceCount ?? 0,
      primary_count: row.primary_count ?? row.primaryCount ?? 0,
      overflow_count: row.overflow_count ?? row.overflowCount ?? 0,
      case_law_count: row.case_law_count ?? row.caseLawCount ?? 0,
      statute_count: row.statute_count ?? row.statuteCount ?? 0,
      chunk_ids_used: chunkIds,
      judge_total: total,
      judge_supported: supported,
      judge_unsupported: (row.judge_unsupported ?? row.judgeUnsupported) || 0,
      judge_regenerated: (row.judge_regenerated ?? row.judgeRegenerated) || 0,
      judge_removed: (row.judge_removed ?? row.judgeRemoved) || 0,
      judge_supported_ratio: ratio,
      judge_confidence: row.judge_confidence || row.judgeConfidence || null,
      response_chars: (row.response_chars ?? row.responseChars) || 0,
      duration_ms: (row.duration_ms ?? row.durationMs) || 0,
      pack_versions: row.pack_versions || row.packVersions || {},
    }
    stream.write(JSON.stringify(entry) + '\n')
  } catch (e) {
    console.warn('[routeAnalytics] log failed:', e.message)
  }
}

// Read-only diagnostic for ops. Scans the file (avoid on huge logs — but
// after a month at ~1000 rows/day that's still trivially scannable).
function getStats() {
  try {
    if (!fs.existsSync(LOG_PATH)) return { total: 0, file: LOG_PATH }
    const lines = fs.readFileSync(LOG_PATH, 'utf8').trim().split('\n').filter(Boolean)
    const oneDay = Date.now() - 24 * 3600 * 1000
    let recent24h = 0
    const byJur = {}
    let interpretiveCount = 0
    let totalRatio = 0
    let ratioN = 0
    for (const ln of lines) {
      let e; try { e = JSON.parse(ln) } catch { continue }
      if (new Date(e.ts).getTime() > oneDay) recent24h++
      const k = JSON.stringify(e.jurisdictions || [])
      byJur[k] = (byJur[k] || 0) + 1
      if (e.interpretive) interpretiveCount++
      if (typeof e.judge_supported_ratio === 'number') {
        totalRatio += e.judge_supported_ratio
        ratioN++
      }
    }
    return {
      total: lines.length,
      recent24h,
      interpretive_fraction: lines.length ? +(interpretiveCount / lines.length).toFixed(3) : 0,
      avg_judge_supported_ratio: ratioN ? +(totalRatio / ratioN).toFixed(3) : null,
      by_jurisdictions: byJur,
      file: LOG_PATH,
    }
  } catch (e) {
    return { error: e.message, file: LOG_PATH }
  }
}

module.exports = { logQueryRoute, getStats }
