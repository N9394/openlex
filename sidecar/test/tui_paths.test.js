"use strict"
/**
 * Paths dropped or typed into the terminal app, Windows rules included
 * (checked on every platform through the { platform, home } options).
 */
const test = require('node:test')
const assert = require('assert')

let paths
test.before(async () => { paths = await import('../tui/paths.mjs') })

const WIN = { platform: 'win32', home: 'C:\\Users\\Anna Huber', exists: () => false }
const MAC = { platform: 'darwin', home: '/Users/anna', exists: () => false }

test('Windows: drive letters, backslashes and "…" quoted paths with spaces', () => {
  assert.deepStrictEqual(paths.cleanPaths('C:\\Akten\\vertrag.docx', WIN), ['C:\\Akten\\vertrag.docx'])
  assert.deepStrictEqual(paths.cleanPaths('"C:\\Users\\Anna Huber\\My Contract.docx"', WIN), ['C:\\Users\\Anna Huber\\My Contract.docx'])
  // Windows Terminal drops several files as: "a b.docx" c.pdf
  assert.deepStrictEqual(paths.cleanPaths('"D:\\Akte 1\\a b.docx" D:\\Akte1\\c.pdf', WIN), ['D:\\Akte 1\\a b.docx', 'D:\\Akte1\\c.pdf'])
  // Forward slashes are fine too, and a backslash is never an escape.
  assert.deepStrictEqual(paths.cleanPaths('C:/Akten/x.docx', WIN), ['C:\\Akten\\x.docx'])
  // Single quotes are part of the name on Windows.
  assert.deepStrictEqual(paths.cleanPaths("\"C:\\Akten\\O'Brien Vertrag.docx\"", WIN), ["C:\\Akten\\O'Brien Vertrag.docx"])
  assert.deepStrictEqual(paths.cleanPaths("C:\\Akten\\O'Brien.docx", WIN), ["C:\\Akten\\O'Brien.docx"])
  // UNC share
  assert.deepStrictEqual(paths.cleanPaths('"\\\\fileserver\\akten\\a b.docx"', WIN), ['\\\\fileserver\\akten\\a b.docx'])
})

test('Windows: an existing path with spaces typed without quotes is taken whole', () => {
  const opts = { ...WIN, exists: (p) => p === 'C:\\My Files\\x.docx' }
  assert.deepStrictEqual(paths.cleanPaths('C:\\My Files\\x.docx', opts), ['C:\\My Files\\x.docx'])
})

test('Windows: file:/// URLs (drag and drop from some apps) and ~\\', () => {
  assert.deepStrictEqual(paths.cleanPaths('file:///C:/Users/Anna%20Huber/My%20Contract.docx', WIN), ['C:\\Users\\Anna Huber\\My Contract.docx'])
  assert.deepStrictEqual(paths.cleanPaths('file:///c:/akten/%C3%9Cbersicht.pdf', WIN), ['c:\\akten\\Übersicht.pdf'])
  assert.deepStrictEqual(paths.cleanPaths('file://fileserver/akten/a.docx', WIN), ['\\\\fileserver\\akten\\a.docx'])
  assert.strictEqual(paths.fileUrlToPath('file:///C:/x%20y/z.docx', WIN), 'C:\\x y\\z.docx')
  assert.deepStrictEqual(paths.cleanPaths('~\\Documents\\a.docx', WIN), ['C:\\Users\\Anna Huber\\Documents\\a.docx'])
  assert.deepStrictEqual(paths.cleanPaths('~/Documents/a.docx', WIN), ['C:\\Users\\Anna Huber\\Documents\\a.docx'])
})

test('macOS/Linux: quotes, backslash-escaped spaces, file:// and ~ unchanged', () => {
  assert.deepStrictEqual(paths.cleanPaths("'/Users/anna/My Contract.docx' /tmp/b.pdf", MAC), ['/Users/anna/My Contract.docx', '/tmp/b.pdf'])
  assert.deepStrictEqual(paths.cleanPaths('/Users/anna/My\\ Contract.docx', MAC), ['/Users/anna/My Contract.docx'])
  assert.deepStrictEqual(paths.cleanPaths('file:///Users/anna/My%20Contract.docx', MAC), ['/Users/anna/My Contract.docx'])
  assert.deepStrictEqual(paths.cleanPaths('~/a.docx', MAC), ['/Users/anna/a.docx'])
})

test('shortPath: ~ only for the home folder itself, case-insensitive on Windows', () => {
  assert.strictEqual(paths.shortPath('C:\\Users\\Anna Huber\\Documents\\a.docx', WIN), '~\\Documents\\a.docx')
  assert.strictEqual(paths.shortPath('c:\\users\\anna huber\\a.docx', WIN), '~\\a.docx')
  assert.strictEqual(paths.shortPath('C:\\Users\\Anna Huberova\\a.docx', WIN), 'C:\\Users\\Anna Huberova\\a.docx')
  assert.strictEqual(paths.shortPath('/Users/anna/x/a.docx', MAC), '~/x/a.docx')
  assert.strictEqual(paths.shortPath('/Users/annabel/a.docx', MAC), '/Users/annabel/a.docx')
  assert.strictEqual(paths.shortPath('/Users/anna', MAC), '~')
})
