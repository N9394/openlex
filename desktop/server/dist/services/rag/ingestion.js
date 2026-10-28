"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ingestContent = ingestContent;
exports.ingestClauseTemplate = ingestClauseTemplate;
exports.ingestJurisdictionEntry = ingestJurisdictionEntry;
exports.ingestCaseLawEntry = ingestCaseLawEntry;
exports.bulkIngestCaseLaw = bulkIngestCaseLaw;
exports.ingestUserDocument = ingestUserDocument;
exports.ingestUserDocumentSafe = ingestUserDocumentSafe;
exports.deleteUserDocumentChunks = deleteUserDocumentChunks;
exports.deleteAllUserChunks = deleteAllUserChunks;
exports.bulkIngestClauses = bulkIngestClauses;
exports.bulkIngestJurisdiction = bulkIngestJurisdiction;
exports.ingestLegalAPIDocument = ingestLegalAPIDocument;
exports.ingestCourtListenerCase = ingestCourtListenerCase;
exports.ingestEURLexDocument = ingestEURLexDocument;
exports.ingestCanLIICase = ingestCanLIICase;
exports.bulkIngestLegalAPIDocuments = bulkIngestLegalAPIDocuments;
exports.fetchAndIngestLegalContent = fetchAndIngestLegalContent;
exports.isDocumentIngested = isDocumentIngested;
exports.getIngestionStats = getIngestionStats;
const client_1 = require("@prisma/client");
const crypto_1 = require("crypto");
const chunking_1 = require("./chunking");
const embeddings_1 = require("./embeddings");
const legalAPIs_1 = require("../legalAPIs");
const prisma = new client_1.PrismaClient();
const DEFAULT_GENERATE_EMBEDDINGS = process.env.RAG_GENERATE_EMBEDDINGS === 'true';
function calculateContentHash(content) {
    const normalized = content.toLowerCase().trim().replace(/\s+/g, ' ');
    return (0, crypto_1.createHash)('sha256').update(normalized).digest('hex');
}
function countWords(content) {
    return content.trim().split(/\s+/).filter(w => w.length > 0).length;
}
function validateChunk(chunk, sourceName) {
    const trimmed = chunk.trim();
    if (trimmed.length < 50) {
        return 'too_short';
    }
    const wordCount = countWords(trimmed);
    if (wordCount < 10) {
        return 'too_few_words';
    }
    const lines = trimmed.split('\n');
    const contentLines = lines.filter(line => {
        const l = line.trim();
        if (l.length === 0)
            return false;
        if (/^(§|Čl\.|Article|SECTION|Paragraph|Part|Chapter|\d+\.)\s*\d*[a-z]?\s*$/i.test(l)) {
            return false;
        }
        if (l.length < 20 && !/[.,:;!?]/.test(l)) {
            return false;
        }
        return true;
    });
    if (contentLines.length === 0) {
        return 'headers_only';
    }
    if (!sourceName || sourceName.trim() === '' || sourceName === 'Untitled') {
        console.warn(`[RAG] Warning: Chunk has invalid sourceName: "${sourceName}"`);
    }
    return null;
}
async function isDuplicateContent(contentHash) {
    try {
        const result = await prisma.$queryRawUnsafe(`SELECT COUNT(*) as count FROM rag_chunks WHERE content_hash = ?`, contentHash);
        return (result[0]?.count || 0) > 0;
    }
    catch (e) {
        return false;
    }
}
async function ingestContent(content, options, generateEmbeddings = DEFAULT_GENERATE_EMBEDDINGS) {
    const chunks = (0, chunking_1.chunkText)(content);
    const isGlobal = options.sourceType !== 'user_doc';
    let embeddingsCreated = 0;
    let chunksCreated = 0;
    let skipped = 0;
    const reasons = {};
    for (const chunk of chunks) {
        const validationError = validateChunk(chunk, options.sourceName);
        if (validationError) {
            skipped++;
            reasons[validationError] = (reasons[validationError] || 0) + 1;
            continue;
        }
        const contentHash = calculateContentHash(chunk);
        const wordCount = countWords(chunk);
        const isDuplicate = await isDuplicateContent(contentHash);
        if (isDuplicate) {
            skipped++;
            reasons['duplicate'] = (reasons['duplicate'] || 0) + 1;
            continue;
        }
        const id = (0, crypto_1.randomUUID)();
        try {
            await prisma.$executeRawUnsafe(`
        INSERT INTO rag_chunks (
          id, content, source_type, source_name, source_url, source_id,
          jurisdiction, language, document_type, clause_type,
          user_id, org_id, is_global, content_hash, word_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, id, chunk, options.sourceType, options.sourceName, options.sourceUrl || null, options.sourceId || null, options.jurisdiction || null, options.language || 'en', options.documentType || null, options.clauseType || null, options.userId || null, options.orgId || null, isGlobal ? 1 : 0, contentHash, wordCount);
            chunksCreated++;
            if (generateEmbeddings) {
                const embedding = await (0, embeddings_1.generateEmbedding)(chunk);
                if (embedding) {
                    await (0, embeddings_1.storeEmbedding)(id, embedding);
                    embeddingsCreated++;
                }
            }
        }
        catch (error) {
            if (error.message?.includes('UNIQUE constraint') || error.code === 'SQLITE_CONSTRAINT') {
                skipped++;
                reasons['duplicate'] = (reasons['duplicate'] || 0) + 1;
            }
            else {
                throw error;
            }
        }
    }
    const logParts = [`[RAG] Ingested ${chunksCreated} chunks from "${options.sourceName}"`];
    if (skipped > 0) {
        logParts.push(`(skipped ${skipped}: ${Object.entries(reasons).map(([k, v]) => `${k}=${v}`).join(', ')})`);
    }
    if (generateEmbeddings && embeddingsCreated > 0) {
        logParts.push(`(${embeddingsCreated} embeddings)`);
    }
    console.log(logParts.join(' '));
    return { chunksCreated, embeddingsCreated, skipped, reasons };
}
async function ingestClauseTemplate(_clause) {
    console.warn('[RAG] ingestClauseTemplate is deprecated - clause library has been removed');
}
async function ingestJurisdictionEntry(entry) {
    await ingestContent(entry.content, {
        sourceType: 'jurisdiction_kb',
        sourceName: entry.topic,
        sourceId: entry.id,
        jurisdiction: entry.jurisdiction,
        language: entry.language,
    });
}
async function ingestCaseLawEntry(caseLaw, generateEmbeddings = DEFAULT_GENERATE_EMBEDDINGS) {
    const contentParts = [
        `Case: ${caseLaw.caseName}`,
        `Citation: ${caseLaw.citation}`,
        `Court: ${caseLaw.court}`,
        `Date: ${caseLaw.dateDecided}`,
        `Topics: ${caseLaw.topics.join(', ')}`,
        ``,
        `Holding: ${caseLaw.holding}`,
    ];
    for (const passage of caseLaw.keyPassages) {
        contentParts.push('', `${passage.heading}:`);
        contentParts.push(passage.text);
    }
    const content = contentParts.join('\n');
    return ingestContent(content, {
        sourceType: 'case_law',
        sourceName: caseLaw.caseName,
        sourceId: caseLaw.id,
        jurisdiction: caseLaw.jurisdiction,
        language: caseLaw.language,
    }, generateEmbeddings);
}
async function bulkIngestCaseLaw(cases, generateEmbeddings = DEFAULT_GENERATE_EMBEDDINGS) {
    let success = 0;
    let failed = 0;
    let totalChunks = 0;
    let totalEmbeddings = 0;
    for (const caseLaw of cases) {
        try {
            const result = await ingestCaseLawEntry(caseLaw, generateEmbeddings);
            success++;
            totalChunks += result.chunksCreated;
            totalEmbeddings += result.embeddingsCreated;
        }
        catch (error) {
            console.error(`[RAG] Failed to ingest case "${caseLaw.caseName}":`, error);
            failed++;
        }
    }
    console.log(`[RAG] Ingested ${success} case law entries (${totalChunks} chunks, ${totalEmbeddings} embeddings)`);
    return { success, failed, chunks: totalChunks, embeddings: totalEmbeddings };
}
async function ingestUserDocument(userId, documentId, documentName, content, metadata = {}, orgId) {
    if (!metadata.isAnonymized) {
        console.warn(`[RAG] Ingesting user document ${documentId} - content may not be anonymized. ` +
            `Set metadata.isAnonymized=true to suppress this warning.`);
    }
    return ingestContent(content, {
        sourceType: 'user_doc',
        sourceName: documentName,
        sourceId: documentId,
        userId,
        orgId,
        jurisdiction: metadata.jurisdiction,
        documentType: metadata.documentType,
    });
}
async function ingestUserDocumentSafe(documentId, generateEmbeddings = DEFAULT_GENERATE_EMBEDDINGS) {
    const document = await prisma.$queryRaw `
    SELECT id, user_id as userId, filename, extracted_text as extractedText, anonymized_text as anonymizedText
    FROM documents
    WHERE id = ${documentId}
  `;
    if (!document || document.length === 0) {
        throw new Error(`Document not found: ${documentId}`);
    }
    const doc = document[0];
    const contentToIngest = doc.anonymizedText || doc.extractedText;
    const usedAnonymized = !!doc.anonymizedText;
    if (!contentToIngest) {
        throw new Error(`Document ${documentId} has no text content`);
    }
    if (!usedAnonymized) {
        console.warn(`[RAG] Document ${documentId} has no anonymized text - using extracted text. ` +
            `This may include PII. Consider re-processing the document.`);
    }
    const result = await ingestContent(contentToIngest, {
        sourceType: 'user_doc',
        sourceName: doc.filename,
        sourceId: doc.id,
        userId: doc.userId,
    }, generateEmbeddings);
    console.log(`[RAG] Ingested document ${documentId} (${usedAnonymized ? 'anonymized' : 'original'}): ` +
        `${result.chunksCreated} chunks, ${result.embeddingsCreated} embeddings`);
    return {
        ...result,
        usedAnonymized,
    };
}
async function deleteUserDocumentChunks(userId, documentId) {
    await (0, embeddings_1.deleteEmbeddingsForDocument)(userId, documentId);
    await prisma.$executeRawUnsafe(`
    DELETE FROM rag_chunks
    WHERE user_id = ? AND source_id = ?
  `, userId, documentId);
    console.log(`[RAG] Deleted chunks for document ${documentId}`);
}
async function deleteAllUserChunks(userId) {
    await prisma.$executeRawUnsafe(`
    DELETE FROM chunk_embeddings
    WHERE chunk_id IN (SELECT id FROM rag_chunks WHERE user_id = ?)
  `, userId);
    await prisma.$executeRawUnsafe(`
    DELETE FROM rag_chunks WHERE user_id = ?
  `, userId);
    console.log(`[RAG] Deleted all chunks for user ${userId}`);
}
async function bulkIngestClauses(clauses) {
    let success = 0;
    let failed = 0;
    for (const clause of clauses) {
        try {
            await ingestClauseTemplate(clause);
            success++;
        }
        catch (error) {
            console.error(`[RAG] Failed to ingest clause "${clause.name}":`, error);
            failed++;
        }
    }
    return { success, failed };
}
async function bulkIngestJurisdiction(entries) {
    let success = 0;
    let failed = 0;
    for (const entry of entries) {
        try {
            await ingestJurisdictionEntry(entry);
            success++;
        }
        catch (error) {
            console.error(`[RAG] Failed to ingest entry "${entry.topic}":`, error);
            failed++;
        }
    }
    return { success, failed };
}
async function ingestLegalAPIDocument(document, generateEmbeddings = DEFAULT_GENERATE_EMBEDDINGS) {
    const contentParts = [
        `Title: ${document.title}`,
        `Source: ${document.source}`,
        `Jurisdiction: ${document.jurisdiction}`,
    ];
    if (document.date) {
        contentParts.push(`Date: ${document.date.toISOString().split('T')[0]}`);
    }
    if (document.citation) {
        contentParts.push(`Citation: ${document.citation}`);
    }
    contentParts.push('', document.content);
    const content = contentParts.join('\n');
    return ingestContent(content, {
        sourceType: 'case_law',
        sourceName: document.title,
        sourceId: document.sourceId,
        sourceUrl: document.url,
        jurisdiction: document.jurisdiction,
        language: 'en',
    }, generateEmbeddings);
}
async function ingestCourtListenerCase(caseLaw, generateEmbeddings = DEFAULT_GENERATE_EMBEDDINGS) {
    const contentParts = [
        `Case: ${caseLaw.title}`,
        `Court: ${caseLaw.court}`,
        `Jurisdiction: ${caseLaw.jurisdiction}`,
    ];
    if (caseLaw.date) {
        contentParts.push(`Date: ${caseLaw.date.toISOString().split('T')[0]}`);
    }
    if (caseLaw.citation) {
        contentParts.push(`Citation: ${caseLaw.citation}`);
    }
    if (caseLaw.judges) {
        contentParts.push(`Judges: ${caseLaw.judges}`);
    }
    if (caseLaw.precedentialStatus) {
        contentParts.push(`Status: ${caseLaw.precedentialStatus}`);
    }
    if (caseLaw.citationCount !== undefined) {
        contentParts.push(`Citation Count: ${caseLaw.citationCount}`);
    }
    contentParts.push('', caseLaw.content);
    const content = contentParts.join('\n');
    return ingestContent(content, {
        sourceType: 'case_law',
        sourceName: caseLaw.title,
        sourceId: caseLaw.sourceId,
        sourceUrl: caseLaw.url,
        jurisdiction: caseLaw.jurisdiction,
        language: 'en',
    }, generateEmbeddings);
}
async function ingestEURLexDocument(document, generateEmbeddings = DEFAULT_GENERATE_EMBEDDINGS) {
    const contentParts = [
        `Title: ${document.title}`,
        `CELEX: ${document.celex}`,
        `Document Type: ${document.documentType}`,
        `Jurisdiction: EU`,
    ];
    if (document.date) {
        contentParts.push(`Date: ${document.date.toISOString().split('T')[0]}`);
    }
    if (document.ojReference) {
        contentParts.push(`Official Journal: ${document.ojReference}`);
    }
    if (document.inForce !== undefined) {
        contentParts.push(`In Force: ${document.inForce ? 'Yes' : 'No'}`);
    }
    if (document.subjects && document.subjects.length > 0) {
        contentParts.push(`Subjects: ${document.subjects.join(', ')}`);
    }
    contentParts.push('', document.content);
    const content = contentParts.join('\n');
    return ingestContent(content, {
        sourceType: 'case_law',
        sourceName: document.title,
        sourceId: document.sourceId,
        sourceUrl: document.url,
        jurisdiction: 'EU',
        language: 'en',
        documentType: document.documentType,
    }, generateEmbeddings);
}
async function ingestCanLIICase(caseLaw, generateEmbeddings = DEFAULT_GENERATE_EMBEDDINGS) {
    const contentParts = [
        `Case: ${caseLaw.title}`,
        `Citation: ${caseLaw.officialCitation}`,
        `Jurisdiction: ${caseLaw.jurisdiction}`,
    ];
    if (caseLaw.date) {
        contentParts.push(`Date: ${caseLaw.date.toISOString().split('T')[0]}`);
    }
    if (caseLaw.docketNumber) {
        contentParts.push(`Docket: ${caseLaw.docketNumber}`);
    }
    if (caseLaw.keywords && caseLaw.keywords.length > 0) {
        contentParts.push(`Keywords: ${caseLaw.keywords.join(', ')}`);
    }
    contentParts.push('', caseLaw.content);
    const content = contentParts.join('\n');
    return ingestContent(content, {
        sourceType: 'case_law',
        sourceName: caseLaw.title,
        sourceId: caseLaw.sourceId,
        sourceUrl: caseLaw.url,
        jurisdiction: caseLaw.jurisdiction,
        language: 'en',
    }, generateEmbeddings);
}
async function bulkIngestLegalAPIDocuments(documents, generateEmbeddings = DEFAULT_GENERATE_EMBEDDINGS) {
    let success = 0;
    let failed = 0;
    let totalChunks = 0;
    let totalEmbeddings = 0;
    for (const document of documents) {
        try {
            let result;
            switch (document.source) {
                case 'courtlistener':
                    result = await ingestCourtListenerCase(document, generateEmbeddings);
                    break;
                case 'eurlex':
                    result = await ingestEURLexDocument(document, generateEmbeddings);
                    break;
                case 'canlii':
                    result = await ingestCanLIICase(document, generateEmbeddings);
                    break;
                default:
                    result = await ingestLegalAPIDocument(document, generateEmbeddings);
            }
            success++;
            totalChunks += result.chunksCreated;
            totalEmbeddings += result.embeddingsCreated;
        }
        catch (error) {
            console.error(`[RAG] Failed to ingest legal document "${document.title}":`, error);
            failed++;
        }
    }
    console.log(`[RAG] Ingested ${success} legal API documents ` +
        `(${totalChunks} chunks, ${totalEmbeddings} embeddings)`);
    return { success, failed, chunks: totalChunks, embeddings: totalEmbeddings };
}
async function fetchAndIngestLegalContent(options = {}) {
    const { generateEmbeddings = DEFAULT_GENERATE_EMBEDDINGS, ...fetchOptions } = options;
    console.log('[RAG] Starting legal content fetch and ingestion...');
    const fetchResult = await (0, legalAPIs_1.fetchLegalDocuments)({
        ...fetchOptions,
        onProgress: (progress) => {
            console.log(`[RAG] Fetching from ${progress.source}: ${progress.fetched}/${progress.total}` +
                (progress.currentDocument ? ` (${progress.currentDocument})` : ''));
        },
    });
    console.log(`[RAG] Fetched ${fetchResult.totalFetched} documents: ` +
        `CourtListener=${fetchResult.bySource.courtlistener}, ` +
        `EUR-Lex=${fetchResult.bySource.eurlex}, ` +
        `CanLII=${fetchResult.bySource.canlii}`);
    const ingestResult = await bulkIngestLegalAPIDocuments(fetchResult.documents, generateEmbeddings);
    const result = {
        fetched: fetchResult.totalFetched,
        ingested: ingestResult.success,
        chunks: ingestResult.chunks,
        embeddings: ingestResult.embeddings,
        errors: [
            ...fetchResult.errors,
            ...(ingestResult.failed > 0
                ? [`${ingestResult.failed} documents failed to ingest`]
                : []),
        ],
    };
    console.log(`[RAG] Legal content ingestion complete: ` +
        `${result.ingested} documents, ${result.chunks} chunks, ${result.embeddings} embeddings`);
    if (result.errors.length > 0) {
        console.warn('[RAG] Errors:', result.errors);
    }
    return result;
}
async function isDocumentIngested(sourceId) {
    const result = await prisma.$queryRaw `
    SELECT COUNT(*) as count FROM rag_chunks WHERE source_id = ${sourceId}
  `;
    return result[0]?.count > 0;
}
async function getIngestionStats() {
    const totalResult = await prisma.$queryRaw `
    SELECT COUNT(*) as count FROM rag_chunks
  `;
    const sourceTypeResult = await prisma.$queryRaw `
    SELECT source_type, COUNT(*) as count FROM rag_chunks GROUP BY source_type
  `;
    const jurisdictionResult = await prisma.$queryRaw `
    SELECT jurisdiction, COUNT(*) as count FROM rag_chunks GROUP BY jurisdiction
  `;
    const bySourceType = {};
    for (const row of sourceTypeResult) {
        bySourceType[row.source_type] = row.count;
    }
    const byJurisdiction = {};
    for (const row of jurisdictionResult) {
        byJurisdiction[row.jurisdiction || 'unknown'] = row.count;
    }
    return {
        totalChunks: totalResult[0]?.count || 0,
        bySourceType,
        byJurisdiction,
    };
}
//# sourceMappingURL=ingestion.js.map