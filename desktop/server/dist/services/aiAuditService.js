"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AIAuditContext = void 0;
exports.saveAIAudit = saveAIAudit;
exports.isAuditEnabled = isAuditEnabled;
exports.getAIAuditLogs = getAIAuditLogs;
exports.getConversationAuditTrail = getConversationAuditTrail;
exports.getAIAuditStats = getAIAuditStats;
exports.exportAIAuditLogs = exportAIAuditLogs;
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
class AIAuditContext {
    entry;
    startTime;
    constructor(userId, requestType, userQuery) {
        this.startTime = Date.now();
        this.entry = {
            userId,
            requestType,
            userQuery,
            ragSearches: [],
            nliVerifications: [],
            quoteVerifications: [],
            llmCalls: [],
            sourcesUsed: [],
            nliVerifiedClaims: 0,
            totalClaims: 0,
            quotesVerified: 0,
            totalQuotes: 0,
        };
    }
    setOrganization(orgId) {
        this.entry.organizationId = orgId;
    }
    setConversation(conversationId) {
        this.entry.conversationId = conversationId;
    }
    setCase(caseId) {
        this.entry.caseId = caseId;
    }
    setJurisdiction(jurisdiction, source) {
        this.entry.jurisdiction = jurisdiction;
        this.entry.jurisdictionSource = source;
    }
    setRequestMetadata(ipAddress, userAgent) {
        this.entry.ipAddress = ipAddress;
        this.entry.userAgent = userAgent;
    }
    logRAGSearch(search) {
        this.entry.ragSearches.push(search);
    }
    logNLIVerification(verification) {
        this.entry.nliVerifications.push(verification);
        this.entry.totalClaims = (this.entry.totalClaims || 0) + 1;
        if (verification.result === 'entailment' && verification.confidence >= 0.7) {
            this.entry.nliVerifiedClaims = (this.entry.nliVerifiedClaims || 0) + 1;
        }
    }
    logQuoteVerification(verification) {
        this.entry.quoteVerifications.push(verification);
        this.entry.totalQuotes = (this.entry.totalQuotes || 0) + 1;
        if (verification.isVerified) {
            this.entry.quotesVerified = (this.entry.quotesVerified || 0) + 1;
        }
    }
    logLLMCall(call) {
        this.entry.llmCalls.push(call);
    }
    setResponse(response, sourcesUsed) {
        this.entry.response = response;
        this.entry.sourcesUsed = sourcesUsed;
    }
    calculateConfidence() {
        const nliRatio = this.entry.totalClaims > 0
            ? this.entry.nliVerifiedClaims / this.entry.totalClaims
            : 0;
        const quoteRatio = this.entry.totalQuotes > 0
            ? this.entry.quotesVerified / this.entry.totalQuotes
            : 1;
        const hasContradiction = this.entry.nliVerifications.some(v => v.result === 'contradiction' && v.confidence >= 0.7);
        if (hasContradiction)
            return 'low';
        if (nliRatio >= 0.8 && quoteRatio >= 0.9)
            return 'high';
        if (nliRatio >= 0.5 || this.entry.sourcesUsed.length > 0)
            return 'medium';
        if (this.entry.nliVerifications.length === 0)
            return 'unverified';
        return 'low';
    }
    finalize() {
        this.entry.totalDurationMs = Date.now() - this.startTime;
        this.entry.overallConfidence = this.calculateConfidence();
        const usedSourceIds = new Set(this.entry.sourcesUsed.map(s => s.id));
        for (const search of this.entry.ragSearches) {
            for (const result of search.results) {
                result.wasUsed = usedSourceIds.has(result.id);
            }
        }
        return this.entry;
    }
}
exports.AIAuditContext = AIAuditContext;
async function saveAIAudit(entry) {
    const log = await prisma.aIAuditLog.create({
        data: {
            userId: entry.userId,
            organizationId: entry.organizationId || null,
            conversationId: entry.conversationId || null,
            caseId: entry.caseId || null,
            requestType: entry.requestType,
            userQuery: entry.userQuery,
            ragSearches: JSON.stringify(entry.ragSearches),
            nliVerifications: JSON.stringify(entry.nliVerifications),
            quoteVerifications: JSON.stringify(entry.quoteVerifications),
            llmCalls: JSON.stringify(entry.llmCalls),
            response: entry.response,
            sourcesUsed: JSON.stringify(entry.sourcesUsed),
            overallConfidence: entry.overallConfidence,
            nliVerifiedClaims: entry.nliVerifiedClaims,
            totalClaims: entry.totalClaims,
            quotesVerified: entry.quotesVerified,
            totalQuotes: entry.totalQuotes,
            jurisdiction: entry.jurisdiction,
            jurisdictionSource: entry.jurisdictionSource,
            totalDurationMs: entry.totalDurationMs,
            ipAddress: entry.ipAddress || null,
            userAgent: entry.userAgent || null,
        },
    });
    console.log(`[AIAudit] Logged ${entry.requestType} for user ${entry.userId} (confidence: ${entry.overallConfidence})`);
    return log.id;
}
async function isAuditEnabled(organizationId) {
    if (!organizationId)
        return true;
    try {
        const org = await prisma.organization.findUnique({
            where: { id: organizationId },
            select: { settings: true },
        });
        if (!org?.settings)
            return true;
        const settings = typeof org.settings === 'string'
            ? JSON.parse(org.settings)
            : org.settings;
        return settings.aiAuditEnabled !== false;
    }
    catch {
        return true;
    }
}
async function getAIAuditLogs(organizationId, filter = {}, pagination = { page: 1, limit: 50 }) {
    const where = {};
    if (organizationId)
        where.organizationId = organizationId;
    if (filter.userId)
        where.userId = filter.userId;
    if (filter.conversationId)
        where.conversationId = filter.conversationId;
    if (filter.caseId)
        where.caseId = filter.caseId;
    if (filter.requestType)
        where.requestType = filter.requestType;
    if (filter.confidence)
        where.overallConfidence = filter.confidence;
    if (filter.jurisdiction)
        where.jurisdiction = filter.jurisdiction;
    if (filter.startDate || filter.endDate) {
        where.createdAt = {};
        if (filter.startDate)
            where.createdAt.gte = filter.startDate;
        if (filter.endDate)
            where.createdAt.lte = filter.endDate;
    }
    const [logs, total] = await Promise.all([
        prisma.aIAuditLog.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            skip: (pagination.page - 1) * pagination.limit,
            take: pagination.limit,
            include: {
                user: { select: { id: true, username: true, email: true } },
            },
        }),
        prisma.aIAuditLog.count({ where }),
    ]);
    return {
        logs: logs.map(log => ({
            ...log,
            ragSearches: log.ragSearches ? JSON.parse(log.ragSearches) : [],
            nliVerifications: log.nliVerifications ? JSON.parse(log.nliVerifications) : [],
            quoteVerifications: log.quoteVerifications ? JSON.parse(log.quoteVerifications) : [],
            llmCalls: log.llmCalls ? JSON.parse(log.llmCalls) : [],
            sourcesUsed: log.sourcesUsed ? JSON.parse(log.sourcesUsed) : [],
        })),
        total,
        pages: Math.ceil(total / pagination.limit),
    };
}
async function getConversationAuditTrail(conversationId) {
    const logs = await prisma.aIAuditLog.findMany({
        where: { conversationId },
        orderBy: { createdAt: 'asc' },
        include: {
            user: { select: { id: true, username: true, email: true } },
        },
    });
    return logs.map(log => ({
        ...log,
        ragSearches: log.ragSearches ? JSON.parse(log.ragSearches) : [],
        nliVerifications: log.nliVerifications ? JSON.parse(log.nliVerifications) : [],
        quoteVerifications: log.quoteVerifications ? JSON.parse(log.quoteVerifications) : [],
        llmCalls: log.llmCalls ? JSON.parse(log.llmCalls) : [],
        sourcesUsed: log.sourcesUsed ? JSON.parse(log.sourcesUsed) : [],
    }));
}
async function getAIAuditStats(organizationId, days = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const logs = await prisma.aIAuditLog.findMany({
        where: {
            organizationId,
            createdAt: { gte: startDate },
        },
        select: {
            overallConfidence: true,
            requestType: true,
            nliVerifiedClaims: true,
            totalClaims: true,
            quotesVerified: true,
            totalQuotes: true,
            totalDurationMs: true,
        },
    });
    const byConfidence = {};
    const byRequestType = {};
    let totalNLIRatio = 0;
    let totalQuoteRatio = 0;
    let totalDuration = 0;
    let nliCount = 0;
    let quoteCount = 0;
    for (const log of logs) {
        byConfidence[log.overallConfidence] = (byConfidence[log.overallConfidence] || 0) + 1;
        byRequestType[log.requestType] = (byRequestType[log.requestType] || 0) + 1;
        totalDuration += log.totalDurationMs;
        if (log.totalClaims > 0) {
            totalNLIRatio += log.nliVerifiedClaims / log.totalClaims;
            nliCount++;
        }
        if (log.totalQuotes > 0) {
            totalQuoteRatio += log.quotesVerified / log.totalQuotes;
            quoteCount++;
        }
    }
    return {
        totalQueries: logs.length,
        byConfidence,
        byRequestType,
        averageNLIVerification: nliCount > 0 ? totalNLIRatio / nliCount : 0,
        averageQuoteVerification: quoteCount > 0 ? totalQuoteRatio / quoteCount : 1,
        averageDurationMs: logs.length > 0 ? totalDuration / logs.length : 0,
    };
}
async function exportAIAuditLogs(organizationId, startDate, endDate, format = 'json') {
    const logs = await prisma.aIAuditLog.findMany({
        where: {
            organizationId,
            createdAt: { gte: startDate, lte: endDate },
        },
        orderBy: { createdAt: 'asc' },
        include: {
            user: { select: { username: true, email: true } },
        },
    });
    if (format === 'csv') {
        const header = 'Timestamp,User,Request Type,Query,Jurisdiction,Confidence,NLI Verified,Total Claims,Quotes Verified,Total Quotes,Duration(ms),Sources Count\n';
        const rows = logs.map(log => {
            const sourcesUsed = log.sourcesUsed ? JSON.parse(log.sourcesUsed) : [];
            return `"${log.createdAt.toISOString()}","${log.user?.username || log.user?.email || ''}","${log.requestType}","${log.userQuery.replace(/"/g, '""')}","${log.jurisdiction}","${log.overallConfidence}",${log.nliVerifiedClaims},${log.totalClaims},${log.quotesVerified},${log.totalQuotes},${log.totalDurationMs},${sourcesUsed.length}`;
        }).join('\n');
        return header + rows;
    }
    return JSON.stringify(logs.map(log => ({
        timestamp: log.createdAt,
        user: log.user,
        requestType: log.requestType,
        query: log.userQuery,
        jurisdiction: log.jurisdiction,
        jurisdictionSource: log.jurisdictionSource,
        confidence: log.overallConfidence,
        verification: {
            nliVerifiedClaims: log.nliVerifiedClaims,
            totalClaims: log.totalClaims,
            quotesVerified: log.quotesVerified,
            totalQuotes: log.totalQuotes,
        },
        ragSearches: log.ragSearches ? JSON.parse(log.ragSearches) : [],
        nliVerifications: log.nliVerifications ? JSON.parse(log.nliVerifications) : [],
        quoteVerifications: log.quoteVerifications ? JSON.parse(log.quoteVerifications) : [],
        llmCalls: log.llmCalls ? JSON.parse(log.llmCalls) : [],
        sourcesUsed: log.sourcesUsed ? JSON.parse(log.sourcesUsed) : [],
        response: log.response,
        durationMs: log.totalDurationMs,
        ipAddress: log.ipAddress,
    })), null, 2);
}
exports.default = {
    AIAuditContext,
    saveAIAudit,
    isAuditEnabled,
    getAIAuditLogs,
    getConversationAuditTrail,
    getAIAuditStats,
    exportAIAuditLogs,
};
//# sourceMappingURL=aiAuditService.js.map