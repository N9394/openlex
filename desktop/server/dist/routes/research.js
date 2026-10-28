"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const client_1 = require("@prisma/client");
const auth_1 = require("../middleware/auth");
const researchChatService_1 = require("../services/researchChatService");
const router = express_1.default.Router();
const prisma = new client_1.PrismaClient();
router.post('/chat/stream', auth_1.authenticateToken, async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const { conversationId, message, jurisdictions } = req.body;
        if (!message || message.trim().length < 1) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'Message is required',
            });
        }
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders();
        const sendEvent = (event, data) => {
            res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        };
        try {
            for await (const event of (0, researchChatService_1.chatStream)(userId, message.trim(), {
                conversationId,
                jurisdictionOverride: jurisdictions?.[0],
                jurisdictions: jurisdictions || [],
            })) {
                sendEvent(event.type, event.data);
            }
        }
        catch (streamError) {
            sendEvent('error', { message: streamError.message || 'An error occurred' });
        }
        sendEvent('done', { complete: true });
        res.end();
    }
    catch (error) {
        console.error('[Research] Stream error:', error);
        if (!res.headersSent) {
            return res.status(500).json({ error: 'Internal Server Error', message: error.message });
        }
        res.write(`event: error\ndata: ${JSON.stringify({ message: error.message })}\n\n`);
        res.end();
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
router.post('/chat', auth_1.authenticateToken, async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const { conversationId, message, jurisdictions } = req.body;
        if (!message || message.trim().length < 1) {
            return res.status(400).json({ error: 'Bad Request', message: 'Message is required' });
        }
        let response = { answer: '', sources: [] };
        for await (const event of (0, researchChatService_1.chatStream)(userId, message.trim(), {
            conversationId,
            jurisdictionOverride: jurisdictions?.[0],
            jurisdictions: jurisdictions || [],
        })) {
            if (event.type === 'content' || event.type === 'token')
                response.answer += event.data.text || '';
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
        const { message, jurisdictions } = req.body;
        if (!message || message.trim().length < 1) {
            return res.status(400).json({ error: 'Message is required' });
        }
        let response = { answer: '', sources: [], conversationId };
        for await (const event of (0, researchChatService_1.chatStream)(userId, message.trim(), {
            conversationId,
            jurisdictionOverride: jurisdictions?.[0],
            jurisdictions: jurisdictions || [],
        })) {
            if (event.type === 'content' || event.type === 'token')
                response.answer += event.data.text || '';
            if (event.type === 'sources')
                response.sources = event.data.sources || [];
        }
        res.json(response);
    }
    catch (error) {
        next(error);
    }
});
//# sourceMappingURL=research.js.map