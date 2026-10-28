"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.queryAuditLogs = queryAuditLogs;
exports.getAuditStats = getAuditStats;
exports.getAuditDashboard = getAuditDashboard;
exports.exportAuditLogsToCSV = exportAuditLogsToCSV;
exports.getComplianceAuditLogs = getComplianceAuditLogs;
exports.getFilterOptions = getFilterOptions;
exports.createAuditLog = createAuditLog;
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
async function queryAuditLogs(organizationId, filters, options = {}) {
    const { limit = 50, offset = 0, includeUser = true } = options;
    const where = {};
    if (organizationId) {
        where.organizationId = organizationId;
    }
    if (filters.startDate) {
        where.createdAt = { ...where.createdAt, gte: filters.startDate };
    }
    if (filters.endDate) {
        where.createdAt = { ...where.createdAt, lte: filters.endDate };
    }
    if (filters.action) {
        where.action = filters.action;
    }
    if (filters.resource) {
        where.resource = filters.resource;
    }
    if (filters.userId) {
        where.userId = filters.userId;
    }
    if (filters.resourceId) {
        where.resourceId = filters.resourceId;
    }
    if (filters.isCompliance !== undefined) {
        where.isCompliance = filters.isCompliance;
    }
    const [logs, total] = await Promise.all([
        prisma.auditLog.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: limit,
            skip: offset,
        }),
        prisma.auditLog.count({ where }),
    ]);
    let enrichedLogs = logs.map((log) => ({
        id: log.id,
        organizationId: log.organizationId,
        userId: log.userId,
        action: log.action,
        resource: log.resource,
        resourceId: log.resourceId,
        previousValue: log.previousValue ? JSON.parse(log.previousValue) : null,
        newValue: log.newValue ? JSON.parse(log.newValue) : null,
        ipAddress: log.ipAddress,
        userAgent: log.userAgent,
        requestId: log.requestId,
        isCompliance: log.isCompliance,
        createdAt: log.createdAt,
    }));
    if (includeUser) {
        const userIds = [...new Set(logs.map((l) => l.userId))];
        const users = await prisma.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, email: true, username: true },
        });
        const userMap = new Map(users.map((u) => [u.id, u]));
        enrichedLogs = enrichedLogs.map((log) => ({
            ...log,
            user: userMap.get(log.userId) || undefined,
        }));
    }
    return { logs: enrichedLogs, total };
}
async function getAuditStats(organizationId, dateRange = {}) {
    const where = {};
    if (organizationId) {
        where.organizationId = organizationId;
    }
    if (dateRange.startDate) {
        where.createdAt = { ...where.createdAt, gte: dateRange.startDate };
    }
    if (dateRange.endDate) {
        where.createdAt = { ...where.createdAt, lte: dateRange.endDate };
    }
    const logs = await prisma.auditLog.findMany({
        where,
        select: {
            id: true,
            action: true,
            resource: true,
            userId: true,
            isCompliance: true,
            createdAt: true,
        },
    });
    const eventsByAction = {};
    for (const log of logs) {
        eventsByAction[log.action] = (eventsByAction[log.action] || 0) + 1;
    }
    const eventsByResource = {};
    for (const log of logs) {
        eventsByResource[log.resource] = (eventsByResource[log.resource] || 0) + 1;
    }
    const userCounts = {};
    for (const log of logs) {
        userCounts[log.userId] = (userCounts[log.userId] || 0) + 1;
    }
    const topUserIds = Object.entries(userCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([userId]) => userId);
    const users = await prisma.user.findMany({
        where: { id: { in: topUserIds } },
        select: { id: true, email: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u.email]));
    const eventsByUser = topUserIds.map((userId) => ({
        userId,
        email: userMap.get(userId) || 'Unknown',
        count: userCounts[userId],
    }));
    const complianceEvents = logs.filter((l) => l.isCompliance).length;
    const recentLogs = logs.slice(0, 10).map((log) => ({
        id: log.id,
        organizationId: null,
        userId: log.userId,
        action: log.action,
        resource: log.resource,
        resourceId: null,
        previousValue: null,
        newValue: null,
        ipAddress: null,
        userAgent: null,
        requestId: null,
        isCompliance: log.isCompliance,
        createdAt: log.createdAt,
    }));
    return {
        totalEvents: logs.length,
        eventsByAction,
        eventsByResource,
        eventsByUser,
        complianceEvents,
        recentActivity: recentLogs,
    };
}
async function getAuditDashboard(organizationId, days = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const stats = await getAuditStats(organizationId, { startDate });
    const { logs: recentLogs } = await queryAuditLogs(organizationId, { startDate }, { limit: 20 });
    const topActions = Object.entries(stats.eventsByAction)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([action, count]) => ({ action, count }));
    const topResources = Object.entries(stats.eventsByResource)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([resource, count]) => ({ resource, count }));
    const where = { createdAt: { gte: startDate } };
    if (organizationId) {
        where.organizationId = organizationId;
    }
    const logs = await prisma.auditLog.findMany({
        where,
        select: { createdAt: true },
        orderBy: { createdAt: 'asc' },
    });
    const dayMap = {};
    for (const log of logs) {
        const day = log.createdAt.toISOString().split('T')[0];
        dayMap[day] = (dayMap[day] || 0) + 1;
    }
    const activityByDay = Object.entries(dayMap).map(([date, count]) => ({ date, count }));
    return {
        stats,
        recentLogs,
        topActions,
        topResources,
        activityByDay,
    };
}
async function exportAuditLogsToCSV(organizationId, filters) {
    const { logs } = await queryAuditLogs(organizationId, filters, {
        limit: 10000,
        includeUser: true,
    });
    const headers = [
        'ID',
        'Timestamp',
        'User',
        'Action',
        'Resource',
        'Resource ID',
        'IP Address',
        'Compliance',
    ];
    const rows = logs.map((log) => [
        log.id,
        log.createdAt.toISOString(),
        log.user?.email || log.userId,
        log.action,
        log.resource,
        log.resourceId || '',
        log.ipAddress || '',
        log.isCompliance ? 'Yes' : 'No',
    ]);
    const csvContent = [
        headers.join(','),
        ...rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
    ].join('\n');
    return csvContent;
}
async function getComplianceAuditLogs(organizationId, options = {}) {
    return queryAuditLogs(organizationId, { isCompliance: true }, options);
}
async function getFilterOptions(organizationId) {
    const where = organizationId ? { organizationId } : {};
    const actionLogs = await prisma.auditLog.findMany({
        where,
        select: { action: true },
        distinct: ['action'],
    });
    const actions = actionLogs.map((l) => l.action);
    const resourceLogs = await prisma.auditLog.findMany({
        where,
        select: { resource: true },
        distinct: ['resource'],
    });
    const resources = resourceLogs.map((l) => l.resource);
    const userLogs = await prisma.auditLog.findMany({
        where,
        select: { userId: true },
        distinct: ['userId'],
    });
    const userIds = userLogs.map((l) => l.userId);
    const users = await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, email: true },
    });
    return { actions, resources, users };
}
async function createAuditLog(entry) {
    await prisma.auditLog.create({
        data: {
            organizationId: entry.organizationId,
            userId: entry.userId,
            action: entry.action,
            resource: entry.resource,
            resourceId: entry.resourceId,
            previousValue: entry.previousValue ? JSON.stringify(entry.previousValue) : null,
            newValue: entry.newValue ? JSON.stringify(entry.newValue) : null,
            ipAddress: entry.ipAddress,
            userAgent: entry.userAgent,
            requestId: entry.requestId,
            isCompliance: entry.isCompliance || false,
        },
    });
}
//# sourceMappingURL=auditDashboardService.js.map