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
router.post('/sessions', auth_1.authenticateToken, async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const { documentType, situation } = req.body;
        const sessionId = `draft_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        res.status(201).json({
            id: sessionId,
            documentType,
            situation,
            userId,
            createdAt: new Date().toISOString(),
        });
    }
    catch (error) {
        next(error);
    }
});
router.post('/', auth_1.authenticateToken, async (req, res, next) => {
    try {
        const { documentType, situation, answers, jurisdiction, language } = req.body;
        if (!documentType || !situation) {
            return res.status(400).json({ error: 'documentType and situation are required' });
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
//# sourceMappingURL=drafts.js.map