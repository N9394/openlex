"use strict"
/**
 * Plain text from a .docx without dependencies: read the zip central
 * directory, inflate word/document.xml, keep paragraph breaks, strip tags.
 * Good enough for indexing (no tables-as-grids, no footnotes ordering).
 */

const fs = require('fs')
const zlib = require('zlib')

const MAX_INFLATED = 256 * 1024 * 1024 // one part of a Word/Excel file, uncompressed

function readZipEntry(buf, name) {
  // End of central directory: signature 0x06054b50, within the last 64K.
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('not a zip file')
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('corrupt zip directory')
    const method = buf.readUInt16LE(p + 10)
    const compSize = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const localOff = buf.readUInt32LE(p + 42)
    const entryName = buf.toString('utf8', p + 46, p + 46 + nameLen)
    if (entryName === name) {
      const lNameLen = buf.readUInt16LE(localOff + 26)
      const lExtraLen = buf.readUInt16LE(localOff + 28)
      const start = localOff + 30 + lNameLen + lExtraLen
      const data = buf.subarray(start, start + compSize)
      if (method === 0) return data
      // A zip bomb (a few MB that inflate to gigabytes) must not exhaust memory.
      if (method === 8) return zlib.inflateRawSync(data, { maxOutputLength: MAX_INFLATED })
      throw new Error(`unsupported zip compression ${method}`)
    }
    p += 46 + nameLen + extraLen + commentLen
  }
  return null
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

function xmlToText(xml) {
  return xml
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:(br|cr)\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
      if (e[0] === '#') { const cp = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '\ufffd' }
      return ENTITIES[e] ?? m
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function docxText(file) {
  const buf = Buffer.isBuffer(file) ? file : fs.readFileSync(file)
  const xml = readZipEntry(buf, 'word/document.xml')
  if (!xml) throw new Error('no word/document.xml — not a Word document')
  return xmlToText(xml.toString('utf8'))
}

module.exports = { docxText, readZipEntry, xmlToText }
