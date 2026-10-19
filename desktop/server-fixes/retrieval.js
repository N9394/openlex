"use strict";
/**
 * RAG Retrieval Service
 *
 * Full-text search and retrieval using SQLite FTS5.
 * Supports hybrid search combining keyword and semantic similarity.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.search = search;
exports.searchClauses = searchClauses;
exports.searchUserDocuments = searchUserDocuments;
exports.searchJurisdiction = searchJurisdiction;
exports.getSimilarChunks = getSimilarChunks;
exports.hybridSearch = hybridSearch;
exports.smartSearch = smartSearch;
exports.enhancedSearch = enhancedSearch;
exports.searchWithExpansion = searchWithExpansion;
exports.searchMultiJurisdiction = searchMultiJurisdiction;
exports.getJurisdictionName = getJurisdictionName;
const client_1 = require("@prisma/client");
const embeddings_1 = require("./embeddings");
const queryExpansion_1 = require("./queryExpansion");
const reranker_1 = require("./reranker");
const llmAdapter_1 = require("../llmAdapter");
const searchAuditService_1 = require("../searchAuditService");
const prisma = new client_1.PrismaClient();
// ============================================================================
// CONFIGURATION
// ============================================================================
/** Maximum query length (characters) */
const MAX_QUERY_LENGTH = 1000;
/** Maximum results limit */
const MAX_LIMIT = 50;
/** Default results limit */
const DEFAULT_LIMIT = 5;
// Stop words for query cleaning
const STOP_WORDS = new Set([
    // English
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
    'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'must', 'shall', 'this', 'that', 'these', 'those',
    'what', 'which', 'who', 'whom', 'how', 'when', 'where', 'why',
    // German
    'der', 'die', 'das', 'ein', 'eine', 'und', 'oder', 'aber', 'für', 'mit',
    'von', 'zu', 'bei', 'nach', 'auf', 'aus', 'ist', 'sind', 'war', 'waren',
]);
// FTS5 special characters that need escaping
const FTS5_SPECIAL_CHARS = /["*]/g;
// ============================================================================
// INPUT VALIDATION & SANITIZATION
// ============================================================================
/**
 * Validate and sanitize search query
 */
function validateQuery(query) {
    if (!query || typeof query !== 'string') {
        return { valid: false, sanitized: '', error: 'Query must be a non-empty string' };
    }
    // Trim and check length
    const trimmed = query.trim();
    if (trimmed.length === 0) {
        return { valid: false, sanitized: '', error: 'Query cannot be empty' };
    }
    if (trimmed.length > MAX_QUERY_LENGTH) {
        return { valid: false, sanitized: '', error: `Query exceeds maximum length of ${MAX_QUERY_LENGTH} characters` };
    }
    // Sanitize FTS5 special characters
    const sanitized = trimmed.replace(FTS5_SPECIAL_CHARS, ' ');
    return { valid: true, sanitized };
}
/**
 * Validate and cap limit parameter
 */
function validateLimit(limit) {
    if (typeof limit !== 'number' || isNaN(limit) || limit < 1) {
        return DEFAULT_LIMIT;
    }
    return Math.min(limit, MAX_LIMIT);
}
/**
 * Search the RAG system
 *
 * @param query - The search query
 * @param options - Search options (filters, limits, etc.)
 * @returns Array of search results, or empty array on error
 */
async function search(query, options = {}) {
    const startTime = Date.now();
    try {
        // Validate input
        const validation = validateQuery(query);
        if (!validation.valid) {
            console.warn('[RAG] Invalid query:', validation.error);
            return [];
        }
        const { sourceTypes, jurisdiction, strictJurisdiction = true, // Default to strict - no NULL fallback
        language, documentType, clauseType, userId, orgId, auditContext, } = options;
        // Validate and cap limit
        const limit = validateLimit(options.limit);
        // Build FTS5 query from sanitized input
        const ftsQuery = buildFTSQuery(validation.sanitized);
        if (!ftsQuery) {
            return [];
        }
        // Build SQL with filters using parameterized queries
        // Note: We use $queryRawUnsafe here because FTS5 MATCH syntax requires
        // dynamic query construction. All user inputs are sanitized above.
        let sql = `
      SELECT
        r.id,
        r.content,
        r.source_name,
        r.source_url,
        r.jurisdiction,
        r.clause_type,
        r.created_at,
        r.updated_at,
        bm25(chunk_fts) as rank
      FROM rag_chunks r
      JOIN chunk_fts ON chunk_fts.rowid = r.rowid
      WHERE chunk_fts MATCH ?
    `;
        const params = [ftsQuery];
        // Access control: global OR user's own OR org's shared
        const accessConditions = ['r.is_global = 1'];
        if (userId) {
            accessConditions.push(`r.user_id = ?`);
            params.push(userId);
        }
        if (orgId) {
            accessConditions.push(`r.org_id = ?`);
            params.push(orgId);
        }
        sql += ` AND (${accessConditions.join(' OR ')})`;
        // Source type filter
        if (sourceTypes && sourceTypes.length > 0) {
            // Validate source types (whitelist approach)
            const validSourceTypes = sourceTypes.filter((t) => ['jurisdiction_kb', 'user_doc', 'case_law', 'legislation'].includes(t));
            if (validSourceTypes.length > 0) {
                sql += ` AND r.source_type IN (${validSourceTypes.map(() => '?').join(',')})`;
                params.push(...validSourceTypes);
            }
        }
        // Jurisdiction filter
        if (jurisdiction && typeof jurisdiction === 'string') {
            if (strictJurisdiction) {
                // Strict mode: only match exact jurisdiction (prevents cross-contamination)
                sql += ` AND r.jurisdiction = ?`;
            }
            else {
                // Lenient mode: also include records with NULL jurisdiction (universal content)
                sql += ` AND (r.jurisdiction = ? OR r.jurisdiction IS NULL)`;
            }
            params.push(jurisdiction);
            // Filter out mislabeled chunks (generic labels that don't identify the actual law)
            // These cause garbage results like "Fond Pro Slovakia" for company formation queries
            if (jurisdiction === 'SK') {
                sql += ` AND r.source_name NOT LIKE 'Zbierka zákonov%'`;
            }
            if (jurisdiction === 'AT') {
                sql += ` AND r.source_name NOT LIKE 'Austrian Law%'`;
            }
        }
        // Language filter
        if (language && typeof language === 'string') {
            sql += ` AND r.language = ?`;
            params.push(language);
        }
        // Document type filter
        if (documentType && typeof documentType === 'string') {
            sql += ` AND (r.document_type = ? OR r.document_type IS NULL)`;
            params.push(documentType);
        }
        // Clause type filter
        if (clauseType && typeof clauseType === 'string') {
            sql += ` AND r.clause_type = ?`;
            params.push(clauseType);
        }
        // Order and limit
        sql += ` ORDER BY rank LIMIT ?`;
        params.push(limit);
        const results = (await prisma.$queryRawUnsafe(sql, ...params));
        const mappedResults = results.map((r) => {
            const createdAt = r.created_at ? new Date(r.created_at) : undefined;
            const updatedAt = r.updated_at ? new Date(r.updated_at) : undefined;
            return {
                id: r.id,
                content: r.content,
                sourceName: r.source_name,
                sourceUrl: r.source_url,
                jurisdiction: r.jurisdiction,
                clauseType: r.clause_type,
                rank: Math.abs(r.rank), // BM25 returns negative values
                createdAt,
                updatedAt,
            };
        });
        // Log search for Big Law compliance (non-blocking)
        if (auditContext) {
            (0, searchAuditService_1.logSearch)({
                userId: auditContext.userId,
                organizationId: auditContext.organizationId,
                searchType: (auditContext.searchType || 'rag'),
                query: validation.sanitized,
                jurisdiction: jurisdiction,
                resultCount: mappedResults.length,
                caseId: auditContext.caseId,
                matterId: auditContext.matterId,
                pageUrl: auditContext.pageUrl,
                searchDuration: Date.now() - startTime,
                ipAddress: auditContext.ipAddress,
                userAgent: auditContext.userAgent,
                sessionId: auditContext.sessionId,
            }).catch((err) => {
                console.warn('[RAG] Failed to log search audit:', err);
            });
        }
        return mappedResults;
    }
    catch (error) {
        // Log error but don't crash - return empty results
        console.error('[RAG] Search error:', error instanceof Error ? error.message : error);
        return [];
    }
}
/**
 * Build FTS5 query from user input
 */
function buildFTSQuery(query) {
    // Clean and tokenize (preserve Slovak diacritics)
    const tokens = query
        .toLowerCase()
        .replace(/[^\w\säöüßÄÖÜáéíóúýčďěňřšťžľôä]/gi, ' ') // Keep German and Slovak characters
        .split(/\s+/)
        .filter((t) => t.length > 2)
        .filter((t) => !STOP_WORDS.has(t));
    if (tokens.length === 0) {
        return '';
    }
    // Use OR for flexibility since query expansion adds cross-language terms
    // Each term is a prefix search with *
    return tokens.map((t) => `${t}*`).join(' OR ');
}
/**
 * Search legislation and KB for legal context
 * (Formerly searchClauses - now searches real legislation instead of templates)
 */
async function searchClauses(query, options = {}) {
    return search(query, {
        ...options,
        sourceTypes: ['legislation', 'jurisdiction_kb'],
    });
}
/**
 * Search user's documents
 */
async function searchUserDocuments(userId, query, orgId) {
    return search(query, {
        sourceTypes: ['user_doc'],
        userId,
        orgId,
        limit: 10,
    });
}
/**
 * Search jurisdiction knowledge
 */
async function searchJurisdiction(query, jurisdiction) {
    return search(query, {
        sourceTypes: ['jurisdiction_kb'],
        jurisdiction,
        limit: 5,
    });
}
/**
 * Get similar chunks (for recommendations)
 */
async function getSimilarChunks(chunkId, limit = 5) {
    try {
        // Validate chunkId
        if (!chunkId || typeof chunkId !== 'string') {
            console.warn('[RAG] Invalid chunkId for getSimilarChunks');
            return [];
        }
        // Cap limit
        const cappedLimit = validateLimit(limit);
        // Get the chunk content
        const chunk = (await prisma.$queryRawUnsafe(`SELECT content, clause_type FROM rag_chunks WHERE id = ?`, chunkId));
        if (!chunk[0]) {
            return [];
        }
        // Extract key terms using the dedicated function for better matching
        const { extractKeyTerms } = await Promise.resolve().then(() => __importStar(require('./chunking')));
        const legalTerms = extractKeyTerms(chunk[0].content);
        // If legal terms found, use them; otherwise fall back to content words
        let searchQuery;
        if (legalTerms.length > 0) {
            searchQuery = legalTerms.join(' ');
        }
        else {
            // Fallback: extract significant words (length > 4, first 10)
            searchQuery = chunk[0].content
                .split(/\s+/)
                .filter((t) => t.length > 4 && !STOP_WORDS.has(t.toLowerCase()))
                .slice(0, 10)
                .join(' ');
        }
        if (!searchQuery) {
            return [];
        }
        return search(searchQuery, {
            clauseType: chunk[0].clause_type,
            limit: cappedLimit,
        });
    }
    catch (error) {
        console.error('[RAG] getSimilarChunks error:', error instanceof Error ? error.message : error);
        return [];
    }
}
/**
 * Perform hybrid search combining keyword (FTS5) and semantic (embedding) search
 *
 * Uses Reciprocal Rank Fusion (RRF) to combine rankings:
 * score = keywordWeight * (1 / (k + keywordRank)) + semanticWeight * (1 / (k + semanticRank))
 */
async function hybridSearch(query, options = {}) {
    const { keywordWeight = 0.5, semanticWeight = 0.5, minSimilarity = 0.3, rrfK = 60, limit = 10, semanticQuery, // Use translated query for semantic search if provided
    ...searchOptions } = options;
    // Use translated query for semantic search (better cross-language matching)
    const effectiveSemanticQuery = semanticQuery || query;
    // Run both searches in parallel
    const [keywordResults, semanticResults] = await Promise.all([
        search(query, { ...searchOptions, limit: limit * 2 }),
        (0, embeddings_1.semanticSearch)(effectiveSemanticQuery, {
            sourceTypes: searchOptions.sourceTypes,
            jurisdiction: searchOptions.jurisdiction,
            userId: searchOptions.userId,
            orgId: searchOptions.orgId,
            limit: limit * 2,
            minSimilarity,
        }),
    ]);
    // Build a map of all results by chunk ID
    const resultMap = new Map();
    // Add keyword results
    keywordResults.forEach((result, index) => {
        resultMap.set(result.id, {
            content: result.content,
            sourceName: result.sourceName,
            sourceUrl: result.sourceUrl,
            jurisdiction: result.jurisdiction,
            clauseType: result.clauseType,
            keywordRank: index + 1,
            // Phase 6: Currency fields
            sourceDate: result.sourceDate,
            lastVerified: result.lastVerified,
            expiresAt: result.expiresAt,
            isExpired: result.isExpired,
            daysUntilExpiry: result.daysUntilExpiry,
        });
    });
    // Add semantic results
    semanticResults.forEach((result, index) => {
        const existing = resultMap.get(result.chunkId);
        if (existing) {
            existing.semanticRank = index + 1;
            existing.semanticSimilarity = result.similarity;
        }
        else {
            resultMap.set(result.chunkId, {
                content: result.content,
                sourceName: result.sourceName,
                semanticRank: index + 1,
                semanticSimilarity: result.similarity,
            });
        }
    });
    // Calculate RRF scores
    const scoredResults = [];
    for (const [id, data] of Array.from(resultMap.entries())) {
        let score = 0;
        if (data.keywordRank !== undefined) {
            score += keywordWeight * (1 / (rrfK + data.keywordRank));
        }
        if (data.semanticRank !== undefined) {
            score += semanticWeight * (1 / (rrfK + data.semanticRank));
        }
        scoredResults.push({
            id,
            content: data.content,
            sourceName: data.sourceName,
            sourceUrl: data.sourceUrl,
            jurisdiction: data.jurisdiction,
            clauseType: data.clauseType,
            rank: 0, // Will be set after sorting
            score,
            keywordRank: data.keywordRank,
            semanticSimilarity: data.semanticSimilarity,
            // Phase 6: Currency fields
            sourceDate: data.sourceDate,
            lastVerified: data.lastVerified,
            expiresAt: data.expiresAt,
            isExpired: data.isExpired,
            daysUntilExpiry: data.daysUntilExpiry,
        });
    }
    // Sort by score descending
    scoredResults.sort((a, b) => b.score - a.score);
    // Assign final ranks and limit
    return scoredResults.slice(0, limit).map((result, index) => ({
        ...result,
        rank: index + 1,
    }));
}
/**
 * Smart search: uses hybrid search if embeddings are available, falls back to keyword
 */
async function smartSearch(query, options = {}) {
    try {
        // Try hybrid search first
        const results = await hybridSearch(query, options);
        // If we got results from both sources, return hybrid
        if (results.some((r) => r.semanticSimilarity !== undefined)) {
            console.log('[RAG] Using hybrid search (keyword + semantic)');
            return results;
        }
        // Fall back to keyword-only if no semantic results
        console.log('[RAG] Falling back to keyword search (no embeddings)');
        return search(query, options);
    }
    catch (error) {
        // If hybrid fails, fall back to keyword search
        console.warn('[RAG] Hybrid search failed, using keyword search:', error instanceof Error ? error.message : error);
        return search(query, options);
    }
}
// ============================================================================
// ENHANCED SEARCH (Phase 3)
// ============================================================================
/**
 * Law abbreviation to full name mapping for source-name boosting
 * When a query contains an abbreviation, results with matching source names are boosted
 */
const LAW_ABBREVIATION_BOOST = {
    // Austrian Laws
    MRG: ['Mietrechtsgesetz', 'Mietrecht'],
    KSchG: ['Konsumentenschutzgesetz', 'Konsumenten'],
    AngG: ['Angestelltengesetz', 'Angestellte'],
    ABGB: ['bürgerliches Gesetzbuch', 'Zivilrecht'],
    UGB: ['Unternehmensgesetzbuch', 'Unternehmens'],
    WEG: ['Wohnungseigentumsgesetz', 'Wohnungseigentum'],
    GmbHG: ['GmbH-Gesetz', 'Gesellschaft mit beschränkter'],
    AktG: ['Aktiengesetz', 'Aktien'],
    StGB: ['Strafgesetzbuch', 'Straf'],
    StPO: ['Strafprozessordnung', 'Strafprozess'],
    ZPO: ['Zivilprozessordnung', 'Zivilprozess'],
    DSGVO: ['Datenschutz-Grundverordnung', 'GDPR', 'Datenschutz'],
    DSG: ['Datenschutzgesetz', 'Datenschutz'],
    ArbVG: ['Arbeitsverfassungsgesetz', 'Arbeitsverfassung'],
    AZG: ['Arbeitszeitgesetz', 'Arbeitszeit'],
    UrlG: ['Urlaubsgesetz', 'Urlaub'],
    ASVG: ['Sozialversicherungsgesetz', 'Sozialversicherung'],
    FAGG: ['Fern- und Auswärtsgeschäfte', 'Fernabsatz'],
    // Slovak Laws - CRITICAL for Slovak jurisdiction queries
    ZP: ['Zákonník práce', 'Zákonník'],
    OZ: ['Občiansky zákonník', 'Občian'],
    TZ: ['Trestný zákon', 'Trestný'],
    TP: ['Trestný poriadok', 'poriadok'],
    ObchZ: ['Obchodný zákonník', 'obchodného zákonníka', 'obchodný'], // Commercial Code
    // Company formation specific - boost Obchodný zákonník for these terms
    'COMPANY': ['Obchodný zákonník', 'spoločnosť', 'založenie'],
    'FORMATION': ['Obchodný zákonník', 'založenie', 'vznik'],
    'SRO': ['Obchodný zákonník', 's.r.o.', 'spoločnosť s ručením obmedzeným'],
};

/**
 * HyDE: Generate a hypothetical legal document passage for better embedding search.
 * Instead of embedding the user's casual query, we embed what the ideal statute text
 * would look like — dramatically improving cross-language and colloquial query matching.
 */
// Language map removed — tool router handles target-language query generation
// translateQuery removed — tool router generates queries in target language directly

/**
 * Extract core legal concept from a multi-jurisdiction comparison query.
 * Strips jurisdiction names, comparison framing, and question phrasing via LLM.
 * Returns a clean concept string for the cross-encoder reranker.
 */
async function extractLegalConcept(query) {
    try {
        const prompt = `/no_think\nExtract the core legal concept from this query. Remove all jurisdiction names, country names, comparison language (vs, compared to), and question phrasing (what are, how does). Return ONLY a short phrase (5-15 words).

Query: "${query}"

Core legal concept:`;
        const result = await (0, llmAdapter_1.callLLM)(
            [{ role: 'user', content: prompt }],
            { taskType: 'claim_regeneration', maxTokens: 50, useFastModel: false, temperature: 0 }
        );
        const concept = (result || '').trim().replace(/^["']|["']$/g, '').trim();
        if (!concept || concept.length < 5 || concept.length > 200) {
            console.log(`[ConceptExtraction] Failed (bad length: ${concept.length}), using original query`);
            return null;
        }
        console.log(`[ConceptExtraction] "${query.substring(0, 60)}..." → "${concept}"`);
        return concept;
    } catch (err) {
        console.warn(`[ConceptExtraction] LLM call failed: ${err.message}, using original query`);
        return null;
    }
}

async function enhancedSearch(query, options = {}) {
    // minRerankScore default lowered 0.01 → 0.001: only truly irrelevant
    // (near-zero score) gets dropped. We keep up to `limit` of the top
    // results regardless of absolute score — the LLM judge downstream can
    // decide which actually back claims, the UI shows all with badges.
    const { expandQuery: shouldExpand = true, rerank = true, minRerankScore = 0.001, rerankContext, limit = 10, ...searchOptions } = options;
    console.log('[RAG] Enhanced search starting...');
    // Step 1: Query expansion (with jurisdiction for cross-language support)
    let searchQuery = query;
    let expandedTerms;
    let semanticQuery = query; // Separate query for semantic search
        // No translation — callers (tool router, M&A pipeline) generate queries in target language directly

    // Step 2: Hybrid search — wide funnel of 60 candidates per the user's
    // preference: "give reranker more to chew through, then rank, only
    // throw out truly irrelevant stuff." Was limit*4 capped at 60; now
    // a hard floor of 60 even when caller asked for limit=10.
    const fetchLimit = rerank ? Math.max(60, Math.min(limit * 6, 80)) : limit;
    let hybridResults = await hybridSearch(searchQuery, {
        ...searchOptions,
        semanticQuery, // HyDE doc or translated query for semantic search
        limit: fetchLimit,
    });
    if (hybridResults.length === 0) {
        console.log('[RAG] No results found');
        return [];
    }
    console.log(`[RAG] Hybrid search returned ${hybridResults.length} results`);
    // Step 2.5: Apply source-name boosting for law abbreviations
    // If query contains a law abbreviation (MRG, KSchG, etc.), boost results whose
    // source name matches the full law name
    const queryUpper = query.toUpperCase();
    const detectedAbbreviations = [];
    for (const [abbrev, fullNames] of Object.entries(LAW_ABBREVIATION_BOOST)) {
        if (queryUpper.includes(abbrev)) {
            detectedAbbreviations.push(abbrev);
            // Boost matching results by modifying their score
            hybridResults = hybridResults.map(result => {
                const sourceLower = result.sourceName.toLowerCase();
                const matches = fullNames.some(name => sourceLower.includes(name.toLowerCase()));
                if (matches) {
                    // Boost the score significantly (multiply by 2)
                    return {
                        ...result,
                        score: result.score * 2,
                        keywordRank: result.keywordRank ? Math.max(1, result.keywordRank - 5) : undefined,
                    };
                }
                return result;
            });
        }
    }
    if (detectedAbbreviations.length > 0) {
        console.log(`[RAG] Boosting results for law abbreviations: ${detectedAbbreviations.join(', ')}`);
        // Re-sort after boosting
        hybridResults.sort((a, b) => b.score - a.score);
    }
    // Step 3: Reranking (optional, adds latency but improves precision)
    if (rerank && hybridResults.length > 3) {
        try {
            console.log('[RAG] Reranking results...');
            const reranked = await (0, reranker_1.rerankResults)(semanticQuery || query, hybridResults, {
                topK: fetchLimit,  // Get more than needed so we can filter intelligently
                minScore: minRerankScore,
                context: rerankContext,
            });
            // Return ALL non-irrelevant sources (score >= 0.001 cuts only
            // pure garbage). The downstream LLM uses the first ~10 in its
            // prompt context; the UI shows the whole list with a "Show
            // all" expand button. Hiding sources we DID retrieve was the
            // bug — user only ever saw 3.
            const TRULY_IRRELEVANT = 0.001;
            let filtered = reranked.filter(r => (r.rerankScore || 0) >= TRULY_IRRELEVANT);
            if (filtered.length === 0 && reranked.length > 0) {
                filtered = reranked.slice(0, Math.min(3, reranked.length));
                console.log('[RAG] All scores below ' + TRULY_IRRELEVANT + ', falling back to top 3');
            }
            console.log(`[RAG] Reranking complete: ${reranked.length} scored, ${filtered.length} non-irrelevant returned (top: ${(filtered[0]?.rerankScore || 0).toFixed(4)}, bottom: ${(filtered[filtered.length-1]?.rerankScore || 0).toFixed(4)})`);
            return filtered.map((r) => ({
                ...r,
                expandedTerms,
            }));
        }
        catch (error) {
            console.warn('[RAG] Reranking failed, using hybrid results:', error instanceof Error ? error.message : error);
        }
    }
    // Return hybrid results without reranking
    return hybridResults.slice(0, limit).map((r, i) => ({
        ...r,
        expandedTerms,
        originalRank: i + 1,
    }));
}
/**
 * Search with automatic language detection and expansion
 * Best for user-facing search where query language may vary
 */
async function searchWithExpansion(query, options = {}) {
    const expanded = (0, queryExpansion_1.expandQuery)(query, {
        jurisdiction: options.jurisdiction, // Pass jurisdiction for cross-language expansion
    });
    console.log('[RAG] Expanded query:', expanded.expanded);
    console.log('[RAG] Synonyms used:', expanded.synonymsUsed);
    // Use expanded query for search
    return search(expanded.expanded, options);
}
/** Human-readable jurisdiction names */
const JURISDICTION_NAMES = {
    'US': 'United States',
    'US-CA': 'California',
    'AT': 'Austria',
    'DE': 'Germany',
    'SK': 'Slovakia',
    'RO': 'Romania',
    'UK': 'United Kingdom',
    'EW': 'England & Wales',
    'SC': 'Scotland',
    'NI': 'Northern Ireland',
    'FR': 'France',
    'CH': 'Switzerland',
    'CZ': 'Czech Republic',
    'CY': 'Cyprus',
    'ZA': 'South Africa',
    'EU': 'European Union',
    'NL': 'Netherlands',
    'HU': 'Hungary',
    'IT': 'Italy',
    'INTL': 'International',
};
/**
 * Search across multiple jurisdictions in parallel
 *
 * This is the core function for cross-jurisdictional legal research.
 * It searches each jurisdiction separately and returns results grouped by jurisdiction.
 *
 * @param query - The search query
 * @param jurisdictions - Array of jurisdiction codes to search
 * @param options - Search options (applied to all jurisdictions)
 * @returns Results grouped by jurisdiction
 */
async function searchMultiJurisdiction(query, jurisdictions, options = {}) {
    if (!jurisdictions || jurisdictions.length === 0) {
        console.warn('[RAG] searchMultiJurisdiction called with no jurisdictions');
        return [];
    }
    // Single jurisdiction: delegate directly to enhancedSearch (no merge needed)
    if (jurisdictions.length === 1) {
        const jurisdiction = jurisdictions[0];
        console.log(`[RAG] Single-jurisdiction search: "${query}" in ${jurisdiction}`);
        const startTime = Date.now();
        try {
            const results = await enhancedSearch(query, {
                ...options,
                jurisdiction,
                limit: options.limit || 10,
            });
            console.log(`[RAG] Single-jurisdiction search complete: ${results.length} results in ${Date.now() - startTime}ms`);
            return [{
                jurisdiction,
                jurisdictionName: JURISDICTION_NAMES[jurisdiction] || jurisdiction,
                results,
                totalCount: results.length,
            }];
        } catch (error) {
            console.error(`[RAG] Error searching ${jurisdiction}:`, error);
            return [{
                jurisdiction,
                jurisdictionName: JURISDICTION_NAMES[jurisdiction] || jurisdiction,
                results: [],
                totalCount: 0,
            }];
        }
    }
    // Multi-jurisdiction: single-batch rerank to avoid Flask contention
    console.log(`[RAG] Multi-jurisdiction search: "${query}" across ${jurisdictions.join(', ')}`);
    const startTime = Date.now();
    const perJurisdictionLimit = Math.min(60, Math.floor(120 / jurisdictions.length));
    // Step 1: Run hybrid search (no reranking) for each jurisdiction in parallel
    // This is fast — translation + embedding + Qdrant + abbreviation boost, no Flask reranker
    // Run concept extraction IN PARALLEL with per-jurisdiction searches (zero added latency)
    const searchPromises = jurisdictions.map(async (jurisdiction) => {
        try {
            const results = await enhancedSearch(query, {
                ...options,
                jurisdiction,
                rerank: false,
                limit: perJurisdictionLimit,
            });
            return { jurisdiction, results };
        }
        catch (error) {
            console.error(`[RAG] Error in hybrid search for ${jurisdiction}:`, error);
            return { jurisdiction, results: [] };
        }
    });
    const [conceptResult, ...searchResults] = await Promise.all([
        extractLegalConcept(query),
        ...searchPromises,
    ]);
    const perJurisdiction = searchResults;
    // Step 2: Merge all candidates into one array (preserve jurisdiction tag)
    const allCandidates = [];
    for (const { jurisdiction, results } of perJurisdiction) {
        for (const r of results) {
            allCandidates.push({ ...r, _srcJurisdiction: jurisdiction });
        }
    }
    if (allCandidates.length === 0) {
        console.log('[RAG] Multi-jurisdiction search: no candidates found');
        return jurisdictions.map((j) => ({
            jurisdiction: j,
            jurisdictionName: JURISDICTION_NAMES[j] || j,
            results: [],
            totalCount: 0,
        }));
    }
    console.log(`[RAG] Merged ${allCandidates.length} candidates from ${jurisdictions.length} jurisdictions, reranking in single batch...`);
    // Step 3: One rerank call on the merged batch
    // Use LLM-extracted concept for reranker query (clean legal concept without jurisdiction names)
    const rerankQuery = conceptResult || query;
    console.log(`[RAG] Rerank query: "${rerankQuery.substring(0, 80)}"${conceptResult ? ' [concept-extracted]' : ' [fallback-original]'}`);
    let finalCandidates = allCandidates;
    if (allCandidates.length > 3) {
        try {
            const reranked = await (0, reranker_1.rerankResults)(rerankQuery, allCandidates, {
                topK: allCandidates.length,
                minScore: 0.001,
            });
            // Same strategy as enhancedSearch: kill only truly irrelevant
            // (score < 0.001), keep enough for downstream allocation
            // across jurisdictions. We don't `slice(0, limit)` here because
            // the per-jurisdiction split below caps to `min(limit/N, 3)`
            // per jurisdiction anyway.
            const TRULY_IRRELEVANT = 0.001;
            let filtered = reranked.filter((r) => (r.rerankScore || 0) >= TRULY_IRRELEVANT);
            if (filtered.length === 0 && reranked.length > 0) {
                filtered = reranked.slice(0, Math.min(3, reranked.length));
                console.log(`[RAG] All scores below ${TRULY_IRRELEVANT}, falling back to top 3`);
            }
            console.log(`[RAG] Batch rerank: ${reranked.length} scored, ${filtered.length} non-irrelevant (top: ${(filtered[0]?.rerankScore || 0).toFixed(4)})`);
            finalCandidates = filtered;
        } catch (error) {
            console.warn('[RAG] Batch reranking failed, using hybrid results:', error instanceof Error ? error.message : error);
        }
    }
    // Step 4: Split back by jurisdiction with minimum/maximum representation guarantee
    const resultMap = {};
    for (const j of jurisdictions) {
        resultMap[j] = [];
    }
    const resultLimit = options.limit || 10;
    const MIN_PER_JURISDICTION = 3; // Guarantee each jurisdiction gets representation
    // Cap per jurisdiction so no single jurisdiction dominates (e.g., US federal with 218K chunks)
    const MAX_PER_JURISDICTION = Math.max(
        MIN_PER_JURISDICTION + 1,
        Math.ceil(resultLimit / jurisdictions.length) + 3
    );
    // First pass: split reranked results by jurisdiction (capped per-jurisdiction)
    for (const r of finalCandidates) {
        const j = r._srcJurisdiction || r.jurisdiction;
        if (resultMap[j] && resultMap[j].length < MAX_PER_JURISDICTION) {
            resultMap[j].push(r);
        }
    }
    // Second pass: if any jurisdiction has < MIN_PER_JURISDICTION results but had candidates, pull from pre-rerank pool
    for (const { jurisdiction, results: rawResults } of perJurisdiction) {
        if (resultMap[jurisdiction].length < MIN_PER_JURISDICTION && rawResults.length > 0) {
            const existing = new Set(resultMap[jurisdiction].map(r => r.id || r.title));
            const extras = rawResults
                .filter(r => !existing.has(r.id || r.title))
                .slice(0, MIN_PER_JURISDICTION - resultMap[jurisdiction].length);
            if (extras.length > 0) {
                console.log(`[RAG] Backfilling ${extras.length} results for ${jurisdiction} (had ${resultMap[jurisdiction].length}, min ${MIN_PER_JURISDICTION})`);
                resultMap[jurisdiction].push(...extras);
            }
        }
    }
    const totalResults = Object.values(resultMap).reduce((sum, arr) => sum + arr.length, 0);
    const perJurCounts = jurisdictions.map(j => `${j}:${resultMap[j].length}`).join(', ');
    console.log(`[RAG] Multi-jurisdiction search complete: ${totalResults} results (${perJurCounts}) in ${Date.now() - startTime}ms`);
    // Step 5: Format and sort
    const results = jurisdictions.map((j) => ({
        jurisdiction: j,
        jurisdictionName: JURISDICTION_NAMES[j] || j,
        results: resultMap[j],
        totalCount: resultMap[j].length,
    }));
    return results.sort((a, b) => {
        if (a.totalCount > 0 && b.totalCount === 0)
            return -1;
        if (b.totalCount > 0 && a.totalCount === 0)
            return 1;
        return jurisdictions.indexOf(a.jurisdiction) - jurisdictions.indexOf(b.jurisdiction);
    });
}
/**
 * Get jurisdiction name from code
 */
function getJurisdictionName(code) {
    return JURISDICTION_NAMES[code] || code;
}
