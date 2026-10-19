"use strict"
/**
 * OCR for scanned PDFs — on the machine, with what the OS already ships:
 *
 *   macOS    Apple Vision (VNRecognizeTextRequest) + PDFKit, via JXA
 *   Windows  Windows.Media.Ocr + Windows.Data.Pdf (WinRT), via PowerShell
 *   Linux    tesseract + pdftoppm, when installed
 *
 * No model download, no cloud. Results are cached by file hash, so a
 * re-index of the firm library does not OCR the same scan twice.
 * OPENLEX_OCR=0 turns it off.
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { execFile } = require('child_process')
const { DATA_DIR } = require('./config')

const CACHE_DIR = path.join(DATA_DIR, 'ocr-cache')
const LANGS = (process.env.OPENLEX_OCR_LANGS || 'de-DE,en-US,fr-FR,it-IT,es-ES,pt-BR,cs-CZ,sk-SK,pl-PL,ro-RO,nl-NL').split(',').map((s) => s.trim()).filter(Boolean)
const PAGE_TIMEOUT_MS = 60000

const MAC_SCRIPT = `ObjC.import('Foundation'); ObjC.import('Quartz'); ObjC.import('Vision'); ObjC.import('AppKit')
function run(argv) {
  const doc = $.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath(argv[0]))
  if (!doc || doc.isNil()) return JSON.stringify({ error: 'cannot open PDF' })
  const want = JSON.parse(argv[1])
  const pages = JSON.parse(argv[2])
  const probe = $.VNRecognizeTextRequest.alloc.init
  const supported = ObjC.deepUnwrap(probe.supportedRecognitionLanguagesAndReturnError(null)) || []
  const langs = want.filter((l) => supported.includes(l))
  const out = {}
  for (const n of pages) {
    if (n < 1 || n > doc.pageCount) continue
    const page = doc.pageAtIndex(n - 1)
    const box = page.boundsForBox(0)
    const scale = Math.min(3, 4000 / Math.max(box.size.width, box.size.height))
    const size = $.NSMakeSize(box.size.width * scale, box.size.height * scale)
    const thumb = page.thumbnailOfSizeForBox(size, 0)
    // Opaque white page: transparent backgrounds confuse the recogniser.
    const img = $.NSImage.alloc.initWithSize(size)
    img.lockFocus
    $.NSColor.whiteColor.set
    $.NSRectFill($.NSMakeRect(0, 0, size.width, size.height))
    thumb.drawInRectFromRectOperationFraction($.NSMakeRect(0, 0, size.width, size.height), $.NSZeroRect, 2, 1.0)
    img.unlockFocus
    const cg = $.NSBitmapImageRep.imageRepWithData(img.TIFFRepresentation).CGImage
    const req = $.VNRecognizeTextRequest.alloc.init
    req.recognitionLevel = 0
    req.usesLanguageCorrection = true
    if (langs.length) req.recognitionLanguages = $(langs)
    $.VNImageRequestHandler.alloc.initWithCGImageOptions(cg, $.NSDictionary.dictionary).performRequestsError($([req]), null)
    const lines = []
    const res = req.results
    for (let k = 0; k < res.count; k++) lines.push(res.objectAtIndex(k).topCandidates(1).objectAtIndex(0).string.js)
    out[n] = lines.join('\\n')
  }
  return JSON.stringify({ pages: out, langs })
}`

// PowerShell 5.1 + WinRT. Await helper per the documented AsTask pattern.
const WIN_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
function Await($op, [Type]$t) { $task = $asTask.MakeGenericMethod($t).Invoke($null, @($op)); $task.Wait(-1) | Out-Null; $task.Result }
function AwaitAction($op) { $m = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction' }; $m[0].Invoke($null, @($op)).Wait(-1) | Out-Null }
[Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Pdf.PdfDocument, Windows.Data.Pdf, ContentType = WindowsRuntime] | Out-Null
[Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime] | Out-Null
$in = [Console]::In.ReadToEnd() | ConvertFrom-Json
$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($in.file)) ([Windows.Storage.StorageFile])
$pdf = Await ([Windows.Data.Pdf.PdfDocument]::LoadFromFileAsync($file)) ([Windows.Data.Pdf.PdfDocument])
$engine = $null
foreach ($l in $in.langs) { try { $lang = New-Object Windows.Globalization.Language($l); if ([Windows.Media.Ocr.OcrEngine]::IsLanguageSupported($lang)) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($lang); break } } catch {} }
if ($engine -eq $null) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }
if ($engine -eq $null) { throw 'no OCR language installed (Settings > Time & language > Language)' }
$out = @{}
foreach ($n in $in.pages) {
  if ($n -lt 1 -or $n -gt $pdf.PageCount) { continue }
  $page = $pdf.GetPage($n - 1)
  $stream = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
  $opts = New-Object Windows.Data.Pdf.PdfPageRenderOptions
  $opts.DestinationWidth = [uint32]([Math]::Min(2600, $page.Size.Width * 3))
  AwaitAction ($page.RenderToStreamAsync($stream, $opts))
  $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $res = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
  $out["$n"] = (($res.Lines | ForEach-Object { $_.Text }) -join "\`n")
  $page.Dispose()
}
@{ pages = $out; langs = @($engine.RecognizerLanguage.LanguageTag) } | ConvertTo-Json -Compress -Depth 4
`

function run(cmd, args, { input, timeout } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(cmd, args, { timeout, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`${path.basename(cmd)}: ${String(stderr || err.message).trim().split('\n').slice(-2).join(' ')}`))
      resolve(String(stdout))
    })
    if (input !== undefined) child.stdin.end(input)
  })
}

function which(bin) {
  for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
    const p = path.join(dir, bin)
    try { fs.accessSync(p, fs.constants.X_OK); return p } catch { /* next */ }
  }
  return null
}

function backend() {
  if (process.env.OPENLEX_OCR === '0') return null
  if (process.platform === 'darwin') return 'vision'
  if (process.platform === 'win32') return 'windows'
  if (which('tesseract') && which('pdftoppm')) return 'tesseract'
  return null
}

const TESS = { 'de-DE': 'deu', 'en-US': 'eng', 'fr-FR': 'fra', 'it-IT': 'ita', 'es-ES': 'spa', 'pt-BR': 'por', 'cs-CZ': 'ces', 'sk-SK': 'slk', 'pl-PL': 'pol', 'ro-RO': 'ron', 'nl-NL': 'nld' }

async function ocrPages(file, pages) {
  const b = backend()
  if (!b) throw new Error('OCR is not available on this system (Linux: install tesseract and poppler-utils)')
  const timeout = PAGE_TIMEOUT_MS * Math.max(1, pages.length) + 60000
  if (b === 'vision') {
    const script = path.join(DATA_DIR, 'run', 'ocr-vision.js')
    fs.mkdirSync(path.dirname(script), { recursive: true })
    if (!fs.existsSync(script) || fs.readFileSync(script, 'utf8') !== MAC_SCRIPT) fs.writeFileSync(script, MAC_SCRIPT)
    const r = JSON.parse(await run('/usr/bin/osascript', ['-l', 'JavaScript', script, file, JSON.stringify(LANGS), JSON.stringify(pages)], { timeout }))
    if (r.error) throw new Error(r.error)
    return r.pages
  }
  if (b === 'windows') {
    const r = JSON.parse(await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', WIN_SCRIPT], { input: JSON.stringify({ file: path.resolve(file), pages, langs: LANGS }), timeout }))
    return r.pages
  }
  // tesseract: render each page to PNG with pdftoppm, then OCR it.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openlex-ocr-'))
  try {
    const out = {}
    const langs = [...new Set(LANGS.map((l) => TESS[l]).filter(Boolean))].join('+') || 'eng'
    for (const n of pages) {
      const base = path.join(tmp, `p${n}`)
      await run(which('pdftoppm'), ['-r', '300', '-f', String(n), '-l', String(n), '-png', '-singlefile', file, base], { timeout: PAGE_TIMEOUT_MS })
      try { out[n] = (await run(which('tesseract'), [`${base}.png`, 'stdout', '-l', langs], { timeout: PAGE_TIMEOUT_MS })).trim() }
      catch { out[n] = (await run(which('tesseract'), [`${base}.png`, 'stdout'], { timeout: PAGE_TIMEOUT_MS })).trim() } // language data missing → default
    }
    return out
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

// Cyrillic/Greek letters that look like Latin ones. OCR engines sometimes
// pick them for Latin words ("Аст" for "Acm…"); with only Latin-script
// languages configured they are always errors.
const HOMOGLYPHS = { А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', Х: 'X', а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', у: 'y', х: 'x', і: 'i', т: 'm', Α: 'A', Β: 'B', Ε: 'E', Κ: 'K', Μ: 'M', Ν: 'N', Ο: 'O', Ρ: 'P', Τ: 'T', Χ: 'X', ο: 'o' }
const NON_LATIN = /^(el|ru|uk|bg|sr|mk|be|ar|he|zh|ja|ko|th|hi)/i
function latinize(text) {
  if (LANGS.some((l) => NON_LATIN.test(l))) return text
  const foreign = /[\u0400-\u04FF\u0370-\u03FF]/g
  return String(text).replace(/\p{L}+/gu, (w) => {
    if (!foreign.test(w)) return w
    foreign.lastIndex = 0
    // Mixed-script word, or one made only of look-alikes → Latin.
    const all = [...w.matchAll(foreign)].every(([c]) => HOMOGLYPHS[c])
    return /\p{Script=Latin}/u.test(w) || all ? w.replace(foreign, (c) => HOMOGLYPHS[c] || c) : w
  })
}

/**
 * OCR the given pages (1-based) of a PDF (path or Buffer).
 * @returns {Promise<Object<number,string>>} page number → text
 */
async function ocrPdf(input, pages) {
  const data = Buffer.isBuffer(input) ? input : fs.readFileSync(input)
  const hash = crypto.createHash('sha256').update(data).digest('hex')
  const key = path.join(CACHE_DIR, `${hash}.json`)
  let cache = {}
  try { cache = JSON.parse(fs.readFileSync(key, 'utf8')) } catch { /* none yet */ }
  const missing = pages.filter((n) => typeof cache[n] !== 'string')
  if (missing.length) {
    let file = Buffer.isBuffer(input) ? null : path.resolve(input)
    let tmp = null
    if (!file) {
      tmp = path.join(os.tmpdir(), `openlex-ocr-${hash.slice(0, 12)}.pdf`)
      fs.writeFileSync(tmp, data, { mode: 0o600 })
      file = tmp
    }
    try {
      const got = await ocrPages(file, missing)
      for (const [n, text] of Object.entries(got || {})) cache[n] = latinize(String(text || ''))
    } finally {
      if (tmp) fs.rmSync(tmp, { force: true })
    }
    fs.mkdirSync(CACHE_DIR, { recursive: true })
    fs.writeFileSync(key, JSON.stringify(cache), { mode: 0o600 })
  }
  return Object.fromEntries(pages.map((n) => [n, cache[n] || '']))
}

module.exports = { ocrPdf, backend, latinize, CACHE_DIR, LANGS }
