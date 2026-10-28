"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeDocumentParallel = analyzeDocumentParallel;
exports.analyzeDocumentFast = analyzeDocumentFast;
exports.analyzeDocument = analyzeDocument;
const modelRouter_1 = require("./modelRouter");
// ClauseCache disabled - embedding lookups overloaded GPU
// const clauseCache_1 = require("./clauseCache");
function splitIntoChunks(text, chunkSize = 6000, overlap = 300) {
    const chunks = [];
    let start = 0;
    while (start < text.length) {
        const end = Math.min(start + chunkSize, text.length);
        chunks.push(text.slice(start, end));
        start = end - overlap;
        if (start >= text.length - overlap)
            break;
    }
    return chunks;
}
async function preloadRAGContext(documentSnippet, options) {
    console.log('[PARALLEL] RAG disabled for doc analysis (LLM-only mode)');
    return {
        clausePatterns: '',
        riskBenchmarks: '',
        deadlinePatterns: '',
    };
}
async function processChunkForClauses(chunk, index, ragContext, options) {
    const { userTier = 'free', jurisdiction } = options;
    // ClauseCache disabled - embedding lookups took 16s each and overloaded GPU
    const prompt = `Analyze this document section and extract any legal clauses, terms, or provisions.

${ragContext.clausePatterns ? `REFERENCE CLAUSE PATTERNS:\n${ragContext.clausePatterns}\n\n` : ''}DOCUMENT SECTION:
${chunk.substring(0, 6000)}

Return a JSON object with:
{
  "clauses": [
    {
      "title": "Clause title/name",
      "content": "The actual clause text",
      "type": "termination|liability|indemnity|confidentiality|payment|warranty|other",
      "importance": "high|medium|low"
    }
  ]
}

Return ONLY the JSON object, no additional text.`;
    const systemPrompt = `You are a legal document analyzer using The Archivist persona.

CRITICAL GROUNDING RULES:
- Extract clauses ONLY from the provided document section
- Use the reference patterns to identify clause types accurately
- Do NOT invent clauses not present in the document
- Mark importance based on standard patterns from knowledge base`;
    try {
        const hasRAG = !!(ragContext.clausePatterns || ragContext.riskBenchmarks);
        const result = await (0, modelRouter_1.executeWithRouter)(prompt, {
            taskType: 'clause_extraction',
            userTier,
            context: {
                inputLength: chunk.length,
                requiresAccuracy: true,
                isLegalContent: true,
                hasSourceDocument: true,
                hasRAGContext: hasRAG,
            },
            systemPrompt,
            temperature: 0.1,
        });
        const jsonMatch = result.response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            const clauses = parsed.clauses || [];
            // Cache storage disabled
            return {
                index,
                content: chunk.substring(0, 200),
                analysis: clauses
            };
        }
        return { index, content: chunk.substring(0, 200), analysis: [] };
    }
    catch (error) {
        console.error(`[PARALLEL] Error processing chunk ${index}:`, error);
        return {
            index,
            content: chunk.substring(0, 200),
            analysis: [],
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
}
async function processChunkForRisks(chunk, index, ragContext, options) {
    const { userTier = 'free', jurisdiction } = options;
    // ClauseCache disabled - embedding lookups took 16s each and overloaded GPU
    const prompt = `Analyze this document section for potential legal risks or concerns.

${ragContext.riskBenchmarks ? `RISK BENCHMARKS:\n${ragContext.riskBenchmarks}\n\n` : ''}DOCUMENT SECTION:
${chunk.substring(0, 6000)}

Return a JSON object with:
{
  "risks": [
    {
      "title": "Risk title",
      "description": "Brief explanation of the risk",
      "severity": "high|medium|low",
      "recommendation": "What to do about it"
    }
  ]
}

Return ONLY the JSON object, no additional text.`;
    const systemPrompt = `You are a legal risk analyst using The Archivist persona.

CRITICAL GROUNDING RULES:
- Identify risks ONLY from what is present (or notably absent) in the document
- Use risk benchmarks to calibrate severity levels
- Do NOT invent hypothetical risks
- Reference standard protective clauses when making recommendations`;
    try {
        const hasRAG = !!(ragContext.clausePatterns || ragContext.riskBenchmarks);
        const result = await (0, modelRouter_1.executeWithRouter)(prompt, {
            taskType: 'risk_assessment',
            userTier,
            context: {
                inputLength: chunk.length,
                requiresAccuracy: true,
                isLegalContent: true,
                hasSourceDocument: true,
                hasRAGContext: hasRAG,
            },
            systemPrompt,
            temperature: 0.1,
        });
        const jsonMatch = result.response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            const risks = parsed.risks || [];
            // Cache storage disabled
            return {
                index,
                content: chunk.substring(0, 200),
                analysis: risks
            };
        }
        return { index, content: chunk.substring(0, 200), analysis: [] };
    }
    catch (error) {
        console.error(`[PARALLEL] Error processing risks for chunk ${index}:`, error);
        return {
            index,
            content: chunk.substring(0, 200),
            analysis: [],
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
}
async function extractDatesFromText(text, ragContext, options) {
    const { userTier = 'free' } = options;
    const prompt = `Extract all important dates, deadlines, and time-sensitive information from this document.

${ragContext.deadlinePatterns ? `STANDARD DEADLINE PATTERNS:\n${ragContext.deadlinePatterns}\n\n` : ''}DOCUMENT:
${text.substring(0, 8000)}

Return a JSON object with:
{
  "dates": [
    {
      "date": "YYYY-MM-DD format ONLY (e.g., '2025-03-15'). If the document mentions a month without a specific day, use the 1st of the month. If only a year, use January 1st of that year. For date ranges like 'December 2024 – April 2025', use the END date.",
      "relativePeriod": "For relative deadlines (e.g., '30 days after signing', 'within 7 days'), put the relative text here. Leave empty if a specific date exists.",
      "originalText": "The exact text from the document describing this date",
      "description": "What this date represents",
      "importance": "critical|high|medium|low",
      "isDeadline": true/false
    }
  ]
}

IMPORTANT: The "date" field MUST be in YYYY-MM-DD format or left empty if only a relative period exists.

Return ONLY the JSON object, no additional text.`;
    const systemPrompt = `You are a legal document date extractor using The Archivist persona.

CRITICAL GROUNDING RULES:
- Extract dates ONLY from the provided document
- Use standard deadline patterns to identify importance levels
- Do NOT invent dates not present in the document
- Mark critical any deadlines with legal consequences`;
    try {
        const hasRAG = !!ragContext.deadlinePatterns;
        const result = await (0, modelRouter_1.executeWithRouter)(prompt, {
            taskType: 'deadline_extraction',
            userTier,
            context: {
                inputLength: text.length,
                requiresAccuracy: true,
                isLegalContent: true,
                hasSourceDocument: true,
                hasRAGContext: hasRAG,
            },
            systemPrompt,
            temperature: 0.05,
        });
        const jsonMatch = result.response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            return parsed.dates || [];
        }
        return [];
    }
    catch (error) {
        console.error('[PARALLEL] Error extracting dates:', error);
        return [];
    }
}
async function generateSummary(text, options) {
    const { userTier = 'free' } = options;
    const prompt = `Provide a concise summary of this legal document (2-3 paragraphs).

DOCUMENT:
${text.substring(0, 8000)}

Focus on:
- Document type and purpose
- Key parties involved
- Main obligations and rights
- Important terms and conditions

Write the summary directly, no JSON formatting needed.`;
    const systemPrompt = `You are a legal document summarizer using The Archivist persona.

CRITICAL GROUNDING RULES:
- Summarize ONLY what is present in the document
- Do NOT make assumptions about missing information
- Be factual and accurate`;
    try {
        const result = await (0, modelRouter_1.executeWithRouter)(prompt, {
            taskType: 'document_analysis',
            userTier,
            context: {
                inputLength: text.length,
                requiresAccuracy: true,
                isLegalContent: true,
                hasSourceDocument: true,
            },
            systemPrompt,
            temperature: 0.3,
        });
        return result.response.trim();
    }
    catch (error) {
        console.error('[PARALLEL] Error generating summary:', error);
        return 'Unable to generate summary.';
    }
}
function mergeClauses(chunkResults) {
    const allClauses = [];
    const seenTitles = new Set();
    for (const result of chunkResults) {
        if (!Array.isArray(result.analysis))
            continue;
        for (const clause of result.analysis) {
            const normalizedTitle = clause.title?.toLowerCase().trim() || '';
            if (normalizedTitle && !seenTitles.has(normalizedTitle)) {
                seenTitles.add(normalizedTitle);
                allClauses.push(clause);
            }
        }
    }
    return allClauses;
}
function mergeRisks(chunkResults) {
    const allRisks = [];
    const seenTitles = new Set();
    for (const result of chunkResults) {
        if (!Array.isArray(result.analysis))
            continue;
        for (const risk of result.analysis) {
            const normalizedTitle = risk.title?.toLowerCase().trim() || '';
            if (normalizedTitle && !seenTitles.has(normalizedTitle)) {
                seenTitles.add(normalizedTitle);
                allRisks.push(risk);
            }
        }
    }
    const severityOrder = { high: 0, medium: 1, low: 2 };
    return allRisks.sort((a, b) => (severityOrder[a.severity] || 2) -
        (severityOrder[b.severity] || 2));
}
async function analyzeDocumentParallel(text, options = {}) {
    const startTime = Date.now();
    const errors = [];
    let chunksFailed = 0;
    const chunks = splitIntoChunks(text);
    console.log(`[PARALLEL] Processing ${chunks.length} chunks sequentially (stable mode)`);
    const ragContext = await preloadRAGContext(text.substring(0, 2000), options);
    // Sequential processing to avoid GPU overload (was 3)
    const maxConcurrent = 1;
    const clauseResults = [];
    const riskResults = [];
    for (let i = 0; i < chunks.length; i += maxConcurrent) {
        const batch = chunks.slice(i, i + maxConcurrent);
        const batchSettled = await Promise.allSettled(batch.map((chunk, idx) => processChunkForClauses(chunk, i + idx, ragContext, options)));
        for (const result of batchSettled) {
            if (result.status === 'fulfilled') {
                clauseResults.push(result.value);
                if (result.value.error) {
                    errors.push(`Clause chunk: ${result.value.error}`);
                }
            }
            else {
                chunksFailed++;
                const errorMsg = result.reason?.message || 'Unknown error';
                errors.push(`Clause extraction failed: ${errorMsg}`);
                console.error(`[PARALLEL] Clause batch error:`, errorMsg);
            }
        }
        console.log(`[PARALLEL] Clauses: ${clauseResults.length}/${chunks.length} chunks processed`);
    }
    for (let i = 0; i < chunks.length; i += maxConcurrent) {
        const batch = chunks.slice(i, i + maxConcurrent);
        const batchSettled = await Promise.allSettled(batch.map((chunk, idx) => processChunkForRisks(chunk, i + idx, ragContext, options)));
        for (const result of batchSettled) {
            if (result.status === 'fulfilled') {
                riskResults.push(result.value);
                if (result.value.error) {
                    errors.push(`Risk chunk: ${result.value.error}`);
                }
            }
            else {
                chunksFailed++;
                const errorMsg = result.reason?.message || 'Unknown error';
                errors.push(`Risk assessment failed: ${errorMsg}`);
                console.error(`[PARALLEL] Risk batch error:`, errorMsg);
            }
        }
        console.log(`[PARALLEL] Risks: ${riskResults.length}/${chunks.length} chunks processed`);
    }
    let summary = 'Document analysis completed.';
    let importantDates = [];
    const [summaryResult, datesResult] = await Promise.allSettled([
        generateSummary(text, options),
        extractDatesFromText(text, ragContext, options)
    ]);
    if (summaryResult.status === 'fulfilled') {
        summary = summaryResult.value;
    }
    else {
        errors.push(`Summary generation failed: ${summaryResult.reason?.message || 'Unknown error'}`);
    }
    if (datesResult.status === 'fulfilled') {
        importantDates = datesResult.value;
    }
    else {
        errors.push(`Date extraction failed: ${datesResult.reason?.message || 'Unknown error'}`);
    }
    const clauses = mergeClauses(clauseResults);
    const riskFlags = mergeRisks(riskResults);
    const duration = Date.now() - startTime;
    const chunksSucceeded = clauseResults.length + riskResults.length;
    const totalExpected = chunks.length * 2;
    const isPartial = chunksFailed > 0 || errors.length > 0;
    console.log(`[PARALLEL] Analysis completed in ${duration}ms - ${isPartial ? 'PARTIAL' : 'COMPLETE'} (${chunksSucceeded}/${totalExpected} operations succeeded)`);
    return {
        summary,
        clauses,
        riskFlags,
        importantDates,
        duration,
        chunksProcessed: chunks.length,
        ragUsed: ragContext.clausePatterns.length > 0 || ragContext.riskBenchmarks.length > 0,
        sourcesCount: (ragContext.clausePatterns.match(/\[Pattern/g) || []).length +
            (ragContext.riskBenchmarks.match(/\[Pattern/g) || []).length,
        partial: isPartial,
        chunksSucceeded: Math.floor(chunksSucceeded / 2),
        chunksFailed,
        errors: errors.length > 0 ? errors.slice(0, 5) : undefined,
    };
}
async function analyzeDocumentFast(text, options = {}) {
    const startTime = Date.now();
    const errors = [];
    const ragContext = await preloadRAGContext(text.substring(0, 2000), options);
    // Run sequentially to avoid GPU overload
    let summary = 'Document analysis completed.';
    let clauses = [];
    let riskFlags = [];
    let importantDates = [];

    try {
        summary = await generateSummary(text, options);
    } catch (e) {
        errors.push(`Summary: ${e.message}`);
    }

    try {
        const clauseResult = await processChunkForClauses(text, 0, ragContext, options);
        clauses = clauseResult.analysis || [];
    } catch (e) {
        errors.push(`Clauses: ${e.message}`);
    }

    try {
        const riskResult = await processChunkForRisks(text, 0, ragContext, options);
        riskFlags = riskResult.analysis || [];
    } catch (e) {
        errors.push(`Risks: ${e.message}`);
    }

    try {
        importantDates = await extractDatesFromText(text, ragContext, options);
    } catch (e) {
        errors.push(`Dates: ${e.message}`);
    }

    const duration = Date.now() - startTime;
    const isPartial = errors.length > 0;
    console.log(`[PARALLEL] Fast analysis completed in ${duration}ms - ${isPartial ? 'PARTIAL' : 'COMPLETE'}`);
    return {
        summary,
        clauses,
        riskFlags,
        importantDates,
        duration,
        chunksProcessed: 1,
        ragUsed: ragContext.clausePatterns.length > 0 || ragContext.riskBenchmarks.length > 0,
        sourcesCount: (ragContext.clausePatterns.match(/\[Pattern/g) || []).length +
            (ragContext.riskBenchmarks.match(/\[Pattern/g) || []).length,
        partial: isPartial,
        chunksSucceeded: isPartial ? 0 : 1,
        chunksFailed: isPartial ? 1 : 0,
        errors: errors.length > 0 ? errors : undefined,
    };
}
async function analyzeDocument(text, options = {}) {
    if (text.length < 8000) {
        return analyzeDocumentFast(text, options);
    }
    return analyzeDocumentParallel(text, options);
}
exports.default = {
    analyzeDocument,
    analyzeDocumentParallel,
    analyzeDocumentFast,
    splitIntoChunks,
};
