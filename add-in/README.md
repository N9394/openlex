# OpenLex Word add-in

Office.js Word add-in: task pane (Chat / Document / Suggestions / Settings)
+ ribbon tab ("OpenLex Chat", "Analyze Document"). Thin UI — all agent work
happens in the sidecar at `http://127.0.0.1:18001`.

## Layout

```
manifest.xml          TaskPane manifest (catalog sideload, SourceLocation = sidecar)
taskpane.html/.css/.js  Pane UI: the Office.js + DOM glue (follows Word's light/dark theme)
lib/*.js              Pane logic without Office.js (activity, data line, sources,
                      review, errors, menu, permission card, theme, hint slot,
                      matter) — plain scripts in the pane, require()d by the
                      node tests in ../sidecar/test/addin_pane.test.js
TESTING.md            Manual test script in Word
commands.html         Ribbon command handlers (Office.actions.associate)
assets/               Icons (16/32/80)
sideload-mac.sh       macOS: copies manifest into Word's WEF folder
sideload-win.ps1      Windows: copies manifest into %APPDATA%\Microsoft\Word\WEF
```

## Sideload (dev)

1. Start the sidecar (`cd ../sidecar && npm start`) — it serves the add-in
   over https://localhost:18001 (self-signed cert in dev, see sidecar README).
2. Run the sideload script for your OS.
3. In Word: Insert → Add-ins → Shared Folder → "OpenLex".

Note: Office.js requires HTTPS for the SourceLocation. The sidecar must serve
localhost with a self-signed cert that the OS trusts (dev instructions in the
sidecar README). The manifest currently points at `https://localhost:18001`.

## Ribbon actions

- **OpenLex Chat** — opens the task pane.
- **Analyze Document** — pulls the body text and POSTs to
  `/api/document/analyze`; suggestions stream back as comments in the pane.
