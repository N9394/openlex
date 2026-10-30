#!/usr/bin/env node
/**
 * The OLD desktop server (desktop/server + server-fixes), staged into
 * resources/server only when a build asks for it:
 *
 *   OPENLEX_BUNDLE_LEGACY_SERVER=1 node scripts/prepare-resources.js
 *
 * The app does not start it unless OPENLEX_LEGACY_SERVER=1 at run time
 * (main/legacy.js); its features moved onto the engine. Public builds leave
 * it out. Nothing here is obfuscated: what ships is the JavaScript in this
 * repository.
 */
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

function ensure(dir) { fs.mkdirSync(dir, { recursive: true }) }
function rmRf(p) { fs.rmSync(p, { recursive: true, force: true }) }

/**
 * @param {{ RES: string, target: { os: string, arch: string }, step: Function, copyDir: Function }} ctx
 */
async function stageLegacyServer({ RES, target, step, copyDir }) {
  const ROOT = path.resolve(__dirname, '..')
  const DESKTOP = path.resolve(ROOT, '..')
  const SERVER_SRC = process.env.OPENLEX_SERVER_DIR || path.join(DESKTOP, 'server')
  const FIXES_DIR = path.join(DESKTOP, 'server-fixes')
  const RES_SERVER = path.join(RES, 'server')

  await step('build legacy server (tsc)', () => {
    if (!fs.existsSync(path.join(SERVER_SRC, 'dist', 'server.js'))) {
      execSync('npm run build', { cwd: SERVER_SRC, stdio: 'inherit' })
    }
  })

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
    const wantsWin = target.os === 'win32', wantsMac = target.os === 'darwin', wantsLinux = target.os === 'linux'
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

  await step('smoke-test staged server', () => {
    if (process.env.SKIP_SERVER_SMOKE === '1') {
      console.log('  (skipped via SKIP_SERVER_SMOKE=1)')
      return
    }
    // The smoke test boots the staged server on the HOST. After the per-target
    // prune step, Prisma engines for non-host platforms are missing — the test
    // would fail with "libquery_engine-{host}.dylib.node not found" even
    // though the build is otherwise correct. Skip when target != host.
    if (target.os !== process.platform) {
      console.log(`  (skipped: cross-platform build on ${process.platform} for ${target.os} — host's Prisma engine was pruned)`)
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

}

module.exports = { stageLegacyServer }
