"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const client_1 = require("@prisma/client");
const auth_1 = require("../middleware/auth");
const navigatorService_1 = require("../services/navigatorService");
const { AIAuditContext, saveAIAudit, isAuditEnabled } = require('../services/aiAuditService');
const router = express_1.default.Router();
const prisma = new client_1.PrismaClient();
router.post('/detect', auth_1.authenticateToken, async (req, res, next) => {
    try {
        const { situation } = req.body;
        if (!situation || situation.trim().length < 10) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'Please describe your situation in more detail',
            });
        }
        const auditContext = new AIAuditContext(req.user.userId, 'navigator', situation);
        auditContext.setRequestMetadata(req.ip, req.headers['user-agent']);
        const detection = await (0, navigatorService_1.detectDocumentType)(situation, auditContext);
        // Save audit for detect step
        try {
            auditContext.setResponse(JSON.stringify(detection), []);
            const auditOn = await isAuditEnabled(null);
            if (auditOn) await saveAIAudit(auditContext.finalize());
        } catch (_e) { /* non-critical */ }
        res.json(detection);
    }
    catch (error) {
        next(error);
    }
});
router.post('/questions', auth_1.authenticateToken, async (req, res, next) => {
    try {
        const { documentType, situation } = req.body;
        if (!documentType) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'documentType is required',
            });
        }
        const user = await prisma.user.findUnique({
            where: { id: req.user.userId },
            select: { jurisdiction: true, language: true },
        });
        const questions = await (0, navigatorService_1.generateQuestions)(documentType, situation || '', {
            jurisdiction: user?.jurisdiction || 'US',
            language: user?.language || 'en'
        });
        res.json({ questions, documentType });
    }
    catch (error) {
        next(error);
    }
});
router.post('/draft/stream', auth_1.authenticateToken, async (req, res, next) => {
    const auditContext = new AIAuditContext(req.user.userId, 'navigator', `Draft ${req.body.documentType}: ${(req.body.situation || '').substring(0, 200)}`);
    auditContext.setRequestMetadata(req.ip, req.headers['user-agent']);
    try {
        const { documentType, situation, answers, jurisdiction, language } = req.body;
        if (!documentType || !situation) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'documentType and situation are required',
            });
        }
        const user = await prisma.user.findUnique({
            where: { id: req.user.userId },
            select: { jurisdiction: true, language: true, organizationId: true },
        });
        const effectiveJurisdiction = jurisdiction || user?.jurisdiction || 'US';
        auditContext.setJurisdiction(effectiveJurisdiction, jurisdiction ? 'user_selected' : 'auto_detected');
        if (user?.organizationId) auditContext.setOrganization(user.organizationId);
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders();
        const onChunk = (chunk) => {
            res.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
            if (typeof res.flush === 'function') {
                res.flush();
            }
        };
        await (0, navigatorService_1.draftDocumentStream)(documentType, situation, answers || {}, effectiveJurisdiction, language || user?.language || 'en', user?.organizationId || undefined, onChunk, 1, auditContext);
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.end();
    }
    catch (error) {
        console.error('[NAVIGATOR] Streaming draft error:', error);
        if (!res.headersSent) {
            next(error);
        }
        else {
            res.write(`data: ${JSON.stringify({ error: 'Generation failed' })}\n\n`);
            res.end();
        }
    }
    finally {
        // Save audit even on error/abort
        try {
            if (!auditContext.entry.response) auditContext.setResponse('Draft streaming ' + (res.writableEnded ? 'completed' : 'aborted'), []);
            const auditOn = await isAuditEnabled(null);
            if (auditOn) await saveAIAudit(auditContext.finalize());
        } catch (_e) { /* non-critical */ }
    }
});
router.post('/draft', auth_1.authenticateToken, async (req, res, next) => {
    try {
        const { documentType, situation, answers, jurisdiction, language } = req.body;
        if (!documentType || !situation) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'documentType and situation are required',
            });
        }
        const user = await prisma.user.findUnique({
            where: { id: req.user.userId },
            select: { jurisdiction: true, language: true, organizationId: true },
        });
        const effectiveJurisdiction = jurisdiction || user?.jurisdiction || 'US';
        const auditContext = new AIAuditContext(req.user.userId, 'navigator', `Draft ${documentType}: ${situation.substring(0, 200)}`);
        auditContext.setRequestMetadata(req.ip, req.headers['user-agent']);
        auditContext.setJurisdiction(effectiveJurisdiction, jurisdiction ? 'user_selected' : 'auto_detected');
        if (user?.organizationId) auditContext.setOrganization(user.organizationId);
        const draftedDocument = await (0, navigatorService_1.draftDocument)(documentType, situation, answers || {}, effectiveJurisdiction, language || user?.language || 'en', user?.organizationId || undefined, auditContext);
        // Save audit log
        try {
            auditContext.setResponse(JSON.stringify(draftedDocument).substring(0, 5000), []);
            const auditOn = await isAuditEnabled(null);
            if (auditOn) await saveAIAudit(auditContext.finalize());
        } catch (_e) { /* non-critical */ }
        res.json(draftedDocument);
    }
    catch (error) {
        next(error);
    }
});
// POST /regenerate-section — regenerate a single section of a drafted document
router.post('/regenerate-section', auth_1.authenticateToken, async (req, res, next) => {
    try {
        const { documentType, situation, jurisdiction, language, answers, sectionTitle, sectionIndex } = req.body;
        if (!documentType || !sectionTitle) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'documentType and sectionTitle are required',
            });
        }
        const user = await prisma.user.findUnique({
            where: { id: req.user.userId },
            select: { jurisdiction: true, language: true, organizationId: true },
        });

        // Use a targeted prompt to regenerate just one section
        let sectionContent = '';
        const onChunk = (chunk) => { sectionContent += chunk; };

        await (0, navigatorService_1.draftDocumentStream)(
            documentType,
            `Regenerate ONLY the section titled "${sectionTitle}" for the following situation: ${situation || 'General legal document'}. Output ONLY the content for this one section, no JSON, no other sections.`,
            answers || {},
            jurisdiction || user?.jurisdiction || 'US',
            language || user?.language || 'en',
            user?.organizationId || undefined,
            onChunk,
            1
        );

        res.json({ content: sectionContent.trim(), sectionIndex });
    }
    catch (error) {
        console.error('[NAVIGATOR] Section regeneration error:', error);
        next(error);
    }
});
exports.default = router;
//# sourceMappingURL=navigator.js.map