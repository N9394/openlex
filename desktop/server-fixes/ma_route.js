"use strict";
/**
 * M&A Due Diligence — Express Router
 *
 * All endpoints under /api/ma
 * Deal CRUD, party management, batch doc upload, pipeline control, SSE, checkpoints
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const express_1 = __importDefault(require("express"));
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const promises_1 = __importDefault(require("fs/promises"));
const client_1 = require("@prisma/client");
const auth_1 = require("../middleware/auth");
const maService = require('../services/maService');

const router = express_1.default.Router();
const prisma = new client_1.PrismaClient();

// ============================================================================
// MULTER — batch upload for M&A documents (50MB each)
// ============================================================================

const maStorage = multer_1.default.diskStorage({
    destination: async (req, file, cb) => {
        const dealId = req.params.id;
        const uploadDir = path_1.default.join(__dirname, `../../uploads/ma/${dealId}`);
        await promises_1.default.mkdir(uploadDir, { recursive: true });
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\.{2,}/g, '.');
        const uniqueName = `${Date.now()}_${safeName}`;
        cb(null, uniqueName);
    },
});

const maUpload = (0, multer_1.default)({
    storage: maStorage,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB per file
    fileFilter: (req, file, cb) => {
        const allowedMimes = [
            'application/pdf',
            'text/plain',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/msword'
        ];
        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Only PDF, DOCX, DOC, and TXT files are allowed'));
        }
    },
});

// ============================================================================
// DEAL CRUD
// ============================================================================

// Create deal
router.post('/deals', auth_1.authenticateToken, async (req, res) => {
    try {
        const { name, description, perspective, dealType, industry } = req.body;
        if (!name || !name.trim()) return res.status(400).json({ error: 'Please provide a deal name.' });
        if (name.length > 255) return res.status(400).json({ error: 'Deal name is too long (max 255 characters).' });
        const cleanName = name.trim();

        const deal = await prisma.deal.create({
            data: {
                userId: req.user.userId,
                name: cleanName,
                description: description ? description.slice(0, 2000) : null,
                perspective: perspective || 'buyer',
                dealType: dealType || 'asset_purchase',
                industry: industry || null,
            },
            include: { parties: true, documents: true, checkpoints: true, job: true }
        });

        res.status(201).json(deal);
    } catch (error) {
        console.error('[MA Route] Create deal error:', error);
        res.status(500).json({ error: 'Failed to create deal' });
    }
});

// List user's deals
router.get('/deals', auth_1.authenticateToken, async (req, res) => {
    try {
        const deals = await prisma.deal.findMany({
            where: { userId: req.user.userId },
            include: {
                _count: { select: { documents: true, risks: true, warranties: true } },
                job: { select: { currentStage: true, totalLLMCalls: true, startedAt: true, completedAt: true } }
            },
            orderBy: { updatedAt: 'desc' }
        });
        res.json(deals);
    } catch (error) {
        console.error('[MA Route] List deals error:', error);
        res.status(500).json({ error: 'Failed to list deals' });
    }
});

// Get deal with all relations
router.get('/deals/:id', auth_1.authenticateToken, async (req, res) => {
    try {
        const deal = await prisma.deal.findFirst({
            where: { id: req.params.id, userId: req.user.userId },
            include: {
                parties: true,
                documents: {
                    select: {
                        id: true, filename: true, filesize: true, mimetype: true,
                        docType: true, jurisdiction: true, language: true, confidence: true,
                        textLength: true, pageCount: true, status: true, partyId: true,
                        createdAt: true, updatedAt: true,
                        _count: { select: { sections: true } }
                    },
                    orderBy: { createdAt: 'asc' }
                },
                risks: { orderBy: { severity: 'asc' } },
                warranties: true,
                disclosures: true,
                checkpoints: { orderBy: { createdAt: 'desc' } },
                job: true,
                _count: { select: { auditEvents: true } }
            }
        });

        if (!deal) return res.status(404).json({ error: 'Deal not found' });
        res.json(deal);
    } catch (error) {
        console.error('[MA Route] Get deal error:', error);
        res.status(500).json({ error: 'Failed to get deal' });
    }
});

// Update deal config
router.put('/deals/:id', auth_1.authenticateToken, async (req, res) => {
    try {
        const { name, description, perspective, dealType, industry } = req.body;
        if (name !== undefined && name.length > 255) return res.status(400).json({ error: 'Deal name is too long (max 255 characters).' });
        const deal = await prisma.deal.updateMany({
            where: { id: req.params.id, userId: req.user.userId },
            data: {
                ...(name !== undefined && { name }),
                ...(description !== undefined && { description }),
                ...(perspective !== undefined && { perspective }),
                ...(dealType !== undefined && { dealType }),
                ...(industry !== undefined && { industry }),
            }
        });
        if (deal.count === 0) return res.status(404).json({ error: 'Deal not found' });

        const updated = await prisma.deal.findUnique({ where: { id: req.params.id } });
        res.json(updated);
    } catch (error) {
        console.error('[MA Route] Update deal error:', error);
        res.status(500).json({ error: 'Failed to update deal' });
    }
});

// Delete deal (cascade) — aborts running pipeline first
router.delete('/deals/:id', auth_1.authenticateToken, async (req, res) => {
    try {
        const deal = await prisma.deal.findFirst({
            where: { id: req.params.id, userId: req.user.userId }
        });
        if (!deal) return res.status(404).json({ error: 'Deal not found' });

        // Abort any running pipeline before deleting
        maService.abortPipeline(deal.id);

        // Delete uploaded files
        const uploadDir = path_1.default.join(__dirname, `../../uploads/ma/${deal.id}`);
        try { await promises_1.default.rm(uploadDir, { recursive: true, force: true }); } catch {}

        await prisma.deal.delete({ where: { id: deal.id } });
        res.json({ success: true, message: 'Deal and all associated data deleted.' });
    } catch (error) {
        console.error('[MA Route] Delete deal error:', error);
        res.status(500).json({ error: 'Failed to delete deal' });
    }
});

// Clone deal (config + parties, no documents/results)
router.post('/deals/:id/clone', auth_1.authenticateToken, async (req, res) => {
    try {
        const deal = await prisma.deal.findFirst({
            where: { id: req.params.id, userId: req.user.userId },
            include: { parties: true }
        });
        if (!deal) return res.status(404).json({ error: 'Deal not found' });

        const cloned = await prisma.deal.create({
            data: {
                userId: req.user.userId,
                name: `${deal.name} (Copy)`,
                description: deal.description,
                perspective: deal.perspective,
                dealType: deal.dealType,
                industry: deal.industry,
                industryProfile: deal.industryProfile,
            },
            include: { parties: true, documents: true, checkpoints: true, job: true }
        });

        // Clone parties
        for (const p of deal.parties) {
            await prisma.dealParty.create({
                data: {
                    dealId: cloned.id,
                    name: p.name,
                    role: p.role,
                    jurisdiction: p.jurisdiction,
                    entityType: p.entityType,
                    registeredIn: p.registeredIn,
                    notes: p.notes,
                }
            });
        }

        const result = await prisma.deal.findUnique({
            where: { id: cloned.id },
            include: { parties: true, documents: true, checkpoints: true, job: true }
        });
        res.status(201).json(result);
    } catch (error) {
        console.error('[MA Route] Clone deal error:', error);
        res.status(500).json({ error: 'Failed to clone deal' });
    }
});

// Cleanup raw files after analysis (text is already in DB)
router.delete('/deals/:id/cleanup', auth_1.authenticateToken, async (req, res) => {
    try {
        const deal = await prisma.deal.findFirst({
            where: { id: req.params.id, userId: req.user.userId }
        });
        if (!deal) return res.status(404).json({ error: 'Deal not found' });

        const uploadDir = path_1.default.join(__dirname, `../../uploads/ma/${deal.id}`);
        let freedBytes = 0;
        try {
            const files = await promises_1.default.readdir(uploadDir);
            for (const f of files) {
                const stat = await promises_1.default.stat(path_1.default.join(uploadDir, f));
                freedBytes += stat.size;
            }
            await promises_1.default.rm(uploadDir, { recursive: true, force: true });
        } catch {}

        // Clear filepath on documents (so we know files are gone)
        await prisma.dealDocument.updateMany({
            where: { dealId: deal.id },
            data: { filepath: '' }
        });

        res.json({ success: true, freedBytes, freedMB: (freedBytes / (1024 * 1024)).toFixed(1) });
    } catch (error) {
        console.error('[MA Route] Cleanup error:', error);
        res.status(500).json({ error: 'Failed to cleanup files' });
    }
});

// Deal templates
router.get('/templates', auth_1.authenticateToken, async (req, res) => {
    res.json(DEAL_TEMPLATES);
});

// Get industry suggestions (autocomplete list — user can type anything)
router.get('/industries', auth_1.authenticateToken, async (req, res) => {
    const { INDUSTRY_SUGGESTIONS } = require('../services/maAnalyzers');
    res.json(INDUSTRY_SUGGESTIONS);
});

const DEAL_TEMPLATES = [
    {
        id: 'at_asset',
        name: 'Austrian Asset Purchase',
        perspective: 'buyer',
        dealType: 'asset_purchase',
        parties: [
            { name: 'Buyer GmbH', role: 'buyer', jurisdiction: 'AT', entityType: 'GmbH' },
            { name: 'Seller GmbH', role: 'seller', jurisdiction: 'AT', entityType: 'GmbH' },
        ]
    },
    {
        id: 'at_share',
        name: 'Austrian Share Deal',
        perspective: 'buyer',
        dealType: 'share_purchase',
        parties: [
            { name: 'Buyer GmbH', role: 'buyer', jurisdiction: 'AT', entityType: 'GmbH' },
            { name: 'Seller GmbH', role: 'seller', jurisdiction: 'AT', entityType: 'GmbH' },
            { name: 'Target GmbH', role: 'target', jurisdiction: 'AT', entityType: 'GmbH' },
        ]
    },
    {
        id: 'de_asset',
        name: 'German Asset Purchase',
        perspective: 'buyer',
        dealType: 'asset_purchase',
        parties: [
            { name: 'Käufer GmbH', role: 'buyer', jurisdiction: 'DE', entityType: 'GmbH' },
            { name: 'Verkäufer GmbH', role: 'seller', jurisdiction: 'DE', entityType: 'GmbH' },
        ]
    },
    {
        id: 'cross_border',
        name: 'Cross-Border Share Deal (AT/DE)',
        perspective: 'buyer',
        dealType: 'share_purchase',
        parties: [
            { name: 'Buyer GmbH', role: 'buyer', jurisdiction: 'AT', entityType: 'GmbH' },
            { name: 'Seller GmbH', role: 'seller', jurisdiction: 'DE', entityType: 'GmbH' },
            { name: 'Target s.r.o.', role: 'target', jurisdiction: 'SK', entityType: 's.r.o.' },
        ]
    },
    {
        id: 'sk_share',
        name: 'Slovak Share Deal',
        perspective: 'buyer',
        dealType: 'share_purchase',
        parties: [
            { name: 'Kupujúci s.r.o.', role: 'buyer', jurisdiction: 'SK', entityType: 's.r.o.' },
            { name: 'Predávajúci s.r.o.', role: 'seller', jurisdiction: 'SK', entityType: 's.r.o.' },
            { name: 'Cieľová spoločnosť a.s.', role: 'target', jurisdiction: 'SK', entityType: 'a.s.' },
        ]
    },
    {
        id: 'merger',
        name: 'Merger (AT)',
        perspective: 'buyer',
        dealType: 'merger',
        parties: [
            { name: 'Acquiring AG', role: 'buyer', jurisdiction: 'AT', entityType: 'AG' },
            { name: 'Target AG', role: 'target', jurisdiction: 'AT', entityType: 'AG' },
        ]
    },
];

// ============================================================================
// PARTY MANAGEMENT
// ============================================================================

router.post('/deals/:id/parties', auth_1.authenticateToken, async (req, res) => {
    try {
        const deal = await prisma.deal.findFirst({ where: { id: req.params.id, userId: req.user.userId } });
        if (!deal) return res.status(404).json({ error: 'Deal not found' });

        const { name, role, jurisdiction, entityType, registeredIn, notes } = req.body;
        if (!name || !role || !jurisdiction) {
            return res.status(400).json({ error: 'name, role, and jurisdiction are required' });
        }

        const party = await prisma.dealParty.create({
            data: { dealId: deal.id, name, role, jurisdiction, entityType, registeredIn, notes }
        });
        res.status(201).json(party);
    } catch (error) {
        console.error('[MA Route] Create party error:', error);
        res.status(500).json({ error: 'Failed to create party' });
    }
});

router.put('/deals/:id/parties/:pid', auth_1.authenticateToken, async (req, res) => {
    try {
        const deal = await prisma.deal.findFirst({ where: { id: req.params.id, userId: req.user.userId } });
        if (!deal) return res.status(404).json({ error: 'Deal not found' });

        const { name, role, jurisdiction, entityType, registeredIn, notes } = req.body;
        const party = await prisma.dealParty.updateMany({
            where: { id: req.params.pid, dealId: deal.id },
            data: {
                ...(name !== undefined && { name }),
                ...(role !== undefined && { role }),
                ...(jurisdiction !== undefined && { jurisdiction }),
                ...(entityType !== undefined && { entityType }),
                ...(registeredIn !== undefined && { registeredIn }),
                ...(notes !== undefined && { notes }),
            }
        });
        if (party.count === 0) return res.status(404).json({ error: 'Party not found' });

        const updated = await prisma.dealParty.findUnique({ where: { id: req.params.pid } });
        res.json(updated);
    } catch (error) {
        console.error('[MA Route] Update party error:', error);
        res.status(500).json({ error: 'Failed to update party' });
    }
});

router.delete('/deals/:id/parties/:pid', auth_1.authenticateToken, async (req, res) => {
    try {
        const deal = await prisma.deal.findFirst({ where: { id: req.params.id, userId: req.user.userId } });
        if (!deal) return res.status(404).json({ error: 'Deal not found' });

        await prisma.dealParty.deleteMany({ where: { id: req.params.pid, dealId: deal.id } });
        res.json({ success: true });
    } catch (error) {
        console.error('[MA Route] Delete party error:', error);
        res.status(500).json({ error: 'Failed to delete party' });
    }
});

// ============================================================================
// DOCUMENT UPLOAD (batch, with inline ingest)
// ============================================================================

router.post('/deals/:id/documents', auth_1.authenticateToken, (req, res, next) => {
    maUpload.array('files', 10)(req, res, (err) => {
        if (err) {
            // Multer errors (file too large, wrong type) → 400 with clear message
            const message = err.code === 'LIMIT_FILE_SIZE'
                ? 'File is too large. Maximum size is 50 MB.'
                : err.message || 'File upload failed.';
            return res.status(400).json({ error: message });
        }
        next();
    });
}, async (req, res) => {
    try {
        const deal = await prisma.deal.findFirst({ where: { id: req.params.id, userId: req.user.userId } });
        if (!deal) return res.status(404).json({ error: 'Deal not found' });

        const files = req.files;
        if (!files || files.length === 0) {
            return res.status(400).json({ error: 'No files uploaded' });
        }

        const results = [];

        for (const file of files) {
            try {
                // Create document record
                const doc = await prisma.dealDocument.create({
                    data: {
                        dealId: deal.id,
                        filename: file.originalname,
                        filepath: file.path,
                        filesize: file.size,
                        mimetype: file.mimetype,
                        partyId: req.body.partyId || null,
                        status: 'uploaded'
                    }
                });

                // Ingest inline (parse + split into sections)
                const ingestResult = await maService.ingestDocument(deal.id, doc.id, file.path);

                results.push({
                    id: doc.id,
                    filename: file.originalname,
                    status: 'parsed',
                    textLength: ingestResult.textLength,
                    pageCount: ingestResult.pageCount,
                    sectionCount: ingestResult.sectionCount
                });
            } catch (error) {
                console.error(`[MA Upload] Failed to process ${file.originalname}:`, error.message);
                results.push({
                    filename: file.originalname,
                    status: 'failed',
                    error: error.message
                });
            }
        }

        res.status(201).json({ uploaded: results.length, results });
    } catch (error) {
        console.error('[MA Route] Upload error:', error);
        res.status(500).json({ error: 'Failed to upload documents' });
    }
});

router.delete('/deals/:id/documents/:did', auth_1.authenticateToken, async (req, res) => {
    try {
        const deal = await prisma.deal.findFirst({ where: { id: req.params.id, userId: req.user.userId } });
        if (!deal) return res.status(404).json({ error: 'Deal not found' });

        const doc = await prisma.dealDocument.findFirst({
            where: { id: req.params.did, dealId: deal.id }
        });
        if (!doc) return res.status(404).json({ error: 'Document not found' });

        // Delete file
        try { await promises_1.default.unlink(doc.filepath); } catch {}

        // Delete document + cascade sections
        await prisma.dealDocument.delete({ where: { id: doc.id } });
        res.json({ success: true });
    } catch (error) {
        console.error('[MA Route] Delete document error:', error);
        res.status(500).json({ error: 'Failed to delete document' });
    }
});

// ============================================================================
// PIPELINE CONTROL
// ============================================================================

// Start pipeline
router.post('/deals/:id/start', auth_1.authenticateToken, async (req, res) => {
    try {
        const deal = await prisma.deal.findFirst({ where: { id: req.params.id, userId: req.user.userId } });
        if (!deal) return res.status(404).json({ error: 'Deal not found' });

        const job = await maService.startPipeline(deal.id);
        res.json({ success: true, jobId: job.id, stage: job.currentStage });
    } catch (error) {
        console.error('[MA Route] Start pipeline error:', error);
        const friendlyMessages = {
            'Pipeline already running': 'The analysis pipeline is already running. Wait for it to finish or pause it first.',
            'No parsed documents to analyze': 'Upload at least one document before starting the analysis.',
            'Deal not found': 'Deal not found.',
        };
        const msg = friendlyMessages[error.message] || error.message;
        res.status(400).json({ error: msg });
    }
});

// Pause pipeline
router.post('/deals/:id/pause', auth_1.authenticateToken, async (req, res) => {
    try {
        const deal = await prisma.deal.findFirst({ where: { id: req.params.id, userId: req.user.userId } });
        if (!deal) return res.status(404).json({ error: 'Deal not found' });

        await maService.pausePipeline(deal.id);
        res.json({ success: true });
    } catch (error) {
        console.error('[MA Route] Pause pipeline error:', error);
        res.status(400).json({ error: error.message });
    }
});

// Resume pipeline
router.post('/deals/:id/resume', auth_1.authenticateToken, async (req, res) => {
    try {
        const deal = await prisma.deal.findFirst({ where: { id: req.params.id, userId: req.user.userId } });
        if (!deal) return res.status(404).json({ error: 'Deal not found' });

        const job = await maService.resumePipeline(deal.id);
        res.json({ success: true, jobId: job.id, stage: job.currentStage });
    } catch (error) {
        console.error('[MA Route] Resume pipeline error:', error);
        res.status(400).json({ error: error.message });
    }
});

// ============================================================================
// SSE STREAM
// ============================================================================

router.get('/deals/:id/stream', auth_1.authenticateToken, async (req, res) => {
    try {
        const deal = await prisma.deal.findFirst({ where: { id: req.params.id, userId: req.user.userId } });
        if (!deal) return res.status(404).json({ error: 'Deal not found' });

        // SSE headers
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders();

        const sendEvent = (event, data) => {
            try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch {}
        };

        // Send current state first
        const job = await prisma.dealJob.findFirst({ where: { dealId: deal.id } });
        if (job) {
            sendEvent('state', {
                stage: job.currentStage,
                progress: JSON.parse(job.stageProgress || '{}'),
                dealStatus: deal.status
            });
        }

        // Subscribe to events
        const unsubscribe = maService.subscribe(deal.id, (event, data) => {
            sendEvent(event, data);
        });

        // Keepalive
        const keepalive = setInterval(() => {
            try { res.write(': keepalive\n\n'); } catch {}
        }, 15000);

        // Cleanup on disconnect
        res.on('close', () => {
            clearInterval(keepalive);
            unsubscribe();
        });
    } catch (error) {
        console.error('[MA Route] SSE stream error:', error);
        res.status(500).json({ error: 'Failed to start stream' });
    }
});

// ============================================================================
// CHECKPOINTS
// ============================================================================

router.post('/deals/:id/checkpoints/:cid/approve', auth_1.authenticateToken, async (req, res) => {
    try {
        const deal = await prisma.deal.findFirst({ where: { id: req.params.id, userId: req.user.userId } });
        if (!deal) return res.status(404).json({ error: 'Deal not found' });

        const checkpoint = await maService.approveCheckpoint(deal.id, req.params.cid, req.user.userId);
        res.json(checkpoint);
    } catch (error) {
        console.error('[MA Route] Approve checkpoint error:', error);
        res.status(400).json({ error: error.message });
    }
});

router.post('/deals/:id/checkpoints/:cid/reject', auth_1.authenticateToken, async (req, res) => {
    try {
        const deal = await prisma.deal.findFirst({ where: { id: req.params.id, userId: req.user.userId } });
        if (!deal) return res.status(404).json({ error: 'Deal not found' });

        const { feedback } = req.body;
        const checkpoint = await maService.rejectCheckpoint(deal.id, req.params.cid, req.user.userId, feedback);
        res.json(checkpoint);
    } catch (error) {
        console.error('[MA Route] Reject checkpoint error:', error);
        res.status(400).json({ error: error.message });
    }
});

// ============================================================================
// RISK OVERRIDE
// ============================================================================

router.put('/deals/:id/risks/:rid', auth_1.authenticateToken, async (req, res) => {
    try {
        const deal = await prisma.deal.findFirst({ where: { id: req.params.id, userId: req.user.userId } });
        if (!deal) return res.status(404).json({ error: 'Deal not found' });

        const { severity, notes } = req.body;
        const risk = await prisma.dealRisk.updateMany({
            where: { id: req.params.rid, dealId: deal.id },
            data: {
                humanOverride: true,
                humanSeverity: severity,
                humanNotes: notes,
                humanOverrideAt: new Date()
            }
        });
        if (risk.count === 0) return res.status(404).json({ error: 'Risk not found' });

        const updated = await prisma.dealRisk.findUnique({ where: { id: req.params.rid } });
        res.json(updated);
    } catch (error) {
        console.error('[MA Route] Override risk error:', error);
        res.status(500).json({ error: 'Failed to override risk' });
    }
});

// ============================================================================
// AUDIT LOG
// ============================================================================

router.get('/deals/:id/audit', auth_1.authenticateToken, async (req, res) => {
    try {
        const deal = await prisma.deal.findFirst({ where: { id: req.params.id, userId: req.user.userId } });
        if (!deal) return res.status(404).json({ error: 'Deal not found' });

        const { stage, eventType, limit = '100', offset = '0' } = req.query;
        const where = { dealId: deal.id };
        if (stage) where.stage = stage;
        if (eventType) where.eventType = eventType;

        const events = await prisma.dealAuditEvent.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: parseInt(limit),
            skip: parseInt(offset)
        });

        const total = await prisma.dealAuditEvent.count({ where });
        res.json({ events, total });
    } catch (error) {
        console.error('[MA Route] Audit log error:', error);
        res.status(500).json({ error: 'Failed to get audit log' });
    }
});

// ============================================================================
// PLAYBOOK (on-demand per warranty)
// ============================================================================

router.post('/deals/:id/warranties/:wid/playbook', auth_1.authenticateToken, async (req, res) => {
    try {
        const deal = await prisma.deal.findFirst({
            where: { id: req.params.id, userId: req.user.userId }
        });
        if (!deal) return res.status(404).json({ error: 'Deal not found' });

        const result = await maService.generateWarrantyPlaybook(deal.id, req.params.wid);
        res.json(result);
    } catch (error) {
        console.error('[MA Route] Playbook error:', error);
        if (error.message === 'Warranty not found') {
            return res.status(404).json({ error: 'Warranty not found.' });
        }
        res.status(500).json({ error: 'Failed to generate playbook' });
    }
});

// ============================================================================
// EXPORT (DOCX / PDF / CSV-audit)
// ============================================================================

const docx = require("docx");
const PDFDocument = require("pdfkit");

function makeFooter(text) {
    return { default: new docx.Footer({ children: [new docx.Paragraph({ alignment: docx.AlignmentType.CENTER, children: [new docx.TextRun({ text, size: 16, color: '888888', italics: true })] })] }) };
}

function mdToDocxParagraphs(text) {
    if (!text) return [new docx.Paragraph({ children: [new docx.TextRun('')] })];
    const children = [];
    for (const line of text.split('\n')) {
        const t = line.trim();
        if (!t) { children.push(new docx.Paragraph({ children: [new docx.TextRun('')] })); continue; }
        if (t.startsWith('### ')) {
            children.push(new docx.Paragraph({ heading: docx.HeadingLevel.HEADING_3, children: [new docx.TextRun({ text: t.slice(4), bold: true })] }));
        } else if (t.startsWith('## ')) {
            children.push(new docx.Paragraph({ heading: docx.HeadingLevel.HEADING_2, children: [new docx.TextRun({ text: t.slice(3), bold: true })] }));
        } else if (t.startsWith('- ') || t.startsWith('* ')) {
            children.push(new docx.Paragraph({ bullet: { level: 0 }, children: [new docx.TextRun(t.slice(2))] }));
        } else {
            const runs = [];
            let lastIdx = 0;
            const regex = /\*\*(.*?)\*\*/g;
            let match;
            while ((match = regex.exec(t)) !== null) {
                if (match.index > lastIdx) runs.push(new docx.TextRun(t.slice(lastIdx, match.index)));
                runs.push(new docx.TextRun({ text: match[1], bold: true }));
                lastIdx = regex.lastIndex;
            }
            if (lastIdx < t.length) runs.push(new docx.TextRun(t.slice(lastIdx)));
            children.push(new docx.Paragraph({ children: runs.length ? runs : [new docx.TextRun(t)] }));
        }
    }
    return children.length ? children : [new docx.Paragraph({ children: [new docx.TextRun('')] })];
}

function createPdf(title, callback) {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
        const chunks = [];
        doc.on('data', c => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
        doc.font('Helvetica-Bold').fontSize(22).fillColor('#1a1a0f').text(title, { align: 'center' });
        doc.moveDown(0.5);
        doc.font('Helvetica').fontSize(9).fillColor('#888888')
            .text(`Generated by OpenLex on ${new Date().toLocaleDateString()}`, { align: 'center' });
        doc.moveDown(1);
        doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#cccccc').stroke();
        doc.moveDown(0.8);
        callback(doc);
        const pages = doc.bufferedPageRange();
        for (let i = 0; i < pages.count; i++) {
            doc.switchToPage(i);
            doc.font('Helvetica').fontSize(8).fillColor('#999999')
                .text('OpenLex — M&A Due Diligence Report', 50, 780, { align: 'center', width: 495 });
        }
        doc.end();
    });
}

function pdfHeading(doc, text, level) {
    const sizes = { 1: 18, 2: 14, 3: 12 };
    doc.font('Helvetica-Bold').fontSize(sizes[level] || 12).fillColor('#1a1a0f').text(text);
    doc.moveDown(0.3);
}

function pdfSection(doc, text) {
    if (!text) return;
    for (const line of text.split('\n')) {
        const t = line.trim();
        if (!t) { doc.moveDown(0.3); continue; }
        if (t.startsWith('### ')) { pdfHeading(doc, t.slice(4), 3); }
        else if (t.startsWith('## ')) { pdfHeading(doc, t.slice(3), 2); }
        else if (t.startsWith('- ') || t.startsWith('* ')) {
            doc.font('Helvetica').fontSize(10).fillColor('#333333').text(`  \u2022  ${t.slice(2)}`, { indent: 10 });
        } else {
            const clean = t.replace(/\*\*(.*?)\*\*/g, '$1');
            doc.font('Helvetica').fontSize(10).fillColor('#333333').text(clean);
        }
    }
}

const SEVERITY_LABEL = { deal_breaker: 'DEAL BREAKER', price_affecting: 'Price Affecting', standard: 'Standard', informational: 'Informational' };

router.get('/deals/:id/export/:format', auth_1.authenticateToken, async (req, res) => {
    try {
        const deal = await prisma.deal.findFirst({
            where: { id: req.params.id, userId: req.user.userId },
            include: {
                parties: true,
                documents: { select: { id: true, filename: true, docType: true, jurisdiction: true } },
                risks: { orderBy: { severity: 'asc' } },
                warranties: true,
                disclosures: true,
                job: true,
            }
        });
        if (!deal) return res.status(404).json({ error: 'Deal not found' });

        const format = req.params.format;
        const supportedFormats = ['docx', 'pdf', 'csv'];
        if (!supportedFormats.includes(format)) {
            return res.status(400).json({
                error: `Unsupported export format "${format}". Use one of: ${supportedFormats.join(', ')}`
            });
        }
        const risks = deal.risks || [];
        const warranties = deal.warranties || [];
        const disclosures = deal.disclosures || [];
        const dealBreakers = risks.filter(r => (r.humanOverride ? r.humanSeverity : r.severity) === 'deal_breaker');
        const priceAffecting = risks.filter(r => (r.humanOverride ? r.humanSeverity : r.severity) === 'price_affecting');

        // ==== CSV AUDIT ====
        if (format === 'csv') {
            const events = await prisma.dealAuditEvent.findMany({
                where: { dealId: deal.id },
                orderBy: { createdAt: 'asc' }
            });
            const header = 'Timestamp,Stage,Event,Duration(ms),Input Tokens,Output Tokens,Detail\n';
            const rows = events.map(e => {
                const detail = (e.detail || '').replace(/"/g, '""');
                return `${e.createdAt.toISOString()},${e.stage},${e.eventType},${e.durationMs},${e.inputTokens},${e.outputTokens},"${detail}"`;
            }).join('\n');
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="${deal.name.replace(/[^a-zA-Z0-9]/g, '_')}_audit.csv"`);
            return res.send(header + rows);
        }

        // ==== PDF ====
        if (format === 'pdf') {
            const buffer = await createPdf(`M&A Due Diligence Report: ${deal.name}`, (doc) => {
                // Deal info
                doc.font('Helvetica').fontSize(10).fillColor('#666666')
                    .text(`Perspective: ${deal.perspective}  |  Type: ${deal.dealType.replace('_', ' ')}  |  Date: ${new Date().toLocaleDateString()}`);
                doc.moveDown(0.5);

                if (deal.parties?.length) {
                    pdfHeading(doc, 'Parties', 2);
                    for (const p of deal.parties) {
                        doc.font('Helvetica-Bold').fontSize(10).fillColor('#333333').text(`${p.name} — ${p.role} (${p.jurisdiction})`);
                    }
                    doc.moveDown(0.5);
                }

                // Executive Summary
                if (deal.executiveSummary) {
                    pdfHeading(doc, 'Executive Summary', 1);
                    pdfSection(doc, deal.executiveSummary);
                    doc.moveDown(0.5);
                }

                // Risk summary
                pdfHeading(doc, `Risks (${risks.length})`, 1);
                if (dealBreakers.length) {
                    pdfHeading(doc, 'Deal Breakers', 2);
                    for (const r of dealBreakers) {
                        doc.font('Helvetica-Bold').fontSize(10).fillColor('#cc0000').text(r.title);
                        doc.font('Helvetica').fontSize(9).fillColor('#333333').text(r.description || '');
                        if (r.statutoryBasis) doc.font('Helvetica-Oblique').fontSize(8).fillColor('#666666').text(`Legal basis: ${r.statutoryBasis}`);
                        doc.moveDown(0.3);
                    }
                }
                if (priceAffecting.length) {
                    pdfHeading(doc, 'Price Affecting', 2);
                    for (const r of priceAffecting) {
                        doc.font('Helvetica-Bold').fontSize(10).fillColor('#cc6600').text(r.title);
                        doc.font('Helvetica').fontSize(9).fillColor('#333333').text(r.description || '');
                        if (r.statutoryBasis) doc.font('Helvetica-Oblique').fontSize(8).fillColor('#666666').text(`Legal basis: ${r.statutoryBasis}`);
                        doc.moveDown(0.3);
                    }
                }
                const otherRisks = risks.filter(r => {
                    const sev = r.humanOverride ? r.humanSeverity : r.severity;
                    return sev !== 'deal_breaker' && sev !== 'price_affecting';
                });
                if (otherRisks.length) {
                    pdfHeading(doc, 'Other Risks', 2);
                    for (const r of otherRisks) {
                        const sev = r.humanOverride ? r.humanSeverity : r.severity;
                        doc.font('Helvetica-Bold').fontSize(10).fillColor('#333333').text(`[${SEVERITY_LABEL[sev] || sev}] ${r.title}`);
                        doc.font('Helvetica').fontSize(9).fillColor('#333333').text(r.description || '');
                        doc.moveDown(0.2);
                    }
                }
                doc.moveDown(0.5);

                // Warranties
                if (warranties.length) {
                    pdfHeading(doc, `Warranties (${warranties.length})`, 1);
                    for (const w of warranties) {
                        doc.font('Helvetica-Bold').fontSize(10).fillColor('#333333').text(w.name);
                        const scores = [w.breadthScore, w.disclosureScore, w.exposureScore, w.wniScore].filter(s => s != null);
                        if (scores.length) {
                            doc.font('Helvetica').fontSize(8).fillColor('#666666')
                                .text(`Breadth: ${w.breadthScore ?? '-'} | Disclosure: ${w.disclosureScore ?? '-'} | Exposure: ${w.exposureScore ?? '-'} | W&I: ${w.wniScore ?? '-'}`);
                        }
                        if (w.clauseText) doc.font('Helvetica').fontSize(9).fillColor('#333333').text(w.clauseText.slice(0, 300) + (w.clauseText.length > 300 ? '...' : ''));
                        doc.moveDown(0.3);
                    }
                    doc.moveDown(0.5);
                }

                // Disclosures
                if (disclosures.length) {
                    pdfHeading(doc, `Disclosures (${disclosures.length})`, 1);
                    const missing = disclosures.filter(d => d.status === 'missing');
                    const partial = disclosures.filter(d => d.status === 'partial');
                    if (missing.length) {
                        pdfHeading(doc, `Missing (${missing.length})`, 2);
                        for (const d of missing) {
                            doc.font('Helvetica').fontSize(9).fillColor('#cc0000').text(`${d.warrantyName}: ${d.content.slice(0, 200)}`);
                        }
                        doc.moveDown(0.3);
                    }
                    if (partial.length) {
                        pdfHeading(doc, `Partial (${partial.length})`, 2);
                        for (const d of partial) {
                            doc.font('Helvetica').fontSize(9).fillColor('#cc6600').text(`${d.warrantyName}: ${d.content.slice(0, 200)}`);
                        }
                    }
                }

                // W&I readiness
                if (deal.wniReadiness) {
                    doc.moveDown(0.5);
                    pdfHeading(doc, 'W&I Insurance Readiness', 1);
                    try {
                        const wni = JSON.parse(deal.wniReadiness);
                        doc.font('Helvetica-Bold').fontSize(12).fillColor('#333333').text(`Score: ${wni.readinessScore}/100 — ${wni.readinessLevel}`);
                        if (wni.estimatedPremiumRange && wni.estimatedPremiumRange !== 'N/A') {
                            doc.font('Helvetica').fontSize(9).fillColor('#666666').text(`Estimated premium: ${wni.estimatedPremiumRange}`);
                        }
                        if (wni.recommendations?.length) {
                            doc.moveDown(0.3);
                            pdfHeading(doc, 'Recommendations', 3);
                            for (const r of wni.recommendations) {
                                doc.font('Helvetica').fontSize(9).fillColor('#333333').text(`  \u2022  ${r}`);
                            }
                        }
                    } catch {}
                }
            });

            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="${deal.name.replace(/[^a-zA-Z0-9]/g, '_')}_report.pdf"`);
            return res.send(buffer);
        }

        // ==== DOCX (default) ====
        const docChildren = [];

        // Title + meta
        docChildren.push(new docx.Paragraph({
            heading: docx.HeadingLevel.HEADING_1,
            children: [new docx.TextRun({ text: `M&A Due Diligence Report: ${deal.name}`, bold: true })],
        }));
        docChildren.push(new docx.Paragraph({
            children: [new docx.TextRun({ text: `Perspective: ${deal.perspective}  |  Type: ${deal.dealType.replace('_', ' ')}  |  Date: ${new Date().toLocaleDateString()}`, size: 20, color: '666666' })],
        }));
        docChildren.push(new docx.Paragraph({ children: [new docx.TextRun('')] }));

        // Parties
        if (deal.parties?.length) {
            docChildren.push(new docx.Paragraph({ heading: docx.HeadingLevel.HEADING_2, children: [new docx.TextRun({ text: 'Parties', bold: true })] }));
            for (const p of deal.parties) {
                docChildren.push(new docx.Paragraph({ children: [
                    new docx.TextRun({ text: p.name, bold: true }),
                    new docx.TextRun({ text: ` — ${p.role} (${p.jurisdiction})`, color: '666666' }),
                ] }));
            }
            docChildren.push(new docx.Paragraph({ children: [new docx.TextRun('')] }));
        }

        // Executive Summary
        if (deal.executiveSummary) {
            docChildren.push(new docx.Paragraph({ heading: docx.HeadingLevel.HEADING_1, children: [new docx.TextRun({ text: 'Executive Summary', bold: true })] }));
            docChildren.push(...mdToDocxParagraphs(deal.executiveSummary));
            docChildren.push(new docx.Paragraph({ children: [new docx.TextRun('')] }));
        }

        // Risks
        docChildren.push(new docx.Paragraph({ heading: docx.HeadingLevel.HEADING_1, children: [new docx.TextRun({ text: `Risks (${risks.length})`, bold: true })] }));
        for (const r of risks) {
            const sev = r.humanOverride ? r.humanSeverity : r.severity;
            const sevLabel = SEVERITY_LABEL[sev] || sev;
            const sevColor = sev === 'deal_breaker' ? 'CC0000' : sev === 'price_affecting' ? 'CC6600' : '333333';
            docChildren.push(new docx.Paragraph({ children: [
                new docx.TextRun({ text: `[${sevLabel}] `, bold: true, color: sevColor }),
                new docx.TextRun({ text: r.title, bold: true }),
            ] }));
            if (r.description) docChildren.push(new docx.Paragraph({ children: [new docx.TextRun({ text: r.description, size: 20 })] }));
            if (r.statutoryBasis) docChildren.push(new docx.Paragraph({ children: [new docx.TextRun({ text: `Legal basis: ${r.statutoryBasis}`, italics: true, size: 18, color: '666666' })] }));
            if (r.humanOverride && r.humanNotes) docChildren.push(new docx.Paragraph({ children: [new docx.TextRun({ text: `Reviewer note: ${r.humanNotes}`, italics: true, size: 18, color: '2E5A3F' })] }));
            docChildren.push(new docx.Paragraph({ children: [new docx.TextRun('')] }));
        }

        // Warranties
        if (warranties.length) {
            docChildren.push(new docx.Paragraph({ heading: docx.HeadingLevel.HEADING_1, children: [new docx.TextRun({ text: `Warranties (${warranties.length})`, bold: true })] }));
            for (const w of warranties) {
                docChildren.push(new docx.Paragraph({ children: [new docx.TextRun({ text: w.name, bold: true })] }));
                const scores = [];
                if (w.breadthScore != null) scores.push(`Breadth: ${w.breadthScore}`);
                if (w.disclosureScore != null) scores.push(`Disclosure: ${w.disclosureScore}`);
                if (w.exposureScore != null) scores.push(`Exposure: ${w.exposureScore}`);
                if (w.wniScore != null) scores.push(`W&I: ${w.wniScore}`);
                if (scores.length) docChildren.push(new docx.Paragraph({ children: [new docx.TextRun({ text: scores.join('  |  '), size: 18, color: '666666' })] }));
                if (w.clauseText) docChildren.push(new docx.Paragraph({ children: [new docx.TextRun({ text: w.clauseText.slice(0, 500) + (w.clauseText.length > 500 ? '...' : ''), size: 20 })] }));
                // Playbook positions
                if (w.playbookPositions) {
                    try {
                        const positions = JSON.parse(w.playbookPositions);
                        if (Array.isArray(positions) && positions.length) {
                            docChildren.push(new docx.Paragraph({ children: [new docx.TextRun({ text: 'Negotiation Positions:', bold: true, size: 20, color: '2E5A3F' })] }));
                            for (const pos of positions) {
                                docChildren.push(new docx.Paragraph({ bullet: { level: 0 }, children: [
                                    new docx.TextRun({ text: `${pos.stance || pos.level}: `, bold: true }),
                                    new docx.TextRun({ text: pos.position || pos.text || '' }),
                                ] }));
                            }
                        }
                    } catch {}
                }
                docChildren.push(new docx.Paragraph({ children: [new docx.TextRun('')] }));
            }
        }

        // Disclosures
        if (disclosures.length) {
            docChildren.push(new docx.Paragraph({ heading: docx.HeadingLevel.HEADING_1, children: [new docx.TextRun({ text: `Disclosures (${disclosures.length})`, bold: true })] }));
            for (const d of disclosures) {
                const statusColor = d.status === 'missing' ? 'CC0000' : d.status === 'partial' ? 'CC6600' : d.status === 'adequate' ? '2E5A3F' : '333333';
                docChildren.push(new docx.Paragraph({ children: [
                    new docx.TextRun({ text: `[${d.status.toUpperCase()}] `, bold: true, color: statusColor }),
                    new docx.TextRun({ text: d.warrantyName, bold: true }),
                ] }));
                docChildren.push(new docx.Paragraph({ children: [new docx.TextRun({ text: d.content, size: 20 })] }));
                if (d.assessment) docChildren.push(new docx.Paragraph({ children: [new docx.TextRun({ text: d.assessment, italics: true, size: 18, color: '666666' })] }));
                docChildren.push(new docx.Paragraph({ children: [new docx.TextRun('')] }));
            }
        }

        // W&I Readiness
        if (deal.wniReadiness) {
            try {
                const wni = JSON.parse(deal.wniReadiness);
                docChildren.push(new docx.Paragraph({ heading: docx.HeadingLevel.HEADING_1, children: [new docx.TextRun({ text: 'W&I Insurance Readiness', bold: true })] }));
                docChildren.push(new docx.Paragraph({ children: [
                    new docx.TextRun({ text: `Score: ${wni.readinessScore}/100 — ${wni.readinessLevel}`, bold: true, size: 24 }),
                ] }));
                if (wni.estimatedPremiumRange && wni.estimatedPremiumRange !== 'N/A') {
                    docChildren.push(new docx.Paragraph({ children: [new docx.TextRun({ text: `Estimated premium: ${wni.estimatedPremiumRange}`, size: 20, color: '666666' })] }));
                }
                if (wni.recommendations?.length) {
                    docChildren.push(new docx.Paragraph({ children: [new docx.TextRun({ text: 'Recommendations:', bold: true })] }));
                    for (const r of wni.recommendations) {
                        docChildren.push(new docx.Paragraph({ bullet: { level: 0 }, children: [new docx.TextRun(r)] }));
                    }
                }
            } catch {}
        }

        // Pipeline stats
        if (deal.job) {
            docChildren.push(new docx.Paragraph({ children: [new docx.TextRun('')] }));
            docChildren.push(new docx.Paragraph({ heading: docx.HeadingLevel.HEADING_2, children: [new docx.TextRun({ text: 'Pipeline Statistics', bold: true, color: '666666' })] }));
            docChildren.push(new docx.Paragraph({ children: [new docx.TextRun({ text: `LLM Calls: ${deal.job.totalLLMCalls}  |  Tokens: ${deal.job.totalTokens}  |  Duration: ${Math.round((deal.job.totalDurationMs || 0) / 1000)}s`, size: 18, color: '888888' })] }));
        }

        const doc2 = new docx.Document({
            numbering: { config: [{ reference: 'default-numbering', levels: [{ level: 0, format: docx.LevelFormat.DECIMAL, text: '%1.', alignment: docx.AlignmentType.START }] }] },
            sections: [{
                properties: {},
                headers: {},
                footers: makeFooter(`OpenLex — M&A Due Diligence Report — ${deal.name}`),
                children: docChildren,
            }],
        });

        const buffer = await docx.Packer.toBuffer(doc2);
        const safeFilename = deal.name.replace(/[^a-zA-Z0-9]/g, '_');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}_report.docx"`);
        res.send(buffer);
    } catch (error) {
        console.error('[MA Route] Export error:', error);
        res.status(500).json({ error: 'Failed to export deal' });
    }
});

// ============================================================================
// SCHEDULER STATUS (admin)
// ============================================================================

router.get('/scheduler/status', auth_1.authenticateToken, async (req, res) => {
    try {
        const { scheduler } = require('../services/maScheduler');
        res.json(scheduler.getStatus());
    } catch (error) {
        res.status(500).json({ error: 'Failed to get scheduler status' });
    }
});

module.exports = router;
