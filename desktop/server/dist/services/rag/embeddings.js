"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateEmbedding = generateEmbedding;
exports.generateEmbeddings = generateEmbeddings;
exports.storeEmbedding = storeEmbedding;
exports.getEmbedding = getEmbedding;
exports.deleteEmbedding = deleteEmbedding;
exports.deleteEmbeddingsForDocument = deleteEmbeddingsForDocument;
exports.cosineSimilarity = cosineSimilarity;
exports.findSimilarChunks = findSimilarChunks;
exports.semanticSearch = semanticSearch;
exports.checkEmbeddingsHealth = checkEmbeddingsHealth;
exports.getEmbeddingStats = getEmbeddingStats;
const client_1 = require("@prisma/client");
const crypto_1 = require("crypto");
const prisma = new client_1.PrismaClient();

// Config
const OLLAMA_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const EMBEDDINGS_URL = process.env.EMBEDDINGS_URL || 'http://172.17.0.1:11435';
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "snowflake-arctic-embed2";
const EMBEDDING_DIM = 1024;
const MAX_EMBED_TEXT_LENGTH = 8000;
const BATCH_SIZE = 10;
const QDRANT_URL = process.env.QDRANT_URL || "http://127.0.0.1:6333";
const QDRANT_COLLECTION = process.env.QDRANT_COLLECTION || "legal_chunks_hybrid_v2";
const USE_HYBRID = process.env.USE_HYBRID_SEARCH !== "false"; // default true

/**
 * Generate dense embedding via BGE-M3 (embeddings service, 1024d)
 * Falls back to Ollama/Arctic if embeddings service unavailable
 */
async function generateEmbedding(text) {
    const truncatedText = text.slice(0, MAX_EMBED_TEXT_LENGTH);
    // Primary: BGE-M3 dense via embeddings service
    try {
        const response = await fetch(`${EMBEDDINGS_URL}/api/dense`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: truncatedText }),
            signal: AbortSignal.timeout(30000),
        });
        if (response.ok) {
            const data = await response.json();
            if (data.embedding && Array.isArray(data.embedding) && data.embedding.length === 1024) {
                return data.embedding;
            }
        }
        console.warn('[Embeddings] BGE-M3 dense response invalid, falling back to Ollama');
    } catch (e) {
        console.warn('[Embeddings] BGE-M3 dense error:', e instanceof Error ? e.message : e);
    }
    // Fallback: Ollama/Arctic
    try {
        const response = await fetch(`${OLLAMA_URL}/api/embeddings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: EMBEDDING_MODEL,
                prompt: truncatedText,
            }),
        });
        if (!response.ok) {
            console.error('[Embeddings] Ollama fallback error:', response.status);
            return null;
        }
        const data = (await response.json());
        if (!data.embedding || !Array.isArray(data.embedding)) {
            console.error('[Embeddings] Invalid Ollama response format');
            return null;
        }
        console.log('[Embeddings] Used Ollama/Arctic fallback for dense embedding');
        return data.embedding;
    } catch (error) {
        console.error('[Embeddings] Failed to generate embedding:', error instanceof Error ? error.message : error);
        return null;
    }
}

/**
 * Generate sparse vector via embeddings service (BGE-M3)
 */
async function generateSparseVector(text) {
    try {
        const response = await fetch(`${EMBEDDINGS_URL}/api/sparse`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: text.slice(0, MAX_EMBED_TEXT_LENGTH) }),
        });
        if (!response.ok) {
            console.warn('[Embeddings] Sparse vector generation failed:', response.status);
            return null;
        }
        const data = await response.json();
        return { indices: data.indices, values: data.values };
    } catch (error) {
        console.warn('[Embeddings] Sparse error:', error instanceof Error ? error.message : error);
        return null;
    }
}

async function generateEmbeddings(texts) {
    const results = [];
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
        const batch = texts.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.all(batch.map(generateEmbedding));
        results.push(...batchResults);
        if (i + BATCH_SIZE < texts.length) {
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
    }
    return results;
}

async function storeEmbedding(chunkId, embedding) {
    const embeddingJson = JSON.stringify(embedding);
    await prisma.$executeRawUnsafe(`
    INSERT OR REPLACE INTO chunk_embeddings (id, chunk_id, embedding, model, dimension)
    VALUES (?, ?, ?, ?, ?)
  `, (0, crypto_1.randomUUID)(), chunkId, embeddingJson, EMBEDDING_MODEL, EMBEDDING_DIM);
}

async function getEmbedding(chunkId) {
    const result = (await prisma.$queryRawUnsafe(`SELECT embedding FROM chunk_embeddings WHERE chunk_id = ?`, chunkId));
    if (!result[0]?.embedding) {
        return null;
    }
    try {
        return JSON.parse(result[0].embedding);
    }
    catch {
        return null;
    }
}

async function deleteEmbedding(chunkId) {
    await prisma.$executeRawUnsafe(`DELETE FROM chunk_embeddings WHERE chunk_id = ?`, chunkId);
}

async function deleteEmbeddingsForDocument(userId, documentId) {
    await prisma.$executeRawUnsafe(`
    DELETE FROM chunk_embeddings
    WHERE chunk_id IN (
      SELECT id FROM rag_chunks WHERE user_id = ? AND source_id = ?
    )
  `, userId, documentId);
}

function cosineSimilarity(a, b) {
    if (a.length !== b.length) {
        throw new Error('Vector dimensions must match');
    }
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);
    if (normA === 0 || normB === 0) {
        return 0;
    }
    return dotProduct / (normA * normB);
}

/**
 * Hybrid search: Dense (Arctic) + Sparse (BGE-M3) → RRF fusion in Qdrant
 * Falls back to dense-only if sparse vectors unavailable
 */
async function findSimilarChunks(queryEmbedding, options = {}) {
    const { sourceTypes, jurisdiction, userId, orgId, limit = 10, minSimilarity = 0.15 } = options;
    console.log(`[Embeddings] Hybrid search | jurisdiction: ${jurisdiction} | collection: ${QDRANT_COLLECTION} | hybrid: ${USE_HYBRID}`);

    try {
        const must = [];
        if (jurisdiction) {
            must.push({ key: "jurisdiction", match: { value: jurisdiction } });
        }
        const filter = must.length > 0 ? { must } : undefined;
        const prefetchLimit = Math.max(limit * 3, 60);  // Wide net for reranker

        // Try hybrid search (dense + sparse)
        if (USE_HYBRID) {
            try {
                // Get sparse query vector from BGE-M3
                const sparseVec = await generateSparseVector(options._queryText || "");

                if (sparseVec && sparseVec.indices.length > 0) {
                    // Full hybrid: dense + sparse → RRF fusion
                    console.log(`[Embeddings] Hybrid: dense (${queryEmbedding.length}d) + sparse (${sparseVec.indices.length} dims)`);
                    const response = await fetch(QDRANT_URL + "/collections/" + QDRANT_COLLECTION + "/points/query", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            prefetch: [
                                {
                                    query: queryEmbedding,
                                    using: "dense",
                                    limit: prefetchLimit,
                                    filter: filter,
                                },
                                {
                                    query: { indices: sparseVec.indices, values: sparseVec.values },
                                    using: "sparse",
                                    limit: prefetchLimit,
                                    filter: filter,
                                },
                            ],
                            query: { fusion: "rrf" },
                            limit: limit,
                            with_payload: true,
                        }),
                    });

                    if (response.ok) {
                        const data = await response.json();
                        const points = data.result?.points || [];
                        console.log(`[Embeddings] Hybrid RRF returned ${points.length} results`);
                        return points.map(r => ({
                            chunkId: r.payload?.chunk_id || r.id,
                            content: r.payload?.content || "",
                            sourceName: r.payload?.source_name || r.payload?.sourceName || "Unknown",
                            sourceType: r.payload?.source_type || "",
                            jurisdiction: r.payload?.jurisdiction || "",
                            similarity: r.score,
                        }));
                    } else {
                        const errText = await response.text();
                        console.warn("[Embeddings] Hybrid search failed, falling back to dense:", errText);
                    }
                } else {
                    console.log("[Embeddings] No sparse vector, falling back to dense-only");
                }
            } catch (e) {
                console.warn("[Embeddings] Hybrid search error, falling back to dense:", e.message);
            }
        }

        // Fallback: dense-only search (works with both v1 unnamed and v2 named vectors)
        let searchBody;
        // Try named vector first (v2), fall back to unnamed (v1)
        searchBody = {
            vector: { name: "dense", vector: queryEmbedding },
            limit: limit,
            score_threshold: minSimilarity,
            filter: filter,
            with_payload: true,
        };

        let response = await fetch(QDRANT_URL + "/collections/" + QDRANT_COLLECTION + "/points/search", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(searchBody),
        });

        // If named vector fails (v1 collection), try unnamed
        if (!response.ok) {
            console.log("[Embeddings] Named vector search failed, trying unnamed vector...");
            searchBody = {
                vector: queryEmbedding,
                limit: limit,
                score_threshold: minSimilarity,
                filter: filter,
                with_payload: true,
            };
            response = await fetch(QDRANT_URL + "/collections/" + QDRANT_COLLECTION + "/points/search", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(searchBody),
            });
        }

        if (!response.ok) {
            console.warn("[Embeddings] Qdrant search failed:", response.status);
            return [];
        }

        const data = await response.json();
        console.log("[Embeddings] Dense search returned", data.result?.length || 0, "results");
        return (data.result || []).map(r => ({
            chunkId: r.payload?.chunk_id || r.id,
            content: r.payload?.content || "",
            sourceName: r.payload?.source_name || r.payload?.sourceName || "Unknown",
            sourceType: r.payload?.source_type || "",
            jurisdiction: r.payload?.jurisdiction || "",
            similarity: r.score,
        }));
    } catch (e) {
        console.warn("[Embeddings] Qdrant error:", e.message);
        return [];
    }
}

async function semanticSearch(query, options = {}) {
    const queryEmbedding = await generateEmbedding(query);
    if (!queryEmbedding) {
        console.warn('[Embeddings] Failed to generate query embedding');
        return [];
    }
    // Pass query text for sparse vector generation
    return findSimilarChunks(queryEmbedding, { ...options, _queryText: query });
}

async function checkEmbeddingsHealth() {
    try {
        const response = await fetch(`${OLLAMA_URL}/api/tags`, { method: 'GET' });
        if (!response.ok) {
            return { available: false, model: EMBEDDING_MODEL, error: `Ollama not responding: ${response.status}` };
        }
        const data = (await response.json());
        const hasModel = data.models?.some((m) => m.name === EMBEDDING_MODEL || m.name.startsWith(EMBEDDING_MODEL));
        if (!hasModel) {
            return { available: false, model: EMBEDDING_MODEL, error: `Model ${EMBEDDING_MODEL} not found` };
        }
        return { available: true, model: EMBEDDING_MODEL, collection: QDRANT_COLLECTION, hybrid: USE_HYBRID };
    }
    catch (error) {
        return { available: false, model: EMBEDDING_MODEL, error: error instanceof Error ? error.message : 'Connection failed' };
    }
}

async function getEmbeddingStats() {
    const result = (await prisma.$queryRawUnsafe(`SELECT COUNT(*) as count FROM chunk_embeddings`));
    return {
        totalEmbeddings: Number(result[0]?.count || 0),
        model: EMBEDDING_MODEL,
        dimension: EMBEDDING_DIM,
        collection: QDRANT_COLLECTION,
        hybrid: USE_HYBRID,
    };
}
//# sourceMappingURL=embeddings.js.map
