"use strict"
/** The smallest Word document the text extractor reads (tests only). */
const { docxBuffer } = require('../../src/docx_write')

const tinyDocx = (...paragraphs) => docxBuffer(paragraphs.map((text) => ({ text })))

module.exports = { tinyDocx }
