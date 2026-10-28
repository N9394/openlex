"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const client_1 = require("@prisma/client");
const auth_1 = require("../middleware/auth");
const navigatorService_1 = require("../services/navigatorService");
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
        const detection = await (0, navigatorService_1.detectDocumentType)(situation);
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
            select: { jurisdiction: true, language: true, organizationId: true, thinkingBudget: true },
        });
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
        await (0, navigatorService_1.draftDocumentStream)(documentType, situation, answers || {}, jurisdiction || user?.jurisdiction || 'US', language || user?.language || 'en', user?.organizationId || undefined, onChunk, user?.thinkingBudget ?? 1);
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
        const draftedDocument = await (0, navigatorService_1.draftDocument)(documentType, situation, answers || {}, jurisdiction || user?.jurisdiction || 'US', language || user?.language || 'en', user?.organizationId || undefined);
        res.json(draftedDocument);
    }
    catch (error) {
        next(error);
    }
});
exports.default = router;
//# sourceMappingURL=navigator.js.map