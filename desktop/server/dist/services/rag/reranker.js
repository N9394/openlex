"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rerankResults = rerankResults;
exports.isResultRelevant = isResultRelevant;

const EMBEDDINGS_URL = process.env.EMBEDDINGS_URL || 'http://localhost:11435';
const RERANK_TIMEOUT = 120000;
const MIN_RERANK_SCORE = 0.01;  // Binary relevance threshold  // Higher threshold - only truly relevant sources  // BGE reranker threshold (keeps ~2x spread above irrelevant)

async function rerankResults(query, results, options = {}) {
    const { topK = 10, minScore = MIN_RERANK_SCORE, context } = options;

    if (results.length === 0) {
        return [];
    }

    // Skip reranking for very few results
    if (results.length <= 2) {
        return results.map((r, i) => ({
            ...r,
            relevanceScore: 10 - i,
            rerankScore: 1.0,
            originalRank: i + 1,
        }));
    }

    try {
        console.log(`[Reranker] Sending ${results.length} results to BGE reranker...`);

        // Prepare documents for reranking
        const documents = results.map((r, i) => ({
            index: i,
            content: r.content || r.excerpt || '',
            sourceName: r.sourceName,
        }));

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), RERANK_TIMEOUT);

        const response = await fetch(`${EMBEDDINGS_URL}/api/rerank`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                query: query,
                documents: documents,
                threshold: minScore,
            }),
            signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!response.ok) {
            throw new Error(`Reranker error: ${response.status}`);
        }

        const data = await response.json();
        console.log(`[Reranker] BGE returned ${data.results?.length || 0} results above threshold ${minScore}`);

        // Map reranked results back to original format
        const reranked = data.results.map((r, newRank) => {
            const original = results[r.index];
            return {
                ...original,
                relevanceScore: Math.round(r.score * 1000),  // Scale for compatibility
                rerankScore: r.score,
                originalRank: r.index + 1,
                newRank: newRank + 1,
            };
        });

        // Already sorted by rerank_score, just take topK
        return reranked.slice(0, topK);

    } catch (error) {
        console.warn('[Reranker] BGE reranker failed, falling back to original order:', error instanceof Error ? error.message : error);

        // Fallback: return original order with default scores
        return results.slice(0, topK).map((r, i) => ({
            ...r,
            relevanceScore: 10 - i,
            rerankScore: null,
            originalRank: i + 1,
        }));
    }
}

async function isResultRelevant(query, result, threshold = MIN_RERANK_SCORE) {
    try {
        const response = await fetch(`${EMBEDDINGS_URL}/api/rerank`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                query: query,
                documents: [{ content: result.content || result.excerpt || '' }],
                threshold: 0,  // Get score even if low
            }),
        });

        if (!response.ok) {
            return true;  // Assume relevant if reranker fails
        }

        const data = await response.json();
        if (data.results && data.results.length > 0) {
            return data.results[0].rerank_score >= threshold;
        }
        return true;
    } catch {
        return true;  // Assume relevant on error
    }
}
