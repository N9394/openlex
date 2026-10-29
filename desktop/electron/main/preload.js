/**
 * Renderer ↔ main bridge. Exposed under window.lexvault.
 *
 * The renderer talks to the local Express backend over HTTP at
 * window.lexvault.backendUrl (an http://127.0.0.1:PORT). Identity is the
 * license, exposed here so AuthContext can read it without an HTTP call.
 * Without a license it is the community identity ({ community: true,
 * account_id: null, tier: 'community' }) — there is no sign-in.
 */
const { contextBridge, ipcRenderer } = require('electron')

let cachedIdentity = null

contextBridge.exposeInMainWorld('lexvault', {
  isElectron: true,

  // Identity (from the signed license file)
  getIdentity: async () => {
    if (cachedIdentity) return cachedIdentity
    cachedIdentity = await ipcRenderer.invoke('lexvault:identity')
    return cachedIdentity
  },

  // Re-fetch license after launcher refreshes it (Stripe webhook → new entitlements)
  reloadEntitlements: async () => {
    cachedIdentity = await ipcRenderer.invoke('lexvault:reloadEntitlements')
    return cachedIdentity
  },

  // External link opener — keeps the SPA from popping new Electron windows
  openExternal: (url) => ipcRenderer.invoke('lexvault:openExternal', url),

  // App info + Qdrant chunk stats for the Settings → License panel
  getAppInfo: () => ipcRenderer.invoke('lexvault:appInfo'),

  // Per-component health for the Settings → Dependencies tab
  getDependencyStatus: () => ipcRenderer.invoke('lexvault:dependencyStatus'),

  // Auto-update lifecycle. The renderer subscribes via onUpdateEvent and
  // shows an in-app banner. installPendingUpdate triggers spawn-installer +
  // quit immediately (otherwise the user has to wait for the OS dialog).
  onUpdateEvent: (cb) => {
    ipcRenderer.on('lexvault:update-event', (_e, payload) => cb(payload))
  },
  checkForUpdate: () => ipcRenderer.invoke('lexvault:checkForUpdate'),
  installPendingUpdate: () => ipcRenderer.invoke('lexvault:installPendingUpdate'),

  // Optional activation (Settings → License): renderer sends the pasted
  // lv_live_… token, main saves it, fetches the signed license, returns
  // { ok, error?, license? } and relaunches the App on success.
  activateToken: (token) => ipcRenderer.invoke('lexvault:activateToken', token),

  // Boot-stage progress events (any open window) so the user sees
  // model download progress + service startup instead of a black screen.
  onBootStage: (cb) => {
    ipcRenderer.on('lexvault:boot-stage', (_e, payload) => cb(payload))
  },

  // Listen for entitlement updates pushed by the launcher
  onEntitlementsChanged: (cb) => {
    ipcRenderer.on('lexvault:entitlements-changed', (_e, payload) => cb(payload))
  },

  // Pack sync events: { kind: 'pack-download-progress'|'pack-ingest-done'|… }
  // Used by Settings → Data Management to render per-jurisdiction progress.
  onPackEvent: (cb) => {
    ipcRenderer.on('lexvault:pack-event', (_e, payload) => cb(payload))
  },

  // Manually download a specific entitled jurisdiction pack
  downloadPack: (code) => ipcRenderer.invoke('lexvault:downloadPack', code),

  // Force re-download of the LLM model (deletes existing + refetches with full SHA validation)
  refetchModel: () => ipcRenderer.invoke('lexvault:refetchModel'),

  // Hardware detail (raw hardware.json, includes detected.gpu.diag)
  getHardwareDetail: () => ipcRenderer.invoke('lexvault:hardwareDetail'),

  // llama-server runtime state + recent log
  getLLMState: () => ipcRenderer.invoke('lexvault:llmState'),
  // Trigger a tiny inference to verify GPU offload actually works
  testLLM: () => ipcRenderer.invoke('lexvault:testLLM'),
  // End-to-end retrieval smoke test: count → embed → Qdrant query for a
  // given jurisdiction + query. Reports each stage's outcome so the UI can
  // pinpoint why research returns "no sources".
  testRetrieval: (opts) => ipcRenderer.invoke('lexvault:testRetrieval', opts || {}),

  // User override for which tier to run on next boot
  setTierOverride: (tier) => ipcRenderer.invoke('lexvault:setTierOverride', tier),

  // Desktop push notification (research finished, doc analysis done, etc.)
  // Renderer is the natural sender (it knows when an op finishes) but we
  // route through main so the click handler can refocus the window.
  notify: (title, body, opts) => ipcRenderer.invoke('lexvault:notify', { title, body, ...(opts || {}) }),
  setNotificationsEnabled: (on) => ipcRenderer.invoke('lexvault:setNotificationsEnabled', !!on),
  getNotificationsEnabled: () => ipcRenderer.invoke('lexvault:getNotificationsEnabled'),

  // Clipboard bridge — Electron's clipboard module works in all contexts
  // (including ones where navigator.clipboard.writeText fails). Used as a
  // fallback for the Copy button in Research / Investigate / Workshop.
  copyText: (text) => ipcRenderer.invoke('lexvault:copyText', String(text || '')),

  // Save a Blob / ArrayBuffer to a user-chosen path via Electron's native
  // save dialog. Used by Research/Investigate/M&A export buttons when
  // the browser's a.download trick doesn't trigger a download in Electron.
  // Renderer: const buf = await blob.arrayBuffer(); lexvault.saveFile({suggestedName: '...', bytes: buf})
  saveFile: (opts) => ipcRenderer.invoke('lexvault:saveFile', opts),

  // OpenLex hub — offline link with the Word plugin (main/hub-client.js).
  //   hub.status()                 → { connected, sidecar }
  //   hub.sendToWord(text, meta)   → insert-text handoff into the open Word doc
  //   hub.onEvent(cb)              → events from Word (open-in-app, …)
  //   hub.onStatus(cb)             → connection changes
  hub: {
    status: () => ipcRenderer.invoke('lexvault:hubStatus'),
    sendToWord: (text, meta) => ipcRenderer.invoke('lexvault:hubSend', { type: 'insert-text', data: { text: String(text || ''), ...(meta || {}) } }),
    onEvent: (cb) => { ipcRenderer.on('lexvault:hub-event', (_e, ev) => cb(ev)) },
    onStatus: (cb) => { ipcRenderer.on('lexvault:hub-status', (_e, st) => cb(st)) },
  },

  // OpenLex engine API (same endpoints the Word pane uses).
  //   engine.call('GET', '/api/library')
  //   engine.stream('/api/workflows/run', body, (ev) => …)  → resolves when done
  //   engine.stream('/api/chat', body, onEvent, 'q-1') · engine.stop('q-1')  → Stop
  engine: {
    call: (method, path, body) => ipcRenderer.invoke('lexvault:engine', { method, path, body }),
    stream: (path, body, onEvent, id) => {
      const streamId = id ? String(id) : Math.random().toString(36).slice(2)
      const listener = (_e, msg) => { if (msg.streamId === streamId) onEvent(msg.ev) }
      ipcRenderer.on('lexvault:engine-stream', listener)
      return ipcRenderer.invoke('lexvault:engineStream', { path, body, streamId })
        .finally(() => ipcRenderer.removeListener('lexvault:engine-stream', listener))
    },
    stop: (streamId) => ipcRenderer.invoke('lexvault:engineStop', { streamId: String(streamId) }),
  },

  // Matters shared with the Word plugin (OpenLex engine matters.js).
  matters: {
    list: (opts) => ipcRenderer.invoke('lexvault:matters', { op: 'list', ...(opts || {}) }),
    create: (m) => ipcRenderer.invoke('lexvault:matters', { op: 'create', ...m }),
    update: (id, patch) => ipcRenderer.invoke('lexvault:matters', { op: 'update', id, patch }),
    setActive: (id) => ipcRenderer.invoke('lexvault:matters', { op: 'setActive', id }),
  },
})
