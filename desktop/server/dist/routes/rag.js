"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const auth_1 = require("../middleware/auth");
const rag_1 = require("../services/rag");
const router = express_1.default.Router();
router.post('/search', auth_1.authenticateToken, async (req, res, next) => {
    try {
        const { query, jurisdiction, limit = 10 } = req.body;
        if (!query) {
            return res.status(400).json({ error: 'Query is required' });
        }
        const results = await (0, rag_1.enhancedSearch)(query, {
            jurisdiction,
            limit,
            rerank: true,
            expandQuery: true,
        });
        res.json({
            results,
            count: results.length,
        });
    }
    catch (error) {
        next(error);
    }
});
router.get('/health', async (_req, res) => {
    try {
        const stats = await (0, rag_1.getRAGStats)();
        res.json({
            status: 'healthy',
            chunks: stats.totalChunks,
            qdrant: true,
        });
    }
    catch (error) {
        res.status(503).json({
            status: 'unhealthy',
            error: error.message,
        });
    }
});
exports.default = router;
//# sourceMappingURL=rag.js.map