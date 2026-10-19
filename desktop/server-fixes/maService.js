"use strict";
/**
 * M&A Due Diligence — Pipeline Orchestrator
 *
 * Deterministic state machine: CLASSIFY → PLAN → ANALYZE (Phase 1)
 * Later phases add: RAG_VERIFY → SYNTHESIZE → PLAYBOOK → REPORT
 *
 * Key principles:
 * - Every stage writes results to DB after each item (granular resume)
 * - Server restart loses at most 1 in-flight LLM call
 * - Never loads all docs into memory
 * - Uses background LLM slots via maScheduler
 */

const { PrismaClient } = require('@prisma/client');
const { classifyDocument, generatePlan, generateIndustryProfile, analyzeChunk, consolidateDocumentResults, splitIntoMaChunks,
    verifyRisk, synthesizeRisks, scoreWarranties, analyzeDisclosureGaps, assessWniReadiness,
    generatePlaybook, generateReport } = require('../services/maAnalyzers');
const { parseDocument } = require('../services/docParser');
const { enhancedSearch } = require('../services/rag/retrieval');

const prisma = new PrismaClient();

// ============================================================================
// EVENT BUS — SSE subscribers per deal
// ============================================================================

const eventBus = new Map(); // dealId → Set<callback>

function subscribe(dealId, callback) {
    if (!eventBus.has(dealId)) eventBus.set(dealId, new Set());
    eventBus.get(dealId).add(callback);
    return () => {
        const subs = eventBus.get(dealId);
        if (subs) {
            subs.delete(callback);
            if (subs.size === 0) eventBus.delete(dealId);
        }
    };
}

function emit(dealId, event, data) {
    const subs = eventBus.get(dealId);
    if (subs) {
        for (const cb of subs) {
            try { cb(event, data); } catch (e) { console.error('[MA Event] Callback error:', e.message); }
        }
    }
}

// ============================================================================
// ACTIVE PIPELINES — track running pipelines for pause/cancel
// ============================================================================

const activePipelines = new Map(); // dealId → { paused: boolean, aborted: boolean }

function getPipelineControl(dealId) {
    if (!activePipelines.has(dealId)) {
        activePipelines.set(dealId, { paused: false, aborted: false });
    }
    return activePipelines.get(dealId);
}

function isPaused(dealId) {
    return getPipelineControl(dealId).paused;
}

function isAborted(dealId) {
    return getPipelineControl(dealId).aborted;
}

/**
 * Abort a running pipeline (called before deal deletion).
 * Sets aborted flag so all in-flight operations bail out.
 */
function abortPipeline(dealId) {
    const control = getPipelineControl(dealId);
    control.aborted = true;
    console.log(`[MA Pipeline] Aborted pipeline for deal ${dealId}`);
}

// ============================================================================
// RETRY + TIMING HELPERS
// ============================================================================

const MAX_RETRIES = 3;
const CIRCUIT_BREAKER_THRESHOLD = 5; // abort after N consecutive failures
const CLASSIFY_CONCURRENCY = 5;
const ANALYZE_CONCURRENCY = 3;

/**
 * Retry an async fn up to MAX_RETRIES times with exponential backoff.
 * Returns { result, retries, durationMs } or throws after all retries exhausted.
 */
async function withRetry(fn, itemLabel, dealId) {
    let lastError;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        // Bail out immediately if deal was deleted/aborted
        if (isAborted(dealId)) {
            throw new Error(`Pipeline aborted for deal ${dealId}`);
        }
        try {
            const start = Date.now();
            const result = await fn();
            return { result, retries: attempt - 1, durationMs: Date.now() - start };
        } catch (err) {
            lastError = err;
            if (isAborted(dealId)) {
                throw new Error(`Pipeline aborted for deal ${dealId}`);
            }
            if (attempt < MAX_RETRIES) {
                const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 8000);
                console.warn(`[MA Retry] ${itemLabel} attempt ${attempt}/${MAX_RETRIES} failed: ${err.message}. Retrying in ${backoffMs}ms...`);
                await logAuditEvent(dealId, 'retry', 'item_retry', {
                    item: itemLabel,
                    attempt,
                    error: err.message,
                    backoffMs
                });
                await new Promise(r => setTimeout(r, backoffMs));
            }
        }
    }
    throw lastError;
}

/**
 * Circuit breaker — tracks consecutive failures.
 * If N consecutive items fail with similar errors, aborts the stage early.
 */
class CircuitBreaker {
    constructor(threshold = CIRCUIT_BREAKER_THRESHOLD) {
        this.threshold = threshold;
        this.consecutiveFailures = 0;
        this.lastError = null;
        this.tripped = false;
    }
    recordSuccess() {
        this.consecutiveFailures = 0;
    }
    recordFailure(error) {
        this.consecutiveFailures++;
        this.lastError = error.message || String(error);
        if (this.consecutiveFailures >= this.threshold) {
            this.tripped = true;
            console.error(`[MA Circuit Breaker] TRIPPED after ${this.consecutiveFailures} consecutive failures. Last error: ${this.lastError}`);
        }
    }
    isTripped() {
        return this.tripped;
    }
}

/**
 * Run items in parallel with concurrency limit.
 * Returns array of { item, result, error } for each item.
 */
async function runParallel(items, concurrency, fn) {
    const results = [];
    let idx = 0;

    async function worker() {
        while (idx < items.length) {
            const i = idx++;
            try {
                const result = await fn(items[i], i);
                results[i] = { item: items[i], result, error: null };
            } catch (err) {
                results[i] = { item: items[i], result: null, error: err };
            }
        }
    }

    const workers = [];
    for (let i = 0; i < Math.min(concurrency, items.length); i++) {
        workers.push(worker());
    }
    await Promise.all(workers);
    return results;
}

/**
 * Stage-level time estimator.
 * Tracks per-item durations and returns estimated remaining seconds.
 */
class StageTimer {
    constructor() {
        this.durations = [];
        this.stageStart = Date.now();
    }
    recordItem(durationMs) {
        this.durations.push(durationMs);
    }
    getEstimate(completedItems, totalItems) {
        if (this.durations.length === 0 || completedItems >= totalItems) return 0;
        const avgMs = this.durations.reduce((a, b) => a + b, 0) / this.durations.length;
        const remaining = totalItems - completedItems;
        return Math.round((avgMs * remaining) / 1000);
    }
    getElapsed() {
        return Date.now() - this.stageStart;
    }
}

// ============================================================================
// STAGE 0: INGEST (runs inline on upload, not a pipeline stage)
// ============================================================================

/**
 * Parse an uploaded file and split into sections.
 * Called immediately on upload, before pipeline starts.
 */
async function ingestDocument(dealId, documentId, filepath) {
    const startTime = Date.now();

    try {
        await prisma.dealDocument.update({
            where: { id: documentId },
            data: { status: 'parsing' }
        });

        // Parse document
        const extractedText = await parseDocument(filepath);
        const textLength = extractedText.length;

        // Reject empty or near-empty documents
        if (textLength < 50) {
            await prisma.dealDocument.update({
                where: { id: documentId },
                data: { status: 'failed' }
            });
            throw new Error('Document is empty or too short to analyze (minimum 50 characters).');
        }

        // Count pages from [Page N] markers
        const pageMatches = extractedText.match(/\[Page\s+\d+\]/g);
        const pageCount = pageMatches ? pageMatches.length : Math.ceil(textLength / 3000);

        // Split into chunks
        const chunks = splitIntoMaChunks(extractedText);

        // Store extracted text and create sections
        await prisma.dealDocument.update({
            where: { id: documentId },
            data: {
                extractedText,
                textLength,
                pageCount,
                status: 'parsed'
            }
        });

        // Create section rows
        for (let i = 0; i < chunks.length; i++) {
            await prisma.dealDocumentSection.create({
                data: {
                    documentId,
                    sectionIndex: i,
                    content: chunks[i].content,
                    heading: chunks[i].heading,
                    pageNumber: chunks[i].pageNumber,
                }
            });
        }

        // Audit event
        await logAuditEvent(dealId, 'ingest', 'doc_ingested', {
            documentId,
            textLength,
            pageCount,
            sectionCount: chunks.length,
            durationMs: Date.now() - startTime
        });

        emit(dealId, 'doc_ingested', {
            docId: documentId,
            textLength,
            pageCount,
            sectionCount: chunks.length
        });

        return { textLength, pageCount, sectionCount: chunks.length };
    } catch (error) {
        console.error(`[MA Ingest] Failed for doc ${documentId}:`, error.message);
        await prisma.dealDocument.update({
            where: { id: documentId },
            data: { status: 'failed' }
        });
        throw error;
    }
}

// ============================================================================
// STAGE 1: CLASSIFY
// ============================================================================

async function runClassifyStage(dealId, job) {
    const docs = await prisma.dealDocument.findMany({
        where: { dealId, status: 'parsed' },
        select: { id: true, filename: true, extractedText: true }
    });

    if (docs.length === 0) return;

    emit(dealId, 'stage_start', { stage: 'classify', totalItems: docs.length });

    const progress = parseStageProgress(job.stageProgress);
    const completed = new Set(progress.completedItems || []);
    let classifyCount = 0;
    const timer = new StageTimer();
    const breaker = new CircuitBreaker();

    // Filter out already-completed docs, then classify in parallel batches
    const remaining = docs.filter(d => !completed.has(d.id));

    for (let batchStart = 0; batchStart < remaining.length; batchStart += CLASSIFY_CONCURRENCY) {
        if (isAborted(dealId) || isPaused(dealId) || breaker.isTripped()) break;

        const batch = remaining.slice(batchStart, batchStart + CLASSIFY_CONCURRENCY);
        const batchResults = await runParallel(batch, CLASSIFY_CONCURRENCY, async (doc) => {
            if (isAborted(dealId) || isPaused(dealId) || breaker.isTripped()) return null;
            const snippet = (doc.extractedText || '').slice(0, 3000);
            return withRetry(() => classifyDocument(doc.filename, snippet), `classify:${doc.filename}`, dealId);
        });

        for (let i = 0; i < batchResults.length; i++) {
            const { item: doc, result: retryResult, error } = batchResults[i];
            if (!retryResult && !error) continue; // skipped

            if (error) {
                console.error(`[MA Classify] Failed for ${doc.filename} after ${MAX_RETRIES} retries:`, error.message);
                breaker.recordFailure(error);
                completed.add(doc.id);
                await logAuditEvent(dealId, 'classify', 'item_failed', {
                    documentId: doc.id,
                    error: error.message,
                    retriesExhausted: true,
                    circuitBreakerCount: breaker.consecutiveFailures
                });
                continue;
            }

            const { result, retries, durationMs } = retryResult;
            breaker.recordSuccess();

            await prisma.dealDocument.update({
                where: { id: doc.id },
                data: {
                    docType: result.docType,
                    jurisdiction: result.jurisdiction,
                    language: result.language,
                    confidence: result.confidence,
                    status: 'classified'
                }
            });

            completed.add(doc.id);
            classifyCount++;
            timer.recordItem(durationMs);

            await updateJobProgress(job.id, 'classify', completed, docs.length, durationMs);

            emit(dealId, 'doc_classified', {
                docId: doc.id,
                docName: doc.filename,
                type: result.docType,
                jurisdiction: result.jurisdiction,
                confidence: result.confidence,
                retries,
                estimatedSeconds: timer.getEstimate(completed.size, docs.length)
            });
        }
    }

    if (isPaused(dealId)) {
        await savePauseState(dealId, job.id, 'classify', completed, docs.length);
        return;
    }

    if (breaker.isTripped()) {
        console.error(`[MA Classify] Circuit breaker tripped — aborting classify stage. ${classifyCount}/${docs.length} classified.`);
        await logAuditEvent(dealId, 'classify', 'circuit_breaker_tripped', {
            classified: classifyCount,
            total: docs.length,
            lastError: breaker.lastError
        });
    }

    emit(dealId, 'stage_complete', { stage: 'classify', classifiedCount: classifyCount, elapsedMs: timer.getElapsed() });
}

// ============================================================================
// STAGE 2: PLAN (creates checkpoint)
// ============================================================================

async function runPlanStage(dealId, job) {
    const deal = await prisma.deal.findUnique({
        where: { id: dealId },
        include: {
            documents: {
                where: { status: 'classified' },
                select: { id: true, filename: true, docType: true, jurisdiction: true, textLength: true }
            }
        }
    });

    if (!deal) throw new Error('Deal not found');

    emit(dealId, 'stage_start', { stage: 'plan', totalItems: 1 });

    // Build summaries for plan
    const classifiedDocs = deal.documents.map(d => ({
        filename: d.filename,
        docType: d.docType,
        jurisdiction: d.jurisdiction,
        textLength: d.textLength
    }));

    const plan = await generatePlan(classifiedDocs, {
        name: deal.name,
        perspective: deal.perspective,
        dealType: deal.dealType,
        industry: deal.industry
    });

    // Generate industry risk profile if industry is set and not yet profiled
    let industryProfile = null;
    if (deal.industry && !deal.industryProfile) {
        try {
            const jurisdictions = [...new Set(deal.documents.map(d => d.jurisdiction).filter(Boolean))];
            industryProfile = await generateIndustryProfile(deal.industry, jurisdictions, deal.dealType, deal.perspective);
            await prisma.deal.update({
                where: { id: dealId },
                data: { industryProfile: JSON.stringify(industryProfile) }
            });
            await logAuditEvent(dealId, 'plan', 'industry_profile_generated', {
                industry: deal.industry,
                riskAreas: industryProfile.riskAreas?.length || 0,
                keyAssets: industryProfile.keyAssets?.length || 0,
            });
        } catch (err) {
            console.error('[MA Pipeline] Failed to generate industry profile:', err.message);
            // Non-fatal — analysis continues with generic industry hint
        }
    }

    // Create checkpoint
    await prisma.dealCheckpoint.create({
        data: {
            dealId,
            stage: 'plan_review',
            status: 'pending',
            proposal: JSON.stringify({
                ...plan,
                documentCount: deal.documents.length,
                totalTextLength: deal.documents.reduce((sum, d) => sum + (d.textLength || 0), 0)
            })
        }
    });

    // Update deal status
    await prisma.deal.update({
        where: { id: dealId },
        data: { status: 'plan_review' }
    });

    await prisma.dealJob.update({
        where: { id: job.id },
        data: { currentStage: 'plan_review' }
    });

    emit(dealId, 'checkpoint', {
        stage: 'plan_review',
        proposal: plan
    });

    emit(dealId, 'stage_complete', { stage: 'plan' });

    // Pipeline pauses here until checkpoint approved
}

// ============================================================================
// STAGE 3: ANALYZE
// ============================================================================

async function runAnalyzeStage(dealId, job) {
    const deal = await prisma.deal.findUnique({ where: { id: dealId } });

    const docs = await prisma.dealDocument.findMany({
        where: { dealId, status: 'classified' },
        select: { id: true, filename: true, docType: true, jurisdiction: true },
        orderBy: { createdAt: 'asc' }
    });

    if (docs.length === 0) return;

    // Count total sections
    const totalSections = await prisma.dealDocumentSection.count({
        where: {
            documentId: { in: docs.map(d => d.id) },
            analyzed: false
        }
    });

    emit(dealId, 'stage_start', { stage: 'analyze', totalItems: totalSections });

    const progress = parseStageProgress(job.stageProgress);
    const completedDocs = new Set(progress.completedItems || []);
    let analyzedSections = 0;
    let totalRisks = 0;
    let totalWarranties = 0;
    let successfulDocs = 0;
    const timer = new StageTimer();
    const stageBreaker = new CircuitBreaker(3); // abort after 3 consecutive doc failures

    // Filter to only unprocessed docs
    const pendingDocs = docs.filter(d => !completedDocs.has(d.id));

    // Analyze documents in parallel (ANALYZE_CONCURRENCY docs at a time)
    // Sections within each doc are still sequential (required for consolidation)
    await runParallel(pendingDocs, ANALYZE_CONCURRENCY, async (doc) => {
        if (isAborted(dealId) || stageBreaker.isTripped()) return;
        if (isPaused(dealId)) return; // pause checked after parallel batch

        // Get unanalyzed sections for this document
        const sections = await prisma.dealDocumentSection.findMany({
            where: { documentId: doc.id, analyzed: false },
            orderBy: { sectionIndex: 'asc' }
        });

        const totalDocSections = await prisma.dealDocumentSection.count({
            where: { documentId: doc.id }
        });

        emit(dealId, 'doc_analyzing', {
            docId: doc.id,
            docName: doc.filename,
            chunk: 0,
            totalChunks: totalDocSections,
            estimatedSeconds: timer.getEstimate(analyzedSections, totalSections)
        });

        const chunkResults = [];
        const sectionBreaker = new CircuitBreaker(); // per-doc circuit breaker for sections
        let docSectionsFailed = 0;

        for (const section of sections) {
            if (isAborted(dealId) || isPaused(dealId) || sectionBreaker.isTripped()) break;

            try {
                const { result, retries, durationMs } = await withRetry(
                    () => analyzeChunk(section.content, {
                        filename: doc.filename,
                        docType: doc.docType,
                        jurisdiction: doc.jurisdiction,
                        sectionIndex: section.sectionIndex,
                        totalSections: totalDocSections,
                        heading: section.heading,
                        industry: deal.industry,
                        industryProfile: deal.industryProfile
                    }),
                    `analyze:${doc.filename}:s${section.sectionIndex}`, dealId
                );

                sectionBreaker.recordSuccess();

                // Save per-section result
                await prisma.dealDocumentSection.update({
                    where: { id: section.id },
                    data: {
                        analysisResult: JSON.stringify(result),
                        analyzed: true
                    }
                });

                chunkResults.push(result);
                analyzedSections++;
                timer.recordItem(durationMs);

                await logAuditEvent(dealId, 'analyze', 'section_analyzed', {
                    documentId: doc.id,
                    sectionId: section.id,
                    risksFound: (result.risks || []).length,
                    warrantiesFound: (result.warranties || []).length,
                    durationMs,
                    retries
                }, 0, 0, durationMs);

            } catch (error) {
                console.error(`[MA Analyze] Failed section ${section.id} after ${MAX_RETRIES} retries:`, error.message);
                sectionBreaker.recordFailure(error);
                docSectionsFailed++;
                analyzedSections++; // Count as processed (skipped)
                await logAuditEvent(dealId, 'analyze', 'item_failed', {
                    sectionId: section.id,
                    error: error.message,
                    retriesExhausted: true,
                    circuitBreakerCount: sectionBreaker.consecutiveFailures
                });
            }
        }

        if (sectionBreaker.isTripped()) {
            console.error(`[MA Analyze] Section circuit breaker tripped for ${doc.filename} — skipping remaining sections`);
            await logAuditEvent(dealId, 'analyze', 'doc_circuit_breaker', {
                documentId: doc.id,
                filename: doc.filename,
                sectionsFailed: docSectionsFailed,
                lastError: sectionBreaker.lastError
            });
        }

        // Track doc-level success/failure for stage circuit breaker
        if (chunkResults.length === 0 && sections.length > 0) {
            stageBreaker.recordFailure(new Error(`All ${sections.length} sections failed for ${doc.filename}`));
        } else {
            stageBreaker.recordSuccess();
            successfulDocs++;
        }

        // Consolidate if needed (>10 chunks with results)
        const chunksWithResults = chunkResults.filter(r =>
            (r.risks?.length || 0) + (r.warranties?.length || 0) + (r.clauses?.length || 0) > 0
        );

        let consolidated;
        if (chunksWithResults.length > 10) {
            consolidated = await consolidateDocumentResults(chunkResults, {
                filename: doc.filename
            });
        } else {
            consolidated = {
                clauses: chunkResults.flatMap(r => r.clauses || []),
                risks: chunkResults.flatMap(r => r.risks || []),
                warranties: chunkResults.flatMap(r => r.warranties || []),
                dates: chunkResults.flatMap(r => r.dates || []),
                disclosures: chunkResults.flatMap(r => r.disclosures || [])
            };
        }

        // Store extracted risks and warranties in DB
        for (const risk of consolidated.risks) {
            await prisma.dealRisk.create({
                data: {
                    dealId,
                    title: risk.title || 'Untitled risk',
                    description: risk.description || '',
                    severity: risk.severity || 'standard',
                    category: risk.category || 'legal',
                    jurisdiction: doc.jurisdiction,
                    documentId: doc.id,
                    location: risk.location,
                    clauseText: risk.clauseText
                }
            });
            totalRisks++;
        }

        for (const warranty of consolidated.warranties) {
            await prisma.dealWarranty.create({
                data: {
                    dealId,
                    name: warranty.name || 'Unnamed warranty',
                    clauseText: warranty.clauseText || '',
                    documentId: doc.id,
                    location: warranty.location
                }
            });
            totalWarranties++;
        }

        for (const disc of consolidated.disclosures) {
            await prisma.dealDisclosure.create({
                data: {
                    dealId,
                    warrantyName: disc.warrantyName || 'General',
                    content: disc.content || '',
                    documentId: doc.id,
                    location: disc.location
                }
            });
        }

        // Mark document as analyzed
        await prisma.dealDocument.update({
            where: { id: doc.id },
            data: { status: 'analyzed' }
        });

        completedDocs.add(doc.id);
        await updateJobProgress(job.id, 'analyze', completedDocs, docs.length);

        emit(dealId, 'doc_analyzed', {
            docId: doc.id,
            docName: doc.filename,
            clauseCount: consolidated.clauses.length,
            riskCount: consolidated.risks.length,
            warrantyCount: consolidated.warranties.length
        });
    });

    // Check if paused during parallel execution
    if (isPaused(dealId)) {
        await savePauseState(dealId, job.id, 'analyze', completedDocs, docs.length);
        return;
    }

    if (stageBreaker.isTripped()) {
        console.error(`[MA Analyze] Stage circuit breaker tripped — ${successfulDocs}/${docs.length} docs analyzed successfully.`);
        await logAuditEvent(dealId, 'analyze', 'stage_circuit_breaker', {
            successfulDocs,
            totalDocs: docs.length,
            lastError: stageBreaker.lastError
        });
    }

    emit(dealId, 'stage_complete', {
        stage: 'analyze',
        analyzedSections,
        totalRisks,
        totalWarranties,
        successfulDocs
    });
}

// ============================================================================
// STAGE 4: RAG_VERIFY
// ============================================================================

async function runRagVerifyStage(dealId, job) {
    const risks = await prisma.dealRisk.findMany({
        where: { dealId, verified: false },
        include: { deal: { select: { perspective: true, dealType: true, industry: true, industryProfile: true } } },
        orderBy: [
            { severity: 'asc' }, // deal_breaker first (alphabetically first)
            { createdAt: 'asc' }
        ]
    });

    if (risks.length === 0) return;

    emit(dealId, 'stage_start', { stage: 'rag_verify', totalItems: risks.length });

    const progress = parseStageProgress(job.stageProgress);
    const completedRisks = new Set(progress.completedItems || []);
    let verifiedCount = 0;
    const timer = new StageTimer();
    const breaker = new CircuitBreaker();

    for (const risk of risks) {
        if (isAborted(dealId) || isPaused(dealId) || breaker.isTripped()) {
            if (!breaker.isTripped()) {
                await savePauseState(dealId, job.id, 'rag_verify', completedRisks, risks.length);
            }
            if (breaker.isTripped()) {
                console.error(`[MA RAG Verify] Circuit breaker tripped — ${verifiedCount}/${risks.length} risks verified.`);
                await logAuditEvent(dealId, 'rag_verify', 'circuit_breaker_tripped', {
                    verified: verifiedCount,
                    total: risks.length,
                    lastError: breaker.lastError
                });
            }
            return;
        }
        if (completedRisks.has(risk.id)) continue;

        try {
            const { result, retries, durationMs } = await withRetry(async () => {
                // Search statutes for this risk — use clauseText (in document language) for best matching
                const searchQuery = (risk.clauseText || `${risk.title} ${risk.description || ''}`).slice(0, 300).trim();
                const ragResults = await enhancedSearch(searchQuery, {
                    jurisdiction: risk.jurisdiction,
                    limit: 5,
                    rerank: true,
                    rerankContext: risk.description
                });

                // LLM verification
                const verifyResult = await verifyRisk(risk, ragResults, risk.deal);
                return { ...verifyResult, ragResults };
            }, `rag_verify:${risk.title}`, dealId);

            // Update risk
            await prisma.dealRisk.update({
                where: { id: risk.id },
                data: {
                    verified: result.verified,
                    statutoryBasis: result.statutoryBasis,
                    ragSources: JSON.stringify(result.ragResults.map(r => ({ sourceName: r.sourceName, jurisdiction: r.jurisdiction, score: r.score }))),
                    verifiedAt: new Date(),
                    severity: result.adjustedSeverity || risk.severity
                }
            });

            breaker.recordSuccess();
            verifiedCount++;
            completedRisks.add(risk.id);
            timer.recordItem(durationMs);
            await updateJobProgress(job.id, 'rag_verify', completedRisks, risks.length, durationMs);

            emit(dealId, 'risk_verified', {
                riskId: risk.id,
                title: risk.title,
                verified: result.verified,
                statutoryBasis: result.statutoryBasis,
                adjustedSeverity: result.adjustedSeverity,
                retries,
                estimatedSeconds: timer.getEstimate(completedRisks.size, risks.length)
            });

            await logAuditEvent(dealId, 'rag_verify', 'risk_verified', {
                riskId: risk.id,
                verified: result.verified,
                statutoryBasis: result.statutoryBasis,
                ragResultCount: result.ragResults.length,
                retries
            }, 0, 0, durationMs);

        } catch (error) {
            console.error(`[MA RAG Verify] Failed for risk ${risk.id} after ${MAX_RETRIES} retries:`, error.message);
            breaker.recordFailure(error);
            completedRisks.add(risk.id); // Skip after all retries exhausted
            await logAuditEvent(dealId, 'rag_verify', 'item_failed', {
                riskId: risk.id,
                error: error.message,
                retriesExhausted: true
            });
        }
    }

    emit(dealId, 'stage_complete', { stage: 'rag_verify', verifiedCount, elapsedMs: timer.getElapsed() });
}

// ============================================================================
// RISK_REVIEW CHECKPOINT
// ============================================================================

async function createRiskReviewCheckpoint(dealId, job) {
    const risks = await prisma.dealRisk.findMany({
        where: { dealId },
        orderBy: { severity: 'asc' }
    });

    const deal = await prisma.deal.findUnique({ where: { id: dealId } });

    const riskSynthesis = await synthesizeRisks(risks, {
        perspective: deal.perspective,
        dealType: deal.dealType,
        name: deal.name
    });

    // Store risk synthesis on deal
    await prisma.deal.update({
        where: { id: dealId },
        data: {
            riskSummary: JSON.stringify(riskSynthesis),
            status: 'risk_review'
        }
    });

    // Create checkpoint
    const checkpoint = await prisma.dealCheckpoint.create({
        data: {
            dealId,
            stage: 'risk_review',
            proposal: JSON.stringify({
                totalRisks: risks.length,
                tierCounts: riskSynthesis.tierCounts,
                dealBreakers: riskSynthesis.dealBreakers,
                priceAffecting: riskSynthesis.priceAffecting,
                summary: riskSynthesis.summary,
                mitigationPriorities: riskSynthesis.mitigationPriorities,
                topCategories: riskSynthesis.topCategories,
                jurisdictionBreakdown: riskSynthesis.jurisdictionBreakdown
            })
        }
    });

    await prisma.dealJob.update({
        where: { id: job.id },
        data: { currentStage: 'risk_review', stageProgress: '{}' }
    });

    emit(dealId, 'checkpoint', {
        checkpointId: checkpoint.id,
        stage: 'risk_review',
        proposal: JSON.parse(checkpoint.proposal)
    });

    await logAuditEvent(dealId, 'risk_review', 'checkpoint_created', {
        checkpointId: checkpoint.id,
        totalRisks: risks.length
    });
}

// ============================================================================
// STAGE 5: SYNTHESIZE (warranties, disclosures, W&I)
// ============================================================================

async function runSynthesizeStage(dealId, job) {
    const deal = await prisma.deal.findUnique({ where: { id: dealId } });
    const warranties = await prisma.dealWarranty.findMany({ where: { dealId } });
    const disclosures = await prisma.dealDisclosure.findMany({ where: { dealId } });
    const risks = await prisma.dealRisk.findMany({ where: { dealId } });
    const dealConfig = { name: deal.name, perspective: deal.perspective, dealType: deal.dealType, industry: deal.industry, industryProfile: deal.industryProfile };

    emit(dealId, 'stage_start', { stage: 'synthesize', totalItems: 3 });

    // Sub-step 1: Score warranties
    emit(dealId, 'synthesis_progress', { substage: 'scoring_warranties', progress: 0 });
    try {
        const warrantyScores = await scoreWarranties(warranties, disclosures, dealConfig);
        for (const score of warrantyScores.scores || []) {
            if (score.index >= 0 && score.index < warranties.length) {
                await prisma.dealWarranty.update({
                    where: { id: warranties[score.index].id },
                    data: {
                        breadthScore: score.breadthScore || 0,
                        disclosureScore: score.disclosureScore || 0,
                        exposureScore: score.exposureScore || 0,
                        wniScore: score.wniScore || 0
                    }
                });
            }
        }
        await logAuditEvent(dealId, 'synthesize', 'warranties_scored', {
            count: warrantyScores.scores?.length || 0
        });
    } catch (error) {
        console.error('[MA Synthesize] Warranty scoring failed:', error.message);
    }

    // Sub-step 2: Disclosure gap analysis
    emit(dealId, 'synthesis_progress', { substage: 'disclosure_gaps', progress: 33 });
    try {
        const disclosureAnalysis = await analyzeDisclosureGaps(warranties, disclosures);

        // Update disclosure statuses
        for (const gap of disclosureAnalysis.gaps || []) {
            const matchingDiscs = disclosures.filter(d => d.warrantyName === gap.warrantyName);
            for (const disc of matchingDiscs) {
                await prisma.dealDisclosure.update({
                    where: { id: disc.id },
                    data: { status: gap.status, assessment: gap.assessment }
                });
            }
            // If no disclosure exists for a warranty with missing status, create one
            if (matchingDiscs.length === 0 && (gap.status === 'missing' || gap.status === 'partial')) {
                await prisma.dealDisclosure.create({
                    data: {
                        dealId,
                        warrantyName: gap.warrantyName,
                        content: gap.assessment || 'No disclosure found',
                        status: gap.status,
                        assessment: gap.assessment
                    }
                });
            }
        }

        await prisma.deal.update({
            where: { id: dealId },
            data: { disclosureGaps: JSON.stringify(disclosureAnalysis) }
        });

        await logAuditEvent(dealId, 'synthesize', 'disclosure_gaps_analyzed', {
            gaps: disclosureAnalysis.gaps?.length || 0,
            criticalGaps: disclosureAnalysis.criticalGaps?.length || 0
        });
    } catch (error) {
        console.error('[MA Synthesize] Disclosure analysis failed:', error.message);
    }

    // Sub-step 3: W&I readiness
    emit(dealId, 'synthesis_progress', { substage: 'wni_readiness', progress: 66 });
    try {
        const updatedWarranties = await prisma.dealWarranty.findMany({ where: { dealId } });
        const wniResult = await assessWniReadiness(updatedWarranties, risks, dealConfig);

        await prisma.deal.update({
            where: { id: dealId },
            data: { wniReadiness: JSON.stringify(wniResult) }
        });

        await logAuditEvent(dealId, 'synthesize', 'wni_assessed', {
            readinessScore: wniResult.readinessScore,
            readinessLevel: wniResult.readinessLevel
        });
    } catch (error) {
        console.error('[MA Synthesize] W&I assessment failed:', error.message);
    }

    emit(dealId, 'stage_complete', { stage: 'synthesize' });
}

// ============================================================================
// STAGE 7: REPORT
// ============================================================================

async function runReportStage(dealId, job) {
    const deal = await prisma.deal.findUnique({ where: { id: dealId } });
    const warranties = await prisma.dealWarranty.findMany({ where: { dealId } });
    const dealConfig = { name: deal.name, perspective: deal.perspective, dealType: deal.dealType, industry: deal.industry, industryProfile: deal.industryProfile };

    emit(dealId, 'stage_start', { stage: 'report', totalItems: 1 });

    const riskSynthesis = deal.riskSummary ? JSON.parse(deal.riskSummary) : {};
    const disclosureAnalysis = deal.disclosureGaps ? JSON.parse(deal.disclosureGaps) : {};
    const wniAssessment = deal.wniReadiness ? JSON.parse(deal.wniReadiness) : {};

    const report = await generateReport(dealConfig, riskSynthesis, warranties, disclosureAnalysis, wniAssessment);

    await prisma.deal.update({
        where: { id: dealId },
        data: { executiveSummary: report.executiveSummary }
    });

    await logAuditEvent(dealId, 'report', 'report_generated', {
        dealReadiness: report.dealReadiness,
        recommendationCount: report.keyRecommendations?.length || 0
    });

    emit(dealId, 'stage_complete', { stage: 'report' });
    return report;
}

// ============================================================================
// COUNSEL SIGNOFF CHECKPOINT (after report, before completed)
// ============================================================================

async function createCounselSignoffCheckpoint(dealId, job) {
    const deal = await prisma.deal.findUnique({
        where: { id: dealId },
        include: {
            risks: { select: { id: true, title: true, severity: true, humanOverride: true, humanSeverity: true } },
            warranties: { select: { id: true, name: true, breadthScore: true, exposureScore: true, playbookPositions: true } },
            disclosures: { select: { id: true, status: true } },
        }
    });

    const risks = deal.risks || [];
    const warranties = deal.warranties || [];
    const disclosures = deal.disclosures || [];

    const dealBreakers = risks.filter(r => (r.humanOverride ? r.humanSeverity : r.severity) === 'deal_breaker');
    const missingDisclosures = disclosures.filter(d => d.status === 'missing');
    const warrantiesWithPlaybook = warranties.filter(w => w.playbookPositions);

    let wniData = null;
    try { wniData = deal.wniReadiness ? JSON.parse(deal.wniReadiness) : null; } catch {}

    const proposal = {
        executiveSummary: deal.executiveSummary ? deal.executiveSummary.slice(0, 500) + (deal.executiveSummary.length > 500 ? '...' : '') : null,
        riskCount: risks.length,
        dealBreakerCount: dealBreakers.length,
        dealBreakers: dealBreakers.map(r => r.title),
        warrantyCount: warranties.length,
        warrantiesWithPlaybook: warrantiesWithPlaybook.length,
        disclosureCount: disclosures.length,
        missingDisclosureCount: missingDisclosures.length,
        wniScore: wniData?.readinessScore || null,
        wniLevel: wniData?.readinessLevel || null,
    };

    const checkpoint = await prisma.dealCheckpoint.create({
        data: {
            dealId,
            stage: 'counsel_signoff',
            status: 'pending',
            proposal: JSON.stringify(proposal)
        }
    });

    await prisma.dealJob.update({
        where: { id: job.id },
        data: { currentStage: 'counsel_signoff', stageProgress: '{}' }
    });
    await prisma.deal.update({ where: { id: dealId }, data: { status: 'counsel_signoff' } });

    await logAuditEvent(dealId, 'counsel_signoff', 'checkpoint_created', {
        riskCount: risks.length,
        dealBreakerCount: dealBreakers.length,
    });

    emit(dealId, 'checkpoint', { checkpointId: checkpoint.id, stage: 'counsel_signoff', proposal });
}

// ============================================================================
// STAGE 6: PLAYBOOK (on-demand, not part of pipeline)
// ============================================================================

async function generateWarrantyPlaybook(dealId, warrantyId) {
    const warranty = await prisma.dealWarranty.findUnique({ where: { id: warrantyId } });
    if (!warranty) throw new Error('Warranty not found');

    const deal = await prisma.deal.findUnique({ where: { id: dealId } });
    const dealConfig = { name: deal.name, perspective: deal.perspective, dealType: deal.dealType, industry: deal.industry, industryProfile: deal.industryProfile };

    // Find related risks
    const relatedRisks = await prisma.dealRisk.findMany({
        where: { dealId, documentId: warranty.documentId },
        take: 5
    });

    const result = await generatePlaybook(warranty, dealConfig, relatedRisks);

    await prisma.dealWarranty.update({
        where: { id: warrantyId },
        data: { playbookPositions: JSON.stringify(result.positions) }
    });

    await logAuditEvent(dealId, 'playbook', 'playbook_generated', {
        warrantyId,
        warrantyName: warranty.name,
        positionCount: result.positions?.length || 0
    });

    return result;
}

// ============================================================================
// PIPELINE ORCHESTRATOR
// ============================================================================

/**
 * Run the pipeline from current stage to completion (or checkpoint).
 * This is the main entry point — called when starting or resuming a pipeline.
 */
async function runPipeline(dealId) {
    const deal = await prisma.deal.findUnique({
        where: { id: dealId },
        include: { job: true }
    });

    if (!deal) throw new Error('Deal not found');
    if (!deal.job) throw new Error('No job found for deal');

    const job = deal.job;
    const control = getPipelineControl(dealId);
    control.paused = false;
    control.aborted = false;

    const startTime = Date.now();

    try {
        const stage = job.currentStage;

        // Stage routing — deterministic pipeline
        if (stage === 'classify') {
            await prisma.deal.update({ where: { id: dealId }, data: { status: 'classifying' } });
            await runClassifyStage(dealId, job);
            if (isAborted(dealId) || isPaused(dealId)) return;

            // Advance to plan
            await prisma.dealJob.update({
                where: { id: job.id },
                data: { currentStage: 'plan', stageProgress: '{}' }
            });
            await runPlanStage(dealId, job);
            // Plan creates a checkpoint and pauses pipeline
            return;
        }

        if (stage === 'plan' || stage === 'plan_review') {
            // User approved plan checkpoint → run analyze
            await prisma.dealJob.update({
                where: { id: job.id },
                data: { currentStage: 'analyze', stageProgress: '{}' }
            });
            await prisma.deal.update({ where: { id: dealId }, data: { status: 'analyzing' } });
            await runAnalyzeStage(dealId, job);
            if (isAborted(dealId) || isPaused(dealId)) return;

            // Guard: check if analysis produced any results before proceeding
            const analyzedDocs = await prisma.dealDocument.count({ where: { dealId, status: 'analyzed' } });
            const risksFound = await prisma.dealRisk.count({ where: { dealId } });
            if (analyzedDocs === 0) {
                console.error(`[MA Pipeline] No documents analyzed successfully — aborting pipeline`);
                await prisma.deal.update({ where: { id: dealId }, data: { status: 'failed' } });
                emit(dealId, 'error', {
                    message: 'Analysis failed for all documents. Check server logs for details.',
                    stage: 'analyze',
                    recoverable: true
                });
                return;
            }
            console.log(`[MA Pipeline] Analysis complete: ${analyzedDocs} docs, ${risksFound} risks. Proceeding to RAG verify.`);
            // Fall through to rag_verify
        }

        if (stage === 'plan' || stage === 'plan_review' || stage === 'analyze') {
            // Advance to RAG_VERIFY
            await prisma.dealJob.update({
                where: { id: job.id },
                data: { currentStage: 'rag_verify', stageProgress: '{}' }
            });
            await prisma.deal.update({ where: { id: dealId }, data: { status: 'rag_verifying' } });
            await runRagVerifyStage(dealId, job);
            if (isAborted(dealId) || isPaused(dealId)) return;

            // Create RISK_REVIEW checkpoint
            await createRiskReviewCheckpoint(dealId, job);
            return; // Wait for user approval
        }

        if (stage === 'risk_review') {
            // User approved risk review → run synthesize
            await prisma.dealJob.update({
                where: { id: job.id },
                data: { currentStage: 'synthesize', stageProgress: '{}' }
            });
            await prisma.deal.update({ where: { id: dealId }, data: { status: 'synthesizing' } });
            await runSynthesizeStage(dealId, job);
            if (isAborted(dealId) || isPaused(dealId)) return;
            // Fall through to report
        }

        if (stage === 'risk_review' || stage === 'synthesize') {
            // Advance to REPORT
            await prisma.dealJob.update({
                where: { id: job.id },
                data: { currentStage: 'report', stageProgress: '{}' }
            });
            await prisma.deal.update({ where: { id: dealId }, data: { status: 'reporting' } });
            await runReportStage(dealId, job);
            if (isAborted(dealId) || isPaused(dealId)) return;

            // Create COUNSEL_SIGNOFF checkpoint
            await createCounselSignoffCheckpoint(dealId, job);
            return;
        }

        if (stage === 'counsel_signoff') {
            // Counsel approved — pipeline complete
            await prisma.deal.update({
                where: { id: dealId },
                data: { status: 'completed', completedAt: new Date() }
            });
            await prisma.dealJob.update({
                where: { id: job.id },
                data: {
                    currentStage: 'completed',
                    completedAt: new Date(),
                    totalDurationMs: { increment: Date.now() - startTime }
                }
            });
            await logAuditEvent(dealId, 'counsel_signoff', 'pipeline_completed', {});
            emit(dealId, 'done', {
                totalDuration: Date.now() - startTime,
                llmCalls: job.totalLLMCalls,
                tokensUsed: job.totalTokens
            });
            return;
        }

        if (stage === 'rag_verify') {
            // Resuming RAG verify
            await prisma.deal.update({ where: { id: dealId }, data: { status: 'rag_verifying' } });
            await runRagVerifyStage(dealId, job);
            if (isAborted(dealId) || isPaused(dealId)) return;
            await createRiskReviewCheckpoint(dealId, job);
            return;
        }

        if (stage === 'report') {
            // Resuming report
            await prisma.deal.update({ where: { id: dealId }, data: { status: 'reporting' } });
            await runReportStage(dealId, job);
            if (isAborted(dealId) || isPaused(dealId)) return;

            await createCounselSignoffCheckpoint(dealId, job);
            return;
        }

        console.log(`[MA Pipeline] Unknown stage: ${stage}`);
    } catch (error) {
        // If aborted (e.g. deal deleted), just log and clean up silently
        if (isAborted(dealId)) {
            console.log(`[MA Pipeline] Pipeline for deal ${dealId} was aborted — cleaning up.`);
        } else {
            console.error(`[MA Pipeline] Error in deal ${dealId}:`, error);
            try {
                await prisma.deal.update({
                    where: { id: dealId },
                    data: { status: 'failed' }
                });
            } catch (updateErr) {
                // Deal may already be deleted — ignore
                console.warn(`[MA Pipeline] Could not update deal status: ${updateErr.message}`);
            }
            emit(dealId, 'error', {
                message: error.message,
                stage: job.currentStage,
                recoverable: true
            });
        }
    } finally {
        activePipelines.delete(dealId);
    }
}

/**
 * Start a new pipeline for a deal.
 */
async function startPipeline(dealId) {
    const deal = await prisma.deal.findUnique({
        where: { id: dealId },
        include: { job: true, documents: { select: { id: true, status: true } } }
    });

    if (!deal) throw new Error('Deal not found');
    const runningStages = ['classify', 'plan', 'analyze', 'rag_verify', 'synthesize', 'report'];
    if (deal.job && runningStages.includes(deal.job.currentStage)) {
        throw new Error('Pipeline already running');
    }

    // Check we have parsed documents
    const parsedDocs = deal.documents.filter(d => ['parsed', 'classified'].includes(d.status));
    if (parsedDocs.length === 0) {
        throw new Error('No parsed documents to analyze');
    }

    // Create or reset job
    let job;
    if (deal.job) {
        job = await prisma.dealJob.update({
            where: { id: deal.job.id },
            data: {
                currentStage: 'classify',
                stageProgress: '{}',
                startedAt: new Date(),
                pausedAt: null,
                completedAt: null,
            }
        });
    } else {
        job = await prisma.dealJob.create({
            data: {
                dealId,
                currentStage: 'classify',
                startedAt: new Date()
            }
        });
    }

    await logAuditEvent(dealId, 'pipeline', 'pipeline_started', {
        documentCount: parsedDocs.length
    });

    // Run pipeline in background (don't await)
    runPipeline(dealId).catch(err => {
        console.error(`[MA Pipeline] Unhandled error:`, err);
    });

    return job;
}

/**
 * Pause a running pipeline.
 */
async function pausePipeline(dealId) {
    const control = getPipelineControl(dealId);
    control.paused = true;

    await prisma.deal.update({
        where: { id: dealId },
        data: { status: 'paused' }
    });

    const job = await prisma.dealJob.findFirst({ where: { dealId } });
    if (job) {
        await prisma.dealJob.update({
            where: { id: job.id },
            data: { pausedAt: new Date() }
        });
    }

    emit(dealId, 'paused', { stage: job?.currentStage });
}

/**
 * Resume a paused pipeline.
 */
async function resumePipeline(dealId) {
    const job = await prisma.dealJob.findFirst({ where: { dealId } });
    if (!job) throw new Error('No job found for deal');

    await prisma.dealJob.update({
        where: { id: job.id },
        data: { pausedAt: null }
    });

    // Run pipeline in background
    runPipeline(dealId).catch(err => {
        console.error(`[MA Pipeline] Resume error:`, err);
    });

    return job;
}

/**
 * Approve a checkpoint and continue the pipeline.
 */
async function approveCheckpoint(dealId, checkpointId, userId) {
    const checkpoint = await prisma.dealCheckpoint.update({
        where: { id: checkpointId },
        data: {
            status: 'approved',
            reviewedBy: userId,
            reviewedAt: new Date()
        }
    });

    await logAuditEvent(dealId, checkpoint.stage, 'checkpoint_approved', {
        checkpointId,
        reviewedBy: userId
    });

    // Resume pipeline after checkpoint
    await resumePipeline(dealId);

    return checkpoint;
}

/**
 * Reject a checkpoint with feedback.
 */
async function rejectCheckpoint(dealId, checkpointId, userId, feedback) {
    const checkpoint = await prisma.dealCheckpoint.update({
        where: { id: checkpointId },
        data: {
            status: 'rejected',
            reviewedBy: userId,
            reviewedAt: new Date(),
            feedback
        }
    });

    await prisma.deal.update({
        where: { id: dealId },
        data: { status: 'paused' }
    });

    emit(dealId, 'checkpoint_rejected', {
        checkpointId,
        stage: checkpoint.stage,
        feedback
    });

    return checkpoint;
}

// ============================================================================
// HELPERS
// ============================================================================

function parseStageProgress(json) {
    try { return JSON.parse(json || '{}'); }
    catch { return {}; }
}

async function updateJobProgress(jobId, stage, completedSet, totalItems, durationMs = 0) {
    await prisma.dealJob.update({
        where: { id: jobId },
        data: {
            currentStage: stage,
            stageProgress: JSON.stringify({
                completedItems: Array.from(completedSet),
                totalItems
            }),
            totalLLMCalls: { increment: 1 },
            totalDurationMs: { increment: durationMs }
        }
    });
}

async function savePauseState(dealId, jobId, stage, completedSet, totalItems) {
    await prisma.deal.update({
        where: { id: dealId },
        data: { status: 'paused' }
    });
    await prisma.dealJob.update({
        where: { id: jobId },
        data: {
            currentStage: stage,
            stageProgress: JSON.stringify({
                completedItems: Array.from(completedSet),
                totalItems
            }),
            pausedAt: new Date()
        }
    });
}

async function logAuditEvent(dealId, stage, eventType, detail, inputTokens = 0, outputTokens = 0, durationMs = 0) {
    try {
        await prisma.dealAuditEvent.create({
            data: {
                dealId,
                stage,
                eventType,
                detail: JSON.stringify(detail),
                inputTokens,
                outputTokens,
                durationMs
            }
        });
    } catch (err) {
        console.error('[MA Audit] Failed to log event:', err.message);
    }
}

// ============================================================================
// EXPORTS
// ============================================================================

exports.subscribe = subscribe;
exports.emit = emit;
exports.ingestDocument = ingestDocument;
exports.startPipeline = startPipeline;
exports.pausePipeline = pausePipeline;
exports.resumePipeline = resumePipeline;
exports.abortPipeline = abortPipeline;
exports.approveCheckpoint = approveCheckpoint;
exports.rejectCheckpoint = rejectCheckpoint;
exports.runPipeline = runPipeline;
exports.generateWarrantyPlaybook = generateWarrantyPlaybook;
