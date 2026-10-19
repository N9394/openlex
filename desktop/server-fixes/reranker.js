"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rerankResults = rerankResults;
exports.isResultRelevant = isResultRelevant;

const MIN_RERANK_SCORE = 0.01;

// ─── LLM reranker — OpenRouter (cloud) OR local llama-server (App) ───
// Same prompt, same parsing, same scoring. Just the endpoint differs:
//   - cloud (production server, OPENROUTER_API_KEY set): OpenRouter qwen3.5-9b, ~3-5s
//   - App (LOCAL_LLM_URL set, no OpenRouter): local llama-server via OpenAI-
//     compatible /v1/chat/completions. Same model family (Qwen3.5-9B Q4_K_M).
//     Latency depends on the user's hardware — at 73 tok/s that's ~2-4s for
//     30 docs of ranking output. With Q8 KV cache idle-unloaded we eat the
//     ~10s warmup once per idle window.

async function rerankWithLLM(query, documents) {
    const useLocal = !process.env.OPENROUTER_API_KEY;
    const localUrl = process.env.OLLAMA_BASE_URL || process.env.LOCAL_LLM_URL || 'http://127.0.0.1:11434';
    const apiKey = process.env.OPENROUTER_API_KEY || '';
    const model = useLocal
        ? (process.env.OLLAMA_MODEL || 'local')
        : (process.env.OPENROUTER_MODEL || 'qwen/qwen3.5-9b');
    const endpoint = useLocal
        ? `${localUrl}/v1/chat/completions`
        : 'https://openrouter.ai/api/v1/chat/completions';
    const backend = useLocal ? 'llm-local' : 'llm-openrouter';

    // Cap at 30 docs — more than that overwhelms the LLM and exceeds token limits
    const MAX_LLM_RERANK = 30;
    const docsToScore = documents.slice(0, MAX_LLM_RERANK);

    // Build compact document list: source_name + first 200 chars of content
    const docList = docsToScore.map((d, i) => {
        const name = d.sourceName || 'Unknown';
        const snippet = (d.content || '').slice(0, 200).replace(/\n/g, ' ');
        return `${i + 1}. [${name}]: ${snippet}`;
    }).join('\n');

    const prompt = `User question: "${query}"

Which documents help answer this? Include related laws (definitions, licensing, exemptions, penalties, cross-references). Return ONLY numbers as JSON array, most relevant first. Return [] if none are relevant.

${docList}

Numbers only: [`;

    // Scale max_tokens: ~5 tokens per score + buffer
    const maxTokens = Math.max(100, docsToScore.length * 6 + 20);

    const headers = { 'Content-Type': 'application/json' };
    if (!useLocal) headers['Authorization'] = `Bearer ${apiKey}`;

    const body = {
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        max_tokens: maxTokens,
    };
    // OpenRouter accepts the reasoning hint; local llama-server ignores it.
    if (!useLocal) {
        body.reasoning = { effort: 'none' };
        body.provider = { order: ['Together', 'Venice'], allow_fallbacks: true };
    }

    // Local LLM gets a longer timeout because rerank may queue behind the
    // answering call. 30s is fine for cloud; 60s for the slower local case.
    const timeout = useLocal ? 60_000 : 30_000;

    const t0 = Date.now();
    const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeout),
    });

    const data = await response.json();
    if (!response.ok) {
        throw new Error(`${backend} ${response.status}: ${data.error?.message || response.statusText}`);
    }

    // Parse the selected document indices from response
    const text = data.choices?.[0]?.message?.content || '';

    // Extract JSON array of numbers — response may start with just numbers (we prefixed "[")
    const fullText = '[' + text; // We ended the prompt with "Numbers only: ["

    // Handle empty array: LLM returned "]" meaning no relevant docs
    const emptyMatch = fullText.match(/\[\s*\]/);
    if (emptyMatch) {
        console.log(`[Reranker] LLM found no relevant docs from ${docsToScore.length}`);
        // Return all docs with score 0
        const allResults = documents.map((_, i) => ({ index: i, score: 0 }));
        const elapsed = Date.now() - t0;
        console.log(`[Reranker] LLM | ${docsToScore.length}/${documents.length} docs scored | ${(elapsed / 1000).toFixed(1)}s | no relevant`);
        return { results: allResults, backend };
    }

    // Extract all integers from the response — tolerant of non-numeric junk,
    // truncated responses (no closing ]), and out-of-range numbers
    const allNumbers = fullText.match(/\b\d+\b/g);
    if (!allNumbers || allNumbers.length === 0) {
        console.log(`[Reranker] LLM returned no parseable numbers from ${docsToScore.length} docs`);
        const allResults = documents.map((_, i) => ({ index: i, score: 0 }));
        const elapsed = Date.now() - t0;
        console.log(`[Reranker] LLM | ${docsToScore.length}/${documents.length} docs scored | ${(elapsed / 1000).toFixed(1)}s | no parseable`);
        return { results: allResults, backend };
    }

    const selectedIndices = allNumbers
        .map(s => parseInt(s, 10))
        .filter(n => !isNaN(n) && n >= 1 && n <= docsToScore.length)
        .map(n => n - 1); // Convert 1-indexed to 0-indexed

    console.log(`[Reranker] LLM selected ${selectedIndices.length} relevant docs from ${docsToScore.length}`);

    // Assign decreasing scores based on selection order
    // First selected = 1.0, second = 0.9, etc.
    const allResults = [];
    const selectedSet = new Set();
    for (let rank = 0; rank < selectedIndices.length; rank++) {
        const idx = selectedIndices[rank];
        if (selectedSet.has(idx)) continue; // skip duplicates
        selectedSet.add(idx);
        const score = Math.max(0.1, 1.0 - rank * 0.05); // 1.0, 0.95, 0.90, ...
        allResults.push({ index: idx, score });
    }
    // Unselected docs get score 0
    for (let i = 0; i < documents.length; i++) {
        if (!selectedSet.has(i)) {
            allResults.push({ index: i, score: 0 });
        }
    }

    allResults.sort((a, b) => b.score - a.score);

    const elapsed = Date.now() - t0;
    const cost = data.usage?.cost || 0;
    const tokens = data.usage?.total_tokens || 0;
    console.log(`[Reranker] LLM | ${docsToScore.length}/${documents.length} docs scored | ${(elapsed / 1000).toFixed(1)}s | ${tokens} tok | $${cost.toFixed(6)} | top: ${allResults[0]?.score?.toFixed(4) || 'N/A'}`);

    return { results: allResults, backend: 'llm-openrouter' };
}

// ─── Main rerank function ───

async function rerankResults(query, results, options = {}) {
    const { topK = 10, minScore = MIN_RERANK_SCORE, context } = options;

    if (results.length === 0) return [];

    if (results.length <= 2) {
        return results.map((r, i) => ({
            ...r,
            relevanceScore: 10 - i,
            rerankScore: 1.0,
            originalRank: i + 1,
        }));
    }

    const documents = results.map((r, i) => ({
        index: i,
        content: r.content || r.excerpt || '',
        sourceName: r.sourceName,
    }));

    let rerankerResults;
    let backend;

    try {
        const llmData = await rerankWithLLM(query, documents);
        rerankerResults = llmData.results;
        backend = llmData.backend;
    } catch (err) {
        console.warn('[Reranker] LLM reranker failed:', err instanceof Error ? err.message : err);
        // Final fallback: return original order (RRF scores)
        return results.slice(0, topK).map((r, i) => ({
            ...r,
            relevanceScore: 10 - i,
            rerankScore: null,
            originalRank: i + 1,
        }));
    }

    const filtered = rerankerResults.filter(r => r.score >= minScore);
    console.log(`[Reranker] ${filtered.length}/${rerankerResults.length} above threshold ${minScore} (${backend})`);

    const reranked = filtered.map((r, newRank) => {
        const original = results[r.index];
        return {
            ...original,
            relevanceScore: Math.round(r.score * 1000),
            rerankScore: r.score,
            originalRank: r.index + 1,
            newRank: newRank + 1,
        };
    });

    return reranked.slice(0, topK);
}

async function isResultRelevant(query, result, threshold = MIN_RERANK_SCORE) {
    try {
        const llmData = await rerankWithLLM(query, [{ content: result.content || result.excerpt || '', sourceName: result.sourceName || 'Unknown' }]);
        if (llmData.results && llmData.results.length > 0) {
            return llmData.results[0].score >= threshold;
        }
        return true;
    } catch {
        return true;
    }
}
