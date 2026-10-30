import { useEffect, useState } from 'react'
import { CheckCircle, AlertTriangle, Cpu, Database, Brain, Server, RefreshCw, Search } from 'lucide-react'

type DepStatus = {
  app: { version: string; platform: string; arch: string }
  hardware: {
    tier: string; model: string; modelFilename: string; modelSizeBytes: number
    ctx: number; gpuLayers: number
  } | null
  model: { state: string; filename?: string; downloaded?: number; total?: number; pct?: number; actualBytes?: number; installed?: boolean; path?: string }
  embeddings: { reachable: boolean }
  qdrant: { reachable: boolean; collectionExists: boolean; totalChunks: number }
  llm: { reachable: boolean; llmRunning: boolean; lastUsedAt?: number; idleMs?: number }
  backend: { reachable: boolean; status?: number; body?: any; off?: boolean }
  packs: { entitled: string[]; downloaded: string[]; installed_meta?: Record<string, { version?: string; ingested_at?: string; chunk_count?: number }> }
}

function formatBytes(n?: number) {
  if (!n) return '—'
  if (n >= 1e9) return (n / 1e9).toFixed(2) + ' GB'
  if (n >= 1e6) return (n / 1e6).toFixed(1) + ' MB'
  if (n >= 1e3) return (n / 1e3).toFixed(0) + ' KB'
  return n + ' B'
}

function Row({ icon: Icon, name, status, detail, progress }: {
  icon: any; name: string; status: 'ok' | 'warn' | 'down' | 'busy'; detail: string; progress?: number
}) {
  return (
    <div className="flex items-center gap-3 py-3 border-b border-tobacco/40 last:border-0">
      <Icon size={18} className="text-cream/70 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-parchment text-sm">{name}</span>
          {status === 'ok' && <CheckCircle size={14} className="text-forest" />}
          {status === 'warn' && <AlertTriangle size={14} className="text-yellow-500" />}
          {status === 'down' && <span className="inline-block w-2 h-2 rounded-full bg-red-500" />}
          {status === 'busy' && <RefreshCw size={14} className="text-accent animate-spin" />}
        </div>
        <div className="text-antique text-xs">{detail}</div>
        {progress !== undefined && (
          <div className="mt-1 w-full h-1 bg-obsidian/40 rounded overflow-hidden">
            <div className="h-full bg-accent transition-all" style={{ width: `${progress}%` }} />
          </div>
        )}
      </div>
    </div>
  )
}

function LLMTestPanel() {
  const [state, setState] = useState<any>(null)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<any>(null)

  useEffect(() => {
    const tick = async () => {
      try { const s = await (window as any).lexvault?.getLLMState?.(); if (s) setState(s) } catch {}
    }
    tick()
    const id = setInterval(tick, 4000)
    return () => clearInterval(id)
  }, [])

  const runTest = async () => {
    setRunning(true)
    setResult(null)
    try {
      const r = await (window as any).lexvault.testLLM()
      setResult(r)
    } catch (e: any) { setResult({ ok: false, error: e?.message || String(e) }) }
    finally { setRunning(false) }
  }

  return (
    <div className="mt-3 bg-obsidian/30 rounded p-3 text-sm">
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="text-cream">
          LLM runtime
          {state?.fellBackToCpu && (
            <span className="ml-2 text-yellow-500 text-xs">⚠ GPU spawn failed — running on CPU</span>
          )}
        </div>
        <button
          onClick={runTest}
          disabled={running}
          className="px-3 py-1 bg-accent/20 text-accent rounded text-xs font-medium hover:bg-accent/30 disabled:opacity-50 flex items-center gap-1"
        >
          {running ? <RefreshCw size={12} className="animate-spin" /> : <Cpu size={12} />}
          {running ? 'Testing…' : 'Test inference'}
        </button>
      </div>
      {result && (
        <div className="mt-2 text-xs">
          {result.ok ? (
            <div className="text-forest">
              ✓ Inference OK in {(result.elapsed / 1000).toFixed(1)}s — &ldquo;{(result.response || '').slice(0, 80)}&rdquo;
            </div>
          ) : (
            <div className="text-red-400">
              ✗ Inference failed{result.elapsed ? ` after ${(result.elapsed / 1000).toFixed(1)}s` : ''} — {result.error?.slice(0, 200) || `HTTP ${result.status}`}
            </div>
          )}
        </div>
      )}
      {state?.logTail && (
        <details className="mt-2">
          <summary className="cursor-pointer text-antique text-xs">llama-server log tail</summary>
          <pre className="mt-2 text-xs font-mono text-cream/80 max-h-64 overflow-auto whitespace-pre-wrap">{state.logTail}</pre>
        </details>
      )}
    </div>
  )
}

function RetrievalTestPanel({ entitled }: { entitled: string[] }) {
  const [jurisdiction, setJurisdiction] = useState(entitled[0] || 'AT')
  const [query, setQuery] = useState('Verjährung')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<any>(null)
  const run = async () => {
    setRunning(true); setResult(null)
    try { setResult(await (window as any).lexvault.testRetrieval({ jurisdiction, query })) }
    catch (e: any) { setResult({ error: e?.message || String(e) }) }
    finally { setRunning(false) }
  }
  return (
    <div className="mt-3 bg-obsidian/30 rounded p-3 text-sm">
      <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
        <div className="text-cream">End-to-end retrieval test</div>
        <button onClick={run} disabled={running}
          className="px-3 py-1 bg-accent/20 text-accent rounded text-xs font-medium hover:bg-accent/30 disabled:opacity-50 flex items-center gap-1">
          {running ? <RefreshCw size={12} className="animate-spin" /> : <Search size={12} />}
          {running ? 'Testing…' : 'Test retrieval'}
        </button>
      </div>
      <div className="flex gap-2 mb-2">
        <select className="bg-obsidian/60 text-cream text-xs rounded px-2 py-1 border border-tobacco/40"
          value={jurisdiction} onChange={e => setJurisdiction(e.target.value)}>
          {entitled.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <input className="flex-1 bg-obsidian/60 text-cream text-xs rounded px-2 py-1 border border-tobacco/40"
          value={query} onChange={e => setQuery(e.target.value)} placeholder="query..."/>
      </div>
      {result && (
        <div className="text-xs space-y-1 font-mono">
          {(result.stages || []).map((s: any, i: number) => (
            <div key={i} className={s.ok ? 'text-forest' : 'text-red-400'}>
              {s.ok ? '✓' : '✗'} {s.name}: {s.ok
                ? `${s.elapsed_ms}ms` +
                  (s.count != null ? ` count=${s.count}` : '') +
                  (s.dim != null ? ` dim=${s.dim}` : '') +
                  (s.result_count != null ? ` hits=${s.result_count} top="${(s.first_source || '').slice(0, 50)}" score=${(s.first_score || 0).toFixed(3)}` : '')
                : (s.error || `HTTP ${s.status} ${s.body || ''}`).slice(0, 200)}
            </div>
          ))}
          {result.diagnosis && (
            <div className="mt-2 p-2 rounded bg-tobacco/30 text-cream text-xs whitespace-pre-wrap">{result.diagnosis}</div>
          )}
          {result.error && <div className="text-red-400">{result.error}</div>}
        </div>
      )}
    </div>
  )
}

function GpuPanel() {
  const [hw, setHw] = useState<any>(null)
  const [override, setOverride] = useState<string>('auto')
  const [restartFlag, setRestartFlag] = useState(false)

  useEffect(() => {
    const w = window as any
    w.lexvault?.getHardwareDetail?.().then((d: any) => {
      setHw(d)
      // Read existing override if any (we expose via the same hardware.json via detected.overriddenFrom)
      if (d?.detected?.overriddenFrom) setOverride(d.tier)
    }).catch(() => {})
  }, [])

  const apply = async (tier: string) => {
    setOverride(tier)
    try {
      const r = await (window as any).lexvault.setTierOverride(tier)
      if (r?.restartRequired) setRestartFlag(true)
    } catch (e: any) { alert('Failed: ' + (e?.message || e)) }
  }

  if (!hw) return null
  const gpu = hw.detected?.gpu
  return (
    <div className="mt-3 bg-obsidian/30 rounded p-3 text-sm">
      <div className="flex items-center justify-between gap-3 mb-2">
        <div>
          <span className="text-antique">Detected GPU:</span>{' '}
          <span className="font-mono text-parchment">{gpu?.name || 'none'}</span>
          {gpu?.vramGB ? <span className="text-antique"> · {gpu.vramGB} GB</span> : null}
          {gpu?.via ? <span className="text-antique"> · via {gpu.via}</span> : null}
        </div>
        <select
          value={override}
          onChange={e => apply(e.target.value)}
          className="input text-xs px-2 py-1"
          style={{ minWidth: 140 }}
        >
          <option value="auto">Auto (detect)</option>
          <option value="nvidia">NVIDIA</option>
          <option value="amd">AMD</option>
          <option value="intel">Intel</option>
          <option value="apple">Apple Silicon</option>
          <option value="cpu">CPU only</option>
        </select>
      </div>
      {restartFlag && (
        <div className="text-yellow-400 text-xs">
          Restart OpenLex for the new tier to take effect.
        </div>
      )}
      {gpu?.diag && (
        <details className="mt-2">
          <summary className="cursor-pointer text-antique text-xs">GPU detection log (for support)</summary>
          <div className="mt-2 space-y-1 text-xs font-mono text-cream/80 max-h-48 overflow-auto">
            {(gpu.diag.sources || []).map((s: any, i: number) => (
              <div key={i}>
                <span className="text-accent">[{s.via}]</span>{' '}
                <span className="text-antique">{(s.raw || '').slice(0, 280)}</span>
              </div>
            ))}
            {(gpu.diag.errors || []).map((e: string, i: number) => (
              <div key={'e' + i} className="text-red-400">[error] {e}</div>
            ))}
            {gpu.allCandidates && gpu.allCandidates.length > 0 && (
              <div className="text-antique">Candidates: {gpu.allCandidates.map((c: any) => c.name).join(', ')}</div>
            )}
          </div>
        </details>
      )}
    </div>
  )
}

type PackEvent =
  | { kind: 'pack-download-start'; code: string; version: string }
  | { kind: 'pack-download-progress'; code: string; version: string; pct: number }
  | { kind: 'pack-download-done'; code: string; version: string }
  | { kind: 'pack-ingest-start'; code: string; version: string }
  | { kind: 'pack-ingest-done'; code: string; version: string; chunk_count: number }
  | { kind: 'pack-error'; code: string; version: string; error: string }
  | { kind: string; [k: string]: any }

// An older or failed main process may leave parts out: fill them so the page never crashes.
function normalise(d: any): DepStatus {
  return {
    ...d,
    app: d.app || { version: '—', platform: '', arch: '' },
    hardware: d.hardware || null,
    model: d.model || { state: 'unknown', installed: false },
    llm: d.llm || { reachable: false },
    embeddings: d.embeddings || { reachable: false },
    qdrant: d.qdrant || { reachable: false, collectionExists: false, totalChunks: 0 },
    backend: d.backend || { off: true },
    packs: { entitled: [], downloaded: [], installed_meta: {}, ...(d.packs || {}) },
  }
}

export default function DependenciesTab() {
  const [dep, setDep] = useState<DepStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [packState, setPackState] = useState<Record<string, PackEvent>>({})

  useEffect(() => {
    let cancelled = false
    const tick = async () => {
      try {
        const w = window as any
        if (!w.lexvault?.getDependencyStatus) {
          setError('Bridge not available — run inside the OpenLex App.')
          return
        }
        const next = await w.lexvault.getDependencyStatus()
        if (!cancelled) { setDep(next ? normalise(next) : null); setError(next ? null : 'Status not available.') }
      } catch (e: any) {
        if (!cancelled) setError(e.message || String(e))
      }
    }
    tick()
    const id = setInterval(tick, 2500)
    const w = window as any
    if (w.lexvault?.onPackEvent) {
      w.lexvault.onPackEvent((evt: PackEvent) => {
        if (!evt.code) return
        setPackState(s => ({ ...s, [evt.code]: evt }))
      })
    }
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  const [refetching, setRefetching] = useState(false)
  const refetchModel = async () => {
    const w = window as any
    if (!w.lexvault?.refetchModel) return
    if (!confirm('Re-download the LLM model? This will delete the existing 5.7 GB file and download it fresh with full SHA256 validation. Takes 5-15 minutes depending on connection.')) return
    setRefetching(true)
    try { await w.lexvault.refetchModel() }
    catch (e: any) { alert('Refetch failed: ' + (e?.message || e)) }
    finally { setRefetching(false) }
  }

  if (error) return <div className="card text-red-400">{error}</div>
  if (!dep) return <div className="card text-antique">Loading…</div>

  const modelStatus: 'ok' | 'busy' | 'down' =
    dep?.model?.installed ? 'ok' : dep.model.state === 'downloading' ? 'busy' : 'down'
  const modelDetail = dep.model.installed
    ? `${dep.hardware?.modelFilename || dep.model.filename} — ${formatBytes(dep.model.actualBytes || dep.hardware?.modelSizeBytes)}`
    : dep.model.state === 'downloading'
      ? `Downloading ${formatBytes(dep.model.downloaded)} / ${formatBytes(dep.model.total)} (${dep.model.pct}%)`
      : 'Not downloaded'

  return (
    <div className="card space-y-6">
      <div>
        <h2 className="font-serif text-xl text-parchment">Dependencies</h2>
        <p className="text-antique text-sm mt-1">
          Live health of every component the App relies on. Updates every 2.5 s.
        </p>
      </div>

      <div>
        <div className="text-cream text-sm font-medium mb-2">Hardware tier</div>
        <div className="bg-obsidian/30 rounded p-3 text-sm grid grid-cols-2 gap-2 font-mono">
          <div><span className="text-antique">Tier:</span> {dep.hardware?.tier || '—'}</div>
          <div><span className="text-antique">Model:</span> {dep.hardware?.model || '—'}</div>
          <div><span className="text-antique">Context:</span> {dep.hardware?.ctx?.toLocaleString() || '—'} tokens</div>
          <div><span className="text-antique">GPU layers:</span> {dep.hardware?.gpuLayers ?? '—'}</div>
          <div><span className="text-antique">Platform:</span> {dep.app.platform} {dep.app.arch}</div>
          <div><span className="text-antique">Version:</span> {dep.app.version}</div>
        </div>
        <GpuPanel />
      </div>

      <div>
        <div className="text-cream text-sm font-medium mb-2">Local services</div>
        <div className="bg-obsidian/30 rounded px-4">
          <div className="flex items-center gap-3 py-3 border-b border-tobacco/40">
            <Brain size={18} className="text-cream/70 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-parchment text-sm">LLM model (qwen3.5:9b Q4_K_M)</span>
                {modelStatus === 'ok' && <CheckCircle size={14} className="text-forest" />}
                {modelStatus === 'busy' && <RefreshCw size={14} className="text-accent animate-spin" />}
                {modelStatus === 'down' && <span className="inline-block w-2 h-2 rounded-full bg-red-500" />}
              </div>
              <div className="text-antique text-xs">{modelDetail}</div>
              {dep.model.state === 'downloading' && (
                <div className="mt-1 w-full h-1 bg-obsidian/40 rounded overflow-hidden">
                  <div className="h-full bg-accent transition-all" style={{ width: `${dep.model.pct}%` }} />
                </div>
              )}
            </div>
            <button
              onClick={refetchModel}
              disabled={refetching || dep.model.state === 'downloading'}
              className="px-3 py-1 bg-tobacco/30 text-cream rounded text-xs font-medium hover:bg-tobacco/50 disabled:opacity-50 flex items-center gap-1"
              title="Delete existing model file and download fresh with full SHA256 validation"
            >
              {refetching ? <RefreshCw size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              Refetch
            </button>
          </div>
          <Row
            icon={Cpu}
            name="llama-server (inference)"
            status={dep.llm.reachable ? 'ok' : 'down'}
            detail={
              !dep.llm.reachable
                ? 'Not reachable on 127.0.0.1:11434'
                : dep.llm.llmRunning
                  ? `Running — last inference ${dep.llm.lastUsedAt ? new Date(dep.llm.lastUsedAt).toLocaleTimeString() : 'never'}`
                  : 'Idle (lazy-spawn on next inference)'
            }
          />
          <Row
            icon={Brain}
            name="Embeddings (BGE-M3 INT8)"
            status={dep.embeddings.reachable ? 'ok' : 'down'}
            detail={dep.embeddings.reachable ? 'Ready on 127.0.0.1:11435' : 'Not reachable'}
          />
          <Row
            icon={Database}
            name="Qdrant (vector DB)"
            status={dep.qdrant.reachable ? 'ok' : 'down'}
            detail={
              !dep.qdrant.reachable
                ? 'Not reachable on 127.0.0.1:16333'
                : dep.qdrant.collectionExists
                  ? `${(dep.qdrant.totalChunks || 0).toLocaleString()} chunks indexed`
                  : 'No collection — download statute packs to populate'
            }
          />
          {!dep.backend.off && (
            <Row
              icon={Server}
              name="Old desktop server"
              status={dep.backend.reachable && dep.backend.status === 200 ? 'ok' : dep.backend.reachable ? 'warn' : 'down'}
              detail={
                !dep.backend.reachable
                  ? 'Not reachable on 127.0.0.1:18000'
                  : `HTTP ${dep.backend.status} — ${dep.backend.body?.status || 'unknown'}`
              }
            />
          )}
        </div>
        <LLMTestPanel />
        <RetrievalTestPanel entitled={dep.packs.entitled} />
      </div>

      <div>
        <div className="text-cream text-sm font-medium mb-2">Statute packs</div>
        <div className="bg-obsidian/30 rounded p-3">
          {dep.packs.entitled.length === 0 ? (
            <div className="text-antique text-sm">No active subscriptions.</div>
          ) : (
            <div className="space-y-2">
              {dep.packs.entitled.map(code => {
                const meta = (dep.packs.installed_meta || {})[code]
                const installed = !!meta || dep.packs.downloaded.includes(code)
                const evt = packState[code]
                let detail = installed ? 'Installed' : 'Pending — will auto-download in background'
                let progress: number | undefined
                let isErrored = false
                let isBusy = false
                if (evt) {
                  if (evt.kind === 'pack-download-progress') {
                    detail = `Downloading… ${evt.pct}%`
                    progress = evt.pct
                    isBusy = true
                  } else if (evt.kind === 'pack-download-done') { detail = 'Downloaded — ingesting…'; isBusy = true }
                  else if (evt.kind === 'pack-ingest-start') { detail = 'Ingesting into Qdrant…'; isBusy = true }
                  else if (evt.kind === 'pack-ingest-progress') {
                    const pct = Math.round(((evt as any).inserted / (evt as any).total) * 100)
                    detail = `Ingesting… ${pct}% (${((evt as any).inserted as number).toLocaleString()} / ${((evt as any).total as number).toLocaleString()})`
                    progress = pct
                    isBusy = true
                  }
                  else if (evt.kind === 'pack-ingest-done') detail = `Installed (${(evt.chunk_count || 0).toLocaleString()} chunks)`
                  else if (evt.kind === 'pack-error') { detail = `Error: ${(evt as any).error}`; isErrored = true }
                } else if (installed && meta) {
                  const when = meta.ingested_at ? new Date(meta.ingested_at).toLocaleString() : 'unknown'
                  detail = `Last synced ${when} • ${(meta.chunk_count || 0).toLocaleString()} chunks`
                }
                const canRetry = !installed && !isBusy
                const retry = async () => {
                  setPackState(s => ({ ...s, [code]: { kind: 'pack-download-start', code, version: '' } }))
                  try { await (window as any).lexvault?.downloadPack?.(code) }
                  catch (e: any) {
                    setPackState(s => ({ ...s, [code]: { kind: 'pack-error', code, version: '', error: e?.message || String(e) } }))
                  }
                }
                return (
                  <div key={code} className="flex items-center gap-3 py-2 border-b border-tobacco/40 last:border-0">
                    <span className={`px-2 py-1 rounded font-mono text-xs ${installed ? 'bg-forest/20 text-forest' : isErrored ? 'bg-red-500/20 text-red-300' : 'bg-tobacco/30 text-cream'}`}>
                      {code}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className={`text-sm ${isErrored ? 'text-red-300' : 'text-cream'}`}>{detail}</div>
                      {progress !== undefined && (
                        <div className="mt-1 w-full h-1 bg-obsidian/40 rounded overflow-hidden">
                          <div className="h-full bg-accent transition-all" style={{ width: `${progress}%` }} />
                        </div>
                      )}
                    </div>
                    {canRetry && (
                      <button onClick={retry}
                        className="text-xs px-3 py-1 rounded border border-tobacco/60 text-cream hover:bg-tobacco/30 transition-colors"
                        title={isErrored ? 'Retry download + ingest' : 'Download now'}>
                        {isErrored ? 'Retry' : 'Download'}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
          <div className="text-antique text-xs mt-3">
            Statute packs sync automatically on every launch. New chunks for an entitled jurisdiction
            ship as a delta and ingest in seconds.
          </div>
        </div>
      </div>
    </div>
  )
}
