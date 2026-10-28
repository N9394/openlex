"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateContentHash = generateContentHash;
exports.contentHasChanged = contentHasChanged;
exports.detectAmendments = detectAmendments;
exports.getUnacknowledgedAmendments = getUnacknowledgedAmendments;
exports.acknowledgeAmendment = acknowledgeAmendment;
exports.markAsVerified = markAsVerified;
exports.verifySource = verifySource;
exports.getContentFreshness = getContentFreshness;
exports.findStaleContent = findStaleContent;
exports.getGroundingStats = getGroundingStats;
const client_1 = require("@prisma/client");
const crypto_1 = __importDefault(require("crypto"));
const prisma = new client_1.PrismaClient();
function generateContentHash(content) {
    const normalized = content.trim().replace(/\r\n/g, '\n').replace(/\s+/g, ' ');
    return crypto_1.default.createHash('sha256').update(normalized).digest('hex');
}
function contentHasChanged(oldContent, newContent) {
    const oldHash = generateContentHash(oldContent);
    const newHash = generateContentHash(newContent);
    if (oldHash === newHash) {
        return { changed: false, similarity: 1.0 };
    }
    const oldWords = new Set(oldContent.toLowerCase().split(/\s+/).filter(w => w.length > 3));
    const newWords = new Set(newContent.toLowerCase().split(/\s+/).filter(w => w.length > 3));
    const intersection = new Set([...oldWords].filter(w => newWords.has(w)));
    const union = new Set([...oldWords, ...newWords]);
    const similarity = union.size > 0 ? intersection.size / union.size : 0;
    return { changed: true, similarity };
}
async function detectAmendments(sourceId, newContent, sourceName) {
    const amendments = [];
    try {
        const existingChunks = await prisma.$queryRawUnsafe(`SELECT id, content, content_hash FROM rag_chunks WHERE source_id = ?`, sourceId);
        if (existingChunks.length === 0) {
            return [];
        }
        for (const existing of existingChunks) {
            const { changed, similarity } = contentHasChanged(existing.content, newContent);
            if (changed && similarity < 0.95) {
                const amendment = {
                    id: crypto_1.default.randomUUID(),
                    chunkId: existing.id,
                    sourceName,
                    previousContent: existing.content,
                    newContent,
                    detectedAt: new Date(),
                    changeType: similarity < 0.3 ? 'removed' : 'modified',
                    acknowledged: false,
                };
                amendments.push(amendment);
                await prisma.$executeRawUnsafe(`INSERT INTO rag_amendments (id, chunk_id, source_name, previous_content, new_content, detected_at, change_type, acknowledged)
           VALUES (?, ?, ?, ?, ?, datetime('now'), ?, 0)`, amendment.id, amendment.chunkId, amendment.sourceName, amendment.previousContent.substring(0, 5000), amendment.newContent.substring(0, 5000), amendment.changeType);
                console.log(`[GROUNDING] Amendment detected for ${sourceName}: ${amendment.changeType} (${Math.round(similarity * 100)}% similarity)`);
            }
        }
    }
    catch (error) {
        console.error('[GROUNDING] Error detecting amendments:', error);
    }
    return amendments;
}
async function getUnacknowledgedAmendments(limit = 50) {
    try {
        const results = await prisma.$queryRawUnsafe(`SELECT * FROM rag_amendments WHERE acknowledged = 0 ORDER BY detected_at DESC LIMIT ?`, limit);
        return results.map(r => ({
            id: r.id,
            chunkId: r.chunk_id,
            sourceName: r.source_name,
            previousContent: r.previous_content,
            newContent: r.new_content,
            detectedAt: new Date(r.detected_at),
            changeType: r.change_type,
            acknowledged: Boolean(r.acknowledged),
            acknowledgedBy: r.acknowledged_by,
            acknowledgedAt: r.acknowledged_at ? new Date(r.acknowledged_at) : undefined,
        }));
    }
    catch (error) {
        console.error('[GROUNDING] Error fetching amendments:', error);
        return [];
    }
}
async function acknowledgeAmendment(amendmentId, userId) {
    try {
        await prisma.$executeRawUnsafe(`UPDATE rag_amendments SET acknowledged = 1, acknowledged_by = ?, acknowledged_at = datetime('now') WHERE id = ?`, userId, amendmentId);
        return true;
    }
    catch (error) {
        console.error('[GROUNDING] Error acknowledging amendment:', error);
        return false;
    }
}
async function markAsVerified(chunkId) {
    try {
        await prisma.$executeRawUnsafe(`UPDATE rag_chunks SET last_verified_at = datetime('now') WHERE id = ?`, chunkId);
        return true;
    }
    catch (error) {
        console.error('[GROUNDING] Error marking as verified:', error);
        return false;
    }
}
async function verifySource(sourceId) {
    try {
        const result = await prisma.$executeRawUnsafe(`UPDATE rag_chunks SET last_verified_at = datetime('now') WHERE source_id = ?`, sourceId);
        return typeof result === 'number' ? result : 0;
    }
    catch (error) {
        console.error('[GROUNDING] Error verifying source:', error);
        return 0;
    }
}
async function getContentFreshness(chunkIds) {
    if (chunkIds.length === 0)
        return [];
    try {
        const placeholders = chunkIds.map(() => '?').join(',');
        const results = await prisma.$queryRawUnsafe(`SELECT id, source_name, source_date, last_verified_at, expires_at FROM rag_chunks WHERE id IN (${placeholders})`, ...chunkIds);
        const now = new Date();
        return results.map(r => {
            const lastVerified = r.last_verified_at ? new Date(r.last_verified_at) : null;
            const expiresAt = r.expires_at ? new Date(r.expires_at) : null;
            const sourceDate = r.source_date ? new Date(r.source_date) : null;
            const daysSinceVerification = lastVerified
                ? Math.floor((now.getTime() - lastVerified.getTime()) / (1000 * 60 * 60 * 24))
                : 999;
            const isExpired = expiresAt ? now > expiresAt : false;
            let freshnessLevel;
            if (isExpired) {
                freshnessLevel = 'expired';
            }
            else if (!lastVerified) {
                freshnessLevel = 'unknown';
            }
            else if (daysSinceVerification <= 30) {
                freshnessLevel = 'fresh';
            }
            else if (daysSinceVerification <= 90) {
                freshnessLevel = 'stale';
            }
            else {
                freshnessLevel = 'expired';
            }
            return {
                chunkId: r.id,
                sourceName: r.source_name,
                sourceDate: sourceDate || undefined,
                lastVerified: lastVerified || undefined,
                expiresAt: expiresAt || undefined,
                daysSinceVerification,
                isExpired,
                freshnessLevel,
            };
        });
    }
    catch (error) {
        console.error('[GROUNDING] Error getting content freshness:', error);
        return [];
    }
}
async function findStaleContent(daysThreshold = 90, limit = 100) {
    try {
        const results = await prisma.$queryRawUnsafe(`SELECT id, source_name, source_date, last_verified_at, expires_at
       FROM rag_chunks
       WHERE last_verified_at IS NULL
          OR last_verified_at < datetime('now', '-' || ? || ' days')
          OR (expires_at IS NOT NULL AND expires_at < datetime('now'))
       ORDER BY last_verified_at ASC
       LIMIT ?`, daysThreshold, limit);
        const now = new Date();
        return results.map(r => {
            const lastVerified = r.last_verified_at ? new Date(r.last_verified_at) : null;
            const expiresAt = r.expires_at ? new Date(r.expires_at) : null;
            const sourceDate = r.source_date ? new Date(r.source_date) : null;
            const daysSinceVerification = lastVerified
                ? Math.floor((now.getTime() - lastVerified.getTime()) / (1000 * 60 * 60 * 24))
                : 999;
            const isExpired = expiresAt ? now > expiresAt : daysSinceVerification > daysThreshold;
            return {
                chunkId: r.id,
                sourceName: r.source_name,
                sourceDate: sourceDate || undefined,
                lastVerified: lastVerified || undefined,
                expiresAt: expiresAt || undefined,
                daysSinceVerification,
                isExpired,
                freshnessLevel: isExpired ? 'expired' : 'stale',
            };
        });
    }
    catch (error) {
        console.error('[GROUNDING] Error finding stale content:', error);
        return [];
    }
}
async function getGroundingStats() {
    try {
        const [totalResult, freshResult, staleResult, expiredResult, unknownResult, amendmentsResult, avgDaysResult,] = await Promise.all([
            prisma.$queryRawUnsafe(`SELECT COUNT(*) as count FROM rag_chunks`),
            prisma.$queryRawUnsafe(`SELECT COUNT(*) as count FROM rag_chunks WHERE last_verified_at > datetime('now', '-30 days')`),
            prisma.$queryRawUnsafe(`SELECT COUNT(*) as count FROM rag_chunks WHERE last_verified_at > datetime('now', '-90 days') AND last_verified_at <= datetime('now', '-30 days')`),
            prisma.$queryRawUnsafe(`SELECT COUNT(*) as count FROM rag_chunks WHERE last_verified_at <= datetime('now', '-90 days') OR (expires_at IS NOT NULL AND expires_at < datetime('now'))`),
            prisma.$queryRawUnsafe(`SELECT COUNT(*) as count FROM rag_chunks WHERE last_verified_at IS NULL`),
            prisma.$queryRawUnsafe(`SELECT COUNT(*) as count FROM rag_amendments WHERE acknowledged = 0`),
            prisma.$queryRawUnsafe(`SELECT AVG(julianday('now') - julianday(last_verified_at)) as avg_days FROM rag_chunks WHERE last_verified_at IS NOT NULL`),
        ]);
        return {
            totalChunks: totalResult[0]?.count || 0,
            freshChunks: freshResult[0]?.count || 0,
            staleChunks: staleResult[0]?.count || 0,
            expiredChunks: expiredResult[0]?.count || 0,
            unknownChunks: unknownResult[0]?.count || 0,
            pendingAmendments: amendmentsResult[0]?.count || 0,
            averageDaysSinceVerification: Math.round(avgDaysResult[0]?.avg_days || 0),
        };
    }
    catch (error) {
        console.error('[GROUNDING] Error getting stats:', error);
        return {
            totalChunks: 0,
            freshChunks: 0,
            staleChunks: 0,
            expiredChunks: 0,
            unknownChunks: 0,
            pendingAmendments: 0,
            averageDaysSinceVerification: 0,
        };
    }
}
exports.default = {
    generateContentHash,
    contentHasChanged,
    detectAmendments,
    getUnacknowledgedAmendments,
    acknowledgeAmendment,
    markAsVerified,
    verifySource,
    getContentFreshness,
    findStaleContent,
    getGroundingStats,
};
//# sourceMappingURL=grounding.js.map