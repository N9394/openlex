"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const promises_1 = __importDefault(require("fs/promises"));
const client_1 = require("@prisma/client");
const auth_1 = require("../middleware/auth");
const rateLimit_1 = require("../middleware/rateLimit");
const researchChatService_1 = require("../services/researchChatService");
const docParser_1 = require("../services/docParser");
const { AIAuditContext, saveAIAudit, isAuditEnabled } = require('../services/aiAuditService');
const docx = require("docx");
const PDFDocument = require("pdfkit");
const router = express_1.default.Router();
const prisma = new client_1.PrismaClient();

// Sanitize filename for Content-Disposition header (prevent header injection)
function safeFilename(name) {
    return name.replace(/[^a-zA-Z0-9._\- ]/g, '_').replace(/\.{2,}/g, '.').slice(0, 200);
}

// Multer setup for chat file attachments
const chatStorage = multer_1.default.diskStorage({
    destination: async (req, file, cb) => {
        const uploadDir = path_1.default.join(__dirname, '../../uploads/chat-attachments');
        await promises_1.default.mkdir(uploadDir, { recursive: true });
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\.{2,}/g, '.');
        const uniqueName = `${Date.now()}_${safeName}`;
        cb(null, uniqueName);
    },
});
const chatUpload = (0, multer_1.default)({
    storage: chatStorage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: (req, file, cb) => {
        const allowed = [
            'application/pdf', 'text/plain',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/msword',
        ];
        cb(null, allowed.includes(file.mimetype));
    },
});

// ============================================================================
// Importance label helper
// ============================================================================
function friendlyImportance(raw) {
    const v = (raw || '').toLowerCase();
    if (v === 'high' || v === 'critical') return 'Very Important';
    if (v === 'medium') return 'Important';
    return 'Less Important';
}
function importanceColor(raw) {
    const v = (raw || '').toLowerCase();
    if (v === 'high' || v === 'critical') return 'CC3333';
    if (v === 'medium') return 'CC8833';
    return '666666';
}

// ============================================================================
// DOCX Export Helpers
// ============================================================================

function mdToDocxChildren(text) {
    if (!text) return [new docx.Paragraph({ children: [new docx.TextRun('')] })];
    const lines = text.split('\n');
    const children = [];
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
            children.push(new docx.Paragraph({ children: [new docx.TextRun('')] }));
            continue;
        }
        // Headings
        if (trimmed.startsWith('### ')) {
            children.push(new docx.Paragraph({ heading: docx.HeadingLevel.HEADING_3, children: parseInline(trimmed.slice(4)) }));
        } else if (trimmed.startsWith('## ')) {
            children.push(new docx.Paragraph({ heading: docx.HeadingLevel.HEADING_2, children: parseInline(trimmed.slice(3)) }));
        } else if (trimmed.startsWith('# ')) {
            children.push(new docx.Paragraph({ heading: docx.HeadingLevel.HEADING_1, children: parseInline(trimmed.slice(2)) }));
        }
        // Bullet
        else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
            children.push(new docx.Paragraph({
                bullet: { level: 0 },
                children: parseInline(trimmed.slice(2)),
            }));
        }
        // Numbered
        else if (/^\d+\.\s/.test(trimmed)) {
            children.push(new docx.Paragraph({
                numbering: { reference: 'default-numbering', level: 0 },
                children: parseInline(trimmed.replace(/^\d+\.\s/, '')),
            }));
        }
        // Normal paragraph
        else {
            children.push(new docx.Paragraph({ children: parseInline(trimmed) }));
        }
    }
    return children.length > 0 ? children : [new docx.Paragraph({ children: [new docx.TextRun('')] })];
}

function parseInline(text) {
    const runs = [];
    const re = /\*\*(.+?)\*\*/g;
    let lastIdx = 0;
    let match;
    while ((match = re.exec(text)) !== null) {
        if (match.index > lastIdx) {
            runs.push(new docx.TextRun(text.slice(lastIdx, match.index)));
        }
        runs.push(new docx.TextRun({ text: match[1], bold: true }));
        lastIdx = re.lastIndex;
    }
    if (lastIdx < text.length) {
        runs.push(new docx.TextRun(text.slice(lastIdx)));
    }
    return runs.length > 0 ? runs : [new docx.TextRun(text)];
}

function makeFooter(text) {
    return {
        default: new docx.Footer({
            children: [new docx.Paragraph({
                alignment: docx.AlignmentType.CENTER,
                children: [new docx.TextRun({ text, size: 16, color: '888888', italics: true })],
            })],
        }),
    };
}

// ============================================================================
// Export: Research Conversation
// ============================================================================
router.post('/export/conversation/:id', rateLimit_1.exportLimiter, auth_1.authenticateToken, async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const conversation = await (0, researchChatService_1.getConversation)(req.params.id, userId);
        if (!conversation) {
            return res.status(404).json({ error: 'Not Found' });
        }

        const docChildren = [];
        // Title
        docChildren.push(new docx.Paragraph({
            heading: docx.HeadingLevel.HEADING_1,
            children: [new docx.TextRun({ text: conversation.title || 'Research Conversation', bold: true })],
        }));
        docChildren.push(new docx.Paragraph({
            children: [new docx.TextRun({ text: `Jurisdiction: ${conversation.jurisdiction || 'N/A'}  |  Date: ${new Date().toLocaleDateString()}`, size: 20, color: '666666' })],
        }));
        docChildren.push(new docx.Paragraph({ children: [new docx.TextRun('')] }));

        const msgs = conversation.messages || [];
        for (const msg of msgs) {
            if (msg.role === 'user') {
                docChildren.push(new docx.Paragraph({
                    heading: docx.HeadingLevel.HEADING_2,
                    children: [new docx.TextRun({ text: 'Question', bold: true, color: '2E5A3F' })],
                }));
                docChildren.push(new docx.Paragraph({ children: [new docx.TextRun(msg.content || '')] }));
                docChildren.push(new docx.Paragraph({ children: [new docx.TextRun('')] }));
            } else if (msg.role === 'assistant') {
                docChildren.push(new docx.Paragraph({
                    heading: docx.HeadingLevel.HEADING_2,
                    children: [new docx.TextRun({ text: 'Research Response', bold: true, color: '8B6914' })],
                }));
                docChildren.push(...mdToDocxChildren(msg.content || ''));
                docChildren.push(new docx.Paragraph({ children: [new docx.TextRun('')] }));

                // Sources
                if (msg.sources && msg.sources.length > 0) {
                    docChildren.push(new docx.Paragraph({
                        heading: docx.HeadingLevel.HEADING_3,
                        children: [new docx.TextRun({ text: `Sources (${msg.sources.length})`, bold: true })],
                    }));
                    for (const src of msg.sources) {
                        const name = src.title || src.source_name || 'Unknown Source';
                        const score = src.score ? ` — ${(src.score * 100).toFixed(0)}% relevance` : '';
                        docChildren.push(new docx.Paragraph({
                            bullet: { level: 0 },
                            children: [
                                new docx.TextRun({ text: name, bold: true }),
                                new docx.TextRun({ text: score, color: '666666' }),
                            ],
                        }));
                    }
                }
                docChildren.push(new docx.Paragraph({ children: [new docx.TextRun('')] }));
            }
        }

        const doc2 = new docx.Document({
            numbering: { config: [{ reference: 'default-numbering', levels: [{ level: 0, format: docx.LevelFormat.DECIMAL, text: '%1.', alignment: docx.AlignmentType.START }] }] },
            sections: [{
                properties: {},
                footers: makeFooter(`Generated by LexVault on ${new Date().toLocaleDateString()}`),
                children: docChildren,
            }],
        });

        const buffer = await docx.Packer.toBuffer(doc2);
        const filename = (conversation.title || 'research').replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '_');
        res.setHeader('Content-Disposition', `attachment; filename="${safeFilename(filename)}.docx"`);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.send(buffer);
    } catch (error) {
        console.error('[Export] Conversation DOCX error:', error);
        next(error);
    }
});

// ============================================================================
// Export: Navigator Document
// ============================================================================
router.post('/export/navigator', rateLimit_1.exportLimiter, auth_1.authenticateToken, async (req, res, next) => {
    try {
        const { title, sections, jurisdiction, language } = req.body;
        if (!title || !sections) {
            return res.status(400).json({ error: 'title and sections are required' });
        }

        const docChildren = [];
        docChildren.push(new docx.Paragraph({
            heading: docx.HeadingLevel.HEADING_1,
            alignment: docx.AlignmentType.CENTER,
            children: [new docx.TextRun({ text: title.toUpperCase(), bold: true })],
        }));
        docChildren.push(new docx.Paragraph({
            alignment: docx.AlignmentType.CENTER,
            children: [new docx.TextRun({ text: `Jurisdiction: ${jurisdiction || 'N/A'}  |  Language: ${language || 'en'}`, size: 20, color: '666666' })],
        }));
        docChildren.push(new docx.Paragraph({ children: [new docx.TextRun('')] }));

        for (let i = 0; i < sections.length; i++) {
            const section = sections[i];
            docChildren.push(new docx.Paragraph({
                heading: docx.HeadingLevel.HEADING_2,
                children: [new docx.TextRun({ text: `${i + 1}. ${section.title}`, bold: true })],
            }));
            docChildren.push(...mdToDocxChildren(section.content));
            docChildren.push(new docx.Paragraph({ children: [new docx.TextRun('')] }));
        }

        const doc2 = new docx.Document({
            numbering: { config: [{ reference: 'default-numbering', levels: [{ level: 0, format: docx.LevelFormat.DECIMAL, text: '%1.', alignment: docx.AlignmentType.START }] }] },
            sections: [{
                properties: {},
                footers: makeFooter(`Draft generated by LexVault on ${new Date().toLocaleDateString()}`),
                children: docChildren,
            }],
        });

        const buffer = await docx.Packer.toBuffer(doc2);
        const filename = title.replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '_');
        res.setHeader('Content-Disposition', `attachment; filename="${safeFilename(filename)}.docx"`);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.send(buffer);
    } catch (error) {
        console.error('[Export] Navigator DOCX error:', error);
        next(error);
    }
});

// ============================================================================
// Export: Document Analysis
// ============================================================================
router.post('/export/analysis/:id', rateLimit_1.exportLimiter, auth_1.authenticateToken, async (req, res, next) => {
    try {
        const t0 = Date.now();
        const userId = req.user.userId;
        const document = await prisma.document.findFirst({
            where: { id: req.params.id, userId },
        });
        if (!document) {
            return res.status(404).json({ error: 'Not Found' });
        }

        // Build analysis from separate DB fields (analysis column is metadata only)
        const parseJSON = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
        let analysis = parseJSON(document.analysis) || {};
        if (!analysis.summary && document.summary) analysis.summary = parseJSON(document.summary) || document.summary;
        if (!analysis.keyClauses && document.keyClauses) analysis.keyClauses = parseJSON(document.keyClauses);
        if (!analysis.riskFlags && document.riskFlags) analysis.riskFlags = parseJSON(document.riskFlags);
        if (!analysis.importantDates && document.importantDates) analysis.importantDates = parseJSON(document.importantDates);
        if (!analysis.missingElements && document.missingElements) analysis.missingElements = parseJSON(document.missingElements);
        if (!analysis.overallRiskScore && document.overallRiskScore) analysis.overallRiskScore = parseJSON(document.overallRiskScore);
        if (!analysis.clarityScore && document.clarityScore) analysis.clarityScore = parseJSON(document.clarityScore);
        if (!analysis.readabilityScore && document.readabilityScore) analysis.readabilityScore = parseJSON(document.readabilityScore);

        const docChildren = [];
        // Title
        docChildren.push(new docx.Paragraph({
            heading: docx.HeadingLevel.HEADING_1,
            children: [new docx.TextRun({ text: `Document Analysis: ${document.filename || 'Document'}`, bold: true })],
        }));
        docChildren.push(new docx.Paragraph({
            children: [new docx.TextRun({ text: `Analyzed: ${new Date(document.createdAt || Date.now()).toLocaleDateString()}`, size: 20, color: '666666' })],
        }));

        // Risk Score
        const riskScore = analysis.overallRiskScore;
        if (riskScore) {
            const level = typeof riskScore === 'number' ? (riskScore > 70 ? 'HIGH' : riskScore > 40 ? 'MEDIUM' : 'LOW') : (riskScore.level || '').toUpperCase();
            docChildren.push(new docx.Paragraph({ children: [new docx.TextRun('')] }));
            docChildren.push(new docx.Paragraph({
                children: [
                    new docx.TextRun({ text: 'Overall Risk: ', bold: true }),
                    new docx.TextRun({ text: level, bold: true, color: level === 'HIGH' ? 'CC3333' : level === 'MEDIUM' ? 'CC8833' : '339933' }),
                ],
            }));
        }

        // Summary
        const summaryText = typeof analysis.summary === 'string' ? analysis.summary : (analysis.summary?.content || '');
        if (summaryText) {
            docChildren.push(new docx.Paragraph({ children: [new docx.TextRun('')] }));
            docChildren.push(new docx.Paragraph({
                heading: docx.HeadingLevel.HEADING_2,
                children: [new docx.TextRun({ text: 'Summary', bold: true })],
            }));
            docChildren.push(...mdToDocxChildren(summaryText));
        }

        // Key Clauses
        const clauses = analysis.keyClauses || [];
        if (clauses.length > 0) {
            docChildren.push(new docx.Paragraph({ children: [new docx.TextRun('')] }));
            docChildren.push(new docx.Paragraph({
                heading: docx.HeadingLevel.HEADING_2,
                children: [new docx.TextRun({ text: `Key Clauses (${clauses.length})`, bold: true })],
            }));
            for (const c of clauses) {
                const imp = friendlyImportance(c.importance);
                const cat = c.category ? ` [${c.category}]` : '';
                docChildren.push(new docx.Paragraph({
                    bullet: { level: 0 },
                    children: [
                        new docx.TextRun({ text: `${c.title || 'Clause'}`, bold: true }),
                        new docx.TextRun({ text: ` (${imp}${cat})`, color: importanceColor(c.importance) }),
                    ],
                }));
                if (c.content || c.clause) {
                    docChildren.push(new docx.Paragraph({
                        indent: { left: 720 },
                        children: [new docx.TextRun({ text: c.content || c.clause, color: '444444', size: 20 })],
                    }));
                }
                if (c.location || c.sourceRef) {
                    const refs = [];
                    if (c.location) refs.push(new docx.TextRun({ text: `📍 ${c.location}`, color: '888888', size: 18, italics: true }));
                    if (c.location && c.sourceRef) refs.push(new docx.TextRun({ text: '  |  ', color: 'AAAAAA', size: 18 }));
                    if (c.sourceRef) refs.push(new docx.TextRun({ text: `📖 ${c.sourceRef}`, color: '6B8E23', size: 18, italics: true }));
                    docChildren.push(new docx.Paragraph({ indent: { left: 720 }, children: refs }));
                }
            }
        }

        // Risk Flags as table
        const riskFlags = analysis.riskFlags || [];
        if (riskFlags.length > 0) {
            docChildren.push(new docx.Paragraph({ children: [new docx.TextRun('')] }));
            docChildren.push(new docx.Paragraph({
                heading: docx.HeadingLevel.HEADING_2,
                children: [new docx.TextRun({ text: `Risk Flags (${riskFlags.length})`, bold: true })],
            }));

            const hasAnyLocation = riskFlags.some(r => r.location || r.sourceRef);
            const riskHeaders = ['Level', 'Category', 'Explanation', 'Recommendation'];
            if (hasAnyLocation) riskHeaders.push('Reference');
            const headerRow = new docx.TableRow({
                tableHeader: true,
                children: riskHeaders.map(h =>
                    new docx.TableCell({
                        shading: { fill: '2E2E2E' },
                        children: [new docx.Paragraph({ children: [new docx.TextRun({ text: h, bold: true, color: 'FFFFFF', size: 20 })] })],
                    })
                ),
            });

            const dataRows = riskFlags.map(r => {
                const cells = [
                    new docx.TableCell({
                        shading: { fill: (r.level || r.severity) === 'red' ? 'FFCCCC' : (r.level || r.severity) === 'yellow' ? 'FFF3CC' : 'CCFFCC' },
                        children: [new docx.Paragraph({ children: [new docx.TextRun({ text: (r.level || r.severity || '').toUpperCase(), size: 18 })] })],
                    }),
                    new docx.TableCell({ children: [new docx.Paragraph({ children: [new docx.TextRun({ text: r.category || '', size: 18 })] })] }),
                    new docx.TableCell({ children: [new docx.Paragraph({ children: [new docx.TextRun({ text: r.explanation || r.flag || '', size: 18 })] })] }),
                    new docx.TableCell({ children: [new docx.Paragraph({ children: [new docx.TextRun({ text: r.recommendation || '', size: 18 })] })] }),
                ];
                if (hasAnyLocation) {
                    const refParts = [r.location, r.sourceRef].filter(Boolean).join(' | ');
                    cells.push(new docx.TableCell({ children: [new docx.Paragraph({ children: [new docx.TextRun({ text: refParts, size: 16, italics: true, color: '888888' })] })] }));
                }
                return new docx.TableRow({ children: cells });
            });

            docChildren.push(new docx.Table({
                width: { size: 100, type: docx.WidthType.PERCENTAGE },
                rows: [headerRow, ...dataRows],
            }));
        }

        // Important Dates
        const dates = analysis.importantDates || [];
        if (dates.length > 0) {
            docChildren.push(new docx.Paragraph({ children: [new docx.TextRun('')] }));
            docChildren.push(new docx.Paragraph({
                heading: docx.HeadingLevel.HEADING_2,
                children: [new docx.TextRun({ text: 'Important Dates', bold: true })],
            }));
            for (const d of dates) {
                docChildren.push(new docx.Paragraph({
                    bullet: { level: 0 },
                    children: [
                        new docx.TextRun({ text: d.date, bold: true }),
                        new docx.TextRun({ text: ` — ${d.description}` }),
                    ],
                }));
            }
        }

        // Missing Elements
        const missing = analysis.missingElements || [];
        if (missing.length > 0) {
            docChildren.push(new docx.Paragraph({ children: [new docx.TextRun('')] }));
            docChildren.push(new docx.Paragraph({
                heading: docx.HeadingLevel.HEADING_2,
                children: [new docx.TextRun({ text: 'Missing Elements', bold: true })],
            }));
            for (const m of missing) {
                docChildren.push(new docx.Paragraph({
                    bullet: { level: 0 },
                    children: [
                        new docx.TextRun({ text: `${m.element}`, bold: true }),
                        new docx.TextRun({ text: ` (${friendlyImportance(m.importance)})`, color: importanceColor(m.importance) }),
                        new docx.TextRun({ text: ` — ${m.explanation}` }),
                    ],
                }));
            }
        }

        const doc2 = new docx.Document({
            numbering: { config: [{ reference: 'default-numbering', levels: [{ level: 0, format: docx.LevelFormat.DECIMAL, text: '%1.', alignment: docx.AlignmentType.START }] }] },
            sections: [{
                properties: {},
                footers: makeFooter(`Analysis by LexVault — ${document.filename || 'Document'} — ${new Date().toLocaleDateString()}`),
                children: docChildren,
            }],
        });

        const buffer = await docx.Packer.toBuffer(doc2);
        const filename = (document.filename || 'analysis').replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '_');
        res.setHeader('Content-Disposition', `attachment; filename="${safeFilename(filename)}_analysis.docx"`);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.send(buffer);
        saveAIAudit({
            userId,
            requestType: 'document_export',
            userQuery: `Export DOCX: ${document.filename || 'Document'}`,
            ragSearches: [], nliVerifications: [], quoteVerifications: [], llmCalls: [],
            response: `DOCX export (${buffer.length} bytes)`,
            sourcesUsed: [],
            overallConfidence: 'unverified',
            totalDurationMs: Date.now() - t0,
        }).catch(e => console.warn('[Audit] Export log failed:', e));
    } catch (error) {
        console.error('[Export] Analysis DOCX error:', error);
        next(error);
    }
});

// ============================================================================
// PDF Export Helpers
// ============================================================================

function createPdf(title, callback) {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
        const chunks = [];
        doc.on('data', c => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        // Header
        doc.font('Helvetica-Bold').fontSize(22).fillColor('#1a1a0f').text(title, { align: 'center' });
        doc.moveDown(0.5);
        doc.font('Helvetica').fontSize(9).fillColor('#888888')
            .text(`Generated by LexVault on ${new Date().toLocaleDateString()}`, { align: 'center' });
        doc.moveDown(1);
        doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#cccccc').stroke();
        doc.moveDown(0.8);

        callback(doc);

        // Footer on each page
        const pages = doc.bufferedPageRange();
        for (let i = 0; i < pages.count; i++) {
            doc.switchToPage(i);
            doc.font('Helvetica').fontSize(8).fillColor('#999999')
                .text('LexVault — Legal Research Platform', 50, 780, { align: 'center', width: 495 });
        }
        doc.end();
    });
}

function pdfHeading(doc, text, level) {
    const sizes = { 1: 18, 2: 14, 3: 12 };
    doc.font('Helvetica-Bold').fontSize(sizes[level] || 12).fillColor('#1a1a0f').text(text);
    doc.moveDown(0.3);
}

function pdfParagraph(doc, text) {
    if (!text) return;
    const lines = text.split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) { doc.moveDown(0.3); continue; }
        if (trimmed.startsWith('### ')) {
            pdfHeading(doc, trimmed.slice(4), 3);
        } else if (trimmed.startsWith('## ')) {
            pdfHeading(doc, trimmed.slice(3), 2);
        } else if (trimmed.startsWith('# ')) {
            pdfHeading(doc, trimmed.slice(2), 1);
        } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
            doc.font('Helvetica').fontSize(10).fillColor('#333333').text(`  \u2022  ${trimmed.slice(2)}`, { indent: 10 });
        } else {
            // Strip **bold** markers — pdfkit doesn't do inline mixed fonts well,
            // so render as plain text with bold markers removed
            const clean = trimmed.replace(/\*\*(.*?)\*\*/g, '$1');
            doc.font('Helvetica').fontSize(10).fillColor('#333333').text(clean);
        }
    }
}

// ============================================================================
// PDF Export: Research Conversation
// ============================================================================
router.post('/export/conversation/:id/pdf', rateLimit_1.exportLimiter, auth_1.authenticateToken, async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const conversation = await (0, researchChatService_1.getConversation)(req.params.id, userId);
        if (!conversation) return res.status(404).json({ error: 'Not Found' });

        const buffer = await createPdf(conversation.title || 'Research Conversation', (doc) => {
            doc.font('Helvetica').fontSize(9).fillColor('#666666')
                .text(`Jurisdiction: ${conversation.jurisdiction || 'N/A'}`, { align: 'left' });
            doc.moveDown(1);

            const msgs = conversation.messages || [];
            for (const msg of msgs) {
                if (msg.role === 'user') {
                    pdfHeading(doc, 'Question', 2);
                    doc.font('Helvetica').fontSize(10).fillColor('#333333').text(msg.content || '');
                    doc.moveDown(0.5);
                } else if (msg.role === 'assistant') {
                    pdfHeading(doc, 'Research Response', 2);
                    pdfParagraph(doc, msg.content || '');
                    if (msg.sources && msg.sources.length > 0) {
                        doc.moveDown(0.5);
                        doc.font('Helvetica-Bold').fontSize(10).fillColor('#555555').text(`Sources (${msg.sources.length}):`);
                        for (const src of msg.sources) {
                            const name = src.title || src.source_name || 'Unknown';
                            const score = src.score ? ` — ${(src.score * 100).toFixed(0)}%` : '';
                            doc.font('Helvetica').fontSize(9).fillColor('#555555').text(`  •  ${name}${score}`);
                        }
                    }
                    doc.moveDown(1);
                }
            }
        });

        const filename = (conversation.title || 'research').replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '_');
        res.setHeader('Content-Disposition', `attachment; filename="${safeFilename(filename)}.pdf"`);
        res.setHeader('Content-Type', 'application/pdf');
        res.send(buffer);
    } catch (error) {
        console.error('[Export] Conversation PDF error:', error);
        next(error);
    }
});

// ============================================================================
// PDF Export: Navigator Document
// ============================================================================
router.post('/export/navigator/pdf', rateLimit_1.exportLimiter, auth_1.authenticateToken, async (req, res, next) => {
    try {
        const { title, sections, jurisdiction, language } = req.body;
        if (!title || !sections) return res.status(400).json({ error: 'title and sections required' });

        const buffer = await createPdf(title, (doc) => {
            doc.font('Helvetica').fontSize(9).fillColor('#666666')
                .text(`Jurisdiction: ${jurisdiction || 'N/A'}  |  Language: ${language || 'en'}`, { align: 'center' });
            doc.moveDown(1);

            for (let i = 0; i < sections.length; i++) {
                pdfHeading(doc, `${i + 1}. ${sections[i].title}`, 2);
                pdfParagraph(doc, sections[i].content);
                doc.moveDown(0.8);
            }
        });

        const filename = title.replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '_');
        res.setHeader('Content-Disposition', `attachment; filename="${safeFilename(filename)}.pdf"`);
        res.setHeader('Content-Type', 'application/pdf');
        res.send(buffer);
    } catch (error) {
        console.error('[Export] Navigator PDF error:', error);
        next(error);
    }
});

// ============================================================================
// PDF Export: Document Analysis
// ============================================================================
router.post('/export/analysis/:id/pdf', rateLimit_1.exportLimiter, auth_1.authenticateToken, async (req, res, next) => {
    try {
        const t0 = Date.now();
        const userId = req.user.userId;
        const document = await prisma.document.findFirst({ where: { id: req.params.id, userId } });
        if (!document) return res.status(404).json({ error: 'Not Found' });

        // Build analysis from separate DB fields (analysis column is metadata only)
        const parseJSON2 = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
        let analysis = parseJSON2(document.analysis) || {};
        if (!analysis.summary && document.summary) analysis.summary = parseJSON2(document.summary) || document.summary;
        if (!analysis.keyClauses && document.keyClauses) analysis.keyClauses = parseJSON2(document.keyClauses);
        if (!analysis.riskFlags && document.riskFlags) analysis.riskFlags = parseJSON2(document.riskFlags);
        if (!analysis.importantDates && document.importantDates) analysis.importantDates = parseJSON2(document.importantDates);
        if (!analysis.missingElements && document.missingElements) analysis.missingElements = parseJSON2(document.missingElements);
        if (!analysis.overallRiskScore && document.overallRiskScore) analysis.overallRiskScore = parseJSON2(document.overallRiskScore);
        if (!analysis.clarityScore && document.clarityScore) analysis.clarityScore = parseJSON2(document.clarityScore);
        if (!analysis.readabilityScore && document.readabilityScore) analysis.readabilityScore = parseJSON2(document.readabilityScore);

        const buffer = await createPdf(`Analysis: ${document.filename || 'Document'}`, (doc) => {
            // Risk score
            const rs = analysis.overallRiskScore;
            if (rs) {
                const level = typeof rs === 'number' ? (rs > 70 ? 'HIGH' : rs > 40 ? 'MEDIUM' : 'LOW') : (rs.level || '').toUpperCase();
                const color = level === 'HIGH' ? '#CC3333' : level === 'MEDIUM' ? '#CC8833' : '#339933';
                doc.font('Helvetica-Bold').fontSize(12).fillColor(color).text(`Overall Risk: ${level}`);
                doc.moveDown(0.5);
            }

            // Summary
            const summaryText = typeof analysis.summary === 'string' ? analysis.summary : (analysis.summary?.content || '');
            if (summaryText) {
                pdfHeading(doc, 'Summary', 2);
                pdfParagraph(doc, summaryText);
                doc.moveDown(0.8);
            }

            // Key Clauses
            const clauses = analysis.keyClauses || [];
            if (clauses.length > 0) {
                pdfHeading(doc, `Key Clauses (${clauses.length})`, 2);
                for (const c of clauses) {
                    doc.font('Helvetica-Bold').fontSize(10).fillColor('#333333')
                        .text(`${c.title || 'Clause'} (${friendlyImportance(c.importance)})`, { continued: false });
                    if (c.content || c.clause) {
                        doc.font('Helvetica').fontSize(9).fillColor('#555555').text(c.content || c.clause, { indent: 15 });
                    }
                    if (c.location || c.sourceRef) {
                        const refs = [c.location, c.sourceRef].filter(Boolean).join('  |  ');
                        doc.font('Helvetica-Oblique').fontSize(8).fillColor('#888888').text(refs, { indent: 15 });
                    }
                    doc.moveDown(0.3);
                }
                doc.moveDown(0.5);
            }

            // Risk Flags
            const risks = analysis.riskFlags || [];
            if (risks.length > 0) {
                pdfHeading(doc, `Risk Flags (${risks.length})`, 2);
                for (const r of risks) {
                    const level = (r.level || r.severity || '').toUpperCase();
                    const color = level === 'RED' ? '#CC3333' : level === 'YELLOW' ? '#CC8833' : '#339933';
                    doc.font('Helvetica-Bold').fontSize(10).fillColor(color).text(`[${level}] ${r.category || ''}`);
                    if (r.explanation) doc.font('Helvetica').fontSize(9).fillColor('#555555').text(r.explanation, { indent: 15 });
                    if (r.recommendation) doc.font('Helvetica').fontSize(9).fillColor('#888888').text(`Recommendation: ${r.recommendation}`, { indent: 15 });
                    if (r.location || r.sourceRef) {
                        const refs = [r.location, r.sourceRef].filter(Boolean).join('  |  ');
                        doc.font('Helvetica-Oblique').fontSize(8).fillColor('#888888').text(refs, { indent: 15 });
                    }
                    doc.moveDown(0.3);
                }
                doc.moveDown(0.5);
            }

            // Important Dates
            const dates = analysis.importantDates || [];
            if (dates.length > 0) {
                pdfHeading(doc, 'Important Dates', 2);
                for (const d of dates) {
                    doc.font('Helvetica-Bold').fontSize(9).fillColor('#333333').text(d.date, { continued: true });
                    doc.font('Helvetica').text(` — ${d.description}`);
                }
                doc.moveDown(0.5);
            }

            // Missing Elements
            const missing = analysis.missingElements || [];
            if (missing.length > 0) {
                pdfHeading(doc, 'Missing Elements', 2);
                for (const m of missing) {
                    const color = (m.importance || '').toLowerCase() === 'critical' || (m.importance || '').toLowerCase() === 'high' ? '#CC3333' : '#666666';
                    doc.font('Helvetica-Bold').fontSize(9).fillColor(color).text(`${m.element} (${friendlyImportance(m.importance)})`, { continued: true });
                    doc.font('Helvetica').fillColor('#555555').text(` — ${m.explanation}`);
                }
            }
        });

        const filename = (document.filename || 'analysis').replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '_');
        res.setHeader('Content-Disposition', `attachment; filename="${safeFilename(filename)}_analysis.pdf"`);
        res.setHeader('Content-Type', 'application/pdf');
        res.send(buffer);
        saveAIAudit({
            userId,
            requestType: 'document_export',
            userQuery: `Export PDF: ${document.filename || 'Document'}`,
            ragSearches: [], nliVerifications: [], quoteVerifications: [], llmCalls: [],
            response: `PDF export (${buffer.length} bytes)`,
            sourcesUsed: [],
            overallConfidence: 'unverified',
            totalDurationMs: Date.now() - t0,
        }).catch(e => console.warn('[Audit] Export log failed:', e));
    } catch (error) {
        console.error('[Export] Analysis PDF error:', error);
        next(error);
    }
});

// ============================================================================
// Export: Vault Item (DOCX + PDF)
// ============================================================================
router.post('/export/vault/:id', rateLimit_1.exportLimiter, auth_1.authenticateToken, async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const format = req.query.format || 'docx';
        const rawId = req.params.id;

        // Handle document items (prefixed with "doc-" in vault view)
        if (rawId.startsWith('doc-')) {
            const docId = rawId.slice(4);
            const document = await prisma.document.findFirst({ where: { id: docId, userId } });
            if (!document) return res.status(404).json({ error: 'Not Found' });
            // Build analysis from separate DB fields
            const pj = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
            const analysis = pj(document.analysis) || {};
            if (!analysis.summary && document.summary) analysis.summary = pj(document.summary) || document.summary;
            if (!analysis.keyClauses && document.keyClauses) analysis.keyClauses = pj(document.keyClauses);
            if (!analysis.riskFlags && document.riskFlags) analysis.riskFlags = pj(document.riskFlags);
            if (!analysis.importantDates && document.importantDates) analysis.importantDates = pj(document.importantDates);
            if (!analysis.missingElements && document.missingElements) analysis.missingElements = pj(document.missingElements);
            if (!analysis.overallRiskScore && document.overallRiskScore) analysis.overallRiskScore = pj(document.overallRiskScore);
            if (!analysis.clarityScore && document.clarityScore) analysis.clarityScore = pj(document.clarityScore);
            const title = document.filename || 'Document';
            const summaryText = typeof analysis.summary === 'string' ? analysis.summary : (analysis.summary?.content || '');
            // Build combined markdown content for export
            let md = `# Document Analysis: ${title}\n\n`;
            if (summaryText) md += `## Summary\n\n${summaryText}\n\n`;
            const clauses = analysis.keyClauses || [];
            if (clauses.length > 0) {
                md += `## Key Clauses (${clauses.length})\n\n`;
                clauses.forEach(c => {
                    md += `**${c.title || 'Clause'}** (${friendlyImportance(c.importance)}${c.category ? ` [${c.category}]` : ''})\n${c.content || c.clause || ''}\n`;
                    if (c.location || c.sourceRef) md += `*${[c.location, c.sourceRef].filter(Boolean).join(' | ')}*\n`;
                    md += '\n';
                });
            }
            const risks = analysis.riskFlags || [];
            if (risks.length > 0) {
                md += `## Risk Flags (${risks.length})\n\n`;
                risks.forEach(r => {
                    md += `**${(r.level || r.severity || '').toUpperCase()}** — ${r.category || ''}\n${r.explanation || r.flag || ''}\n`;
                    if (r.recommendation) md += `Recommendation: ${r.recommendation}\n`;
                    if (r.location || r.sourceRef) md += `*${[r.location, r.sourceRef].filter(Boolean).join(' | ')}*\n`;
                    md += '\n';
                });
            }
            const dates = analysis.importantDates || [];
            if (dates.length > 0) {
                md += `## Important Dates\n\n`;
                dates.forEach(d => { md += `- **${d.date}** — ${d.description}\n`; });
                md += '\n';
            }
            const missing = analysis.missingElements || [];
            if (missing.length > 0) {
                md += `## Missing Elements\n\n`;
                missing.forEach(m => { md += `- **${m.element}** (${friendlyImportance(m.importance)}) — ${m.explanation}\n`; });
                md += '\n';
            }
            if (format === 'pdf') {
                const buffer = await createPdf(`Analysis: ${title}`, (doc) => {
                    doc.font('Helvetica').fontSize(9).fillColor('#666666')
                        .text(`Analyzed: ${new Date(document.createdAt || Date.now()).toLocaleDateString()}`);
                    doc.moveDown(1);
                    pdfParagraph(doc, md);
                });
                const fn = title.replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '_');
                res.setHeader('Content-Disposition', `attachment; filename="${safeFilename(fn)}_analysis.pdf"`);
                res.setHeader('Content-Type', 'application/pdf');
                return res.send(buffer);
            } else {
                const docChildren = [];
                docChildren.push(new docx.Paragraph({ heading: docx.HeadingLevel.HEADING_1, children: [new docx.TextRun({ text: `Document Analysis: ${title}`, bold: true })] }));
                docChildren.push(new docx.Paragraph({ children: [new docx.TextRun({ text: `Analyzed: ${new Date(document.createdAt || Date.now()).toLocaleDateString()}`, size: 20, color: '666666' })] }));
                docChildren.push(new docx.Paragraph({ children: [new docx.TextRun('')] }));
                docChildren.push(...mdToDocxChildren(md));
                const doc2 = new docx.Document({
                    numbering: { config: [{ reference: 'default-numbering', levels: [{ level: 0, format: docx.LevelFormat.DECIMAL, text: '%1.', alignment: docx.AlignmentType.START }] }] },
                    sections: [{ properties: {}, footers: makeFooter(`Analysis by LexVault — ${title}`), children: docChildren }],
                });
                const buffer = await docx.Packer.toBuffer(doc2);
                const fn = title.replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '_');
                res.setHeader('Content-Disposition', `attachment; filename="${safeFilename(fn)}_analysis.docx"`);
                res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
                return res.send(buffer);
            }
        }

        const item = await prisma.vaultItem.findFirst({ where: { id: rawId, userId } });
        if (!item) return res.status(404).json({ error: 'Not Found' });

        const title = item.title || 'Vault Item';
        const content = item.content || '';
        const typeName = (item.type || 'note').charAt(0).toUpperCase() + (item.type || 'note').slice(1);
        const savedDate = new Date(item.createdAt || Date.now()).toLocaleDateString();

        // Try to parse JSON content (navigator drafts / structured templates)
        let parsed = null;
        if (content.trim().startsWith('{') || content.trim().startsWith('[')) {
            try { parsed = JSON.parse(content); } catch { parsed = null; }
        }
        const hasSections = parsed && parsed.sections && Array.isArray(parsed.sections);

        if (format === 'pdf') {
            const buffer = await createPdf(hasSections ? (parsed.title || title) : title, (doc) => {
                doc.font('Helvetica').fontSize(9).fillColor('#666666')
                    .text(`${typeName}  |  Saved: ${savedDate}`);
                doc.moveDown(1);
                if (hasSections) {
                    // Navigator-style structured export
                    for (let i = 0; i < parsed.sections.length; i++) {
                        const s = parsed.sections[i];
                        pdfHeading(doc, `${i + 1}. ${s.title || 'Section'}`, 11);
                        pdfParagraph(doc, s.content || '');
                        doc.moveDown(0.5);
                    }
                } else {
                    pdfParagraph(doc, content);
                }
            });
            const filename = title.replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '_');
            res.setHeader('Content-Disposition', `attachment; filename="${safeFilename(filename)}.pdf"`);
            res.setHeader('Content-Type', 'application/pdf');
            res.send(buffer);
        } else {
            const docChildren = [];
            if (hasSections) {
                // Navigator-style structured DOCX (centered title, numbered sections)
                const docTitle = parsed.title || title;
                docChildren.push(new docx.Paragraph({
                    heading: docx.HeadingLevel.HEADING_1,
                    alignment: docx.AlignmentType.CENTER,
                    children: [new docx.TextRun({ text: docTitle.toUpperCase(), bold: true })],
                }));
                docChildren.push(new docx.Paragraph({
                    alignment: docx.AlignmentType.CENTER,
                    children: [new docx.TextRun({ text: `${typeName}  |  Saved: ${savedDate}`, size: 20, color: '666666' })],
                }));
                docChildren.push(new docx.Paragraph({ children: [new docx.TextRun('')] }));
                for (let i = 0; i < parsed.sections.length; i++) {
                    const s = parsed.sections[i];
                    docChildren.push(new docx.Paragraph({
                        heading: docx.HeadingLevel.HEADING_2,
                        children: [new docx.TextRun({ text: `${i + 1}. ${s.title || 'Section'}`, bold: true })],
                    }));
                    docChildren.push(...mdToDocxChildren(s.content || ''));
                    docChildren.push(new docx.Paragraph({ children: [new docx.TextRun('')] }));
                }
            } else {
                // Plain content export
                docChildren.push(new docx.Paragraph({
                    heading: docx.HeadingLevel.HEADING_1,
                    children: [new docx.TextRun({ text: title, bold: true })],
                }));
                docChildren.push(new docx.Paragraph({
                    children: [new docx.TextRun({ text: `${typeName}  |  Saved: ${savedDate}`, size: 20, color: '666666' })],
                }));
                docChildren.push(new docx.Paragraph({ children: [new docx.TextRun('')] }));
                docChildren.push(...mdToDocxChildren(content));
            }

            const doc2 = new docx.Document({
                numbering: { config: [{ reference: 'default-numbering', levels: [{ level: 0, format: docx.LevelFormat.DECIMAL, text: '%1.', alignment: docx.AlignmentType.START }] }] },
                sections: [{
                    properties: {},
                    footers: makeFooter(`LexVault — ${typeName} — ${new Date().toLocaleDateString()}`),
                    children: docChildren,
                }],
            });
            const buffer = await docx.Packer.toBuffer(doc2);
            const filename = title.replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '_');
            res.setHeader('Content-Disposition', `attachment; filename="${safeFilename(filename)}.docx"`);
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
            res.send(buffer);
        }
    } catch (error) {
        console.error('[Export] Vault item error:', error);
        next(error);
    }
});
router.post('/chat/stream', rateLimit_1.strictApiLimiter, auth_1.authenticateToken, chatUpload.single('file'), async (req, res, next) => {
    let keepalive = null;
    try {
        const userId = req.user.userId;
        // Parse jurisdictions — FormData sends as string, JSON sends as array
        let { conversationId, message, jurisdictions, ragOnly, sourceOffset } = req.body;
        if (typeof jurisdictions === 'string') {
            try { jurisdictions = JSON.parse(jurisdictions); } catch { jurisdictions = [jurisdictions]; }
        }
        if (typeof ragOnly === 'string') {
            ragOnly = ragOnly === 'true';
        }

        // Handle file attachment: extract text and prepend to message
        let cleanupFile = null;
        if (req.file) {
            try {
                console.log(`[Research] File attached: ${req.file.originalname} (${req.file.size} bytes)`);
                const extractedText = await (0, docParser_1.parseDocument)(req.file.path);
                const truncated = extractedText.slice(0, 30000);
                message = `[Attached: ${req.file.originalname}]\n\n${truncated}\n\n---\n\nQuestion: ${message}`;
                cleanupFile = req.file.path;
            } catch (parseErr) {
                console.error('[Research] File parse error:', parseErr);
                // Clean up on parse failure
                if (req.file.path) {
                    promises_1.default.unlink(req.file.path).catch(() => {});
                }
                return res.status(400).json({ error: 'Failed to parse attached file', message: parseErr.message });
            }
        }

        if ((!message || message.trim().length < 1) && !sourceOffset) {
            if (cleanupFile) promises_1.default.unlink(cleanupFile).catch(() => {});
            return res.status(400).json({
                error: 'Bad Request',
                message: 'Message is required',
            });
        }
        // For source continuation, use a placeholder message
        if (sourceOffset && (!message || message.trim().length < 1)) {
            message = '[analyzing additional sources]';
        }
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders();
        const sendEvent = (event, data) => {
            res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        };
        // SSE keepalive — send comment every 15s to prevent nginx/browser timeout during judge verification
        keepalive = setInterval(() => {
            try { res.write(': keepalive\n\n'); } catch {}
        }, 15000);
        try {
            for await (const event of (0, researchChatService_1.chatStream)(userId, message.trim(), {
                conversationId,
                jurisdictionOverride: jurisdictions?.[0],
                jurisdictions: jurisdictions || [],
                ragOnly: ragOnly,
                sourceOffset: parseInt(sourceOffset) || 0,
                ipAddress: req.ip,
                userAgent: req.headers['user-agent'],
            })) {
                sendEvent(event.type, event.data);
            }
        }
        catch (streamError) {
            sendEvent('error', { message: streamError.message || 'An error occurred' });
        }
        clearInterval(keepalive);
        keepalive = null;
        sendEvent('done', { complete: true });
        res.end();

        // Clean up temp file after streaming completes
        if (cleanupFile) {
            promises_1.default.unlink(cleanupFile).catch(() => {});
        }
    }
    catch (error) {
        if (keepalive) clearInterval(keepalive);
        console.error('[Research] Stream error:', error);
        if (!res.headersSent) {
            return res.status(500).json({ error: 'Internal Server Error', message: error.message });
        }
        try { res.write(`event: error\ndata: ${JSON.stringify({ message: error.message })}\n\n`); } catch {}
        try { res.end(); } catch {}
    }
});
router.get('/jurisdictions', auth_1.authenticateToken, async (_req, res) => {
    const jurisdictions = Object.entries(researchChatService_1.JURISDICTION_INFO).map(([code, info]) => ({
        code,
        ...info,
    }));
    res.json({ jurisdictions });
});
router.post('/conversations', auth_1.authenticateToken, async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const { jurisdiction, title } = req.body;
        const conversation = await prisma.researchConversation.create({
            data: {
                userId,
                jurisdiction: jurisdiction || null,
                title: title || null,
            },
        });
        res.status(201).json({
            id: conversation.id,
            jurisdiction: conversation.jurisdiction,
            title: conversation.title,
            createdAt: conversation.createdAt,
        });
    }
    catch (error) {
        next(error);
    }
});
router.get('/conversations', auth_1.authenticateToken, async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const { limit = 50 } = req.query;
        const conversations = await (0, researchChatService_1.getConversations)(userId, { limit: Number(limit) });
        res.json({ conversations });
    }
    catch (error) {
        next(error);
    }
});
router.get('/conversations/:id', auth_1.authenticateToken, async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const conversation = await (0, researchChatService_1.getConversation)(req.params.id, userId);
        if (!conversation) {
            return res.status(404).json({ error: 'Not Found' });
        }
        res.json(conversation);
    }
    catch (error) {
        next(error);
    }
});
router.delete('/conversations/:id', auth_1.authenticateToken, async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const success = await (0, researchChatService_1.deleteConversation)(req.params.id, userId);
        if (!success) {
            return res.status(404).json({ error: 'Not Found' });
        }
        res.json({ message: 'Deleted' });
    }
    catch (error) {
        next(error);
    }
});
// ============================================================================
// Investigate: Parallel Streaming SSE Endpoint
// ============================================================================

// Per-user active investigation tracking — auto-cancels previous run
const activeInvestigations = new Map(); // userId → AbortController

// LLM semaphore — serialize GPU access (only 1 LLM call at a time)
let llmSemaphorePromise = Promise.resolve();
function acquireLLMSemaphore() {
    let release;
    const prev = llmSemaphorePromise;
    llmSemaphorePromise = new Promise(resolve => { release = resolve; });
    return prev.then(() => release);
}


// ============================================================================
// Investigate: Two-Pass Architecture with LLM-Driven RAG
// ============================================================================

// Extract document structure using regex patterns (0 LLM calls)
function extractDocumentStructure(text) {
    const sections = [];
    const lines = text.split('\n');
    let currentSection = null;
    let lineOffset = 0;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        // Detect section headings via common legal document patterns
        const isHeading = (
            /^#{1,4}\s+/.test(trimmed) ||                                      // markdown headings
            /^(Article|Section|ARTICLE|SECTION)\s+\d/i.test(trimmed) ||        // Article N / Section N
            /^§\s*\d/.test(trimmed) ||                                          // § N
            /^\d{1,3}\.\s+[A-Z]/.test(trimmed) ||                              // N. Title
            /^(SCHEDULE|EXHIBIT|ANNEX|APPENDIX)\s+/i.test(trimmed) ||          // Schedule/Exhibit
            (trimmed.length > 10 && trimmed.length < 120 && trimmed === trimmed.toUpperCase() && /[A-Z]/.test(trimmed))
        );

        if (isHeading) {
            if (currentSection) {
                currentSection.end = lineOffset;
                currentSection.preview = text.slice(currentSection.start, Math.min(currentSection.start + 150, currentSection.end)).trim();
                sections.push(currentSection);
            }
            currentSection = {
                index: sections.length,
                heading: trimmed.replace(/^#+\s*/, ''),
                start: lineOffset,
                end: text.length,
            };
        }
        lineOffset += line.length + 1; // +1 for \n
    }
    if (currentSection) {
        currentSection.end = text.length;
        currentSection.preview = text.slice(currentSection.start, Math.min(currentSection.start + 150, currentSection.end)).trim();
        sections.push(currentSection);
    }
    return sections;
}

// Run search queries against Qdrant in parallel with triple-query support
// Accepts plain strings OR structured {query, query2, query3} objects
async function runLLMDrivenRAG(ragQueries, jurisdictions) {
    const retrieval = require('../services/rag/retrieval');
    const allResults = [];
    const seen = new Set();

    await Promise.all(ragQueries.map(async (q) => {
        try {
            const isStructured = typeof q === 'object' && q.query;
            const mainQuery = isStructured ? q.query : q;
            const synonymQuery = isStructured ? q.query2 : null;
            const statuteQuery = isStructured ? q.query3 : null;
            const triggeredByLabel = mainQuery;

            // Build parallel search promises (triple-query when variants available)
            const searchPromises = [];
            if (jurisdictions.length <= 1) {
                const jur = jurisdictions[0] || 'US';
                searchPromises.push(retrieval.enhancedSearch(mainQuery, { jurisdiction: jur, limit: 10, rerank: true, minRerankScore: 0.01 }));
                if (synonymQuery) searchPromises.push(retrieval.enhancedSearch(synonymQuery, { jurisdiction: jur, limit: 8, rerank: true, minRerankScore: 0.01 }));
                if (statuteQuery) searchPromises.push(retrieval.enhancedSearch(statuteQuery, { jurisdiction: jur, limit: 8, rerank: true, minRerankScore: 0.01 }));
            } else {
                searchPromises.push(retrieval.searchMultiJurisdiction(mainQuery, jurisdictions, { limit: 10 }).then(multi => multi.flatMap(r => r.results)));
                if (synonymQuery) searchPromises.push(retrieval.searchMultiJurisdiction(synonymQuery, jurisdictions, { limit: 8 }).then(multi => multi.flatMap(r => r.results)));
                if (statuteQuery) searchPromises.push(retrieval.searchMultiJurisdiction(statuteQuery, jurisdictions, { limit: 8 }).then(multi => multi.flatMap(r => r.results)));
            }

            const searchResults = await Promise.all(searchPromises);
            const queryLabels = [mainQuery, synonymQuery, statuteQuery].filter(Boolean);
            console.log(`[Investigate/RAG] Triple-query: ${queryLabels.length} searches for "${mainQuery.substring(0, 60)}"`);

            for (const results of searchResults) {
                for (const r of (results || [])) {
                    if (!seen.has(r.sourceName)) {
                        seen.add(r.sourceName);
                        allResults.push({ ...r, triggeredBy: triggeredByLabel });
                    }
                }
            }
        } catch (err) {
            const label = typeof q === 'object' ? q.query : q;
            console.error(`[Investigate/RAG] Query "${label}" failed:`, err.message);
        }
    }));

    return allResults;
}

// Extract targeted RAG queries from analysis output (document-first approach)
// Instead of guessing RAG queries before analysis, we analyze first, then extract
// specific legal claims/statutes that need verification from the actual output.
async function extractTargetedRagQueries(analysis, query, jurisdictions, llmCallFn) {
    const jurStr = jurisdictions.join(', ');
    const jurExamples = jurisdictions.map(j => {
        switch (j) {
            case 'AT': return 'AT: Use ABGB/UGB/KSchG. Example: query="Werkvertrag Fixpreis Preiserhöhung", query2="Werklohn Vergütung Pauschalpreis", query3="ABGB § 919 § 1170 § 1170a Werkvertrag"';
            case 'DE': return 'DE: Use BGB/HGB/StGB. Example: query="Kündigung Gewerberaum Mietvertrag", query2="Mietverhältnis Beendigung Geschäftsräume", query3="BGB § 542 § 573 § 580a Kündigung"';
            case 'SK': return 'SK: Use Zákonník práce/Obchodný zákonník. Example: query="pracovná zmluva podmienky", query2="zamestnanec zamestnávateľ dohoda", query3="Zákonník práce § 42 § 43 § 44"';
            case 'US': return 'US: Use U.S. Code Title. Example: query="consumer credit card liability", query2="cardholder unauthorized charges dispute", query3="U.S. Code Title 15 § 1643 § 1666"';
            case 'RO': return 'RO: Use Codul Civil/Codul Muncii. Example: query="răspundere contractuală daune", query2="obligații neexecutare prejudiciu", query3="Codul Civil Art. 1350 Art. 1530"';
            default: return `${j}: Use relevant statutes from this jurisdiction`;
        }
    }).join('\n');

    const prompt = `You wrote this analysis for query "${query}" (jurisdiction: ${jurStr}):

${analysis.substring(0, 4000)}

Generate 1-5 targeted search queries to find the specific laws and statutes that SUPPORT or VERIFY your claims above. For each topic you referenced, provide:
- query: natural language search in the jurisdiction's language
- query2: formal synonym/alternative phrasing
- query3: specific statute section numbers (2-4 section numbers you believe are most relevant)

Statute formats by jurisdiction:
${jurExamples}

Return JSON only:
{"searches": [
  {"query": "...", "query2": "...", "query3": "..."}
]}`;

    try {
        const response = await llmCallFn(
            [{ role: 'system', content: 'Return only valid JSON.' },
             { role: 'user', content: prompt }],
            { temperature: 0, maxTokens: 600, useFastModel: false }
        );
        const jsonMatch = (response || '').match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            if (Array.isArray(parsed.searches) && parsed.searches.length > 0) {
                const searches = parsed.searches.slice(0, 5);
                console.log(`[Investigate] Extracted ${searches.length} targeted RAG queries from analysis`);
                searches.forEach((s, i) => console.log(`  [${i+1}] q="${s.query}" q2="${s.query2 || '-'}" q3="${s.query3 || '-'}"`));
                return searches;
            }
        }
    } catch (err) {
        console.error('[Investigate] Failed to extract RAG queries from analysis:', err.message);
    }
    // Fallback: use original query as single search
    return [{ query: query, query2: null, query3: null }];
}

// Judge verification for investigate findings
async function verifyFindingWithJudge(analysis, docName, ragSources, llmCallFn, isAbortedFn, auditContext) {
    if (!analysis || analysis.length < 50) return analysis;
    if (isAbortedFn()) return analysis;
    const sources = (ragSources || []).slice(0, 10);
    if (sources.length === 0) return analysis;
    const excerptLen = sources.length > 10 ? 500 : 800;
    const sourceSummary = sources.map((s, i) => {
        const name = s.sourceName || s.source_name || 'Source';
        const text = (s.content || s.text || '').substring(0, excerptLen).replace(/\s+/g, ' ').trim();
        return `[Source ${i + 1}: ${name} (Jurisdiction: ${s.jurisdiction || '?'})]\n${text}`;
    }).join('\n\n');
    const sentences = analysis.split(/(?<=[.!?])\s+/).filter(s => s.length > 20);
    // Only verify claims that reference EXTERNAL legal authorities (statutes, codes, acts)
    // Skip document-internal references like "Section 5 of the agreement"
    const verifiableSentences = sentences.filter(s => {
        // Must reference an external legal authority
        const hasExternalRef = /§\s*\d|U\.S\.\s*Code|Title\s+\d+|Act\s+(of|§)|Code\s+(§|Art)|Gesetz|ABGB|BGB|UGB|zákon/i.test(s)
            || /pursuant to\s+(the\s+)?\w+\s+(Act|Code|Law|Statute|Regulation)/i.test(s)
            || /under\s+(the\s+)?\w+\s+(Act|Code|Law|Statute|Regulation)/i.test(s)
            || /according to\s+(the\s+)?\w+\s+(Act|Code|Law|Statute|Regulation)/i.test(s)
            || /required by\s+(the\s+)?\w+\s+(Act|Code|Law|Statute|Regulation)/i.test(s);
        if (!hasExternalRef) return false;
        // Exclude document-internal references (Section 5, Article 3 of the agreement/contract/document)
        if (/Section\s+\d+\s*(of\s+the\s+(agreement|contract|document|terms|ToS|policy))?[^a-zA-Z]/i.test(s) && !hasExternalRef) return false;
        return true;
    });
    if (verifiableSentences.length === 0) {
        console.log(`[Investigate/Judge] No external legal claims to verify in ${docName}`);
        return analysis;
    }
    const claimsList = verifiableSentences.slice(0, 15).map((s, i) => `${i + 1}. ${s.substring(0, 300)}`).join('\n');
    try {
        const judgeStart = Date.now();
        const judgePrompt = `You are a legal fact-checker for a document investigation. The analysis below examined a user's document and made claims about applicable laws.

IMPORTANT DISTINCTION:
- Claims about what the DOCUMENT SAYS (e.g. "Section 5 disclaims liability") are DOCUMENT FINDINGS — always mark as SUPPORTED.
- Claims about EXTERNAL LAWS (e.g. "Under the UCC, such disclaimers are void") need source verification — check against SOURCE TEXTS below.

SOURCE TEXTS:
${sourceSummary}

CLAIMS TO CHECK:
${claimsList}

Return a JSON object:
{
  "results": [
    {"index": 1, "supported": true},
    {"index": 2, "supported": false, "reason": "brief reason"}
  ]
}

Rules:
- Document findings (what the document says/contains) are ALWAYS supported — do NOT remove them
- Only flag UNSUPPORTED if a claim cites a SPECIFIC external statute/law that is clearly contradicted by the sources
- General legal principles and concepts do NOT need source support — mark as supported
- Cross-language equivalence counts as support
- When in doubt, mark as supported — only remove clearly wrong external legal citations
- Return ONLY the JSON object`;
        const judgeResponse = await llmCallFn(
            [{ role: 'system', content: 'You are a precise legal fact-checker. Return only valid JSON.' }, { role: 'user', content: judgePrompt }],
            { taskType: 'llm_judge', maxTokens: 1000, useFastModel: false, temperature: 0 }
        );
        if (isAbortedFn()) return analysis;
        const judgeMs = Date.now() - judgeStart;
        const jsonMatch = judgeResponse.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            console.log(`[Investigate/Judge] No JSON in response for ${docName} (${judgeMs}ms)`);
            return analysis;
        }
        const parsed = JSON.parse(jsonMatch[0]);
        const results = parsed.results || [];
        const unsupported = results.filter(r => r.supported === false);
        console.log(`[Investigate/Judge] ${docName}: ${results.length} checked, ${unsupported.length} unsupported (${judgeMs}ms)`);
        if (auditContext) {
            auditContext.logLLMCall({
                taskType: 'investigate_judge',
                prompt: `Verify ${verifiableSentences.length} claims from ${docName} against ${sources.length} sources`,
                response: judgeResponse.substring(0, 1000),
                durationMs: judgeMs,
            });
            for (const r of results) {
                const idx = (r.index || 0) - 1;
                const claimText = idx >= 0 && idx < verifiableSentences.length ? verifiableSentences[idx] : '';
                auditContext.logNLIVerification({
                    claim: claimText.substring(0, 500),
                    result: r.supported ? 'llm_supported' : 'judge_removed',
                    confidence: r.supported ? 0.8 : 0.2,
                    source: docName,
                    method: 'llm_judge',
                });
            }
        }
        if (unsupported.length === 0) return analysis;
        let cleaned = analysis;
        for (const r of unsupported) {
            const idx = (r.index || 0) - 1;
            if (idx >= 0 && idx < verifiableSentences.length) {
                const sentence = verifiableSentences[idx];
                cleaned = cleaned.replace(sentence, '').replace(/\n{3,}/g, '\n\n').trim();
                console.log(`[Investigate/Judge] Removed: "${sentence.substring(0, 80)}..." — ${r.reason || 'unsupported'}`);
            }
        }
        return cleaned;
    } catch (err) {
        console.warn(`[Investigate/Judge] Error verifying ${docName}:`, err.message);
        return analysis;
    }
}

async function* investigateStream(userId, { documentIds = [], vaultItemIds = [], query, jurisdictions = [], includeRag = true }, abortSignal, auditContext) {
    const isAborted = () => abortSignal && abortSignal.aborted;
    yield { type: 'status', data: { message: 'Loading documents...', progress: 0 } };

    if (isAborted()) return;

    // 1. Fetch all document/vault texts in parallel
    const docs = await Promise.all(documentIds.map(async (id) => {
        try {
            return await prisma.document.findFirst({
                where: { id, userId },
                select: { id: true, filename: true, extractedText: true, anonymizedText: true, summary: true },
            });
        } catch (err) {
            console.error(`[Investigate] Failed to load doc ${id}:`, err.message);
            return null;
        }
    }));
    const vaults = await Promise.all(vaultItemIds.map(async (id) => {
        try {
            return await prisma.vaultItem.findFirst({
                where: { id, userId },
                select: { id: true, title: true, content: true, type: true },
            });
        } catch (err) {
            console.error(`[Investigate] Failed to load vault ${id}:`, err.message);
            return null;
        }
    }));

    if (isAborted()) return;

    const workItems = [
        ...docs.filter(Boolean).map((d) => ({
            id: d.id,
            name: d.filename,
            content: d.extractedText || d.anonymizedText || d.summary || '',
            sourceType: 'document',
        })),
        ...vaults.filter(Boolean).map((v) => ({
            id: v.id,
            name: v.title,
            content: v.content || '',
            sourceType: 'vault',
        })),
    ];

    const totalItems = workItems.length;
    let completedItems = 0;
    console.log(`[Investigate] Loaded: ${docs.filter(Boolean).length}/${documentIds.length} docs, ${vaults.filter(Boolean).length}/${vaultItemIds.length} vault items`);

    if (workItems.length === 0) {
        yield { type: 'error', data: { message: 'No documents could be loaded. Please try again.' } };
        yield { type: 'done', data: { complete: true, totalItems: 0, completed: 0 } };
        return;
    }

    // LLM helpers (need isAborted + semaphore, scoped to this generator invocation)
    async function llmStreamWithSemaphore(messages, options) {
        if (isAborted()) return '';
        const release = await acquireLLMSemaphore();
        try {
            if (isAborted()) return '';
            const { callLLMStream } = require('../services/llmAdapter');
            let answer = '';
            // Wrap stream in a timeout race to prevent semaphore deadlock on abort
            const streamPromise = (async () => {
                for await (const token of callLLMStream(messages, options)) {
                    if (isAborted()) break;
                    answer += token;
                }
            })();
            // If aborted, don't wait for stream to close — release semaphore after 5s max
            if (abortSignal) {
                const abortPromise = new Promise(resolve => {
                    const onAbort = () => { setTimeout(resolve, 5000); };
                    if (abortSignal.aborted) { onAbort(); } else { abortSignal.addEventListener('abort', onAbort, { once: true }); }
                });
                await Promise.race([streamPromise, abortPromise]);
            } else {
                await streamPromise;
            }
            return answer;
        } finally {
            release();
        }
    }

    async function llmCallWithSemaphore(messages, options) {
        if (isAborted()) return '';
        const release = await acquireLLMSemaphore();
        try {
            if (isAborted()) return '';
            const { callLLM } = require('../services/llmAdapter');
            // Race against abort to prevent semaphore deadlock
            const callPromise = callLLM(messages, options);
            if (abortSignal) {
                const abortPromise = new Promise((_, reject) => {
                    const onAbort = () => { setTimeout(() => reject(new Error('Aborted')), 5000); };
                    if (abortSignal.aborted) { onAbort(); } else { abortSignal.addEventListener('abort', onAbort, { once: true }); }
                });
                return await Promise.race([callPromise, abortPromise]);
            }
            return await callPromise;
        } catch (err) {
            if (isAborted()) return '';
            throw err;
        } finally {
            release();
        }
    }

    // --- Two-Pass Architecture: process each document ---
    const allRagSources = [];
    const allDocFindings = [];

    for (let wi = 0; wi < workItems.length; wi++) {
        const item = workItems[wi];
        if (isAborted()) break;
        const contentLength = (item.content || '').length;
        const t0 = Date.now();

        yield { type: 'doc_start', data: { id: item.id, name: item.name, chunks: 1 } };

        // --- Short-circuit: small documents (<=20K chars) — document-first, RAG-second ---
        if (contentLength <= 20000) {
            console.log(`[Investigate] Small doc: ${item.name} (${contentLength} chars) — document-first analysis`);

            // Step 1: Pure document analysis (NO RAG — avoids contamination with irrelevant sources)
            yield { type: 'status', data: { message: `Analyzing: ${item.name}...`, progress: 10 + Math.round((wi / totalItems) * 40) } };

            try {
                const analyzeStart = Date.now();
                const systemPromptSmall = `You are a legal analyst. Analyze the document for the user's query. Be specific about clauses, obligations, risks, and legal implications. Cite specific sections from the document. Reference the specific laws and statutes you believe apply (even if you are not 100% certain of exact section numbers).`;
                const answer = await llmStreamWithSemaphore(
                    [{ role: 'system', content: systemPromptSmall },
                     { role: 'user', content: `Query: ${query}\n\nDocument: ${item.name}\n\nContent:\n${item.content}` }],
                    { temperature: 0, maxTokens: 2500, useFastModel: false }
                );
                if (isAborted()) break;
                if (auditContext) {
                    auditContext.logLLMCall({
                        taskType: 'investigate_analyze',
                        prompt: `Small doc (pure): ${item.name} (${contentLength} chars)`,
                        response: (answer || '').substring(0, 500),
                        durationMs: Date.now() - analyzeStart,
                    });
                }

                // Emit scan_complete for frontend compatibility
                yield { type: 'scan_complete', data: { docId: item.id, docName: item.name, totalSections: 1, selectedSections: [0], selectedHeadings: ['Full document'], skippedCount: 0, reasoning: 'Document-first analysis complete', ragQueries: [] } };

                // Step 2: Extract targeted RAG queries from the analysis
                let ragSources = [];
                if (includeRag) {
                    yield { type: 'status', data: { message: `Extracting legal references from analysis...`, progress: 40 + Math.round((wi / totalItems) * 20) } };
                    const structuredQueries = await extractTargetedRagQueries(answer, query, jurisdictions, llmCallWithSemaphore);
                    if (isAborted()) break;

                    if (auditContext) {
                        auditContext.logLLMCall({
                            taskType: 'investigate_extract_queries',
                            prompt: `Extract RAG queries from analysis of ${item.name}`,
                            response: JSON.stringify(structuredQueries).substring(0, 500),
                            durationMs: 0,
                        });
                    }

                    // Step 3: Triple-query RAG search using analysis-derived queries
                    yield { type: 'status', data: { message: `Searching legal database (${structuredQueries.length} targeted queries)...`, progress: 55 + Math.round((wi / totalItems) * 15) } };
                    try {
                        ragSources = await runLLMDrivenRAG(structuredQueries, jurisdictions);
                    } catch (err) {
                        console.error('[Investigate] RAG error:', err.message);
                    }
                    for (const sq of structuredQueries) {
                        const qLabel = typeof sq === 'object' ? sq.query : sq;
                        const matchCount = ragSources.filter(r => r.triggeredBy === qLabel).length;
                        yield { type: 'rag_query', data: { query: qLabel, resultCount: matchCount, triggeredBy: 'analysis' } };
                    }
                    if (ragSources.length > 0) {
                        allRagSources.push(...ragSources);
                        yield { type: 'rag_sources', data: { sources: ragSources.slice(0, 10).map(s => ({ sourceName: s.sourceName, score: s.rerankScore || s.score, jurisdiction: s.jurisdiction })) } };
                        if (auditContext) {
                            for (const sq of structuredQueries) {
                                const qLabel = typeof sq === 'object' ? sq.query : sq;
                                const qResults = ragSources.filter(r => r.triggeredBy === qLabel);
                                auditContext.logRAGSearch({
                                    query: qLabel,
                                    jurisdiction: jurisdictions.join(', '),
                                    resultsCount: qResults.length,
                                    results: qResults.slice(0, 5).map(s => ({
                                        id: s.id || '',
                                        sourceName: s.sourceName || s.source_name || 'Source',
                                        relevanceScore: s.rerankScore || s.score || 0,
                                    })),
                                });
                            }
                        }
                    }
                }
                if (isAborted()) break;

                // Step 4: Judge verification — verify the analysis against the RAG sources
                yield { type: 'status', data: { message: `Verifying: ${item.name}...`, progress: 75 + Math.round((wi / totalItems) * 15) } };
                const verified = await verifyFindingWithJudge(answer, item.name, ragSources, llmCallWithSemaphore, isAborted, auditContext);
                if (isAborted()) break;

                console.log(`[Investigate] Completed: ${item.name} (small, ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
                yield { type: 'finding', data: { id: item.id, name: item.name, sourceType: item.sourceType, analysis: verified } };
                allDocFindings.push({ id: item.id, name: item.name, analysis: verified });
            } catch (err) {
                console.error(`[Investigate] Error: ${item.name}:`, err.message);
                yield { type: 'doc_error', data: { id: item.id, name: item.name, error: err.message } };
            }

            completedItems++;
            yield { type: 'doc_complete', data: { id: item.id, completed: completedItems, total: totalItems, progress: 10 + Math.round((completedItems / totalItems) * 80) } };
            continue;
        }

        // --- LARGE DOCUMENT: Document-First Architecture ---
        console.log(`[Investigate] Large doc: ${item.name} (${contentLength} chars) — document-first`);

        // Step 1: Extract structure (0 LLM calls, pure regex)
        yield { type: 'status', data: { message: `Scanning structure: ${item.name}...`, progress: 10 + Math.round((wi / totalItems) * 70) } };
        let sections = extractDocumentStructure(item.content);
        console.log(`[Investigate] ${item.name}: ${sections.length} sections detected`);

        // Fallback: if too few sections detected, create artificial chunks
        if (sections.length < 3) {
            console.log(`[Investigate] ${item.name}: Too few sections (${sections.length}) — creating artificial sections`);
            sections = [];
            const CHUNK_SIZE = 15000;
            for (let start = 0; start < contentLength; start += CHUNK_SIZE) {
                let end = Math.min(start + CHUNK_SIZE, contentLength);
                if (end < contentLength) {
                    const breakPoint = item.content.lastIndexOf('\n\n', end);
                    if (breakPoint > start + CHUNK_SIZE / 2) end = breakPoint;
                }
                const preview = item.content.slice(start, Math.min(start + 150, end)).trim();
                const firstLine = preview.split('\n')[0] || `Part ${sections.length + 1}`;
                sections.push({ index: sections.length, heading: firstLine.substring(0, 80), start, end, preview });
            }
        }

        // Step 2: Smart scan — LLM selects relevant sections only (no RAG query generation)
        yield { type: 'status', data: { message: `Smart scan: ${item.name} (${sections.length} sections)...`, progress: 12 + Math.round((wi / totalItems) * 70) } };

        let selectedIndices, scanReasoning;
        const scanStart = Date.now();
        try {
            const sectionList = sections.map((s, i) =>
                `[${i}] ${s.heading} (${Math.round((s.end - s.start) / 1000)}K chars)\n    Preview: ${s.preview}`
            ).join('\n');

            const scanPrompt = `You are analyzing document "${item.name}" for this query: "${query}"

Document has ${sections.length} sections:
${sectionList}

Select which sections are RELEVANT to the query (by index). Skip boilerplate (definitions, notices, governing law, general provisions) unless specifically asked about.

Return JSON only:
{
  "selectedSections": [0, 3, 7],
  "reasoning": "brief explanation"
}`;

            const scanResponse = await llmCallWithSemaphore(
                [{ role: 'system', content: 'Return only valid JSON.' },
                 { role: 'user', content: scanPrompt }],
                { temperature: 0, maxTokens: 400, useFastModel: false }
            );
            if (isAborted()) break;

            const jsonMatch = scanResponse.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                selectedIndices = parsed.selectedSections || sections.map((_, i) => i);
                scanReasoning = parsed.reasoning || '';
            } else {
                selectedIndices = sections.map((_, i) => i);
                scanReasoning = 'Could not parse scan response — analyzing all sections';
            }
        } catch (err) {
            console.error(`[Investigate] Smart scan failed for ${item.name}:`, err.message);
            selectedIndices = sections.map((_, i) => i);
            scanReasoning = 'Scan failed — analyzing all sections';
        }
        if (auditContext) {
            auditContext.logLLMCall({
                taskType: 'investigate_scan',
                prompt: `Smart scan: ${item.name} (${sections.length} sections)`,
                response: scanReasoning || '',
                durationMs: Date.now() - scanStart,
            });
        }

        // Clamp to valid indices
        selectedIndices = selectedIndices.filter(i => i >= 0 && i < sections.length);
        if (selectedIndices.length === 0) selectedIndices = sections.map((_, i) => i);

        console.log(`[Investigate] ${item.name}: scan selected ${selectedIndices.length}/${sections.length} sections`);

        yield {
            type: 'scan_complete',
            data: {
                docId: item.id,
                docName: item.name,
                totalSections: sections.length,
                selectedSections: selectedIndices,
                selectedHeadings: selectedIndices.map(i => sections[i]?.heading || `Section ${i}`),
                skippedCount: sections.length - selectedIndices.length,
                reasoning: scanReasoning,
                ragQueries: [],
            },
        };
        if (isAborted()) break;

        // Step 3: Deep analysis of selected sections WITHOUT RAG (document-first)
        const selectedSections = selectedIndices.map(i => sections[i]);
        const sectionFindings = [];

        for (let si = 0; si < selectedSections.length; si++) {
            if (isAborted()) break;
            const section = selectedSections[si];
            const sectionText = item.content.slice(section.start, section.end);

            yield {
                type: 'status',
                data: {
                    message: `Analyzing: ${section.heading} (${si + 1}/${selectedSections.length})`,
                    progress: 15 + Math.round(((wi + (si / selectedSections.length)) / totalItems) * 40),
                },
            };
            yield { type: 'doc_progress', data: { id: item.id, chunk: si + 1, totalChunks: selectedSections.length } };

            // NO ragContext injected — pure document analysis
            const sectionPrompt = `Query: ${query}

Section: ${section.heading}

Content:
${sectionText}

Analyze this section for the query. Be specific about clauses, obligations, risks, and legal implications. Cite specific provisions from the document. Reference the specific laws and statutes you believe apply (include section numbers where possible).`;

            try {
                const sectionStart = Date.now();
                const answer = await llmStreamWithSemaphore(
                    [{ role: 'system', content: 'You are a legal analyst. Focus on what the document actually says. Reference applicable laws and statutes by name and section number.' },
                     { role: 'user', content: sectionPrompt }],
                    { temperature: 0, maxTokens: 2000, useFastModel: false }
                );
                if (auditContext) {
                    auditContext.logLLMCall({
                        taskType: `investigate_section_${si}`,
                        prompt: `Section (pure): ${section.heading} (${item.name})`,
                        response: (answer || '').substring(0, 500),
                        durationMs: Date.now() - sectionStart,
                    });
                }

                if (answer && answer.trim()) {
                    sectionFindings.push({ heading: section.heading, analysis: answer.trim() });
                }
            } catch (err) {
                console.error(`[Investigate] Section error (${section.heading}):`, err.message);
            }
        }
        if (isAborted()) break;

        // Step 4: Merge section findings
        let finalAnalysis;
        if (sectionFindings.length === 0) {
            finalAnalysis = 'No relevant findings in the selected sections.';
        } else if (sectionFindings.length === 1) {
            finalAnalysis = sectionFindings[0].analysis;
        } else {
            yield { type: 'status', data: { message: `Merging findings: ${item.name}...`, progress: 60 + Math.round((wi / totalItems) * 10) } };
            const mergePrompt = `You analyzed document "${item.name}" for: "${query}"

Findings from ${sectionFindings.length} sections:

${sectionFindings.map(f => `--- ${f.heading} ---\n${f.analysis}`).join('\n\n')}

Synthesize into a single coherent analysis. Remove duplicates, organize by topic, keep all specific clause references and legal details. Keep all statute/law references.`;

            const mergeStart = Date.now();
            finalAnalysis = await llmStreamWithSemaphore(
                [{ role: 'system', content: 'You are a legal analyst.' },
                 { role: 'user', content: mergePrompt }],
                { temperature: 0, maxTokens: 2500, useFastModel: false }
            );
            if (!finalAnalysis) finalAnalysis = sectionFindings.map(f => `### ${f.heading}\n${f.analysis}`).join('\n\n');
            if (auditContext) {
                auditContext.logLLMCall({
                    taskType: 'investigate_merge',
                    prompt: `Merge ${sectionFindings.length} section findings for ${item.name}`,
                    response: (finalAnalysis || '').substring(0, 500),
                    durationMs: Date.now() - mergeStart,
                });
            }
        }
        if (isAborted()) break;

        // Step 5: Extract targeted RAG queries from the merged analysis
        let ragSources = [];
        if (includeRag && finalAnalysis && finalAnalysis.length > 100) {
            yield { type: 'status', data: { message: `Extracting legal references for verification...`, progress: 72 + Math.round((wi / totalItems) * 8) } };
            const structuredQueries = await extractTargetedRagQueries(finalAnalysis, query, jurisdictions, llmCallWithSemaphore);
            if (isAborted()) break;

            if (auditContext) {
                auditContext.logLLMCall({
                    taskType: 'investigate_extract_queries',
                    prompt: `Extract RAG queries from merged analysis of ${item.name}`,
                    response: JSON.stringify(structuredQueries).substring(0, 500),
                    durationMs: 0,
                });
            }

            // Step 6: Triple-query RAG search
            yield { type: 'status', data: { message: `Searching legal database (${structuredQueries.length} targeted queries)...`, progress: 78 + Math.round((wi / totalItems) * 8) } };
            try {
                ragSources = await runLLMDrivenRAG(structuredQueries, jurisdictions);
            } catch (err) {
                console.error('[Investigate] RAG error:', err.message);
            }
            for (const sq of structuredQueries) {
                const qLabel = typeof sq === 'object' ? sq.query : sq;
                const matchCount = ragSources.filter(r => r.triggeredBy === qLabel).length;
                yield { type: 'rag_query', data: { query: qLabel, resultCount: matchCount, triggeredBy: 'analysis' } };
            }
            if (ragSources.length > 0) {
                allRagSources.push(...ragSources);
                yield {
                    type: 'rag_sources',
                    data: {
                        sources: ragSources.slice(0, 10).map(s => ({
                            sourceName: s.sourceName,
                            score: s.rerankScore || s.score,
                            jurisdiction: s.jurisdiction,
                        })),
                    },
                };
                if (auditContext) {
                    for (const sq of structuredQueries) {
                        const qLabel = typeof sq === 'object' ? sq.query : sq;
                        const qResults = ragSources.filter(r => r.triggeredBy === qLabel);
                        auditContext.logRAGSearch({
                            query: qLabel,
                            jurisdiction: jurisdictions.join(', '),
                            resultsCount: qResults.length,
                            results: qResults.slice(0, 5).map(s => ({
                                id: s.id || '',
                                sourceName: s.sourceName || s.source_name || 'Source',
                                relevanceScore: s.rerankScore || s.score || 0,
                            })),
                        });
                    }
                }
            }
        }
        if (isAborted()) break;

        // Step 7: Judge verification against targeted RAG sources
        yield { type: 'status', data: { message: `Verifying: ${item.name}...`, progress: 88 + Math.round((wi / totalItems) * 8) } };
        const verifiedAnalysis = await verifyFindingWithJudge(finalAnalysis, item.name, ragSources, llmCallWithSemaphore, isAborted, auditContext);
        if (isAborted()) break;

        const elapsedSec = ((Date.now() - t0) / 1000).toFixed(1);
        console.log(`[Investigate] Completed: ${item.name} (${selectedIndices.length}/${sections.length} sections, ${sectionFindings.length} findings, ${elapsedSec}s)`);

        yield { type: 'finding', data: { id: item.id, name: item.name, sourceType: item.sourceType, analysis: verifiedAnalysis } };
        allDocFindings.push({ id: item.id, name: item.name, analysis: verifiedAnalysis });

        completedItems++;
        yield { type: 'doc_complete', data: { id: item.id, completed: completedItems, total: totalItems, progress: 10 + Math.round((completedItems / totalItems) * 80) } };
    }

    // Cross-document comparison (1 LLM call, only if >1 doc with findings)
    if (!isAborted() && allDocFindings.length > 1) {
        yield { type: 'status', data: { message: 'Comparing findings across documents...', progress: 92 } };
        try {
            const summaries = allDocFindings.map(df =>
                `Document: ${df.name}\n${(df.analysis || '').substring(0, 2000)}`
            ).join('\n\n---\n\n');

            const compStart = Date.now();
            const comparisonText = await llmStreamWithSemaphore(
                [{ role: 'system', content: 'You are a legal analyst comparing multiple documents.' },
                 { role: 'user', content: `You analyzed ${allDocFindings.length} documents for: "${query}"

${summaries}

Compare these documents:
1. Common themes and provisions
2. Key differences and conflicts
3. Which document is more favorable/risky for each party
4. Any gaps where one document addresses something the other doesn't` }],
                { temperature: 0, maxTokens: 2000, useFastModel: false }
            );
            if (comparisonText && !isAborted()) {
                yield { type: 'comparison', data: { analysis: comparisonText } };
                if (auditContext) {
                    auditContext.logLLMCall({
                        taskType: 'investigate_comparison',
                        prompt: `Cross-doc comparison: ${allDocFindings.length} documents`,
                        response: comparisonText.substring(0, 500),
                        durationMs: Date.now() - compStart,
                    });
                }
            }
        } catch (err) {
            console.error('[Investigate] Cross-doc comparison error:', err.message);
        }
    }

    // Aggregation
    // Set audit response with all findings summary
    if (auditContext) {
        const findingsSummary = allDocFindings.map(df => `${df.name}: ${(df.analysis || '').substring(0, 500)}`).join('\n\n');
        auditContext.setResponse(
            findingsSummary || 'No findings',
            allRagSources.slice(0, 20).map(s => ({
                id: s.id || '',
                sourceName: s.sourceName || s.source_name || 'Source',
                excerpt: (s.content || '').substring(0, 2000),
            }))
        );
    }

    if (!isAborted()) {
        yield { type: 'aggregation', data: { totalItems, completed: completedItems, ragSourceCount: allRagSources.length } };
    }
    yield { type: 'done', data: { complete: true } };
}

// ============================================================================
// Export: Investigation Findings
// ============================================================================
router.post('/export/investigate', rateLimit_1.exportLimiter, auth_1.authenticateToken, async (req, res, next) => {
    try {
        const { query, findings, format } = req.body;
        if (!findings || !Array.isArray(findings) || findings.length === 0) {
            return res.status(400).json({ error: 'No findings to export' });
        }
        const title = `Investigation: ${query || 'Legal Analysis'}`;

        if (format === 'pdf') {
            const buffer = await createPdf(title, (doc) => {
                doc.font('Helvetica').fontSize(9).fillColor('#666666')
                    .text(`Query: ${query || 'N/A'}  |  Findings: ${findings.length}  |  ${new Date().toLocaleDateString()}`);
                doc.moveDown(1);
                findings.forEach((f, idx) => {
                    if (idx > 0) {
                        doc.moveDown(0.5);
                        doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#dddddd').stroke();
                        doc.moveDown(0.5);
                    }
                    pdfHeading(doc, f.title || `Finding ${idx + 1}`, 2);
                    if (f.source) {
                        doc.font('Helvetica').fontSize(9).fillColor('#666666').text(`Source: ${f.source}`);
                        doc.moveDown(0.3);
                    }
                    pdfParagraph(doc, f.analysis || '');
                });
            });
            const filename = (query || 'investigation').replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '_').slice(0, 50);
            res.setHeader('Content-Disposition', `attachment; filename="${safeFilename(filename)}_findings.pdf"`);
            res.setHeader('Content-Type', 'application/pdf');
            res.send(buffer);
        } else {
            const docChildren = [];
            docChildren.push(new docx.Paragraph({
                heading: docx.HeadingLevel.HEADING_1,
                children: [new docx.TextRun({ text: title, bold: true })],
            }));
            docChildren.push(new docx.Paragraph({
                children: [new docx.TextRun({ text: `Query: ${query || 'N/A'}  |  Findings: ${findings.length}  |  ${new Date().toLocaleDateString()}`, size: 20, color: '666666' })],
            }));
            docChildren.push(new docx.Paragraph({ children: [new docx.TextRun('')] }));

            findings.forEach((f, idx) => {
                if (idx > 0) {
                    docChildren.push(new docx.Paragraph({ children: [new docx.TextRun('')] }));
                }
                docChildren.push(new docx.Paragraph({
                    heading: docx.HeadingLevel.HEADING_2,
                    children: [new docx.TextRun({ text: f.title || `Finding ${idx + 1}`, bold: true })],
                }));
                if (f.source) {
                    docChildren.push(new docx.Paragraph({
                        children: [new docx.TextRun({ text: `Source: ${f.source}`, size: 20, color: '666666', italics: true })],
                    }));
                }
                docChildren.push(...mdToDocxChildren(f.analysis || ''));
            });

            const doc2 = new docx.Document({
                numbering: { config: [{ reference: 'default-numbering', levels: [{ level: 0, format: docx.LevelFormat.DECIMAL, text: '%1.', alignment: docx.AlignmentType.START }] }] },
                sections: [{
                    properties: {},
                    footers: makeFooter(`LexVault — Investigation — ${new Date().toLocaleDateString()}`),
                    children: docChildren,
                }],
            });
            const buffer = await docx.Packer.toBuffer(doc2);
            const filename = (query || 'investigation').replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '_').slice(0, 50);
            res.setHeader('Content-Disposition', `attachment; filename="${safeFilename(filename)}_findings.docx"`);
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
            res.send(buffer);
        }
    } catch (error) {
        console.error('[Export] Investigation error:', error);
        next(error);
    }
});

router.post('/investigate/stream', rateLimit_1.strictApiLimiter, auth_1.authenticateToken, async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const sendEvent = (type, data) => {
        if (!res.writableEnded) {
            res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
        }
    };

    try {
        const userId = req.user.userId;
        const { documentIds, vaultItemIds, query, jurisdictions, includeRag } = req.body;

        if (!query || !query.trim()) {
            sendEvent('error', { message: 'Query is required' });
            sendEvent('done', { complete: true });
            res.end();
            return;
        }

        // Auto-cancel any previous investigation for this user
        const prevController = activeInvestigations.get(userId);
        if (prevController) {
            console.log(`[Investigate] Auto-cancelling previous investigation for user ${userId}`);
            prevController.abort();
            activeInvestigations.delete(userId);
        }

        // Create abort controller for this investigation
        const controller = new AbortController();
        activeInvestigations.set(userId, controller);

        // Wire res.on('close') → abort signal
        res.on('close', () => {
            console.log('[Investigate] Connection closed by client — aborting');
            controller.abort();
            activeInvestigations.delete(userId);
        });

        console.log(`[Investigate] Starting stream for user ${userId}: ${(documentIds || []).length} docs, ${(vaultItemIds || []).length} vault, RAG=${includeRag}`);

        // Create audit context for the investigation
        const auditContext = new AIAuditContext(userId, 'investigate', query.trim());
        if (jurisdictions && jurisdictions.length > 0) {
            auditContext.setJurisdiction(jurisdictions.join(', '), 'user_selected');
        }

        // SSE keepalive — send comment every 15s to prevent nginx/browser timeout
        const keepalive = setInterval(() => {
            if (!res.writableEnded && !controller.signal.aborted) {
                res.write(': keepalive\n\n');
            }
        }, 15000);

        try {
            for await (const event of investigateStream(userId, {
                documentIds: documentIds || [],
                vaultItemIds: vaultItemIds || [],
                query: query.trim(),
                jurisdictions: jurisdictions || [],
                includeRag: includeRag !== false,
            }, controller.signal, auditContext)) {
                if (controller.signal.aborted || res.writableEnded) break;
                sendEvent(event.type, event.data);
            }
        } finally {
            clearInterval(keepalive);
            // Save audit log even on abort — always persist what we have
            try {
                if (!auditContext.entry.response) {
                    auditContext.setResponse('Investigation ' + (controller.signal.aborted ? 'aborted' : 'completed'), []);
                }
                const auditOn = await isAuditEnabled(null);
                if (auditOn) {
                    await saveAIAudit(auditContext.finalize());
                }
            } catch (auditErr) {
                console.error('[Investigate] Audit save failed:', auditErr.message);
            }
        }

        // Clean up
        if (activeInvestigations.get(userId) === controller) {
            activeInvestigations.delete(userId);
        }
    } catch (err) {
        console.error('[Investigate] Stream error:', err);
        sendEvent('error', { message: err.message || 'Investigation failed' });
    }

    if (!res.writableEnded) {
        res.end();
    }
});

// ============================================================================
// Export: Audit Trail (DOCX)
// ============================================================================
router.post('/export/audit/docx', rateLimit_1.exportLimiter, auth_1.authenticateToken, async (req, res, next) => {
    try {
        const { entries } = req.body;
        if (!entries || !entries.length) return res.status(400).json({ error: 'No entries to export' });

        const docChildren = [];
        docChildren.push(new docx.Paragraph({
            heading: docx.HeadingLevel.HEADING_1,
            children: [new docx.TextRun({ text: 'LexVault Audit Trail', bold: true })],
        }));
        docChildren.push(new docx.Paragraph({
            children: [new docx.TextRun({ text: `Generated on ${new Date().toLocaleDateString()}  |  ${entries.length} entries`, size: 20, color: '666666' })],
        }));
        docChildren.push(new docx.Paragraph({ children: [new docx.TextRun('')] }));

        for (const e of entries) {
            const typeLabel = (e.requestType || 'unknown').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            const conf = e.confidence || e.overallConfidence || 'unverified';
            const date = e.date || e.createdAt || '';

            // Entry heading
            docChildren.push(new docx.Paragraph({
                heading: docx.HeadingLevel.HEADING_2,
                spacing: { before: 200 },
                children: [
                    new docx.TextRun({ text: typeLabel, bold: true }),
                    new docx.TextRun({ text: `  —  ${conf}`, color: conf === 'high' ? '22C55E' : conf === 'medium' ? 'F59E0B' : conf === 'low' ? 'EF4444' : '888888' }),
                ],
            }));

            // Date & duration
            const durationStr = e.durationMs ? `${(e.durationMs / 1000).toFixed(1)}s` : '';
            docChildren.push(new docx.Paragraph({
                children: [new docx.TextRun({ text: `${date}${durationStr ? '  |  Duration: ' + durationStr : ''}`, size: 18, color: '888888' })],
            }));

            // Query
            if (e.userQuery || e.query) {
                docChildren.push(new docx.Paragraph({
                    children: [
                        new docx.TextRun({ text: 'Query: ', bold: true, size: 20 }),
                        new docx.TextRun({ text: e.userQuery || e.query, size: 20 }),
                    ],
                }));
            }

            // Jurisdiction
            if (e.jurisdiction) {
                docChildren.push(new docx.Paragraph({
                    children: [
                        new docx.TextRun({ text: 'Jurisdiction: ', bold: true, size: 20 }),
                        new docx.TextRun({ text: e.jurisdiction, size: 20 }),
                    ],
                }));
            }

            // Claims summary
            if (e.totalClaims > 0) {
                const verified = e.claimsVerified || 0;
                const regen = e.claimsRegenerated || 0;
                const removed = e.claimsRemoved || 0;
                docChildren.push(new docx.Paragraph({
                    children: [
                        new docx.TextRun({ text: 'Claims: ', bold: true, size: 20 }),
                        new docx.TextRun({ text: `${verified} verified`, size: 20, color: '22C55E' }),
                        new docx.TextRun({ text: `, ${regen} regenerated`, size: 20, color: 'F59E0B' }),
                        new docx.TextRun({ text: `, ${removed} removed`, size: 20, color: 'EF4444' }),
                        new docx.TextRun({ text: ` / ${e.totalClaims} total`, size: 20 }),
                    ],
                }));
            }

            // Sources
            if (e.sourcesCount > 0) {
                docChildren.push(new docx.Paragraph({
                    children: [
                        new docx.TextRun({ text: 'Sources used: ', bold: true, size: 20 }),
                        new docx.TextRun({ text: String(e.sourcesCount), size: 20 }),
                    ],
                }));
            }

            // Separator
            docChildren.push(new docx.Paragraph({
                border: { bottom: { style: docx.BorderStyle.SINGLE, size: 1, color: 'CCCCCC' } },
                children: [new docx.TextRun('')],
            }));
        }

        const doc2 = new docx.Document({
            sections: [{
                properties: {},
                footers: makeFooter(`LexVault Audit Trail — ${new Date().toLocaleDateString()}`),
                children: docChildren,
            }],
        });

        const buffer = await docx.Packer.toBuffer(doc2);
        res.setHeader('Content-Disposition', `attachment; filename="${safeFilename('lexvault-audit-' + new Date().toISOString().split('T')[0])}.docx"`);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.send(buffer);
    } catch (error) {
        console.error('[Export] Audit DOCX error:', error);
        next(error);
    }
});

// ============================================================================
// Export: Audit Trail (PDF)
// ============================================================================
router.post('/export/audit/pdf', rateLimit_1.exportLimiter, auth_1.authenticateToken, async (req, res, next) => {
    try {
        const { entries } = req.body;
        if (!entries || !entries.length) return res.status(400).json({ error: 'No entries to export' });

        const buffer = await createPdf('LexVault Audit Trail', (doc) => {
            doc.font('Helvetica').fontSize(9).fillColor('#666666')
                .text(`${entries.length} entries`, { align: 'center' });
            doc.moveDown(1);

            for (let i = 0; i < entries.length; i++) {
                const e = entries[i];
                const typeLabel = (e.requestType || 'unknown').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                const conf = e.confidence || e.overallConfidence || 'unverified';
                const date = e.date || e.createdAt || '';
                const durationStr = e.durationMs ? `${(e.durationMs / 1000).toFixed(1)}s` : '';

                // Check if we need a new page (leave room for at least ~120pt)
                if (doc.y > 680) doc.addPage();

                // Type + confidence
                const confColor = conf === 'high' ? '#22C55E' : conf === 'medium' ? '#F59E0B' : conf === 'low' ? '#EF4444' : '#888888';
                doc.font('Helvetica-Bold').fontSize(12).fillColor('#1a1a0f').text(typeLabel, { continued: true });
                doc.font('Helvetica').fontSize(10).fillColor(confColor).text(`  ${conf}`);

                // Date + duration
                doc.font('Helvetica').fontSize(8).fillColor('#888888')
                    .text(`${date}${durationStr ? '  |  ' + durationStr : ''}`);
                doc.moveDown(0.2);

                // Query
                if (e.userQuery || e.query) {
                    doc.font('Helvetica-Bold').fontSize(9).fillColor('#333333').text('Query: ', { continued: true });
                    doc.font('Helvetica').text(e.userQuery || e.query);
                }

                // Jurisdiction
                if (e.jurisdiction) {
                    doc.font('Helvetica-Bold').fontSize(9).fillColor('#333333').text('Jurisdiction: ', { continued: true });
                    doc.font('Helvetica').text(e.jurisdiction);
                }

                // Claims
                if (e.totalClaims > 0) {
                    const verified = e.claimsVerified || 0;
                    const regen = e.claimsRegenerated || 0;
                    const removed = e.claimsRemoved || 0;
                    doc.font('Helvetica-Bold').fontSize(9).fillColor('#333333').text('Claims: ', { continued: true });
                    doc.font('Helvetica').fillColor('#22C55E').text(`${verified} verified`, { continued: true });
                    doc.fillColor('#333333').text(', ', { continued: true });
                    doc.fillColor('#F59E0B').text(`${regen} regenerated`, { continued: true });
                    doc.fillColor('#333333').text(', ', { continued: true });
                    doc.fillColor('#EF4444').text(`${removed} removed`, { continued: true });
                    doc.fillColor('#333333').text(` / ${e.totalClaims} total`);
                }

                // Sources
                if (e.sourcesCount > 0) {
                    doc.font('Helvetica-Bold').fontSize(9).fillColor('#333333').text('Sources: ', { continued: true });
                    doc.font('Helvetica').text(String(e.sourcesCount));
                }

                // Separator line
                doc.moveDown(0.4);
                doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#dddddd').stroke();
                doc.moveDown(0.6);
            }
        });

        res.setHeader('Content-Disposition', `attachment; filename="${safeFilename('lexvault-audit-' + new Date().toISOString().split('T')[0])}.pdf"`);
        res.setHeader('Content-Type', 'application/pdf');
        res.send(buffer);
    } catch (error) {
        console.error('[Export] Audit PDF error:', error);
        next(error);
    }
});

exports.default = router;
router.post('/sessions', auth_1.authenticateToken, async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const { jurisdiction, title } = req.body;
        const conversation = await prisma.researchConversation.create({
            data: { userId, jurisdiction: jurisdiction || null, title: title || null },
        });
        res.status(201).json({
            id: conversation.id,
            jurisdiction: conversation.jurisdiction,
            title: conversation.title,
            createdAt: conversation.createdAt,
        });
    }
    catch (error) {
        next(error);
    }
});
router.get('/sessions', auth_1.authenticateToken, async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const { limit = 50 } = req.query;
        const conversations = await (0, researchChatService_1.getConversations)(userId, { limit: Number(limit) });
        res.json({ sessions: conversations, conversations });
    }
    catch (error) {
        next(error);
    }
});
router.post('/chat', rateLimit_1.strictApiLimiter, auth_1.authenticateToken, async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const { conversationId, message, jurisdictions, ragOnly } = req.body;
        if (!message || message.trim().length < 1) {
            return res.status(400).json({ error: 'Bad Request', message: 'Message is required' });
        }
        let response = { answer: '', sources: [] };
        for await (const event of (0, researchChatService_1.chatStream)(userId, message.trim(), {
            conversationId,
            jurisdictionOverride: jurisdictions?.[0],
            jurisdictions: jurisdictions || [],
            ragOnly: ragOnly,
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
        })) {
            if (event.type === 'content')
                response.answer = event.data.content || response.answer;
            else if (event.type === 'token')
                response.answer += event.data.token || '';
            if (event.type === 'sources')
                response.sources = event.data.sources || [];
        }
        res.json(response);
    }
    catch (error) {
        next(error);
    }
});
router.get('/sessions/:id', auth_1.authenticateToken, async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const conversation = await (0, researchChatService_1.getConversation)(req.params.id, userId);
        if (!conversation) {
            return res.status(404).json({ error: 'Not Found' });
        }
        res.json(conversation);
    }
    catch (error) {
        next(error);
    }
});
router.post('/sessions/:id/messages', auth_1.authenticateToken, async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const conversationId = req.params.id;
        const { message, jurisdictions, ragOnly } = req.body;
        if (!message || message.trim().length < 1) {
            return res.status(400).json({ error: 'Message is required' });
        }
        let response = { answer: '', sources: [], conversationId };
        for await (const event of (0, researchChatService_1.chatStream)(userId, message.trim(), {
            conversationId,
            jurisdictionOverride: jurisdictions?.[0],
            jurisdictions: jurisdictions || [],
            ragOnly: ragOnly,
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
        })) {
            if (event.type === 'content')
                response.answer = event.data.content || response.answer;
            else if (event.type === 'token')
                response.answer += event.data.token || '';
            if (event.type === 'sources')
                response.sources = event.data.sources || [];
        }
        res.json(response);
    }
    catch (error) {
        next(error);
    }
});
exports.extractDocumentStructure = extractDocumentStructure;
exports.runLLMDrivenRAG = runLLMDrivenRAG;
//# sourceMappingURL=research.js.map