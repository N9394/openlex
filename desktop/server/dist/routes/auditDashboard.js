"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const auth_1 = require("../middleware/auth");
const client_1 = require("@prisma/client");
const auditDashboardService_1 = require("../services/auditDashboardService");
const aiAuditService_1 = require("../services/aiAuditService");
const router = express_1.default.Router();
const prisma = new client_1.PrismaClient();
async function requireEnterprise(req, res, next) {
    const userId = req.user?.userId;
    if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { organization: true },
    });
    if (!user) {
        return res.status(401).json({ error: 'User not found' });
    }
    const isEnterprise = user.tier === 'enterprise' ||
        user.tier === 'admin' ||
        user.organization?.tier === 'enterprise';
    if (!isEnterprise) {
        return res.status(403).json({
            error: 'Audit dashboard requires Enterprise plan',
            upgradeUrl: '/pricing',
        });
    }
    req.organizationId = user.organizationId;
    next();
}
router.get('/dashboard', auth_1.authenticateToken, requireEnterprise, async (req, res, next) => {
    try {
        const organizationId = req.organizationId;
        const days = parseInt(req.query.days) || 30;
        const dashboard = await (0, auditDashboardService_1.getAuditDashboard)(organizationId, days);
        res.json({
            success: true,
            dashboard,
        });
    }
    catch (error) {
        console.error('[AUDIT] Error fetching dashboard:', error);
        next(error);
    }
});
router.get('/logs', auth_1.authenticateToken, requireEnterprise, async (req, res, next) => {
    try {
        const organizationId = req.organizationId;
        const filters = {};
        if (req.query.startDate) {
            filters.startDate = new Date(req.query.startDate);
        }
        if (req.query.endDate) {
            filters.endDate = new Date(req.query.endDate);
        }
        if (req.query.action) {
            filters.action = req.query.action;
        }
        if (req.query.resource) {
            filters.resource = req.query.resource;
        }
        if (req.query.userId) {
            filters.userId = req.query.userId;
        }
        if (req.query.resourceId) {
            filters.resourceId = req.query.resourceId;
        }
        if (req.query.isCompliance !== undefined) {
            filters.isCompliance = req.query.isCompliance === 'true';
        }
        const limit = parseInt(req.query.limit) || 50;
        const offset = parseInt(req.query.offset) || 0;
        const { logs, total } = await (0, auditDashboardService_1.queryAuditLogs)(organizationId, filters, {
            limit: Math.min(limit, 100),
            offset,
            includeUser: true,
        });
        res.json({
            success: true,
            logs,
            pagination: {
                total,
                limit,
                offset,
                hasMore: offset + logs.length < total,
            },
        });
    }
    catch (error) {
        console.error('[AUDIT] Error fetching logs:', error);
        next(error);
    }
});
router.get('/stats', auth_1.authenticateToken, requireEnterprise, async (req, res, next) => {
    try {
        const organizationId = req.organizationId;
        const dateRange = {};
        if (req.query.startDate) {
            dateRange.startDate = new Date(req.query.startDate);
        }
        if (req.query.endDate) {
            dateRange.endDate = new Date(req.query.endDate);
        }
        const stats = await (0, auditDashboardService_1.getAuditStats)(organizationId, dateRange);
        res.json({
            success: true,
            stats,
        });
    }
    catch (error) {
        console.error('[AUDIT] Error fetching stats:', error);
        next(error);
    }
});
router.get('/compliance', auth_1.authenticateToken, requireEnterprise, async (req, res, next) => {
    try {
        const organizationId = req.organizationId;
        const limit = parseInt(req.query.limit) || 50;
        const offset = parseInt(req.query.offset) || 0;
        const { logs, total } = await (0, auditDashboardService_1.getComplianceAuditLogs)(organizationId, {
            limit: Math.min(limit, 100),
            offset,
        });
        res.json({
            success: true,
            logs,
            pagination: {
                total,
                limit,
                offset,
                hasMore: offset + logs.length < total,
            },
        });
    }
    catch (error) {
        console.error('[AUDIT] Error fetching compliance logs:', error);
        next(error);
    }
});
router.get('/filters', auth_1.authenticateToken, requireEnterprise, async (req, res, next) => {
    try {
        const organizationId = req.organizationId;
        const options = await (0, auditDashboardService_1.getFilterOptions)(organizationId);
        res.json({
            success: true,
            filters: options,
        });
    }
    catch (error) {
        console.error('[AUDIT] Error fetching filter options:', error);
        next(error);
    }
});
router.get('/export', auth_1.authenticateToken, requireEnterprise, async (req, res, next) => {
    try {
        const organizationId = req.organizationId;
        const filters = {};
        if (req.query.startDate) {
            filters.startDate = new Date(req.query.startDate);
        }
        if (req.query.endDate) {
            filters.endDate = new Date(req.query.endDate);
        }
        if (req.query.action) {
            filters.action = req.query.action;
        }
        if (req.query.resource) {
            filters.resource = req.query.resource;
        }
        if (req.query.isCompliance !== undefined) {
            filters.isCompliance = req.query.isCompliance === 'true';
        }
        const csv = await (0, auditDashboardService_1.exportAuditLogsToCSV)(organizationId, filters);
        const filename = `audit_logs_${new Date().toISOString().split('T')[0]}.csv`;
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(csv);
    }
    catch (error) {
        console.error('[AUDIT] Error exporting logs:', error);
        next(error);
    }
});
router.get('/resource/:resource/:resourceId', auth_1.authenticateToken, requireEnterprise, async (req, res, next) => {
    try {
        const organizationId = req.organizationId;
        const { resource, resourceId } = req.params;
        const { logs, total } = await (0, auditDashboardService_1.queryAuditLogs)(organizationId, { resource, resourceId }, { limit: 100, includeUser: true });
        res.json({
            success: true,
            resource,
            resourceId,
            logs,
            total,
        });
    }
    catch (error) {
        console.error('[AUDIT] Error fetching resource audit trail:', error);
        next(error);
    }
});
router.get('/ai', auth_1.authenticateToken, async (req, res, next) => {
    try {
        const userId = req.user?.userId;
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { organizationId: true, memberRole: true },
        });
        const filter = {};
        if (!user?.organizationId) {
            filter.userId = userId;
        }
        else if (user.memberRole !== 'admin' && user.memberRole !== 'owner') {
            filter.userId = userId;
        }
        if (req.query.requestType) {
            filter.requestType = req.query.requestType;
        }
        if (req.query.confidence) {
            filter.confidence = req.query.confidence;
        }
        if (req.query.jurisdiction) {
            filter.jurisdiction = req.query.jurisdiction;
        }
        if (req.query.conversationId) {
            filter.conversationId = req.query.conversationId;
        }
        if (req.query.startDate) {
            filter.startDate = new Date(req.query.startDate);
        }
        if (req.query.endDate) {
            filter.endDate = new Date(req.query.endDate);
        }
        const page = parseInt(req.query.page) || 1;
        const limit = Math.min(parseInt(req.query.limit) || 20, 100);
        const result = await (0, aiAuditService_1.getAIAuditLogs)(user?.organizationId || null, filter, { page, limit });
        res.json({
            success: true,
            ...result,
        });
    }
    catch (error) {
        console.error('[AUDIT] Error fetching AI audit logs:', error);
        next(error);
    }
});
router.get('/ai/stats', auth_1.authenticateToken, async (req, res, next) => {
    try {
        const userId = req.user?.userId;
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { organizationId: true },
        });
        if (!user?.organizationId) {
            return res.status(403).json({ error: 'Organization required for stats' });
        }
        const days = parseInt(req.query.days) || 30;
        const stats = await (0, aiAuditService_1.getAIAuditStats)(user.organizationId, days);
        res.json({
            success: true,
            stats,
        });
    }
    catch (error) {
        console.error('[AUDIT] Error fetching AI audit stats:', error);
        next(error);
    }
});
router.get('/ai/:logId', auth_1.authenticateToken, async (req, res, next) => {
    try {
        const userId = req.user?.userId;
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const { logId } = req.params;
        if (['stats', 'export', 'conversation'].includes(logId)) {
            return next();
        }
        const log = await prisma.aIAuditLog.findFirst({
            where: {
                id: logId,
                userId,
            },
        });
        if (!log) {
            return res.status(404).json({ error: 'Audit log not found' });
        }
        res.json({
            success: true,
            log,
        });
    }
    catch (error) {
        console.error('[AUDIT] Error fetching audit log:', error);
        next(error);
    }
});
router.get('/ai/conversation/:conversationId', auth_1.authenticateToken, async (req, res, next) => {
    try {
        const userId = req.user?.userId;
        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const { conversationId } = req.params;
        const conversation = await prisma.researchConversation.findFirst({
            where: { id: conversationId, userId },
        });
        if (!conversation) {
            return res.status(404).json({ error: 'Conversation not found' });
        }
        const logs = await (0, aiAuditService_1.getConversationAuditTrail)(conversationId);
        res.json({
            success: true,
            conversationId,
            logs,
        });
    }
    catch (error) {
        console.error('[AUDIT] Error fetching conversation audit trail:', error);
        next(error);
    }
});
router.get('/ai/export', auth_1.authenticateToken, requireEnterprise, async (req, res, next) => {
    try {
        const organizationId = req.organizationId;
        const startDate = req.query.startDate
            ? new Date(req.query.startDate)
            : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const endDate = req.query.endDate
            ? new Date(req.query.endDate)
            : new Date();
        const format = req.query.format || 'json';
        const data = await (0, aiAuditService_1.exportAIAuditLogs)(organizationId, startDate, endDate, format);
        const filename = `ai_audit_logs_${new Date().toISOString().split('T')[0]}.${format}`;
        const contentType = format === 'csv' ? 'text/csv' : 'application/json';
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(data);
    }
    catch (error) {
        console.error('[AUDIT] Error exporting AI audit logs:', error);
        next(error);
    }
});
exports.default = router;
//# sourceMappingURL=auditDashboard.js.map