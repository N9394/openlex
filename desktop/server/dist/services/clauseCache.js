"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupClauseCacheTable = setupClauseCacheTable;
exports.checkCache = checkCache;
exports.storeInCache = storeInCache;
exports.analyzeClauseWithCache = analyzeClauseWithCache;
exports.getCacheStats = getCacheStats;
exports.cleanupCache = cleanupCache;
exports.clearCache = clearCache;
const embeddings_1 = require("./rag/embeddings");
const client_1 = require("@prisma/client");
const crypto_1 = require("crypto");
const prisma = new client_1.PrismaClient();
const SIMILARITY_THRESHOLD = 0.92;
const MAX_CACHE_CHECK = 1000;
const CACHE_TTL_DAYS = 30;
const MIN_CLAUSE_LENGTH = 50;
async function setupClauseCacheTable() {
    try {
        await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS clause_cache (
        id TEXT PRIMARY KEY,
        clause_hash TEXT NOT NULL,
        clause_text TEXT NOT NULL,
        embedding TEXT NOT NULL,
        analysis TEXT NOT NULL,
        jurisdiction TEXT,
        hit_count INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_used_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
        await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_clause_cache_hash ON clause_cache(clause_hash)
    `);
        await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_clause_cache_jurisdiction ON clause_cache(jurisdiction)
    `);
        console.log('[ClauseCache] Database table ready');
    }
    catch (error) {
        console.error('[ClauseCache] Failed to setup table:', error);
    }
}
function normalizeClause(text) {
    return text
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase()
        .replace(/\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}/g, '[DATE]')
        .replace(/\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2}/g, '[DATE]')
        .replace(/(?:eur|usd|€|\$)\s*[\d,]+(?:\.\d{2})?/gi, '[AMOUNT]')
        .replace(/[\d,]+(?:\.\d{2})?\s*(?:eur|usd|euro|dollars?)/gi, '[AMOUNT]')
        .replace(/\d+\s*(?:days?|weeks?|months?|years?)/gi, '[DURATION]')
        .replace(/"[^"]{2,50}"/g, '[NAME]')
        .replace(/'[^']{2,50}'/g, '[NAME]');
}
function hashClause(normalizedText) {
    let hash = 0;
    for (let i = 0; i < normalizedText.length; i++) {
        const char = normalizedText.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return hash.toString(36);
}
async function checkCache(clauseText, jurisdiction) {
    if (clauseText.length < MIN_CLAUSE_LENGTH) {
        return { hit: false };
    }
    const startTime = Date.now();
    const normalized = normalizeClause(clauseText);
    const clauseHash = hashClause(normalized);
    try {
        const exactMatch = await prisma.$queryRawUnsafe(`
      SELECT id, analysis, embedding
      FROM clause_cache
      WHERE clause_hash = ?
      ${jurisdiction ? 'AND (jurisdiction = ? OR jurisdiction IS NULL)' : ''}
      LIMIT 1
    `, clauseHash, ...(jurisdiction ? [jurisdiction] : []));
        if (exactMatch.length > 0) {
            await prisma.$executeRawUnsafe(`
        UPDATE clause_cache
        SET hit_count = hit_count + 1, last_used_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, exactMatch[0].id);
            console.log(`[ClauseCache] Exact match found in ${Date.now() - startTime}ms`);
            return {
                hit: true,
                analysis: JSON.parse(exactMatch[0].analysis),
                similarity: 1.0,
                cacheId: exactMatch[0].id,
                source: 'cache',
            };
        }
        const embedding = await (0, embeddings_1.generateEmbedding)(normalized);
        if (!embedding) {
            console.warn('[ClauseCache] Failed to generate embedding');
            return { hit: false };
        }
        const candidates = await prisma.$queryRawUnsafe(`
      SELECT id, embedding, analysis
      FROM clause_cache
      ${jurisdiction ? 'WHERE jurisdiction = ? OR jurisdiction IS NULL' : ''}
      ORDER BY last_used_at DESC
      LIMIT ?
    `, ...(jurisdiction ? [jurisdiction, MAX_CACHE_CHECK] : [MAX_CACHE_CHECK]));
        let bestMatch = null;
        for (const candidate of candidates) {
            try {
                const candidateEmbedding = JSON.parse(candidate.embedding);
                const similarity = (0, embeddings_1.cosineSimilarity)(embedding, candidateEmbedding);
                if (similarity >= SIMILARITY_THRESHOLD) {
                    if (!bestMatch || similarity > bestMatch.similarity) {
                        bestMatch = {
                            id: candidate.id,
                            similarity,
                            analysis: JSON.parse(candidate.analysis),
                        };
                    }
                }
            }
            catch {
            }
        }
        if (bestMatch) {
            await prisma.$executeRawUnsafe(`
        UPDATE clause_cache
        SET hit_count = hit_count + 1, last_used_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, bestMatch.id);
            console.log(`[ClauseCache] Vector match found (${(bestMatch.similarity * 100).toFixed(1)}%) in ${Date.now() - startTime}ms`);
            return {
                hit: true,
                analysis: bestMatch.analysis,
                similarity: bestMatch.similarity,
                cacheId: bestMatch.id,
                source: 'cache',
            };
        }
        console.log(`[ClauseCache] No match found in ${Date.now() - startTime}ms (checked ${candidates.length} entries)`);
        return { hit: false };
    }
    catch (error) {
        console.error('[ClauseCache] Cache check error:', error);
        return { hit: false };
    }
}
async function storeInCache(clauseText, analysis, jurisdiction) {
    if (clauseText.length < MIN_CLAUSE_LENGTH) {
        return null;
    }
    const normalized = normalizeClause(clauseText);
    const clauseHash = hashClause(normalized);
    try {
        const embedding = await (0, embeddings_1.generateEmbedding)(normalized);
        if (!embedding) {
            console.warn('[ClauseCache] Failed to generate embedding for storage');
            return null;
        }
        const id = (0, crypto_1.randomUUID)();
        await prisma.$executeRawUnsafe(`
      INSERT INTO clause_cache (id, clause_hash, clause_text, embedding, analysis, jurisdiction)
      VALUES (?, ?, ?, ?, ?, ?)
    `, id, clauseHash, clauseText.substring(0, 2000), JSON.stringify(embedding), JSON.stringify(analysis), jurisdiction || null);
        console.log(`[ClauseCache] Stored new entry: ${id}`);
        return id;
    }
    catch (error) {
        console.error('[ClauseCache] Failed to store in cache:', error);
        return null;
    }
}
async function analyzeClauseWithCache(clauseText, jurisdiction, analyzerFn) {
    const cacheResult = await checkCache(clauseText, jurisdiction);
    if (cacheResult.hit && cacheResult.analysis) {
        return {
            analysis: cacheResult.analysis,
            cached: true,
            similarity: cacheResult.similarity,
        };
    }
    const analysis = await analyzerFn(clauseText);
    storeInCache(clauseText, analysis, jurisdiction).catch(err => {
        console.error('[ClauseCache] Background store failed:', err);
    });
    return {
        analysis,
        cached: false,
    };
}
async function getCacheStats() {
    try {
        const stats = await prisma.$queryRawUnsafe(`
      SELECT
        COUNT(*) as total_entries,
        SUM(hit_count) as total_hits,
        MIN(created_at) as oldest_entry,
        MAX(created_at) as newest_entry
      FROM clause_cache
    `);
        const totalEntries = Number(stats[0]?.total_entries || 0);
        const totalHits = Number(stats[0]?.total_hits || 0);
        return {
            totalEntries,
            totalHits,
            hitRate: totalEntries > 0 ? `${((totalHits / (totalHits + totalEntries)) * 100).toFixed(1)}%` : '0%',
            avgSimilarity: 0,
            oldestEntry: stats[0]?.oldest_entry ? new Date(stats[0].oldest_entry) : null,
            newestEntry: stats[0]?.newest_entry ? new Date(stats[0].newest_entry) : null,
        };
    }
    catch (error) {
        console.error('[ClauseCache] Failed to get stats:', error);
        return {
            totalEntries: 0,
            totalHits: 0,
            hitRate: '0%',
            avgSimilarity: 0,
            oldestEntry: null,
            newestEntry: null,
        };
    }
}
async function cleanupCache(maxAgeDays = CACHE_TTL_DAYS) {
    try {
        const result = await prisma.$executeRawUnsafe(`
      DELETE FROM clause_cache
      WHERE last_used_at < datetime('now', '-${maxAgeDays} days')
    `);
        console.log(`[ClauseCache] Cleaned up old entries`);
        return typeof result === 'number' ? result : 0;
    }
    catch (error) {
        console.error('[ClauseCache] Cleanup failed:', error);
        return 0;
    }
}
async function clearCache() {
    try {
        await prisma.$executeRawUnsafe(`DELETE FROM clause_cache`);
        console.log('[ClauseCache] Cache cleared');
    }
    catch (error) {
        console.error('[ClauseCache] Clear failed:', error);
    }
}
setupClauseCacheTable().catch(console.error);
//# sourceMappingURL=clauseCache.js.map