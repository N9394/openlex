/**
 * Sidecar supervisor for the airgapped App.
 *
 * Spawns 4 child processes on app start, in order, waiting for each to
 * become healthy before starting the next:
 *
 *   1. Qdrant   — vector DB. Single-binary release. Listens on 127.0.0.1:6333.
 *      Data dir = userData/qdrant.
 *
 *   2. Embeddings — BGE-M3 dense + sparse. Currently the simplest portable
 *      shape is the existing Python embeddings_service.py packaged with a
 *      Python runtime. Stubbed here as an HTTP service on 127.0.0.1:11435.
 *      Long-term we want an ONNX-only runtime so we can drop the Python dep.
 *
 *   3. LLM      — llama.cpp server. Picks a GGUF model from resources/models
 *      based on hardware tier. Listens on 127.0.0.1:11434 (Ollama-compatible
 *      endpoint shape so the existing Ollama-fallback code path works).
 *
 *   4. Backend  — the existing Express server (product/server). Spawned with
 *      env vars wiring it to the local sidecars (LLM_PROVIDER=ollama,
 *      OLLAMA_BASE_URL=127.0.0.1:11434, EMBEDDINGS_URL=127.0.0.1:11435,
 *      QDRANT_URL=127.0.0.1:6333) and LEXVAULT_LICENSE_PATH so the auth
 *      middleware uses the license file instead of cookies.
 *
 * Health checks: HTTP probe with timeout + exponential backoff. If a sidecar
 * dies after start, we kill everything and surface the error.
 *
 * Cross-platform notes:
 *   - bin/qdrant binaries live in resources/bin/qdrant-{darwin,linux,win32}-{arm64,x64}
 *   - bin/llamacpp ditto. Built with `make` from llama.cpp upstream.
 *   - models/{tier}.gguf — chosen at runtime from hardware.json
 *
 * The first packaged release will ship without the binaries and rely on the
 * Launcher to download them into resources/bin and resources/models. This file
 * already accommodates that — it just looks for binaries at the resolved paths.
 */

const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')
const http = require('http')
const net = require('net')

const PORTS = {
  qdrant: 16333,
  embeddings: 11435,
  llm: 11434,
  backend: 18000,
}

class Supervisor {
  // modelPath: the GGUF main.js settled on; null = no local model (community
  // mode without a download — own API key / custom endpoint only). Omitted =
  // the tier's model from hardware.json.
  constructor({ paths, license, modelPath }) {
    this.paths = paths
    this.license = license
    this.modelPath = modelPath
    this.children = []
    this.backendUrl = `http://127.0.0.1:${PORTS.backend}`
  }

  async start(emit = () => {}) {
    fs.mkdirSync(this.paths.qdrantData, { recursive: true })

    emit({ stage: 'qdrant', state: 'starting' })
    await this._startQdrant()
    await waitForHttp(`http://127.0.0.1:${PORTS.qdrant}/healthz`, 30_000)
    emit({ stage: 'qdrant', state: 'ready' })

    emit({ stage: 'embeddings', state: 'starting' })
    await this._startEmbeddings()
    await waitForHttp(`http://127.0.0.1:${PORTS.embeddings}/`, 60_000)
    emit({ stage: 'embeddings', state: 'ready' })

    emit({ stage: 'llm', state: 'starting' })
    await this._startLLM()
    // LLM proxy is up immediately; the actual llama-server is lazy-spawned
    // on the first inference request. We probe the proxy's own /healthz, not
    // /api/tags (which would force-spawn the model just for the health check).
    await waitForHttp(`http://127.0.0.1:${PORTS.llm}/healthz`, 10_000)
    emit({ stage: 'llm', state: 'ready' })

    emit({ stage: 'backend', state: 'starting' })
    await this._startBackend()
    // Accept ANY HTTP response from /health, including 503. The backend
    // returns 503 while the LLM is still warming up (lazy spawn), but the
    // server itself is up and serving — that's all we care about for boot.
    // Non-LLM features (vault, settings, doc upload) work without LLM.
    await waitForHttp(`http://127.0.0.1:${PORTS.backend}/health`, 30_000, { acceptAny: true })
    emit({ stage: 'backend', state: 'ready' })

    // Pre-warm the LLM in the background. On slow Vulkan setups (e.g. RDNA1
    // RX 5700 XT) the first model load takes 90-120s; if we wait for the
    // user's first research request to trigger spawn, the request times out
    // before llama-server is ready. By kicking off _ensureLLMRunning() here,
    // the model is hot by the time the user types a query. Fire-and-forget —
    // failures (e.g. no Vulkan device) fall back to CPU and surface in the
    // Dependencies tab; no need to gate boot on this.
    if (this._llmModelPath) setTimeout(() => {
      this._ensureLLMRunning().catch(err => {
        console.warn(`[llm-prewarm] background spawn failed: ${err.message}`)
      })
    }, 3000)
  }

  async stop() {
    // Tear down the LLM idle watchdog + proxy + lazy-spawned child first
    if (this._llmIdleTimer) { clearInterval(this._llmIdleTimer); this._llmIdleTimer = null }
    if (this._llmChild && !this._llmChild.killed) {
      try { this._llmChild.kill('SIGTERM') } catch {}
    }
    if (this._llmProxyServer) {
      try { this._llmProxyServer.close() } catch {}
      this._llmProxyServer = null
    }
    for (const child of this.children.reverse()) {
      try {
        if (!child.killed) {
          child.kill('SIGTERM')
        }
      } catch {}
    }
    // Give them a moment, then SIGKILL stragglers
    await new Promise(r => setTimeout(r, 1500))
    for (const child of this.children) {
      try { if (!child.killed) child.kill('SIGKILL') } catch {}
    }
    if (this._llmChild && !this._llmChild.killed) {
      try { this._llmChild.kill('SIGKILL') } catch {}
    }
    this.children = []
    this._llmChild = null
  }

  // -------------------------------------------------------------------------

  _startQdrant() {
    const binary = resolveBinary(this.paths.bin, 'qdrant')
    if (!fs.existsSync(binary)) {
      throw new Error(`Qdrant binary missing at ${binary}. The Launcher should have downloaded it.`)
    }
    const configFile = this._writeQdrantConfig()
    const child = spawn(binary, ['--config-path', configFile], {
      cwd: this.paths.qdrantData,
      env: { ...process.env, QDRANT__STORAGE__STORAGE_PATH: this.paths.qdrantData },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    // Capture stderr + stdout into a ring buffer so getQdrantErrTail() can
    // surface real diagnostics in the boot-failure dialog (audit #91:
    // "Timeout waiting for /healthz" is useless on its own; the user needs
    // to know if it's port-conflict / AV-quarantine / config error / etc).
    this._qdrantLog = []
    const append = (label, buf) => {
      const line = `[${label}] ${buf.toString()}`
      process.stdout.write(line)
      this._qdrantLog.push(line.trim())
      if (this._qdrantLog.length > 100) this._qdrantLog.splice(0, this._qdrantLog.length - 100)
    }
    child.stdout?.on('data', d => append('qdrant', d))
    child.stderr?.on('data', d => append('qdrant!', d))
    this._qdrantExit = null
    child.on('exit', (code, sig) => {
      this._qdrantExit = { code, signal: sig, at: Date.now() }
      console.log(`[qdrant] exited (code=${code}, signal=${sig})`)
    })
    this._qdrantChild = child
    this._qdrantBinary = binary
    this.children.push(child)
  }

  // Diagnostic helper — answers WHY qdrant isn't ready when waitForHttp
  // times out. Used by main.js failure dialog to replace the cryptic
  // "Timeout waiting for http://127.0.0.1:16333/healthz" with something
  // a non-engineer can act on.
  async diagnoseQdrant() {
    const out = { binary: this._qdrantBinary, exists: !!this._qdrantBinary && fs.existsSync(this._qdrantBinary) }
    out.processAlive = !!(this._qdrantChild && !this._qdrantChild.killed && this._qdrantExit === null)
    if (this._qdrantExit) out.exit = this._qdrantExit
    out.logTail = (this._qdrantLog || []).slice(-15)
    // Port-conflict probe: is something OTHER than us answering on 16333?
    // If our child exited, port might still be held by whoever stole it.
    try {
      const net = require('net')
      out.portInUse = await new Promise(resolve => {
        const s = net.createConnection({ host: '127.0.0.1', port: PORTS.qdrant, timeout: 500 })
        s.on('connect', () => { s.destroy(); resolve(true) })
        s.on('error', () => resolve(false))
        s.on('timeout', () => { s.destroy(); resolve(false) })
      })
    } catch { out.portInUse = null }
    // Storage dir writability check (Windows AV often locks a fresh dir)
    try {
      const probe = path.join(this.paths.qdrantData, '.write_probe')
      fs.writeFileSync(probe, 'ok')
      fs.unlinkSync(probe)
      out.storageWritable = true
    } catch (e) { out.storageWritable = false; out.storageError = e.message }
    return out
  }

  getQdrantErrTail() {
    return (this._qdrantLog || []).slice(-15).join('\n')
  }

  _writeQdrantConfig() {
    const file = path.join(this.paths.qdrantData, 'config.yaml')
    // Cap optimizer + indexing parallelism. Default is CPU÷2, which pegs disk
    // I/O at 100% on consumer NVMes during pack ingest (qdrant rebuilds HNSW
    // segments in parallel) — visible as "not responding" in Task Manager
    // while RO etc. settles. Capping to 2 trades indexing latency (~30%
    // slower) for a machine that stays usable.
    const yaml = `
service:
  host: 127.0.0.1
  http_port: ${PORTS.qdrant}
  grpc_port: ${PORTS.qdrant + 1}
storage:
  storage_path: ${this.paths.qdrantData}/storage
  snapshots_path: ${this.paths.qdrantData}/snapshots
  performance:
    max_optimization_threads: 2
    max_search_threads: 0
log_level: WARN
`
    fs.writeFileSync(file, yaml)
    return file
  }

  _startEmbeddings() {
    // Node-based embeddings sidecar (int8 BGE-M3 via onnxruntime-node + custom
    // ORT graph). Spawned with the Electron-bundled Node (process.execPath +
    // ELECTRON_RUN_AS_NODE) so we don't depend on the user having Node.
    const script = path.join(this.paths.bin, 'embeddings', 'server.js')
    if (!fs.existsSync(script)) {
      throw new Error(`Embeddings sidecar missing at ${script}. App bundle is incomplete.`)
    }
    // Read the user's bearer token from disk (same one main.js wrote during
    // first-run activation). Embeddings sidecar uses it to fetch the int8
    // BGE-M3 from license-server on first launch.
    let lvToken = ''
    try {
      const tokenPath = path.join(this.paths.userData, 'token.txt')
      if (fs.existsSync(tokenPath)) lvToken = fs.readFileSync(tokenPath, 'utf8').trim()
    } catch {}
    const child = spawn(process.execPath, [script], {
      cwd: path.dirname(script),
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        EMBEDDINGS_PORT: String(PORTS.embeddings),
        EMBEDDINGS_MODELS_DIR: path.join(this.paths.models, 'embeddings'),
        LEXVAULT_TOKEN: lvToken,
        ...(process.env.LEXVAULT_LICENSE_SERVER ? { LEXVAULT_LICENSE_SERVER: process.env.LEXVAULT_LICENSE_SERVER } : {}),
        HOME: process.env.HOME,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    pipeLogs(child, 'embeddings')
    this.children.push(child)
    child.on('exit', code => console.log(`[embeddings] exited (${code})`))
  }

  // ── LLM lifecycle ────────────────────────────────────────────────────────
  // We don't spawn llama-server eagerly at boot. Instead, _startLLM stands up
  // a tiny HTTP proxy on PORTS.llm that:
  //   • lazy-spawns the real llama-server on PORTS.llm + 100 on the first
  //     inference request (saves ~6 GB RAM when the App is open but idle)
  //   • tracks last-request time
  //   • SIGTERMs the llama-server after LLM_IDLE_MS of inactivity
  //   • re-spawns transparently on the next request (~10s reload penalty)
  //
  // Backend code talks to PORTS.llm without knowing any of this exists.

  _startLLM() {
    const binary = resolveBinary(this.paths.bin, 'llama-server')
    if (!fs.existsSync(binary)) {
      throw new Error(`llama.cpp server binary missing at ${binary}.`)
    }
    const modelPath = this.modelPath !== undefined ? this.modelPath : path.join(this.paths.models, 'llm', this._readHardware().model_filename)
    if (modelPath && !fs.existsSync(modelPath)) {
      throw new Error(`LLM model missing at ${modelPath}. Boot should have downloaded it.`)
    }
    // No local model: the proxy still runs so cloud / custom providers work
    // through the engine; local requests get a clear error (_ensureLLMRunning).

    this._llmInternalPort = PORTS.llm + 100
    // 4 minutes idle before unload. Was 10 min, but on machines with 16-24 GB
    // RAM keeping 6 GB of model weights resident for 10 minutes after the
    // user stops typing makes the App feel sluggish (OS starts swapping).
    // Override via env var if the user reports "first query is always slow".
    this._llmIdleMs       = parseInt(process.env.LEXVAULT_LLM_IDLE_MS || (4 * 60 * 1000), 10)
    this._llmLastUsedAt   = 0
    this._llmReadyPromise = null
    this._llmChild        = null
    this._llmBinary       = binary
    this._llmModelPath    = modelPath

    this._spawnLLMProxy()

    // Idle watchdog — checks every minute, kills llama-server if idle.
    this._llmIdleTimer = setInterval(() => {
      if (!this._llmChild || this._llmChild.killed) return
      if (this._llmLastUsedAt === 0) return                                 // never used yet
      const idleMs = Date.now() - this._llmLastUsedAt
      if (idleMs < this._llmIdleMs) return
      console.log(`[llm-proxy] idle ${Math.round(idleMs/1000)}s — unloading llama-server`)
      try { this._llmChild.kill('SIGTERM') } catch {}
      this._llmChild = null
      this._llmReadyPromise = null
    }, 60_000)
    this._llmIdleTimer.unref?.()
  }

  _spawnLLMProxy() {
    this._llmProxyServer = http.createServer((req, res) => {
      // Health probe used by start() — does not force a spawn.
      if (req.method === 'GET' && (req.url === '/healthz' || req.url === '/healthz/')) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          ok: true,
          llmRunning: !!(this._llmChild && !this._llmChild.killed),
          lastUsedAt: this._llmLastUsedAt,
          idleMs: this._llmIdleMs,
        }))
        return
      }

      // Ollama compatibility shim. The Express server's llmAdapter calls
      // POST /api/chat (Ollama NDJSON streaming) and GET /api/tags (model
      // discovery). llama.cpp's --api-prefix=/api exposes only OpenAI-style
      // /api/chat/completions etc. We translate here so neither side has to
      // know about the other.
      if (req.method === 'GET' && (req.url === '/api/tags' || req.url === '/api/tags/')) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          models: [
            { name: process.env.OLLAMA_MODEL || 'local', model: 'local', size: 0, modified_at: new Date().toISOString() },
            { name: process.env.OLLAMA_MODEL_FAST || 'local', model: 'local', size: 0, modified_at: new Date().toISOString() },
          ],
        }))
        return
      }

      if (req.method === 'POST' && (req.url === '/api/chat' || req.url === '/api/chat/')) {
        this._llmLastUsedAt = Date.now()
        this._handleOllamaChat(req, res).catch(err => {
          console.error('[llm-proxy] ollama-chat translation error:', err.message)
          if (!res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'llm: ' + err.message }))
          }
        })
        return
      }

      // Pass-through for everything else (e.g., direct OpenAI-compat callers).
      this._llmLastUsedAt = Date.now()
      this._ensureLLMRunning().then(() => {
        const proxyReq = http.request({
          host: '127.0.0.1', port: this._llmInternalPort,
          method: req.method, path: req.url,
          headers: { ...req.headers, host: '127.0.0.1:' + this._llmInternalPort },
        }, proxyRes => {
          res.writeHead(proxyRes.statusCode, proxyRes.headers)
          proxyRes.pipe(res)
        })
        proxyReq.on('error', err => {
          console.error('[llm-proxy] upstream error:', err.message)
          if (!res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'llm upstream: ' + err.message }))
          }
        })
        req.pipe(proxyReq)
      }).catch(err => {
        console.error('[llm-proxy] spawn failed:', err.message)
        res.writeHead(503, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'llm spawn: ' + err.message }))
      })
    })
    this._llmProxyServer.on('error', err => console.error('[llm-proxy] server error:', err.message))
    this._llmProxyServer.listen(PORTS.llm, '127.0.0.1', () => {
      console.log(`[llm-proxy] listening on 127.0.0.1:${PORTS.llm} → llama-server :${this._llmInternalPort} (lazy, idle-unload after ${this._llmIdleMs/1000}s)`)
    })
  }

  _engine() {
    if (this._engineLib !== undefined) return this._engineLib
    try {
      const dir = this.paths.engine
      this._engineLib = {
        llm: require(path.join(dir, 'llm.js')),
        policy: require(path.join(dir, 'policy.js')),
        matters: require(path.join(dir, 'matters.js')),
      }
    } catch (err) {
      console.warn('[llm-proxy] OpenLex engine unavailable — local model only:', err.message)
      this._engineLib = null
    }
    return this._engineLib
  }

  // Ollama /api/chat → OpenLex engine (cloud provider) → Ollama NDJSON.
  // Policy is enforced inside the engine; a blocked call returns 403 with
  // the engine's explanation, which the backend surfaces to the user.
  async _handleViaEngine(engine, clientReq, clientRes) {
    const bodyBuf = await new Promise((resolve, reject) => {
      const chunks = []
      clientReq.on('data', c => chunks.push(c))
      clientReq.on('end', () => resolve(Buffer.concat(chunks)))
      clientReq.on('error', reject)
    })
    let ollamaBody
    try { ollamaBody = JSON.parse(bodyBuf.toString('utf8')) }
    catch { throw new Error('invalid JSON in /api/chat body') }
    const model = ollamaBody.model || 'local'
    const opts = {
      maxTokens: ollamaBody.options?.num_predict ?? 2048,
      temperature: ollamaBody.options?.temperature ?? 0,
    }
    // Explicit header, else the matter the user picked in the App.
    const matter = clientReq.headers['x-openlex-matter'] || engine.matters.active('app')?.id || null
    const wantStream = ollamaBody.stream !== false
    try {
      await engine.policy.withMatter(matter, async () => {
        if (!wantStream) {
          const content = await engine.llm.chat(ollamaBody.messages || [], opts)
          clientRes.writeHead(200, { 'Content-Type': 'application/x-ndjson' })
          clientRes.write(JSON.stringify({ model, message: { role: 'assistant', content }, done: false }) + '\n')
          clientRes.end(JSON.stringify({ model, done: true, total_duration: 0 }) + '\n')
          return
        }
        let started = false
        for await (const delta of engine.llm.chatStream(ollamaBody.messages || [], opts)) {
          if (!started) { clientRes.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Transfer-Encoding': 'chunked' }); started = true }
          clientRes.write(JSON.stringify({ model, created_at: new Date().toISOString(), message: { role: 'assistant', content: delta }, done: false }) + '\n')
        }
        if (!started) clientRes.writeHead(200, { 'Content-Type': 'application/x-ndjson' })
        clientRes.end(JSON.stringify({ model, done: true, total_duration: 0 }) + '\n')
      })
    } catch (err) {
      if (clientRes.headersSent) { clientRes.end(JSON.stringify({ error: err.message, done: true }) + '\n'); return }
      clientRes.writeHead(err.code === 'POLICY_BLOCKED' ? 403 : 502, { 'Content-Type': 'application/json' })
      clientRes.end(JSON.stringify({ error: err.message }))
    }
  }

  // Translate Ollama POST /api/chat to llama.cpp's OpenAI-compat
  // POST /api/chat/completions, then translate the SSE stream back to
  // Ollama-style NDJSON ({message: {content}}, {done: true}).
  async _handleOllamaChat(clientReq, clientRes) {
    // Cloud provider selected (shared ~/.lexvault/providers.json)? Route
    // through the OpenLex engine so the App gets the same keys, data
    // policy and audit log as the Word plugin. Local stays on llama-server.
    const engine = this._engine()
    if (engine && engine.llm.activeProvider().kind !== 'local') {
      return this._handleViaEngine(engine, clientReq, clientRes)
    }
    await this._ensureLLMRunning()

    // Buffer the incoming Ollama-format body so we can transform it.
    const bodyBuf = await new Promise((resolve, reject) => {
      const chunks = []
      clientReq.on('data', c => chunks.push(c))
      clientReq.on('end', () => resolve(Buffer.concat(chunks)))
      clientReq.on('error', reject)
    })
    let ollamaBody
    try { ollamaBody = JSON.parse(bodyBuf.toString('utf8')) }
    catch { throw new Error('invalid JSON in /api/chat body') }

    const openaiBody = {
      messages: ollamaBody.messages || [],
      temperature: ollamaBody.options?.temperature ?? 0,
      max_tokens: ollamaBody.options?.num_predict ?? 2048,
      stream: ollamaBody.stream !== false,
    }
    const wantStream = openaiBody.stream

    const upstreamPath = '/api/chat/completions'
    const upstreamReq = http.request({
      host: '127.0.0.1',
      port: this._llmInternalPort,
      method: 'POST',
      path: upstreamPath,
      headers: { 'Content-Type': 'application/json' },
    })
    upstreamReq.write(JSON.stringify(openaiBody))
    upstreamReq.end()

    const upstreamRes = await new Promise((resolve, reject) => {
      upstreamReq.on('response', resolve)
      upstreamReq.on('error', reject)
      upstreamReq.setTimeout(900_000, () => upstreamReq.destroy(new Error('llama-server timeout')))
    })
    if (upstreamRes.statusCode >= 400) {
      const errBuf = await new Promise(resolve => {
        const c = []; upstreamRes.on('data', d => c.push(d)); upstreamRes.on('end', () => resolve(Buffer.concat(c)))
      })
      throw new Error(`llama-server ${upstreamRes.statusCode}: ${errBuf.toString('utf8').slice(0, 200)}`)
    }

    // Headers: send Ollama-flavoured response (NDJSON application/x-ndjson).
    clientRes.writeHead(200, {
      'Content-Type': 'application/x-ndjson',
      'Transfer-Encoding': 'chunked',
    })

    if (!wantStream) {
      // Non-streaming path (rare). Buffer full OpenAI response, emit a
      // single Ollama-style record + done.
      const buf = await new Promise(resolve => {
        const c = []; upstreamRes.on('data', d => c.push(d)); upstreamRes.on('end', () => resolve(Buffer.concat(c)))
      })
      const obj = JSON.parse(buf.toString('utf8'))
      const content = obj.choices?.[0]?.message?.content || ''
      clientRes.write(JSON.stringify({ model: ollamaBody.model || 'local', message: { role: 'assistant', content }, done: false }) + '\n')
      clientRes.end(JSON.stringify({ model: ollamaBody.model || 'local', done: true, total_duration: 0 }) + '\n')
      return
    }

    // Streaming path: parse SSE `data: {...}` lines, emit Ollama records
    // for each delta.content token, then a final done:true line.
    let leftover = ''
    upstreamRes.setEncoding('utf8')
    upstreamRes.on('data', chunk => {
      leftover += chunk
      let idx
      while ((idx = leftover.indexOf('\n')) !== -1) {
        const line = leftover.slice(0, idx).trim()
        leftover = leftover.slice(idx + 1)
        if (!line || !line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (payload === '[DONE]') continue
        try {
          const evt = JSON.parse(payload)
          const delta = evt.choices?.[0]?.delta?.content || ''
          if (delta) {
            clientRes.write(JSON.stringify({
              model: ollamaBody.model || 'local',
              created_at: new Date().toISOString(),
              message: { role: 'assistant', content: delta },
              done: false,
            }) + '\n')
          }
        } catch { /* skip malformed sse line */ }
      }
    })
    upstreamRes.on('end', () => {
      clientRes.end(JSON.stringify({
        model: ollamaBody.model || 'local',
        created_at: new Date().toISOString(),
        message: { role: 'assistant', content: '' },
        done: true,
      }) + '\n')
    })
    upstreamRes.on('error', err => {
      console.error('[llm-proxy] upstream stream error:', err.message)
      try { clientRes.end() } catch {}
    })
  }

  async _ensureLLMRunning() {
    if (!this._llmModelPath) {
      throw new Error(`No local model installed. Choose a provider with your own API key (or a custom llama-server / Ollama endpoint) in the model settings, or put a .gguf file in ${path.join(this.paths.models, 'llm')} and restart OpenLex.`)
    }
    if (this._llmChild && !this._llmChild.killed) return
    if (this._llmReadyPromise) return this._llmReadyPromise

    // Wait for /api/tags to respond OR for the spawned child to exit
    // (whichever happens first). When llama-server crashes at startup
    // (e.g. "Found 0 Vulkan devices") the exit fires immediately — we want
    // to bail and try CPU instead of waiting the full HTTP timeout.
    const waitForReadyOrExit = (timeoutMs) => new Promise((resolve, reject) => {
      let done = false
      const child = this._llmChild
      const onChildExit = (code) => {
        if (done) return
        done = true
        reject(new Error(`llama-server exited (${code}) before becoming healthy`))
      }
      child?.once('exit', onChildExit)
      waitForHttp(`http://127.0.0.1:${this._llmInternalPort}/api/tags`, timeoutMs).then(
        () => { if (done) return; done = true; child?.removeListener('exit', onChildExit); resolve() },
        (err) => { if (done) return; done = true; child?.removeListener('exit', onChildExit); reject(err) },
      )
    })

    this._llmReadyPromise = (async () => {
      // Fallback chain: CUDA → Vulkan → CPU.
      //
      // On NVIDIA hardware we prefer the CUDA build (2-3x faster than Vulkan
      // on the same card — proper cuBLAS + tensor-core paths). If the CUDA
      // exe fails (driver too old for cu12.4, missing cudart, etc.) we drop
      // to the Vulkan binary, which itself falls back to CPU at layer=0.
      const hw = this._readHardware()
      const gpuType = hw.detected?.gpu?.type
      const cudaBin = resolveBinary(this.paths.bin, 'llama-server-cuda')
      const wantsCuda = gpuType === 'cuda' && fs.existsSync(cudaBin)

      if (wantsCuda) {
        this._spawnLLMChild({ forceCpu: false, variant: 'cuda' })
        try {
          await waitForReadyOrExit(180_000)
          console.log('[llm-proxy] llama-server ready (CUDA)')
          this._llmRuntime = 'cuda'
          this._llmFellBackToCpu = false
          return
        } catch (err) {
          console.warn(`[llm-proxy] CUDA spawn failed (${err.message}); trying Vulkan`)
          try { if (this._llmChild && !this._llmChild.killed) this._llmChild.kill('SIGKILL') } catch {}
          this._llmChild = null
        }
      }

      this._spawnLLMChild({ forceCpu: false, variant: 'vulkan' })
      try {
        // 180s — RDNA1 cards (RX 5700 XT) + Windows + Defender mid-scan can
        // take 90-120s to mmap a 5GB GGUF and warm Vulkan. 60s was too tight.
        await waitForReadyOrExit(180_000)
        console.log('[llm-proxy] llama-server ready (Vulkan)')
        this._llmRuntime = 'vulkan'
        this._llmFellBackToCpu = false
        return
      } catch (err) {
        console.warn(`[llm-proxy] Vulkan spawn failed (${err.message}); falling back to CPU`)
        try { if (this._llmChild && !this._llmChild.killed) this._llmChild.kill('SIGKILL') } catch {}
        this._llmChild = null
        this._spawnLLMChild({ forceCpu: true, variant: 'vulkan' })
        await waitForReadyOrExit(180_000)
        this._llmRuntime = 'cpu'
        this._llmFellBackToCpu = true
        console.log('[llm-proxy] llama-server ready (CPU fallback)')
      }
    })()
    try { await this._llmReadyPromise }
    finally { /* keep promise around; cleared on kill */ }
  }

  // Recent stderr + stdout lines from llama-server. Surfaced in the
  // Dependencies tab so users can copy-paste real error messages instead
  // of guessing at "it just hangs."
  getLLMLog() {
    return (this._llmLog || []).slice(-200).join('\n')
  }
  getLLMState() {
    return {
      running: !!(this._llmChild && !this._llmChild.killed),
      fellBackToCpu: !!this._llmFellBackToCpu,
      runtime: this._llmRuntime || null,    // 'cuda' | 'vulkan' | 'cpu' | null
      lastUsedAt: this._llmLastUsedAt,
      idleMs: this._llmIdleMs,
      logTail: this.getLLMLog(),
    }
  }

  _spawnLLMChild({ forceCpu = false, variant = 'vulkan' } = {}) {
    const hw = this._readHardware()
    const cores = require('os').cpus().length
    const threadPct = hw.threads_pct ?? 0.5
    const cacheTypeK = hw.cache_type_k ?? 'q8_0'
    const cacheTypeV = hw.cache_type_v ?? 'q8_0'
    const gpuLayers = forceCpu ? 0 : (hw.n_gpu_layers ?? 0)
    const args = [
      '-m', this._llmModelPath,
      '--host', '127.0.0.1',
      '--port', String(this._llmInternalPort),
      '--ctx-size', String(hw.ctx ?? 8192),
      '--threads', String(Math.max(2, Math.floor(cores * threadPct))),
      '--api-prefix', '/api',
      '--cache-type-k', cacheTypeK,
      '--cache-type-v', cacheTypeV,
      // llama.cpp b9000+ changed --flash-attn from a boolean flag to one
      // taking on|off|auto. KV-quant requires flash attention to engage,
      // so we pass 'on' explicitly.
      '--flash-attn', 'on',
      // One slot: newer llama-server builds default to 4 parallel slots and
      // split ctx between them (2K/slot at 8K), which truncated long JSON
      // replies mid-object — same fix as the Word sidecar (runtime.js).
      // The App and the Word plugin share this server, one request at a time.
      '--parallel', '1',
    ]
    if (gpuLayers > 0) args.push('--n-gpu-layers', String(gpuLayers))
    console.log(`[llm] spawning tier=${hw.tier} variant=${variant} model=${hw.model} ctx=${hw.ctx} gpu_layers=${gpuLayers}${forceCpu ? ' (CPU fallback)' : ''} kv=${cacheTypeK}/${cacheTypeV}`)

    const platform = process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'win32' : 'linux'
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
    // CUDA build has its own binary + its own libs dir (cublas + cudart + the
    // CUDA-flavored ggml DLLs). We MUST NOT mix it with the Vulkan libs dir —
    // both ship a ggml-base.dll and the Windows loader resolves whichever
    // comes first on PATH, which would either break Vulkan when it picks up
    // CUDA-flavored DLLs or break CUDA the other way around. Hence the
    // variant-specific paths.
    const isCuda = variant === 'cuda' && !forceCpu
    const binaryPath = isCuda
      ? resolveBinary(this.paths.bin, 'llama-server-cuda')
      : this._llmBinary
    const libsDir = isCuda
      ? path.join(this.paths.bin, `llama-cuda-${platform}-${arch}-libs`)
      : path.join(this.paths.bin, `llama-${platform}-${arch}-libs`)
    // OS-specific dynamic-library lookup:
    //   - macOS: DYLD_LIBRARY_PATH points at the libs dir (.dylib + .metallib)
    //   - Linux: LD_LIBRARY_PATH points at the libs dir (.so)
    //   - Windows: PATH must include the libs dir so the loader finds the
    //     accompanying DLLs (ggml-vulkan.dll, llama-common.dll, etc.).
    //     LD_LIBRARY_PATH is a Linux-ism that Windows ignores entirely.
    const env = { ...process.env }
    if (fs.existsSync(libsDir)) {
      if (process.platform === 'darwin') {
        env.DYLD_LIBRARY_PATH = libsDir
      } else if (process.platform === 'win32') {
        const sep = ';'
        env.PATH = libsDir + sep + (env.PATH || env.Path || '')
      } else {
        env.LD_LIBRARY_PATH = libsDir
      }
    }
    // ggml-vulkan: explicitly select device 0. Some Windows installs
    // expose multiple Vulkan ICDs (e.g. AMDVLK + Adrenalin's amdvlk64) and
    // the loader picks the empty one, returning "Found 0 Vulkan devices".
    // GGML_VK_VISIBLE_DEVICES=0 forces the first concrete device. Only
    // relevant for the Vulkan binary — CUDA enumerates via CUDA_VISIBLE_DEVICES.
    // Apple uses Metal; CPU fallback doesn't need it.
    if (!forceCpu && !isCuda && process.platform !== 'darwin' && hw.tier !== 'cpu') {
      if (!env.GGML_VK_VISIBLE_DEVICES) env.GGML_VK_VISIBLE_DEVICES = '0'
    }
    if (isCuda) {
      // Pin to GPU 0 for predictability when a laptop has both an integrated
      // and discrete NVIDIA card (rare on desktops, real on Optimus laptops).
      if (!env.CUDA_VISIBLE_DEVICES) env.CUDA_VISIBLE_DEVICES = '0'
    }
    // On Windows, the DLL search order is: (1) exe's directory, (2) the
    // process current directory, (3) PATH. Our exe lives in bin/ but the
    // companion DLLs (ggml-base.dll, ggml-vulkan.dll OR cublas64_12.dll, etc.)
    // live in bin/llama-{cuda-}win32-x64-libs/. Belt-and-suspenders: (a) copy
    // the exe into the libs dir so search-order #1 wins, (b) also set cwd so
    // #2 works as a backstop. Either alone should be enough.
    let exeToSpawn = binaryPath
    let spawnCwd
    if (process.platform === 'win32' && fs.existsSync(libsDir)) {
      const colocatedExe = path.join(libsDir, path.basename(binaryPath))
      try {
        if (!fs.existsSync(colocatedExe) ||
            fs.statSync(colocatedExe).size !== fs.statSync(binaryPath).size) {
          fs.copyFileSync(binaryPath, colocatedExe)
          console.log(`[llm] colocated exe with DLLs at ${colocatedExe}`)
        }
        exeToSpawn = colocatedExe
        spawnCwd = libsDir
      } catch (err) {
        console.warn(`[llm] could not colocate exe (${err.message}); falling back to PATH lookup`)
        spawnCwd = libsDir
      }
    }
    const child = spawn(exeToSpawn, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env,
      cwd: spawnCwd,
    })
    // Capture stderr/stdout lines into a ring buffer so the renderer can
    // show real errors when spawn fails (missing vulkan-1.dll, OOM, etc.).
    if (!this._llmLog) this._llmLog = []
    // Patterns that are llama.cpp's NORMAL informational output but make
    // the log tail look alarming. Filter them so the panel surfaces only
    // signals worth reading. Real errors (missing DLLs, model load failure,
    // OOM, exit codes) all bypass these filters.
    const isNoise = (line) => {
      // "[err] ." — dot-only progress lines (model loading)
      if (/^\.+$/.test(line)) return true
      // "/api/tags 503/404" — health probes during/after warmup
      if (/srv\s+log_server_r:\s*done request: GET \/api\/tags .* (404|503)\b/.test(line)) return true
      // chat-completion request log lines (200 OK during normal serving)
      if (/srv\s+log_server_r:\s*done request: POST \/api\/chat\/completions .* 200\b/.test(line)) return true
      // slot lifecycle chatter — cache hits, sampler chains, init counters
      if (/^slot\s+(get_availabl|launch_slot_|update_slots|init_sampler|prompt_clear|slot_save_an|create_check|release|print_timing)/.test(line)) return true
      // prompt_save / cache update / sched_reserve internals
      if (/^srv\s+(prompt_save|update|get_availabl|load:|update_slots:)/.test(line)) return true
      // empty-line "all slots are idle" repeat
      if (/srv\s+update_slots:\s*all slots are idle/.test(line)) return true
      return false
    }
    const onLine = (prefix) => (chunk) => {
      const text = chunk.toString()
      process.stdout.write(`[llm-${prefix}] ${text}`)
      for (const line of text.split('\n')) {
        const trimmed = line.replace(/\r$/, '').trim()
        if (!trimmed) continue
        if (isNoise(trimmed)) continue
        this._llmLog.push(`[${prefix}] ${trimmed}`)
      }
      // Keep buffer bounded at 500 lines
      while (this._llmLog.length > 500) this._llmLog.shift()
    }
    child.stdout?.on('data', onLine('out'))
    child.stderr?.on('data', onLine('err'))
    this._llmChild = child
    child.on('exit', code => {
      const msg = `[llm] llama-server exited (${code})`
      console.log(msg)
      this._llmLog.push(msg)
      if (this._llmChild === child) {
        this._llmChild = null
        this._llmReadyPromise = null
      }
    })
  }

  _readHardware() {
    try {
      return JSON.parse(fs.readFileSync(this.paths.hardware, 'utf8'))
    } catch (err) {
      throw new Error(`Cannot read hardware.json at ${this.paths.hardware} (${err.message}). Boot must run hardware-detect first.`)
    }
  }

  _startBackend() {
    const serverEntry = path.join(this.paths.server, 'dist', 'server.js')
    if (!fs.existsSync(serverEntry)) {
      throw new Error(`Backend entry missing at ${serverEntry}.`)
    }
    // Prisma SQLite on Windows wants `file:` + forward-slash absolute path
    // (NOT the file:///C:/... triple-slash form pathToFileURL produces — that
    // trips Prisma's URL parser into emitting CANTOPEN errors).
    // Make sure the parent directory exists before SQLite tries to create the
    // .db file there.
    fs.mkdirSync(path.dirname(this.paths.appDb), { recursive: true })
    // Seed app.db from the baseline if it doesn't exist OR if it's a stub
    // empty SQLite file from a previous failed boot. Earlier builds opened
    // Prisma against a never-migrated app.db, leaving an empty file the
    // supervisor would later refuse to overwrite — so every Prisma query
    // 500'd with "no such table". Threshold is 64KB: an empty SQLite with
    // WAL is < 32KB, baseline is ~2.6MB.
    const baseline = path.join(this.paths.server, 'prisma', 'baseline', 'app.db')
    const dbExists = fs.existsSync(this.paths.appDb)
    const dbSize = dbExists ? fs.statSync(this.paths.appDb).size : 0
    const dbLooksEmpty = dbExists && dbSize < 64 * 1024
    if (!dbExists || dbLooksEmpty) {
      if (fs.existsSync(baseline)) {
        if (dbLooksEmpty) {
          // Preserve the stub for postmortems. fs.renameSync is atomic on the
          // same volume; if it ever fails (cross-volume userData) just unlink.
          try { fs.renameSync(this.paths.appDb, this.paths.appDb + '.empty.bak') }
          catch { try { fs.unlinkSync(this.paths.appDb) } catch {} }
        }
        fs.copyFileSync(baseline, this.paths.appDb)
        console.log(`[backend] seeded app.db from baseline (existing=${dbExists} size=${dbSize} → ${fs.statSync(this.paths.appDb).size})`)
      } else {
        console.warn(`[backend] no baseline at ${baseline} — Prisma queries will fail until tables exist`)
      }
    }
    const dbFileUrl = 'file:' + this.paths.appDb.replace(/\\/g, '/')
    const child = spawn(process.execPath, [serverEntry], {
      cwd: this.paths.server,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        NODE_ENV: 'production',
        PORT: String(PORTS.backend),
        LEXVAULT_LOCAL_MODE: '1',
        // Community mode: no licence file → the backend uses its local user.
        LEXVAULT_LICENSE_PATH: this.license?.community ? '' : this.paths.license,
        DATABASE_URL: dbFileUrl,
        LLM_PROVIDER: 'ollama',
        OLLAMA_BASE_URL: `http://127.0.0.1:${PORTS.llm}`,
        OLLAMA_FALLBACK_URL: `http://127.0.0.1:${PORTS.llm}`,
        OLLAMA_MODEL: 'local',
        EMBEDDINGS_URL: `http://127.0.0.1:${PORTS.embeddings}`,
        QDRANT_URL: `http://127.0.0.1:${PORTS.qdrant}`,
        // Critical: the bundled retrieval/embeddings default to the
        // production collection name 'legal_chunks_hybrid_v2', which doesn't
        // exist in the local Qdrant (pack_ingest writes 'legal_chunks_local').
        // Without this, research finds zero sources because every points/query
        // 404s. Same env name the prod server uses.
        QDRANT_COLLECTION: 'legal_chunks_local',
        USE_HYBRID_SEARCH: '1',
        OPENROUTER_API_KEY: '',
        CLIENT_URL: `http://127.0.0.1:${PORTS.backend}`,
        JWT_SECRET: deriveLocalSecret(this.paths.userData),
      },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    pipeLogs(child, 'backend')
    // Track last 30 stderr lines so the boot-fail dialog can show them.
    this._backendErrTail = []
    child.stderr?.on('data', d => {
      const s = d.toString()
      for (const line of s.split('\n')) {
        if (line.trim()) this._backendErrTail.push(line)
      }
      while (this._backendErrTail.length > 30) this._backendErrTail.shift()
    })
    child.on('exit', code => {
      console.log(`[backend] exited (${code})`)
      if (code !== 0 && this._backendErrTail?.length) {
        console.log('[backend] last stderr lines:')
        for (const l of this._backendErrTail) console.log('   ', l)
      }
    })
    this.children.push(child)
    this._backendChild = child
  }

  // Expose backend stderr tail to main.js for diagnostics in the failure dialog
  getBackendErrTail() {
    return (this._backendErrTail || []).slice(-15).join('\n')
  }
}

// --- Helpers ----------------------------------------------------------------

function resolveBinary(binDir, name) {
  const platform = process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'win32' : 'linux'
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  const ext = platform === 'win32' ? '.exe' : ''
  return path.join(binDir, `${name}-${platform}-${arch}${ext}`)
}

function pipeLogs(child, label) {
  child.stdout?.on('data', d => process.stdout.write(`[${label}] ${d}`))
  child.stderr?.on('data', d => process.stderr.write(`[${label}!] ${d}`))
}

function waitForHttp(url, timeoutMs, opts = {}) {
  const { acceptAny = false } = opts
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.get(url, res => {
        res.resume()
        // acceptAny: any HTTP response means the server is listening.
        // default: < 500 only (excludes 502/503 from upstream-dependent endpoints).
        if (acceptAny && res.statusCode) return resolve()
        if (res.statusCode && res.statusCode < 500) return resolve()
        retry()
      })
      req.setTimeout(2000, () => { req.destroy(); retry() })
      req.on('error', () => retry())
    }
    const retry = () => {
      if (Date.now() > deadline) return reject(new Error(`Timeout waiting for ${url}`))
      setTimeout(tryOnce, 400)
    }
    tryOnce()
  })
}

function deriveLocalSecret(userDataDir) {
  // Stable per-install secret used by the local backend's session/jwt code.
  // Random on first boot, persisted thereafter. Never leaves the machine.
  const file = path.join(userDataDir, '.local_secret')
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim()
  const secret = require('crypto').randomBytes(48).toString('hex')
  fs.writeFileSync(file, secret, { mode: 0o600 })
  return secret
}

module.exports = Supervisor
module.exports.PORTS = PORTS
