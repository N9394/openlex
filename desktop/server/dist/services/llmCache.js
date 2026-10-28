"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCachedResponse = getCachedResponse;
exports.setCachedResponse = setCachedResponse;
exports.clearExpiredEntries = clearExpiredEntries;
exports.clearCache = clearCache;
exports.getCacheStats = getCacheStats;
exports.invalidateByTaskType = invalidateByTaskType;
exports.invalidateByContent = invalidateByContent;
const crypto_1 = __importDefault(require("crypto"));
const cache = new Map();
const CACHE_TTL = {
    clause_extraction: 12 * 60 * 60 * 1000,
    document_analysis: 12 * 60 * 60 * 1000,
    risk_assessment: 8 * 60 * 60 * 1000,
    entity_extraction: 12 * 60 * 60 * 1000,
    deadline_extraction: 12 * 60 * 60 * 1000,
    rights_extraction: 12 * 60 * 60 * 1000,
    legal_explanation: 3 * 60 * 60 * 1000,
    research_synthesis: 4 * 60 * 60 * 1000,
    chat: 30 * 60 * 1000,
    archivist_action: 15 * 60 * 1000,
    default: 1 * 60 * 60 * 1000,
};
const MAX_CACHE_SIZE = 500;
let cacheHits = 0;
let cacheMisses = 0;
function generateCacheKey(messages, options) {
    const normalizedMessages = messages.map(m => ({
        role: m.role,
        content: m.content.trim().toLowerCase().substring(0, 5000)
    }));
    const keyData = {
        messages: normalizedMessages,
        taskType: options.taskType || 'default',
        model: options.model || 'default',
        temperature: Math.round((options.temperature || 0) * 10) / 10
    };
    const hash = crypto_1.default
        .createHash('sha256')
        .update(JSON.stringify(keyData))
        .digest('hex')
        .substring(0, 32);
    return `llm:${hash}`;
}
function getCachedResponse(messages, options = {}) {
    const key = generateCacheKey(messages, options);
    const entry = cache.get(key);
    if (!entry) {
        cacheMisses++;
        return null;
    }
    if (Date.now() > entry.expiresAt) {
        cache.delete(key);
        cacheMisses++;
        return null;
    }
    entry.hitCount++;
    cacheHits++;
    console.log(`[CACHE] Hit for ${options.taskType || 'unknown'} (hits: ${entry.hitCount})`);
    return entry.output;
}
function setCachedResponse(messages, output, options = {}) {
    const key = generateCacheKey(messages, options);
    const taskType = options.taskType || 'default';
    const ttl = CACHE_TTL[taskType] || CACHE_TTL.default;
    if (cache.size >= MAX_CACHE_SIZE) {
        evictOldestEntries(MAX_CACHE_SIZE / 10);
    }
    const entry = {
        inputHash: key,
        output,
        model: options.model || 'default',
        taskType,
        timestamp: Date.now(),
        hitCount: 0,
        expiresAt: Date.now() + ttl
    };
    cache.set(key, entry);
    console.log(`[CACHE] Stored response for ${taskType} (ttl: ${ttl / 1000}s)`);
}
function evictOldestEntries(count) {
    const entries = Array.from(cache.entries())
        .sort(([, a], [, b]) => {
        if (Date.now() > a.expiresAt)
            return -1;
        if (Date.now() > b.expiresAt)
            return 1;
        if (a.hitCount !== b.hitCount)
            return a.hitCount - b.hitCount;
        return a.timestamp - b.timestamp;
    });
    for (let i = 0; i < Math.min(count, entries.length); i++) {
        cache.delete(entries[i][0]);
    }
    console.log(`[CACHE] Evicted ${count} entries`);
}
function clearExpiredEntries() {
    const now = Date.now();
    let cleared = 0;
    for (const [key, entry] of cache.entries()) {
        if (now > entry.expiresAt) {
            cache.delete(key);
            cleared++;
        }
    }
    if (cleared > 0) {
        console.log(`[CACHE] Cleared ${cleared} expired entries`);
    }
    return cleared;
}
function clearCache() {
    const size = cache.size;
    cache.clear();
    cacheHits = 0;
    cacheMisses = 0;
    console.log(`[CACHE] Cleared all ${size} entries`);
}
function getCacheStats() {
    const total = cacheHits + cacheMisses;
    return {
        hits: cacheHits,
        misses: cacheMisses,
        entries: cache.size,
        hitRate: total > 0 ? cacheHits / total : 0
    };
}
function invalidateByTaskType(taskType) {
    let invalidated = 0;
    for (const [key, entry] of cache.entries()) {
        if (entry.taskType === taskType) {
            cache.delete(key);
            invalidated++;
        }
    }
    console.log(`[CACHE] Invalidated ${invalidated} entries for ${taskType}`);
    return invalidated;
}
function invalidateByContent(searchText) {
    const normalizedSearch = searchText.toLowerCase();
    let invalidated = 0;
    for (const [key, entry] of cache.entries()) {
        if (entry.output.toLowerCase().includes(normalizedSearch)) {
            cache.delete(key);
            invalidated++;
        }
    }
    console.log(`[CACHE] Invalidated ${invalidated} entries containing "${searchText.substring(0, 20)}..."`);
    return invalidated;
}
setInterval(() => {
    clearExpiredEntries();
}, 5 * 60 * 1000);
exports.default = {
    getCachedResponse,
    setCachedResponse,
    clearExpiredEntries,
    clearCache,
    getCacheStats,
    invalidateByTaskType,
    invalidateByContent,
};
//# sourceMappingURL=llmCache.js.map