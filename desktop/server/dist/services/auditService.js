"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RESOURCE_TYPES = exports.AUDIT_ACTIONS = void 0;
exports.logAuditEvent = logAuditEvent;
exports.logWithChanges = logWithChanges;
exports.getAuditLogs = getAuditLogs;
exports.getResourceAuditTrail = getResourceAuditTrail;
exports.getUserActivityLog = getUserActivityLog;
exports.getAuditStats = getAuditStats;
exports.getSecurityEvents = getSecurityEvents;
exports.exportAuditLogs = exportAuditLogs;
exports.cleanupOldAuditLogs = cleanupOldAuditLogs;
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
exports.AUDIT_ACTIONS = {
    LOGIN: 'auth.login',
    LOGOUT: 'auth.logout',
    LOGIN_FAILED: 'auth.login_failed',
    PASSWORD_CHANGE: 'auth.password_change',
    PASSWORD_RESET: 'auth.password_reset',
    MFA_ENABLED: 'auth.mfa_enabled',
    MFA_DISABLED: 'auth.mfa_disabled',
    USER_CREATE: 'user.create',
    USER_UPDATE: 'user.update',
    USER_DELETE: 'user.delete',
    USER_INVITE: 'user.invite',
    USER_ROLE_CHANGE: 'user.role_change',
    ORG_SETTINGS_UPDATE: 'org.settings_update',
    ORG_MEMBER_ADD: 'org.member_add',
    ORG_MEMBER_REMOVE: 'org.member_remove',
    ORG_TEAM_CREATE: 'org.team_create',
    ORG_TEAM_UPDATE: 'org.team_update',
    ORG_TEAM_DELETE: 'org.team_delete',
    CASE_CREATE: 'case.create',
    CASE_UPDATE: 'case.update',
    CASE_DELETE: 'case.delete',
    CASE_SHARE: 'case.share',
    CASE_UNSHARE: 'case.unshare',
    CASE_EXPORT: 'case.export',
    DOCUMENT_UPLOAD: 'document.upload',
    DOCUMENT_UPDATE: 'document.update',
    DOCUMENT_DELETE: 'document.delete',
    DOCUMENT_DOWNLOAD: 'document.download',
    DOCUMENT_SHARE: 'document.share',
    CLIENT_CREATE: 'client.create',
    CLIENT_UPDATE: 'client.update',
    CLIENT_DELETE: 'client.delete',
    DATA_EXPORT: 'data.export',
    DATA_IMPORT: 'data.import',
    DATA_DELETE: 'data.delete',
    API_KEY_CREATE: 'api.key_create',
    API_KEY_REVOKE: 'api.key_revoke',
    API_INTEGRATION_ADD: 'api.integration_add',
    API_INTEGRATION_REMOVE: 'api.integration_remove',
    SUBSCRIPTION_CHANGE: 'billing.subscription_change',
    SEAT_ADD: 'billing.seat_add',
    SEAT_REMOVE: 'billing.seat_remove',
    PAYMENT_METHOD_UPDATE: 'billing.payment_method_update',
    ADMIN_ACCESS: 'admin.access',
    ADMIN_ACTION: 'admin.action',
    SETTINGS_CHANGE: 'settings.change',
};
exports.RESOURCE_TYPES = {
    USER: 'user',
    ORGANIZATION: 'organization',
    TEAM: 'team',
    CASE: 'case',
    DOCUMENT: 'document',
    CLIENT: 'client',
    VAULT_ITEM: 'vault_item',
    API_KEY: 'api_key',
    INTEGRATION: 'integration',
    SUBSCRIPTION: 'subscription',
    SETTINGS: 'settings',
};
async function logAuditEvent(userId, organizationId, event) {
    const log = await prisma.auditLog.create({
        data: {
            organizationId,
            userId,
            action: event.action,
            resource: event.resourceType,
            resourceId: event.resourceId || null,
            previousValue: event.previousValue ? JSON.stringify(event.previousValue) : null,
            newValue: event.newValue ? JSON.stringify(event.newValue) : null,
            ipAddress: event.ipAddress || null,
            userAgent: event.userAgent || null,
            requestId: event.requestId || null,
            isCompliance: event.isCompliance || false,
        },
    });
    console.log(`[Audit] ${event.action} on ${event.resourceType} by user ${userId}`);
    return log.id;
}
async function logWithChanges(userId, organizationId, action, resourceType, resourceId, oldValue, newValue, metadata) {
    return logAuditEvent(userId, organizationId, {
        action,
        resourceType,
        resourceId,
        previousValue: oldValue,
        newValue: newValue,
        ...metadata,
    });
}
async function getAuditLogs(organizationId, filter = {}, pagination = { page: 1, limit: 50 }) {
    const where = { organizationId };
    if (filter.userId)
        where.userId = filter.userId;
    if (filter.action)
        where.action = { contains: filter.action };
    if (filter.resource)
        where.resource = filter.resource;
    if (filter.resourceId)
        where.resourceId = filter.resourceId;
    if (filter.ipAddress)
        where.ipAddress = filter.ipAddress;
    if (filter.startDate || filter.endDate) {
        where.createdAt = {};
        if (filter.startDate)
            where.createdAt.gte = filter.startDate;
        if (filter.endDate)
            where.createdAt.lte = filter.endDate;
    }
    const [logs, total] = await Promise.all([
        prisma.auditLog.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            skip: (pagination.page - 1) * pagination.limit,
            take: pagination.limit,
        }),
        prisma.auditLog.count({ where }),
    ]);
    const userIds = [...new Set(logs.map(l => l.userId))];
    const users = await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, username: true, email: true },
    });
    const userMap = new Map(users.map(u => [u.id, u.username || u.email || 'Unknown']));
    const entries = logs.map(log => ({
        id: log.id,
        createdAt: log.createdAt,
        userId: log.userId,
        userName: userMap.get(log.userId),
        action: log.action,
        resource: log.resource,
        resourceId: log.resourceId || undefined,
        previousValue: log.previousValue ? JSON.parse(log.previousValue) : undefined,
        newValue: log.newValue ? JSON.parse(log.newValue) : undefined,
        ipAddress: log.ipAddress || undefined,
    }));
    return {
        logs: entries,
        total,
        pages: Math.ceil(total / pagination.limit),
    };
}
async function getResourceAuditTrail(organizationId, resource, resourceId) {
    const logs = await prisma.auditLog.findMany({
        where: {
            organizationId,
            resource,
            resourceId,
        },
        orderBy: { createdAt: 'desc' },
    });
    const userIds = [...new Set(logs.map(l => l.userId))];
    const users = await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, username: true, email: true },
    });
    const userMap = new Map(users.map(u => [u.id, u.username || u.email || 'Unknown']));
    return logs.map(log => ({
        id: log.id,
        createdAt: log.createdAt,
        userId: log.userId,
        userName: userMap.get(log.userId),
        action: log.action,
        resource: log.resource,
        resourceId: log.resourceId || undefined,
        previousValue: log.previousValue ? JSON.parse(log.previousValue) : undefined,
        newValue: log.newValue ? JSON.parse(log.newValue) : undefined,
        ipAddress: log.ipAddress || undefined,
    }));
}
async function getUserActivityLog(organizationId, userId, days = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const logs = await prisma.auditLog.findMany({
        where: {
            organizationId,
            userId,
            createdAt: { gte: startDate },
        },
        orderBy: { createdAt: 'desc' },
    });
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { username: true, email: true },
    });
    const userName = user?.username || user?.email || 'Unknown';
    return logs.map(log => ({
        id: log.id,
        createdAt: log.createdAt,
        userId: log.userId,
        userName,
        action: log.action,
        resource: log.resource,
        resourceId: log.resourceId || undefined,
        previousValue: log.previousValue ? JSON.parse(log.previousValue) : undefined,
        newValue: log.newValue ? JSON.parse(log.newValue) : undefined,
        ipAddress: log.ipAddress || undefined,
    }));
}
async function getAuditStats(organizationId, days = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const logs = await prisma.auditLog.findMany({
        where: {
            organizationId,
            createdAt: { gte: startDate },
        },
        select: {
            action: true,
            userId: true,
            resource: true,
            createdAt: true,
        },
    });
    const eventsByAction = {};
    const eventsByUser = {};
    const eventsByResource = {};
    const dailyCounts = {};
    for (const log of logs) {
        const actionCategory = log.action.split('.')[0];
        eventsByAction[actionCategory] = (eventsByAction[actionCategory] || 0) + 1;
        eventsByUser[log.userId] = (eventsByUser[log.userId] || 0) + 1;
        eventsByResource[log.resource] = (eventsByResource[log.resource] || 0) + 1;
        const dateStr = log.createdAt.toISOString().split('T')[0];
        dailyCounts[dateStr] = (dailyCounts[dateStr] || 0) + 1;
    }
    const dailyTrend = [];
    for (let d = new Date(startDate); d <= new Date(); d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split('T')[0];
        dailyTrend.push({
            date: dateStr,
            count: dailyCounts[dateStr] || 0,
        });
    }
    return {
        totalEvents: logs.length,
        eventsByAction,
        eventsByUser,
        eventsByResource,
        dailyTrend,
    };
}
async function getSecurityEvents(organizationId, days = 7) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const securityActions = [
        exports.AUDIT_ACTIONS.LOGIN_FAILED,
        exports.AUDIT_ACTIONS.PASSWORD_CHANGE,
        exports.AUDIT_ACTIONS.PASSWORD_RESET,
        exports.AUDIT_ACTIONS.MFA_ENABLED,
        exports.AUDIT_ACTIONS.MFA_DISABLED,
        exports.AUDIT_ACTIONS.USER_ROLE_CHANGE,
        exports.AUDIT_ACTIONS.API_KEY_CREATE,
        exports.AUDIT_ACTIONS.API_KEY_REVOKE,
        exports.AUDIT_ACTIONS.ADMIN_ACCESS,
        exports.AUDIT_ACTIONS.DATA_EXPORT,
        exports.AUDIT_ACTIONS.DATA_DELETE,
    ];
    const logs = await prisma.auditLog.findMany({
        where: {
            organizationId,
            createdAt: { gte: startDate },
            action: { in: securityActions },
        },
        orderBy: { createdAt: 'desc' },
    });
    const userIds = [...new Set(logs.map(l => l.userId))];
    const users = await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, username: true, email: true },
    });
    const userMap = new Map(users.map(u => [u.id, u.username || u.email || 'Unknown']));
    return logs.map(log => ({
        id: log.id,
        createdAt: log.createdAt,
        userId: log.userId,
        userName: userMap.get(log.userId),
        action: log.action,
        resource: log.resource,
        resourceId: log.resourceId || undefined,
        previousValue: log.previousValue ? JSON.parse(log.previousValue) : undefined,
        newValue: log.newValue ? JSON.parse(log.newValue) : undefined,
        ipAddress: log.ipAddress || undefined,
    }));
}
async function exportAuditLogs(organizationId, startDate, endDate, format = 'json') {
    const logs = await prisma.auditLog.findMany({
        where: {
            organizationId,
            createdAt: { gte: startDate, lte: endDate },
        },
        orderBy: { createdAt: 'asc' },
    });
    const userIds = [...new Set(logs.map(l => l.userId))];
    const users = await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, username: true, email: true },
    });
    const userMap = new Map(users.map(u => [u.id, { username: u.username, email: u.email }]));
    if (format === 'csv') {
        const header = 'Timestamp,User,Email,Action,Resource,Resource ID,IP Address\n';
        const rows = logs.map(log => {
            const user = userMap.get(log.userId);
            return `"${log.createdAt.toISOString()}","${user?.username || ''}","${user?.email || ''}","${log.action}","${log.resource}","${log.resourceId || ''}","${log.ipAddress || ''}"`;
        }).join('\n');
        return header + rows;
    }
    return JSON.stringify(logs.map(log => {
        const user = userMap.get(log.userId);
        return {
            timestamp: log.createdAt,
            user: { id: log.userId, username: user?.username, email: user?.email },
            action: log.action,
            resource: log.resource,
            resourceId: log.resourceId,
            previousValue: log.previousValue ? JSON.parse(log.previousValue) : null,
            newValue: log.newValue ? JSON.parse(log.newValue) : null,
            ipAddress: log.ipAddress,
            userAgent: log.userAgent,
            requestId: log.requestId,
        };
    }), null, 2);
}
async function cleanupOldAuditLogs(retentionDays = 2555) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
    const result = await prisma.auditLog.deleteMany({
        where: { createdAt: { lt: cutoffDate } },
    });
    console.log(`[Audit] Cleaned up ${result.count} old audit logs`);
    return result.count;
}
//# sourceMappingURL=auditService.js.map