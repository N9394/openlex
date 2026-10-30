// The bundled Qdrant must never phone home: telemetry off in the config and the environment.
const test = require('node:test')
const assert = require('assert')
const fs = require('fs')
const path = require('path')

test('Qdrant is started with telemetry disabled (engine and desktop app)', () => {
  const engine = fs.readFileSync(path.join(__dirname, '..', 'src', 'qdrant.js'), 'utf8')
  assert.match(engine, /telemetry_disabled: true/)
  assert.match(engine, /QDRANT__TELEMETRY_DISABLED: 'true'/)
  const app = fs.readFileSync(path.join(__dirname, '..', '..', 'desktop', 'electron', 'sidecars', 'supervisor.js'), 'utf8')
  assert.match(app, /telemetry_disabled: true/)
  assert.match(app, /QDRANT__TELEMETRY_DISABLED: 'true'/)
})
