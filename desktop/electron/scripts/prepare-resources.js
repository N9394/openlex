#!/usr/bin/env node
/**
 * Stage everything electron-builder needs to package into resources/
 * before running `electron-builder`.
 *
 * Inputs:
 *   ../server/dist            (TypeScript-compiled Express backend)
 *   ../server/prisma          (Prisma schema + migrations)
 *   ../server/node_modules    (runtime deps — we copy a pruned subset)
 *   ../client-vite/dist       (Vite-built SPA)
 *
 * Outputs:
 *   resources/server/         (server/dist + server/prisma + node_modules)
 *   resources/client/         (client SPA — same as Vite dist)
 *   resources/bin/            (placeholder — Launcher fills this with Qdrant/llama-server)
 *   resources/models/         (placeholder — Launcher fills this with GGUFs + BGE-M3)
 *   resources/public_key.pem  (the Ed25519 public key for license verification)
 *
 * Run before electron-builder. The package.json `package` script does this.
 */

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
// OpenLex repo layout: desktop/{electron,client,server-fixes}. The compiled
// Express backend (server/dist + prisma + node_modules) is not in the repo;
// point OPENLEX_SERVER_DIR at it (defaults to the legacy product/server).
const DESKTOP = path.resolve(ROOT, '..')
const SERVER_SRC = process.env.OPENLEX_SERVER_DIR || path.resolve(ROOT, '..', '..', '..', 'product', 'server')
const CLIENT_SRC = path.join(DESKTOP, 'client')
const FIXES_DIR = path.join(DESKTOP, 'server-fixes')

const RES = path.join(ROOT, 'resources')
const RES_SERVER = path.join(RES, 'server')
const RES_CLIENT = path.join(RES, 'client')
const RES_BIN = path.join(RES, 'bin')
const RES_MODELS = path.join(RES, 'models')

function ensure(dir) { fs.mkdirSync(dir, { recursive: true }) }
function rmRf(p) { fs.rmSync(p, { recursive: true, force: true }) }
function copyDir(src, dst, opts = {}) {
  if (!fs.existsSync(src)) {
    if (opts.optional) return false
    throw new Error(`missing source: ${src}`)
  }
  ensure(dst)
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (opts.filter && !opts.filter(entry.name)) continue
    const s = path.join(src, entry.name)
    const d = path.join(dst, entry.name)
    if (entry.isDirectory()) {
      copyDir(s, d, opts)
    } else {
      fs.copyFileSync(s, d)
    }
  }
  return true
}

async function step(label, fn) {
  process.stdout.write(`▸ ${label} … `)
  const t = Date.now()
  try {
    const r = fn()
    if (r && typeof r.then === 'function') await r
    process.stdout.write(`done (${Date.now() - t}ms)\n`)
  } catch (err) {
    process.stdout.write(`FAILED\n`)
    throw err
  }
}

async function main() {
  await step('clean resources', () => {
    rmRf(RES_SERVER); rmRf(RES_CLIENT)
    ensure(RES); ensure(RES_BIN); ensure(RES_MODELS)
  })

  // 1. Build server if needed (compile TypeScript)
  await step('build server (tsc)', () => {
    if (!fs.existsSync(path.join(SERVER_SRC, 'dist', 'server.js'))) {
      execSync('npm run build', { cwd: SERVER_SRC, stdio: 'inherit' })
    }
  })

  // 2. Build client if needed (vite build)
  await step('build client (vite)', () => {
    if (!fs.existsSync(path.join(CLIENT_SRC, 'dist', 'index.html'))) {
      execSync('npm run build', { cwd: CLIENT_SRC, stdio: 'inherit' })
    }
  })

  // 3. Stage server
  await step('stage server', () => {
    copyDir(path.join(SERVER_SRC, 'dist'), path.join(RES_SERVER, 'dist'))
    copyDir(path.join(SERVER_SRC, 'prisma'), path.join(RES_SERVER, 'prisma'))
    fs.copyFileSync(path.join(SERVER_SRC, 'package.json'), path.join(RES_SERVER, 'package.json'))
    if (fs.existsSync(path.join(SERVER_SRC, 'package-lock.json'))) {
      fs.copyFileSync(path.join(SERVER_SRC, 'package-lock.json'), path.join(RES_SERVER, 'package-lock.json'))
    }
    // Fix files (runtime overrides) — copy to dist paths inside the staged server.
    // Mirrors what docker-compose volume-mounts do today.
    if (fs.existsSync(FIXES_DIR)) {
      const fixMap = {
        'researchChatService.js': 'dist/services/researchChatService.js',
        'llmAdapter.js': 'dist/services/llmAdapter.js',
        'retrieval.js': 'dist/services/rag/retrieval.js',
        'reranker.js': 'dist/services/rag/reranker.js',
        'embeddings.js': 'dist/services/rag/embeddings.js',
        'navigatorService.js': 'dist/services/navigatorService.js',
        'navigator.js': 'dist/routes/navigator.js',
        'docs.js': 'dist/routes/docs.js',
        'auth.js': 'dist/routes/auth.js',
        'authMiddleware.js': 'dist/middleware/auth.js',
        'account.js': 'dist/routes/account.js',
        'research_route.js': 'dist/routes/research.js',
        'organization.js': 'dist/routes/organization.js',
        'workshop_route.js': 'dist/routes/workshop.js',
        'parallelProcessor.js': 'dist/services/parallelProcessor.js',
        'modelRouter.js': 'dist/services/modelRouter.js',
        'modelWarmup.js': 'dist/services/modelWarmup.js',
        'docParser.js': 'dist/services/docParser.js',
        'aiAuditService.js': 'dist/services/aiAuditService.js',
        'rateLimit.js': 'dist/middleware/rateLimit.js',
        'maService.js': 'dist/services/maService.js',
        'maAnalyzers.js': 'dist/services/maAnalyzers.js',
        'maScheduler.js': 'dist/services/maScheduler.js',
        'ma_route.js': 'dist/routes/ma_route.js',
        'server.js': 'dist/server.js',
        'sessionService.js': 'dist/services/sessionService.js',
        'emailService.js': 'dist/services/emailService.js',
        'documentDrafter.js': 'dist/services/documentDrafter.js',
        'clauseNLIService.js': 'dist/services/clauseNLIService.js',
        'clauseStatuteValidator.js': 'dist/services/clauseStatuteValidator.js',
        'clausePatternExtractor.js': 'dist/services/clausePatternExtractor.js',
        'constrainedCitationService.js': 'dist/services/constrainedCitationService.js',
        'groundedSchema.js': 'dist/services/groundedSchema.js',
        'vault.js': 'dist/routes/vault.js',
        'directoryValidator.js': 'dist/services/rag/directoryValidator.js',
        'schema.prisma': 'prisma/schema.prisma',
      }
      for (const [src, dst] of Object.entries(fixMap)) {
        const s = path.join(FIXES_DIR, src)
        const d = path.join(RES_SERVER, dst)
        if (fs.existsSync(s)) {
          ensure(path.dirname(d))
          fs.copyFileSync(s, d)
        }
      }
    }
  })

  // 4. Stage client
  // OpenLex engine library: the Word sidecar's provider facade + data policy
  // + keychain, so the App's LLM proxy honours the same provider choice,
  // keys and policy (supervisor.js _handleViaEngine).
  // Staged as a full package (src/ + package.json + node_modules) because
  // the App also RUNS the engine (main/engine.js) when the Word plugin
  // hasn't started one. Optional deps (ONNX embeddings, ~600 MB) are
  // skipped: the App has its own embeddings service.
  await step('stage engine', () => {
    const SIDECAR = path.resolve(ROOT, '..', '..', 'sidecar')
    const ENGINE = path.join(RES, 'engine')
    copyDir(path.join(SIDECAR, 'src'), path.join(ENGINE, 'src'))
    copyDir(path.join(SIDECAR, 'playbooks'), path.join(ENGINE, 'playbooks'))
    copyDir(path.join(SIDECAR, 'skills'), path.join(ENGINE, 'skills'))
    // A distributor's build: their distribution.json (licence/update server)
    // comes from a private path, never from the repo.
    if (process.env.OPENLEX_DISTRIBUTION) {
      fs.copyFileSync(process.env.OPENLEX_DISTRIBUTION, path.join(ENGINE, 'distribution.json'))
      fs.copyFileSync(process.env.OPENLEX_DISTRIBUTION, path.join(path.dirname(ENGINE), 'distribution.json'))
    }
    copyDir(path.join(SIDECAR, 'bin'), path.join(ENGINE, 'bin'), { filter: (n) => n === 'openlex.js' })
    for (const f of ['package.json', 'package-lock.json']) fs.copyFileSync(path.join(SIDECAR, f), path.join(ENGINE, f))
    copyDir(path.resolve(ROOT, '..', '..', 'add-in'), path.join(ENGINE, 'add-in'), { filter: (n) => n !== 'node_modules' })
    execSync('npm ci --omit=dev --omit=optional --no-audit --no-fund', { cwd: ENGINE, stdio: 'inherit' })
  })

  await step('stage client', () => {
    copyDir(path.join(CLIENT_SRC, 'dist'), RES_CLIENT)
  })

  // 4b. Make the staged server cross-platform-installable.
  //   - Swap bcrypt (native) → bcryptjs (pure JS) — no per-platform binary churn
  //   - Add binaryTargets to schema.prisma so we ship Mac + Windows engines
  //   - Replace require('bcrypt') with require('bcryptjs') in compiled JS
  // Production server (product/server/) is untouched; this only affects the
  // App-bundled copy.
  await step('cross-platform-ize staged server', () => {
    const pkgPath = path.join(RES_SERVER, 'package.json')
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
    if (pkg.dependencies?.bcrypt) {
      delete pkg.dependencies.bcrypt
      pkg.dependencies.bcryptjs = '^2.4.3'
    }
    // Drop dev-y / heavy deps not needed at runtime in App mode
    for (const k of ['nodemon', 'typescript', '@types', 'eslint', 'jest', 'prettier']) {
      if (pkg.dependencies?.[k]) delete pkg.dependencies[k]
    }
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')

    // Prisma binaryTargets — produce engines for every platform we ship.
    // 'native' covers the host (Mac during build); explicit Windows + Linux
    // coverage so the bundled server.js can connect on any user's OS.
    const schemaPath = path.join(RES_SERVER, 'prisma', 'schema.prisma')
    if (fs.existsSync(schemaPath)) {
      let schema = fs.readFileSync(schemaPath, 'utf8')
      schema = schema.replace(
        /generator\s+client\s*\{[^}]*\}/,
        `generator client {\n  provider = "prisma-client-js"\n  binaryTargets = ["native", "windows", "darwin", "darwin-arm64", "debian-openssl-3.0.x"]\n}`
      )
      fs.writeFileSync(schemaPath, schema)
    }

    // Replace bcrypt imports in the compiled JS. Walk dist/, rewrite require/import.
    const replaceBcrypt = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name)
        if (entry.isDirectory()) replaceBcrypt(p)
        else if (entry.name.endsWith('.js') || entry.name.endsWith('.mjs')) {
          let src = fs.readFileSync(p, 'utf8')
          const before = src
          src = src.replace(/require\(\s*['"]bcrypt['"]\s*\)/g, `require('bcryptjs')`)
          src = src.replace(/from\s+['"]bcrypt['"]/g, `from 'bcryptjs'`)
          if (src !== before) fs.writeFileSync(p, src)
        }
      }
    }
    replaceBcrypt(path.join(RES_SERVER, 'dist'))
  })

  // 4c. Install runtime dependencies for the staged server. Without this the
  // backend dies at boot with "Cannot find module 'express'". Install via the
  // host's npm; bcryptjs avoids native rebuilds, Prisma fetches per-platform
  // engines based on binaryTargets above.
  await step('install staged server deps', () => {
    if (fs.existsSync(path.join(RES_SERVER, 'node_modules'))) {
      console.log('  (server node_modules already present, skipping install)')
    } else {
      execSync('npm install --omit=dev --omit=optional --no-audit --no-fund --legacy-peer-deps',
        { cwd: RES_SERVER, stdio: 'inherit' })
    }
    // Prisma generate — produces the per-platform query engines listed in
    // schema.prisma's binaryTargets.
    execSync('npx --yes prisma@5 generate --schema=prisma/schema.prisma',
      { cwd: RES_SERVER, stdio: 'inherit' })

    // Trim Prisma engines we don't ship for THIS package target. The full
    // matrix lands during install/generate; we keep only the matching one(s).
    const argv = process.env.npm_config_argv ? JSON.parse(process.env.npm_config_argv).original : []
    const wantsWin   = process.env.PACKAGE_TARGETS?.includes('win')   || argv.includes('--win')
    const wantsMac   = process.env.PACKAGE_TARGETS?.includes('mac')   || argv.includes('--mac')   || (!wantsWin && process.platform === 'darwin')
    const wantsLinux = process.env.PACKAGE_TARGETS?.includes('linux') || argv.includes('--linux')
    const enginesDir = path.join(RES_SERVER, 'node_modules', '.prisma', 'client')
    if (fs.existsSync(enginesDir)) {
      for (const f of fs.readdirSync(enginesDir)) {
        const lc = f.toLowerCase()
        const isEngine = lc.startsWith('query_engine-') || lc.startsWith('libquery_engine-')
        if (!isEngine) continue
        const isWin   = /windows/.test(lc)
        const isMac   = /darwin/.test(lc)
        const isLinux = /debian|linux/.test(lc)
        if ((isWin && !wantsWin) || (isMac && !wantsMac) || (isLinux && !wantsLinux)) {
          rmRf(path.join(enginesDir, f))
          console.log(`  pruned prisma engine: ${f}`)
        }
      }
    }
  })

  // 5. Public key for license verification (optional in dev)
  await step('stage public key', () => {
    const localKey = process.env.OPENLEX_PUBLIC_KEY_PATH || path.join(ROOT, '..', '..', 'certs', 'public_key.pem')
    if (fs.existsSync(localKey)) {
      fs.copyFileSync(localKey, path.join(RES, 'public_key.pem'))
    } else {
      console.warn('  (no public_key.pem found — dev build, license verification will be skipped)')
    }
  })

  // 6. Fetch native sidecar binaries (Qdrant + llama-server) into resources/bin/
  await step('fetch sidecars', () => {
    execSync('node scripts/fetch-sidecars.js', { cwd: ROOT, stdio: 'inherit' })
  })

  // 6b. Prune wrong-platform sidecar binaries from resources/bin/ so the Mac
  // build doesn't carry Windows DLLs and vice versa. The fetch script keeps
  // every variant on disk for incremental rebuilds; we only ship the matching
  // ones. Run AFTER fetch so the canonical binaries are present.
  await step('prune cross-platform binaries', () => {
    const argv = process.env.npm_config_argv ? JSON.parse(process.env.npm_config_argv).original : []
    const wantsWin   = process.env.PACKAGE_TARGETS?.includes('win')   || argv.includes('--win')
    const wantsMac   = process.env.PACKAGE_TARGETS?.includes('mac')   || argv.includes('--mac')   || (!wantsWin && process.platform === 'darwin')
    const wantsLinux = process.env.PACKAGE_TARGETS?.includes('linux') || argv.includes('--linux')
    // Optional per-arch narrowing (PACKAGE_ARCH=arm64|x64). When unset we
    // keep every matching-OS variant — useful for "build both arches in one
    // pass" workflows. When set, we drop the other arch so the final .zip
    // doesn't ship a 65 MB qdrant for an architecture this build can't run.
    const arch = (process.env.PACKAGE_ARCH || '').toLowerCase()
    const keep = []
    if (wantsMac) {
      if (arch === 'arm64') keep.push('darwin-arm64')
      else if (arch === 'x64') keep.push('darwin-x64')
      else keep.push('darwin-arm64', 'darwin-x64')
    }
    if (wantsWin) {
      if (arch === 'arm64') keep.push('win32-arm64')
      else if (arch === 'x64') keep.push('win32-x64')
      else keep.push('win32-x64')
    }
    if (wantsLinux) {
      if (arch === 'arm64') keep.push('linux-arm64')
      else if (arch === 'x64') keep.push('linux-x64')
      else keep.push('linux-x64', 'linux-arm64')
    }
    for (const f of fs.readdirSync(RES_BIN, { withFileTypes: true })) {
      if (f.name === 'embeddings' || f.name === 'README.txt') continue
      const matchesKeep = keep.some(k => f.name.includes(k))
      if (!matchesKeep) {
        const p = path.join(RES_BIN, f.name)
        rmRf(p)
        console.log(`  pruned: ${f.name}`)
      }
    }
  })

  // 7. Install embeddings sidecar runtime deps (@huggingface/transformers + express)
  //    Prune ONNX runtime variants we don't ship for the current target.
  //    onnxruntime-web is always browser-only and never needed.
  //    The OS-native binaries we keep depend on which platform(s) we're packaging.
  await step('install embeddings deps', () => {
    const embDir = path.join(RES_BIN, 'embeddings')
    if (!fs.existsSync(path.join(embDir, 'package.json'))) {
      throw new Error(`Expected embeddings sidecar at ${embDir} (server.js + package.json)`)
    }
    // Re-create node_modules cleanly so a previous mac-only prune doesn't leave us
    // without the win32/linux binaries needed for those targets.
    rmRf(path.join(embDir, 'node_modules'))
    execSync('npm install --omit=dev --omit=optional --no-audit --no-fund', { cwd: embDir, stdio: 'inherit' })

    rmRf(path.join(embDir, 'node_modules', 'onnxruntime-web'))

    // What we're packaging: explicit override > electron-builder argv > host platform
    const argv = process.env.npm_config_argv ? JSON.parse(process.env.npm_config_argv).original : []
    const wantsWin   = process.env.PACKAGE_TARGETS?.includes('win')   || argv.includes('--win')
    const wantsMac   = process.env.PACKAGE_TARGETS?.includes('mac')   || argv.includes('--mac')   || (!wantsWin && process.platform === 'darwin')
    const wantsLinux = process.env.PACKAGE_TARGETS?.includes('linux') || argv.includes('--linux')
    const wantsArm64 = process.env.PACKAGE_ARCH === 'arm64' || argv.includes('--arm64') || (process.arch === 'arm64' && !argv.includes('--x64'))
    const wantsX64   = process.env.PACKAGE_ARCH === 'x64'   || argv.includes('--x64')   || (process.arch === 'x64' && !argv.includes('--arm64'))

    const napi = path.join(embDir, 'node_modules', 'onnxruntime-node', 'bin', 'napi-v3')
    if (!wantsWin)   rmRf(path.join(napi, 'win32'))
    if (!wantsMac)   rmRf(path.join(napi, 'darwin'))
    if (!wantsLinux) rmRf(path.join(napi, 'linux'))

    // `sharp` is pulled in transitively by @huggingface/transformers (for
    // its vision-pipeline image preprocessing). It uses platform-specific
    // native binaries published as OPTIONAL deps (@img/sharp-win32-x64,
    // @img/sharp-darwin-arm64, …). With --omit=optional above, none of
    // those are installed → at runtime `require('sharp')` throws "Could
    // not load the \"sharp\" module using the win32-x64 runtime" and the
    // BGE-M3 dense encoder never starts. Symptom: research finds zero
    // sources because the query never gets vectorized.
    // Install the right binary for whatever target we're packaging for.
    // Install per-target. npm refuses host/target mismatches on the os/cpu
    // fields in @img/sharp-{platform}'s package.json (e.g. installing
    // sharp-win32-x64 on a darwin host fails EBADPLATFORM). Use --os and
    // --cpu to tell npm what target we're packing for.
    const sharpTargets = []
    if (wantsWin)   sharpTargets.push({ os: 'win32',  cpu: 'x64',   pkgs: ['@img/sharp-win32-x64'] })
    if (wantsMac && wantsArm64) sharpTargets.push({ os: 'darwin', cpu: 'arm64', pkgs: ['@img/sharp-darwin-arm64', '@img/sharp-libvips-darwin-arm64'] })
    if (wantsMac && wantsX64)   sharpTargets.push({ os: 'darwin', cpu: 'x64',   pkgs: ['@img/sharp-darwin-x64',   '@img/sharp-libvips-darwin-x64'] })
    if (wantsLinux) sharpTargets.push({ os: 'linux',  cpu: 'x64',   pkgs: ['@img/sharp-linux-x64',  '@img/sharp-libvips-linux-x64'] })
    for (const t of sharpTargets) {
      console.log(`  installing sharp for ${t.os}-${t.cpu}: ${t.pkgs.join(', ')}`)
      // npm rejects cross-platform installs with EBADPLATFORM even when
      // --os and --cpu are passed (it enforces the package's own "os"
      // field against the host). --force overrides that check; combined
      // with --os/--cpu, npm fetches the correct tarball anyway.
      try {
        execSync(`npm install --no-save --no-audit --no-fund --force --os=${t.os} --cpu=${t.cpu} ${t.pkgs.join(' ')}`,
          { cwd: embDir, stdio: 'inherit' })
      } catch (err) {
        console.warn(`  sharp install for ${t.os}-${t.cpu} failed: ${err.message.slice(0, 200)}`)
      }
    }
  })

  // 7a. Obfuscate high-value server JS so casual unzipping of the .exe/.app
  // doesn't yield readable prompt templates, judge logic, or RAG plumbing.
  // Runs javascript-obfuscator with conservative settings (no dead-code
  // injection, no string array shuffle — those break Prisma's runtime
  // reflection). Skip with SKIP_OBFUSCATION=1 for fast iteration.
  await step('obfuscate high-value server JS', () => {
    if (process.env.SKIP_OBFUSCATION === '1') {
      console.log('  (skipped via SKIP_OBFUSCATION=1)')
      return
    }
    let JsObfuscator
    try { JsObfuscator = require('javascript-obfuscator') }
    catch (e) {
      console.log('  (javascript-obfuscator not installed — npm install -D javascript-obfuscator)')
      return
    }
    // Files where the proprietary value lives: LLM prompts + RAG + judge.
    // Everything else stays minified-but-readable to keep stack traces useful.
    const TARGETS = [
      'dist/services/researchChatService.js',
      'dist/services/llmAdapter.js',
      'dist/services/rag/retrieval.js',
      'dist/services/rag/reranker.js',
      'dist/services/rag/grounding.js',
      'dist/services/rag/generation.js',
      'dist/services/rag/citationVerifier.js',
      'dist/services/maAnalyzers.js',
      'dist/services/maService.js',
      'dist/services/maScheduler.js',
      'dist/services/parallelProcessor.js',
      'dist/services/documentDrafter.js',
      'dist/services/navigatorService.js',
      'dist/routes/research.js',
      'dist/routes/navigator.js',
      'dist/routes/docs.js',
      'dist/routes/workshop.js',
      'dist/routes/ma_route.js',
    ]
    const opts = {
      compact: true,
      controlFlowFlattening: true,
      controlFlowFlatteningThreshold: 0.6,
      deadCodeInjection: false,
      identifierNamesGenerator: 'mangled',
      renameGlobals: false,
      selfDefending: false,
      simplify: true,
      splitStrings: false,
      stringArray: true,
      stringArrayEncoding: ['base64'],
      stringArrayThreshold: 0.7,
      transformObjectKeys: false,
      unicodeEscapeSequence: false,
    }
    let processed = 0, totalBytes = 0
    for (const rel of TARGETS) {
      const p = path.join(RES_SERVER, rel)
      if (!fs.existsSync(p)) continue
      const src = fs.readFileSync(p, 'utf8')
      try {
        const out = JsObfuscator.obfuscate(src, opts).getObfuscatedCode()
        fs.writeFileSync(p, out)
        processed++
        totalBytes += out.length
      } catch (err) {
        console.warn(`  ! failed to obfuscate ${rel}: ${err.message} (left as-is)`)
      }
    }
    console.log(`  ${processed}/${TARGETS.length} files obfuscated (${(totalBytes / 1024).toFixed(0)} KB total)`)
  })

  // 7b. SMOKE TEST: actually launch the staged server with a fake env, hit
  // /health, and fail the build if it doesn't respond within 15 s. This
  // catches missing-file / missing-module bugs (like the queryExpansion
  // miss that bricked 0.1.4) BEFORE electron-builder packages anything.
  // Skip when SKIP_SERVER_SMOKE=1 — useful if you want a fast packaging
  // run without server validation (e.g., re-packaging with binaries unchanged).
  await step('smoke-test staged server', () => {
    if (process.env.SKIP_SERVER_SMOKE === '1') {
      console.log('  (skipped via SKIP_SERVER_SMOKE=1)')
      return
    }
    // The smoke test boots the staged server on the HOST. After the per-target
    // prune step, Prisma engines for non-host platforms are missing — the test
    // would fail with "libquery_engine-{host}.dylib.node not found" even
    // though the build is otherwise correct. Skip when target != host.
    const argv = process.env.npm_config_argv ? JSON.parse(process.env.npm_config_argv).original : []
    const targets = process.env.PACKAGE_TARGETS || argv.find(a => a.startsWith('--')) || ''
    const hostMac = process.platform === 'darwin'
    const buildingForHost = (hostMac && targets.includes('mac')) ||
                            (process.platform === 'linux' && targets.includes('linux')) ||
                            (process.platform === 'win32' && targets.includes('win'))
    if (!buildingForHost) {
      console.log(`  (skipped: cross-platform build on ${process.platform} for ${targets || 'host'} — host's Prisma engine was pruned)`)
      return
    }
    const { spawn } = require('child_process')
    const http = require('http')
    const port = 18999
    const child = spawn(process.execPath, [path.join(RES_SERVER, 'dist', 'server.js')], {
      cwd: RES_SERVER,
      env: {
        ...process.env,
        PORT: String(port),
        NODE_ENV: 'production',
        LEXVAULT_LOCAL_MODE: '1',
        LEXVAULT_LICENSE_PATH: '/tmp/lex-smoke-license-does-not-exist',
        DATABASE_URL: `file:/tmp/lex-smoke-${Date.now()}.db`,
        OPENROUTER_API_KEY: '',
        LLM_PROVIDER: 'ollama',
        OLLAMA_BASE_URL: 'http://127.0.0.1:65535',  // intentionally dead — we don't need LLM responses
        EMBEDDINGS_URL: 'http://127.0.0.1:65535',
        QDRANT_URL: 'http://127.0.0.1:65535',
        JWT_SECRET: 'smoke-test-secret-not-for-production',
        CLIENT_URL: `http://127.0.0.1:${port}`,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stderrBuf = ''
    child.stdout?.on('data', d => process.stdout.write(`  [server] ${d}`))
    child.stderr?.on('data', d => { stderrBuf += d.toString(); process.stderr.write(`  [server!] ${d}`) })
    let earlyExit = null
    child.on('exit', code => { earlyExit = code })

    const probe = () => new Promise(res => {
      const req = http.get(`http://127.0.0.1:${port}/health`, r => { r.resume(); res(true) })
      req.setTimeout(1000, () => { req.destroy(); res(false) })
      req.on('error', () => res(false))
    })
    const start = Date.now()
    return (async () => {
      while (Date.now() - start < 15_000) {
        if (earlyExit !== null) {
          throw new Error(`Staged server crashed at boot (exit ${earlyExit}). Last stderr:\n${stderrBuf.slice(-1500)}`)
        }
        if (await probe()) break
        await new Promise(r => setTimeout(r, 500))
      }
      try { child.kill('SIGTERM') } catch {}
      if (earlyExit === null && Date.now() - start < 15_000) {
        // /health responded; success
        return
      }
      throw new Error(`Staged server didn't respond on /health within 15 s. Last stderr:\n${stderrBuf.slice(-1500)}`)
    })()
  })

  // 8. Note for the user: model files (GGUFs + BGE-M3 ONNX) are downloaded
  //    on first launch from license-server, not bundled in the binary.
  //    See main.js's boot flow + model-fetcher.js + the embeddings sidecar's
  //    own lazy-load of Xenova/bge-m3 from HuggingFace.
  await step('placeholders', () => {
    fs.writeFileSync(
      path.join(RES_BIN, 'README.txt'),
      'Native binaries bundled here. Model files (LLM GGUF + BGE-M3) are downloaded\non first launch — see main.js boot flow.\n'
    )
  })

  console.log('\n✓ resources staged at', RES)
  console.log('  Now run: npm run package:mac  (or :win / :linux)')
}

main()
