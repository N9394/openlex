"use strict";
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
exports.LLMRetryExhaustedError = exports.LLMParseError = exports.AnalysisTimeoutError = exports.ModelNotFoundError = exports.OllamaConnectionError = exports.LLMError = void 0;
exports.checkLLMHealth = checkLLMHealth;
exports.analyzeDocument = analyzeDocument;
exports.extractClauses = extractClauses;
exports.callLLM = callLLM;
exports.callLLMStream = callLLMStream;
exports.generateFlashcardsWithAI = generateFlashcardsWithAI;
exports.analyzeDocumentForStudy = analyzeDocumentForStudy;
exports.validateAnswer = validateAnswer;
exports.extractRelationshipsFromDocument = extractRelationshipsFromDocument;
exports.extractTimelineFromDocument = extractTimelineFromDocument;
const undici_1 = require("undici");
const aiContext_1 = require("./aiContext");
const HTTP_AGENT_TIMEOUT = 15 * 60 * 1000;
const llmAgent = new undici_1.Agent({
    headersTimeout: HTTP_AGENT_TIMEOUT,
    bodyTimeout: HTTP_AGENT_TIMEOUT,
    keepAliveTimeout: 15 * 60 * 1000,
});
const MAX_CHUNK_TIMEOUT = 15 * 60 * 1000;
class LLMError extends Error {
    code;
    constructor(message, code) {
        super(message);
        this.code = code;
        this.name = 'LLMError';
    }
}
exports.LLMError = LLMError;
class OllamaConnectionError extends LLMError {
    constructor(url, cause) {
        super(`Cannot connect to Ollama at ${url}. Ensure Ollama is running with 'ollama serve'.`, 'OLLAMA_CONNECTION_ERROR');
        this.name = 'OllamaConnectionError';
        if (cause)
            this.cause = cause;
    }
}
exports.OllamaConnectionError = OllamaConnectionError;
class ModelNotFoundError extends LLMError {
    constructor(model) {
        super(`Model '${model}' not found. Pull it with 'ollama pull ${model}'.`, 'MODEL_NOT_FOUND');
        this.name = 'ModelNotFoundError';
    }
}
exports.ModelNotFoundError = ModelNotFoundError;
class AnalysisTimeoutError extends LLMError {
    constructor(timeoutMs) {
        super(`Document analysis timed out after ${Math.round(timeoutMs / 1000)} seconds. Try a shorter document or increase timeout.`, 'ANALYSIS_TIMEOUT');
        this.name = 'AnalysisTimeoutError';
    }
}
exports.AnalysisTimeoutError = AnalysisTimeoutError;
class LLMParseError extends LLMError {
    constructor(details) {
        super(`Failed to parse LLM response: ${details}. The model returned invalid JSON.`, 'LLM_PARSE_ERROR');
        this.name = 'LLMParseError';
    }
}
exports.LLMParseError = LLMParseError;
class LLMRetryExhaustedError extends LLMError {
    constructor(attempts, lastError) {
        super(`Document analysis failed after ${attempts} attempts. Ensure Ollama is running and the model is available.`, 'LLM_RETRY_EXHAUSTED');
        this.name = 'LLMRetryExhaustedError';
        if (lastError)
            this.cause = lastError;
    }
}
exports.LLMRetryExhaustedError = LLMRetryExhaustedError;
const LLM_REQUEST_TIMEOUT = parseInt(process.env.LLM_REQUEST_TIMEOUT || '120000', 10);
const LLM_MAX_CONCURRENT = parseInt(process.env.LLM_MAX_CONCURRENT || '2', 10);
const ALLOW_MOCK_FALLBACK = process.env.ALLOW_MOCK_FALLBACK === 'true' && process.env.NODE_ENV !== 'production';
class LLMRequestQueue {
    queue = [];
    activeRequests = 0;
    maxConcurrent;
    queueTimeout;
    constructor(maxConcurrent = 3, queueTimeout = 120000) {
        this.maxConcurrent = maxConcurrent;
        this.queueTimeout = queueTimeout;
    }
    async enqueue(execute) {
        if (this.activeRequests < this.maxConcurrent) {
            return this.executeRequest(execute);
        }
        return new Promise((resolve, reject) => {
            const request = {
                execute,
                resolve,
                reject,
                enqueuedAt: Date.now(),
            };
            this.queue.push(request);
            console.log(`[LLM Queue] Request queued. Queue size: ${this.queue.length}, Active: ${this.activeRequests}`);
        });
    }
    async executeRequest(execute) {
        this.activeRequests++;
        console.log(`[LLM Queue] Starting request. Active: ${this.activeRequests}/${this.maxConcurrent}`);
        try {
            const result = await execute();
            return result;
        }
        finally {
            this.activeRequests--;
            this.processQueue();
        }
    }
    processQueue() {
        if (this.queue.length === 0 || this.activeRequests >= this.maxConcurrent) {
            return;
        }
        const request = this.queue.shift();
        const waitTime = Date.now() - request.enqueuedAt;
        if (waitTime > this.queueTimeout) {
            request.reject(new AnalysisTimeoutError(this.queueTimeout));
            this.processQueue();
            return;
        }
        console.log(`[LLM Queue] Dequeuing request after ${Math.round(waitTime / 1000)}s wait`);
        this.executeRequest(request.execute)
            .then(request.resolve)
            .catch(request.reject);
    }
    getStatus() {
        return {
            queueSize: this.queue.length,
            activeRequests: this.activeRequests,
            maxConcurrent: this.maxConcurrent,
        };
    }
}
const llmQueue = new LLMRequestQueue(LLM_MAX_CONCURRENT);
async function checkLLMHealth() {
    const provider = process.env.LLM_PROVIDER || 'ollama';
    const model = process.env.OLLAMA_MODEL || 'qwen3:14b';
    const primaryUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    const fallbackUrl = process.env.OLLAMA_FALLBACK_URL || '';
    const queueStatus = llmQueue.getStatus();
    const baseStatus = {
        provider,
        model,
        queue: {
            active: queueStatus.activeRequests,
            waiting: queueStatus.queueSize,
            maxConcurrent: queueStatus.maxConcurrent,
        },
    };
    if (provider === 'mock') {
        return {
            ...baseStatus,
            available: true,
            error: 'Using mock provider - not suitable for production',
        };
    }
    if (provider !== 'ollama') {
        return {
            ...baseStatus,
            available: false,
            error: `Provider '${provider}' health check not implemented`,
        };
    }
    // Helper: try connecting to an Ollama instance with a short timeout
    async function tryOllama(url, timeoutMs) {
        const response = await fetch(`${url}/api/tags`, {
            signal: AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok) {
            throw new Error(`Ollama at ${url} returned status ${response.status}`);
        }
        const data = await response.json();
        const availableModels = data.models?.map(m => m.name) || [];
        const modelAvailable = availableModels.some(m => m.startsWith(model.split(':')[0]));
        return { availableModels, modelAvailable };
    }
    // Try primary (GPU) Ollama with 5s timeout
    try {
        const result = await tryOllama(primaryUrl, 5000);
        if (!result.modelAvailable) {
            return {
                ...baseStatus,
                available: false,
                ollamaSource: 'primary',
                error: `Model '${model}' not found on primary. Available: ${result.availableModels.join(', ') || 'none'}`,
            };
        }
        return {
            ...baseStatus,
            available: true,
            ollamaSource: 'primary',
        };
    }
    catch (primaryError) {
        const primaryMsg = primaryError instanceof Error ? primaryError.message : 'Unknown error';
        // Try fallback (CPU) Ollama with 5s timeout
        if (fallbackUrl) {
            try {
                const result = await tryOllama(fallbackUrl, 5000);
                if (!result.modelAvailable) {
                    return {
                        ...baseStatus,
                        available: false,
                        ollamaSource: 'fallback',
                        error: `Model '${model}' not found on fallback. Available: ${result.availableModels.join(', ') || 'none'}`,
                    };
                }
                return {
                    ...baseStatus,
                    available: true,
                    ollamaSource: 'fallback',
                    warning: `Primary Ollama unreachable (${primaryMsg}), using CPU fallback`,
                };
            }
            catch (fallbackError) {
                const fallbackMsg = fallbackError instanceof Error ? fallbackError.message : 'Unknown error';
                return {
                    ...baseStatus,
                    available: false,
                    error: `Primary Ollama: ${primaryMsg}; Fallback Ollama: ${fallbackMsg}`,
                };
            }
        }
        return {
            ...baseStatus,
            available: false,
            error: `Cannot connect to Ollama: ${primaryMsg}`,
        };
    }
}
async function analyzeDocument(text, language = 'en', jurisdiction = 'US', options = {}) {
    const provider = process.env.LLM_PROVIDER || 'ollama';
    console.log(`[LLM] Using provider: ${provider}, language: ${language}, jurisdiction: ${jurisdiction}, depth: ${options.analysisDepth ?? 'standard'}`);
    switch (provider) {
        case 'ollama':
            return await analyzeWithOllama(text, language, jurisdiction, options);
        case 'openai':
            return await analyzeWithOpenAI(text, language, jurisdiction);
        case 'mock':
            console.warn('[LLM] WARNING: Using mock data - not suitable for production!');
            return await analyzeWithMockData(text, language);
        default:
            throw new Error(`Unknown LLM provider: ${provider}. Set LLM_PROVIDER to 'ollama', 'openai', or 'mock'`);
    }
}
async function extractClauses(text, language = 'en') {
    const provider = process.env.LLM_PROVIDER || 'ollama';
    console.log(`[LLM] Extracting clauses using provider: ${provider}, language: ${language}`);
    switch (provider) {
        case 'ollama':
            return await extractClausesWithOllama(text, language);
        case 'openai':
            return await extractClausesWithOpenAI(text, language);
        case 'mock':
            console.warn('[LLM] WARNING: Using mock clause data - not suitable for production!');
            return await extractClausesWithMockData(text, language);
        default:
            throw new Error(`Unknown LLM provider: ${provider}. Set LLM_PROVIDER to 'ollama', 'openai', or 'mock'`);
    }
}
const CHUNK_SIZE = 8000;
const CHUNK_OVERLAP = 500;
function chunkDocument(text) {
    if (text.length <= CHUNK_SIZE) {
        return [text];
    }
    const chunks = [];
    let start = 0;
    while (start < text.length) {
        let end = start + CHUNK_SIZE;
        if (end < text.length) {
            const breakPoint = text.lastIndexOf('\n\n', end);
            if (breakPoint > start + CHUNK_SIZE / 2) {
                end = breakPoint;
            }
            else {
                const sentenceBreak = text.lastIndexOf('. ', end);
                if (sentenceBreak > start + CHUNK_SIZE / 2) {
                    end = sentenceBreak + 1;
                }
            }
        }
        chunks.push(text.slice(start, end));
        start = end - CHUNK_OVERLAP;
    }
    return chunks;
}
function mergeAnalysisResults(results) {
    if (results.length === 1)
        return results[0];
    const summaries = results.map(r => r.summary).filter(s => s.title || s.content);
    const mergedSummary = {
        title: summaries[0]?.title || 'Document Analysis',
        content: summaries.map(s => s.content).join(' '),
        keyPoints: [...new Set(summaries.flatMap(s => s.keyPoints))],
    };
    const clauseMap = new Map();
    for (const result of results) {
        for (const clause of result.keyClauses) {
            const key = clause.title.toLowerCase();
            if (!clauseMap.has(key) || clause.riskLevel === 'high') {
                clauseMap.set(key, clause);
            }
        }
    }
    const riskSet = new Set();
    const riskFlags = results.flatMap(r => r.riskFlags).filter(f => {
        const key = f.issue || f.category;
        if (riskSet.has(key))
            return false;
        riskSet.add(key);
        return true;
    });
    const dateMap = new Map();
    for (const result of results) {
        for (const date of result.importantDates) {
            dateMap.set(date.date, date);
        }
    }
    const avgReadability = Math.round(results.reduce((sum, r) => sum + r.readabilityScore.score, 0) / results.length);
    const avgRisk = Math.round(results.reduce((sum, r) => sum + r.overallRiskScore.score, 0) / results.length);
    const avgClarity = Math.round(results.reduce((sum, r) => sum + r.clarityScore.overall, 0) / results.length);
    const getGrade = (score) => {
        if (score >= 95)
            return 'A+';
        if (score >= 90)
            return 'A';
        if (score >= 85)
            return 'B+';
        if (score >= 80)
            return 'B';
        if (score >= 75)
            return 'C+';
        if (score >= 70)
            return 'C';
        if (score >= 60)
            return 'D';
        return 'F';
    };
    return {
        summary: mergedSummary,
        keyClauses: Array.from(clauseMap.values()),
        riskFlags,
        importantDates: Array.from(dateMap.values()),
        readabilityScore: {
            score: avgReadability,
            grade: avgReadability >= 70 ? 'Easy' : avgReadability >= 40 ? 'Moderate' : 'Difficult',
            explanation: `Average readability score of ${avgReadability}/100`,
        },
        overallRiskScore: {
            score: avgRisk,
            level: avgRisk <= 30 ? 'low' : avgRisk <= 60 ? 'medium' : 'high',
            explanation: `Combined risk assessment score of ${avgRisk}/100`,
        },
        missingElements: [...new Set(results.flatMap(r => r.missingElements))],
        clarityScore: {
            overall: avgClarity,
            grade: getGrade(avgClarity),
            breakdown: {
                completeness: Math.round(results.reduce((sum, r) => sum + r.clarityScore.breakdown.completeness, 0) / results.length),
                fairness: Math.round(results.reduce((sum, r) => sum + r.clarityScore.breakdown.fairness, 0) / results.length),
                structure: Math.round(results.reduce((sum, r) => sum + r.clarityScore.breakdown.structure, 0) / results.length),
                precision: Math.round(results.reduce((sum, r) => sum + r.clarityScore.breakdown.precision, 0) / results.length),
            },
            strengths: [...new Set(results.flatMap(r => r.clarityScore.strengths))],
            weaknesses: [...new Set(results.flatMap(r => r.clarityScore.weaknesses))],
            recommendation: results[0]?.clarityScore.recommendation || 'Review completed.',
        },
    };
}
function detectDocumentComplexity(text) {
    const charCount = text.length;
    const wordCount = text.split(/\s+/).length;
    const avgWordLength = charCount / wordCount;
    const legalTerms = (text.match(/\b(shall|whereas|notwithstanding|hereinafter|indemnify|covenant|warrant|liability|jurisdiction|arbitration|confidential|terminate|breach|remedy|damages|force majeure)\b/gi) || []).length;
    const sectionCount = (text.match(/\b(section|article|clause|paragraph|§)\s*\d/gi) || []).length;
    const definitionCount = (text.match(/"[^"]+"\s+(means|refers|shall mean)/gi) || []).length;
    let complexityScore = 0;
    if (charCount > 15000)
        complexityScore += 3;
    else if (charCount > 8000)
        complexityScore += 2;
    else if (charCount > 4000)
        complexityScore += 1;
    const legalDensity = legalTerms / (wordCount / 100);
    if (legalDensity > 5)
        complexityScore += 3;
    else if (legalDensity > 2)
        complexityScore += 2;
    else if (legalDensity > 1)
        complexityScore += 1;
    if (sectionCount > 10)
        complexityScore += 2;
    else if (sectionCount > 5)
        complexityScore += 1;
    if (definitionCount > 5)
        complexityScore += 2;
    else if (definitionCount > 2)
        complexityScore += 1;
    if (avgWordLength > 6)
        complexityScore += 1;
    if (charCount > 1000) {
        return 'complex';
    }
    return complexityScore >= 5 ? 'complex' : 'simple';
}
async function analyzeWithOllama(text, language = 'en', jurisdiction = 'US', options = {}) {
    const ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    const analysisDepth = options.analysisDepth ?? 'standard';
    const docComplexity = detectDocumentComplexity(text);
    const fastModel = process.env.OLLAMA_MODEL_TIER_1 || 'qwen3:14b';
    const fullModel = process.env.OLLAMA_MODEL || 'qwen3:14b';
    const selectedModel = docComplexity === 'simple' && analysisDepth !== 'thorough'
        ? fastModel
        : fullModel;
    const cacheMessages = [
        { role: 'system', content: `analyze:${language}:${jurisdiction}:${analysisDepth}:${selectedModel}` },
        { role: 'user', content: text }
    ];
    const cachedResult = (0, llmCache_1.getCachedResponse)(cacheMessages, {
        taskType: 'document_analysis',
        model: selectedModel
    });
    if (cachedResult) {
        try {
            const parsed = JSON.parse(cachedResult);
            console.log(`[LLM] Using cached analysis result`);
            return parsed;
        }
        catch {
            console.log(`[LLM] Cached result invalid, re-analyzing`);
        }
    }
    const DEPTH_TOKENS = {
        quick: 2048,
        standard: 6144,
        thorough: 8192,
    };
    const numPredict = DEPTH_TOKENS[analysisDepth];
    const inputTokensEst = Math.ceil(text.length / 3); const numCtx = Math.min(40960, Math.max(8192, inputTokensEst + numPredict + 2048));
    console.log(`[LLM] Document complexity: ${docComplexity}, model: ${selectedModel}, depth: ${analysisDepth}, predict: ${numPredict}, ctx: ${numCtx}`);
    const chunks = chunkDocument(text);
    const isChunked = chunks.length > 1;
    console.log(`[LLM] Calling Ollama at ${ollamaUrl} with model ${selectedModel}`);
    console.log(`[LLM] Document: ${text.length} chars${isChunked ? ` → ${chunks.length} chunks` : ''}`);
    const ragSources = options.ragSources || [];
    const results = [];
    for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
        const chunk = chunks[chunkIdx];
        const chunkLabel = isChunked ? ` [chunk ${chunkIdx + 1}/${chunks.length}]` : '';
        console.log(`[LLM]${chunkLabel} Processing ${chunk.length} chars...`);
        const result = await llmQueue.enqueue(() => analyzeChunk(chunk, language, jurisdiction, { ollamaUrl, model: selectedModel, numPredict, numCtx, chunkLabel, ragSources }));
        results.push(result);
    }
    return isChunked ? mergeAnalysisResults(results) : results[0];
}
async function analyzeChunk(text, language, jurisdiction, config) {
    const { ollamaUrl, model, numPredict, numCtx, chunkLabel, ragSources } = config;
    const maxRetries = 3;
    const is1BModel = model.includes('1b') || model.includes(':1b');
    const { system, user } = is1BModel
        ? createAnalysisPromptFor1B(text, language)
        : createAnalysisPrompt(text, language, jurisdiction, undefined, ragSources);
    if (is1BModel) {
        console.log(`[LLM]${chunkLabel} Using optimized 1B prompt`);
    }
    const { enforceTemperatureLimit: enforceTemp } = await Promise.resolve().then(() => __importStar(require('./modelRouter')));
    let lastError;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            if (attempt > 1) {
                const backoffMs = Math.pow(2, attempt - 2) * 1000;
                console.log(`[LLM]${chunkLabel} Waiting ${backoffMs}ms before retry...`);
                await new Promise(resolve => setTimeout(resolve, backoffMs));
            }
            const baseTimeout = LLM_REQUEST_TIMEOUT;
            const charTimeout = Math.ceil(text.length / 1000) * 20000;
            const calculatedTimeout = baseTimeout + charTimeout;
            const timeout = Math.min(calculatedTimeout, MAX_CHUNK_TIMEOUT);
            const baseTemp = attempt === 1 ? 0.1 : 0.15 + (attempt * 0.025);
            const temperature = enforceTemp('document_analysis', baseTemp);
            console.log(`[LLM]${chunkLabel} Attempt ${attempt}/${maxRetries} (timeout: ${Math.round(timeout / 60000)}min, temp: ${temperature})`);
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeout);
            let response;
            try {
                response = await fetch(`${ollamaUrl}/api/chat`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    signal: controller.signal,
                    dispatcher: llmAgent,
                    body: JSON.stringify({
                        model,
                        messages: [
                            { role: 'system', content: system },
                            { role: 'user', content: user }
                        ],
                        stream: false, think: false,
                        options: {
                            temperature,
                            top_p: 0.85,
                            top_k: 40,
                            num_ctx: numCtx,
                            num_predict: numPredict,
                            repeat_penalty: 1.15,
                        },
                    }),
                });
            }
            catch (fetchError) {
                clearTimeout(timeoutId);
                if (fetchError instanceof Error) {
                    if (fetchError.name === 'AbortError') {
                        throw new AnalysisTimeoutError(timeout);
                    }
                    if (fetchError.message.includes('ECONNREFUSED') || fetchError.message.includes('fetch failed')) {
                        throw new OllamaConnectionError(ollamaUrl, fetchError);
                    }
                }
                throw fetchError;
            }
            clearTimeout(timeoutId);
            if (!response.ok) {
                const errorText = await response.text().catch(() => response.statusText);
                if (response.status === 404 && errorText.includes('model')) {
                    throw new ModelNotFoundError(model);
                }
                throw new LLMError(`Ollama API error: ${response.status} ${errorText}`, 'OLLAMA_API_ERROR');
            }
            const data = await response.json();
            const analysisText = data.message?.content || data.response || '';
            console.log(`[LLM]${chunkLabel} Response: ${analysisText.length} chars`);
            let result;
            try {
                result = parseAIResponse(analysisText, text);
            }
            catch (parseError) {
                throw new LLMParseError(parseError instanceof Error ? parseError.message : 'Unknown parse error');
            }
            const hasValidClauses = result.keyClauses.some(c => c.title || c.content);
            if (!hasValidClauses && attempt < maxRetries) {
                console.warn(`[LLM]${chunkLabel} Attempt ${attempt} incomplete, retrying...`);
                continue;
            }
            const chunkCacheMessages = [
                { role: 'system', content: `chunk:${language}:${jurisdiction}` },
                { role: 'user', content: text }
            ];
            (0, llmCache_1.setCachedResponse)(chunkCacheMessages, JSON.stringify(result), {
                taskType: 'document_analysis',
                model
            });
            return result;
        }
        catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
            console.error(`[LLM]${chunkLabel} Attempt ${attempt} failed:`, lastError.message);
            if (error instanceof OllamaConnectionError || error instanceof ModelNotFoundError) {
                break;
            }
        }
    }
    console.error(`[LLM]${chunkLabel} All retries exhausted`);
    if (ALLOW_MOCK_FALLBACK) {
        console.warn(`[LLM]${chunkLabel} Using mock data fallback - NOT FOR PRODUCTION`);
        return analyzeWithMockData(text, language);
    }
    throw new LLMRetryExhaustedError(maxRetries, lastError);
}
async function analyzeWithOpenAI(text, language = 'en', jurisdiction = 'US') {
    throw new Error('OpenAI integration not yet implemented. Use LLM_PROVIDER=ollama or LLM_PROVIDER=mock');
}
async function analyzeWithMockData(text, language = 'en') {
    await new Promise(resolve => setTimeout(resolve, 2000));
    const summary = generateMockSummary(text, language);
    const keyClauses = generateMockKeyClauses(text, language);
    const riskFlags = generateMockRiskFlags(text, language);
    const importantDates = generateMockDates(text);
    const readabilityScore = calculateReadabilityScore(text);
    const overallRiskScore = calculateOverallRiskScore(riskFlags);
    const missingElements = detectMissingElements(text, language);
    const clarityScore = calculateClarityScore(text, {
        summary,
        keyClauses,
        riskFlags,
        importantDates,
        readabilityScore,
        overallRiskScore,
        missingElements,
    }, language);
    return {
        summary,
        keyClauses,
        riskFlags,
        importantDates,
        readabilityScore,
        overallRiskScore,
        missingElements,
        clarityScore,
    };
}
async function extractClausesWithOllama(text, language = 'en') {
    const ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    const model = process.env.OLLAMA_MODEL || 'qwen3:14b';
    const { enforceTemperatureLimit: enforceTemp } = await Promise.resolve().then(() => __importStar(require('./modelRouter')));
    const temperature = enforceTemp('clause_extraction', 0.1);
    console.log(`[LLM] Extracting clauses with Ollama at ${ollamaUrl} using model ${model}, temp: ${temperature}`);
    const prompt = createClauseExtractionPrompt(text, language);
    const response = await fetch(`${ollamaUrl}/api/generate`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model,
            prompt,
            stream: false, think: false,
            options: {
                temperature,
                top_p: 0.85,
                top_k: 40,
                num_ctx: 81920,
                num_predict: 4096,
                repeat_penalty: 1.15,
                presence_penalty: 0.5,
                frequency_penalty: 0.3,
            },
        }),
    });
    if (!response.ok) {
        throw new Error(`Ollama API error during clause extraction: ${response.statusText}`);
    }
    const data = await response.json();
    const clausesText = String(data.response || '');
    console.log(`[LLM] Received clause extraction response length: ${clausesText.length} characters`);
    return parseClausesResponse(clausesText, text);
}
async function extractClausesWithOpenAI(text, language = 'en') {
    throw new Error('OpenAI clause extraction not yet implemented. Use LLM_PROVIDER=ollama or LLM_PROVIDER=mock');
}
async function extractClausesWithMockData(text, language = 'en') {
    await new Promise(resolve => setTimeout(resolve, 1500));
    return [
        {
            id: 'clause-1',
            category: 'payment',
            title: 'Payment Terms',
            content: 'Payment is due within 30 days of invoice date.',
            summary: 'Payment must be made within 30 days.',
            riskLevel: 'low',
            citation: 'Payment is due within 30 days of invoice date.',
            implications: ['Standard payment terms', 'No early payment discount mentioned'],
        },
        {
            id: 'clause-2',
            category: 'termination',
            title: 'Termination Notice',
            content: 'Either party may terminate with 90 days written notice.',
            summary: '90-day notice required for termination.',
            riskLevel: 'medium',
            citation: 'Either party may terminate with 90 days written notice.',
            implications: ['Long notice period required', 'May limit flexibility'],
        },
    ];
}
function getJurisdictionContext(jurisdiction) {
    const j = jurisdiction || 'US';
    const jurisdictions = {
        'US': { name: 'United States', law: 'U.S. federal and state law' },
        'UK': { name: 'United Kingdom', law: 'English law' },
        'DE': { name: 'Germany', law: 'German law (BGB, HGB)' },
        'FR': { name: 'France', law: 'French law (Code Civil)' },
        'EU': { name: 'European Union', law: 'EU law and applicable member state law' },
        'CA': { name: 'Canada', law: 'Canadian law' },
        'AU': { name: 'Australia', law: 'Australian law' },
        'CH': { name: 'Switzerland', law: 'Swiss law (Swiss Code of Obligations)' },
        'AT': { name: 'Austria', law: 'Austrian law (ABGB)' },
    };
    return jurisdictions[j] || jurisdictions['US'];
}
function createAnalysisPrompt(documentText, language = 'en', jurisdiction = 'US', tone, ragSources) {
    const languageNames = {
        en: 'English',
        de: 'German',
        fr: 'French',
        es: 'Spanish',
    };
    const languageName = languageNames[language] || 'English';
    const languageInstruction = (0, aiContext_1.getLanguageInstruction)(language);
    const jurisdictionContext = (0, aiContext_1.getJurisdictionContext)(jurisdiction);
    const jurisdictionInfo = getJurisdictionContext(jurisdiction);
    const toneInstruction = tone ? (0, aiContext_1.getToneInstruction)(tone) : '';
    const system = `You are The Archivist, an expert legal document analyst with deep knowledge of contract law, ${jurisdictionInfo.name} regulations, and legal risk assessment.

LANGUAGE REQUIREMENT:
${languageInstruction}
All output must be in ${languageName}.

YOUR EXPERTISE:
- Contract analysis and clause interpretation
- Risk identification and assessment
- Legal terminology and plain-language explanation
- ${jurisdictionInfo.law}

JURISDICTION CONTEXT:
${jurisdictionContext}

ANALYSIS APPROACH:
1. Read the entire document to understand context and purpose
2. Identify the type of legal document
3. Extract key provisions and their implications
4. Assess risks from the reader's perspective
5. Note missing standard provisions

${toneInstruction}

RULES:
- Quote exact phrases from the document
- Only include what's explicitly stated
- All text output MUST be in ${languageName}
${ragSources && ragSources.length > 0 ? `
RELEVANT LEGAL PROVISIONS (${jurisdictionInfo.name}):
RULES: Only cite sources listed below. Do NOT invent statute references or section numbers. If no relevant provision is listed, say the document should be reviewed against applicable law without citing specific statutes.
${ragSources.map((s, i) => `<document index="${i + 1}"><source>${s.source_name || 'Legal Source'}</source><jurisdiction>${s.jurisdiction || jurisdictionInfo.name || 'Unknown'}</jurisdiction><content>${(s.text || '').substring(0, 6000)}</content></document>`).join('\n')}
` : ''}
CRITICAL OUTPUT FORMAT:
- Return ONLY the raw JSON object, starting with { and ending with }
- Do NOT wrap in markdown code blocks (no \`\`\`json or \`\`\`)
- Do NOT add any text before or after the JSON
- Ensure all JSON strings are properly escaped
- The response must be valid parseable JSON

JURISDICTION: ${jurisdictionInfo.name}`;
    const user = `Analyze this legal document thoroughly:

${documentText}

Provide a comprehensive analysis with:

1. SUMMARY - 5 key points about what this document does and means
2. KEY CLAUSES - Most important provisions with their implications
3. RISK FLAGS - Problematic terms that could harm the reader
   - red: Significant risk, unfavorable terms
   - yellow: Moderate concern, needs attention
   - green: Standard, acceptable terms
4. GLOSSARY - Legal terms explained in plain language
5. IMPORTANT DATES - Deadlines, effective dates, renewal dates
6. MISSING ELEMENTS - Standard provisions that are absent

Return this exact JSON structure:
{
  "summary": ["Key point 1", "Key point 2", "Key point 3", "Key point 4", "Key point 5"],
  "keyClauses": [
    {"title": "Clause name", "content": "What it states", "importance": "high|medium|low", "citation": "Exact quote from document"}
  ],
  "riskFlags": [
    {"level": "red|yellow|green", "category": "Category", "explanation": "Why this is a risk", "citation": "Relevant quote"}
  ],
  "glossary": [
    {"term": "Legal term", "explanation": "Plain English explanation"}
  ],
  "importantDates": [
    {"date": "Date or timeframe", "description": "What happens"}
  ],
  "missingElements": [
    {"element": "Missing provision", "importance": "critical|recommended|optional", "explanation": "Why it matters"}
  ]
}`;
    return { system, user };
}
function createAnalysisPromptFor1B(documentText, _language = 'en') {
    const system = `Output only valid JSON. No markdown. No text before or after. Start with { end with }`;
    const maxChars = 1500;
    const text = documentText.length > maxChars
        ? documentText.substring(0, maxChars) + '...'
        : documentText;
    const user = `Analyze this legal document:

${text}

Copy this JSON structure and fill in values from the document:

{
  "summary": ["First key point", "Second key point", "Third key point"],
  "keyClauses": [{"title": "Clause Name", "content": "What it says", "importance": "high"}],
  "riskFlags": [{"level": "yellow", "category": "Risk Type", "explanation": "Why risky"}],
  "glossary": [{"term": "Legal Term", "explanation": "What it means"}],
  "importantDates": [{"date": "The Date", "description": "What happens"}],
  "missingElements": [{"element": "Missing Item", "importance": "recommended", "explanation": "Why needed"}]
}

IMPORTANT: summary must be an array like ["a","b","c"] not a string.

JSON output:`;
    return { system, user };
}
function createClauseExtractionPrompt(documentText, language = 'en') {
    const languageName = language === 'de' ? 'German' : 'English';
    return `You are The Archivist, a meticulous legal document analyzer. Your task is to extract and categorize ALL individual clauses from this ${languageName} legal document.

DOCUMENT TEXT:
${documentText}

TASK: Extract every distinct clause from the document and categorize each one.

CATEGORIES:
- payment: Payment terms, pricing, invoicing, payment methods
- termination: Contract end conditions, notice periods, early termination
- liability: Liability limits, damages, indemnification, insurance
- confidentiality: NDAs, confidential information, data protection
- dispute-resolution: Arbitration, jurisdiction, governing law
- intellectual-property: IP ownership, licenses, patents, trademarks
- warranties: Guarantees, representations, disclaimers
- indemnification: Hold harmless clauses, defense obligations
- force-majeure: Acts of God, unforeseeable circumstances
- general: General provisions, definitions, miscellaneous
- other: Anything that doesn't fit above categories

RISK LEVELS:
- low: Standard, favorable, or neutral terms
- medium: Terms requiring attention or negotiation
- high: Unfavorable or potentially problematic terms

OUTPUT FORMAT: Respond with a JSON array of clause objects. Each clause must have:
{
  "id": "clause-1",  // Unique identifier: clause-1, clause-2, etc.
  "category": "payment",  // One of the categories above
  "title": "Brief title",  // 3-7 words
  "content": "Full clause text",  // The actual clause verbatim from the document
  "summary": "Brief 1-2 sentence summary",
  "riskLevel": "low" | "medium" | "high",
  "citation": "Original text from document",  // Same as content
  "implications": ["What this means", "Practical impact"],  // 2-4 bullet points
  "relatedClauses": ["clause-id-if-related"]  // Optional: IDs of related clauses
}

EXAMPLE OUTPUT:
[
  {
    "id": "clause-1",
    "category": "payment",
    "title": "Monthly Subscription Fee",
    "content": "Client shall pay $500 per month, due on the first day of each month.",
    "summary": "Client pays $500 monthly on the first of each month.",
    "riskLevel": "low",
    "citation": "Client shall pay $500 per month, due on the first day of each month.",
    "implications": [
      "Fixed monthly cost of $500",
      "Payment required at month start, not in arrears",
      "No early payment discount mentioned"
    ]
  },
  {
    "id": "clause-2",
    "category": "termination",
    "title": "Termination for Convenience",
    "content": "Either party may terminate this Agreement with 90 days written notice to the other party.",
    "summary": "90-day notice required for termination by either party.",
    "riskLevel": "medium",
    "citation": "Either party may terminate this Agreement with 90 days written notice to the other party.",
    "implications": [
      "Long notice period required (90 days)",
      "Both parties have equal termination rights",
      "May limit flexibility for quick exit"
    ],
    "relatedClauses": ["clause-7"]
  }
]

INSTRUCTIONS:
1. Extract EVERY clause - don't skip any
2. Use exact text from document for "content" and "citation"
3. Be specific in summaries and implications
4. Assess risk level objectively
5. Link related clauses when applicable
6. Maintain ${languageName} language consistency

RESPOND WITH ONLY THE JSON ARRAY - NO OTHER TEXT.`;
}
function parseClausesResponse(aiResponse, originalText) {
    try {
        const jsonMatch = aiResponse.match(/\[[\s\S]*\]/);
        if (!jsonMatch) {
            throw new Error('No JSON array found in clause extraction response');
        }
        const parsed = JSON.parse(jsonMatch[0]);
        if (!Array.isArray(parsed)) {
            throw new Error('Clause extraction response is not an array');
        }
        return parsed.map((clause, index) => {
            if (!clause.id)
                clause.id = `clause-${index + 1}`;
            if (!clause.category)
                clause.category = 'other';
            if (!clause.title)
                throw new Error(`Clause ${clause.id} missing title`);
            if (!clause.content)
                throw new Error(`Clause ${clause.id} missing content`);
            if (!clause.summary)
                throw new Error(`Clause ${clause.id} missing summary`);
            if (!clause.riskLevel)
                clause.riskLevel = 'low';
            if (!clause.citation)
                clause.citation = clause.content;
            if (!clause.implications || !Array.isArray(clause.implications))
                clause.implications = [];
            return {
                id: clause.id,
                category: clause.category,
                title: clause.title,
                content: clause.content,
                summary: clause.summary,
                riskLevel: clause.riskLevel,
                citation: clause.citation,
                implications: clause.implications,
                relatedClauses: clause.relatedClauses || undefined,
            };
        });
    }
    catch (error) {
        console.error('[LLM] Failed to parse clause extraction response:', error);
        throw new Error(`Clause extraction parsing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}
function cleanJsonForParsing(jsonString) {
    let cleaned = jsonString;
    // DO NOT replace smart double quotes with bare " — they are valid Unicode
    // inside JSON strings (e.g., German quotation marks). Replacing them
    // creates unescaped " inside strings which breaks JSON parsing.
    // Only replace smart single quotes with apostrophes (safe):
    cleaned = cleaned.replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'");
    cleaned = cleaned.replace(/^[\s\S]*?```(?:json)?\s*/i, '');
    cleaned = cleaned.replace(/\s*```[\s\S]*$/i, '');
    cleaned = cleaned.replace(/```json\s*/gi, '').replace(/```\s*/g, '');
    cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, '');
    cleaned = cleaned.replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '');
    const jsonStart = cleaned.indexOf('{');
    if (jsonStart > 0) {
        cleaned = cleaned.substring(jsonStart);
    }
    // String-aware brace counting (skips braces inside quoted strings)
    let braceCount = 0;
    let jsonEnd = -1;
    let inString = false;
    let esc = false;
    for (let i = 0; i < cleaned.length; i++) {
        const ch = cleaned[i];
        if (esc) { esc = false; continue; }
        if (ch === '\\' && inString) { esc = true; continue; }
        if (ch === '"') { inString = !inString; continue; }
        if (!inString) {
            if (ch === '{') braceCount++;
            if (ch === '}') {
                braceCount--;
                if (braceCount === 0) { jsonEnd = i + 1; break; }
            }
        }
    }
    if (jsonEnd > 0 && jsonEnd < cleaned.length) {
        cleaned = cleaned.substring(0, jsonEnd);
    }
    cleaned = cleaned.replace(/,(\s*[}\]])/g, '$1');
    cleaned = cleaned.replace(/[\x00-\x1F\x7F]/g, (char) => {
        if (char === '\n' || char === '\r' || char === '\t') return char;
        return '';
    });
    return cleaned.trim();
}
function repairJson(jsonStr) {
    // Deep repair for common LLM JSON issues:
    // - Unescaped double quotes inside string values
    // - Literal newlines inside strings
    // - Truncated output (unclosed brackets/braces)
    let result = '';
    let inString = false;
    let escape = false;
    const openStack = [];
    for (let i = 0; i < jsonStr.length; i++) {
        const ch = jsonStr[i];
        if (escape) { result += ch; escape = false; continue; }
        if (inString) {
            if (ch === '\\') { escape = true; result += ch; continue; }
            if (ch === '"') {
                // Determine if this is end-of-string or unescaped quote inside string
                const ahead = jsonStr.substring(i + 1, i + 30).trimStart();
                if (ahead.length === 0 || /^[,:}\]\n\r]/.test(ahead)) {
                    inString = false;
                    result += ch;
                } else {
                    result += '\\"';
                }
                continue;
            }
            if (ch === '\n' || ch === '\r') { result += '\\n'; continue; }
            result += ch;
            continue;
        }
        if (ch === '"') { inString = true; result += ch; continue; }
        if (ch === '{' || ch === '[') {
            openStack.push(ch === '{' ? '}' : ']');
            result += ch; continue;
        }
        if (ch === '}' || ch === ']') {
            if (openStack.length > 0) openStack.pop();
            result += ch; continue;
        }
        result += ch;
    }
    // Close any unclosed brackets (handles truncated LLM output)
    while (openStack.length > 0) { result += openStack.pop(); }
    return result;
}
function parseAIResponse(aiResponse, originalText) {
    try {
        const cleanedResponse = cleanJsonForParsing(aiResponse);
        const jsonMatch = cleanedResponse.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error('No JSON found in AI response');
        }
        let jsonStr = jsonMatch[0];
        jsonStr = jsonStr.replace(/,(\s*[}\]])/g, '$1');
        let parsed;
        try {
            parsed = JSON.parse(jsonStr);
        }
        catch (e1) {
            console.warn('[LLM] Initial JSON parse failed, attempting repair...');
            try {
                let cleaned = jsonStr
                    .replace(/[\r\n]+/g, ' ')
                    .replace(/,\s*}/g, '}')
                    .replace(/,\s*]/g, ']');
                parsed = JSON.parse(cleaned);
                console.log('[LLM] Newline cleanup succeeded');
            }
            catch (e2) {
                console.warn('[LLM] Simple cleanup failed, attempting deep JSON repair...');
                try {
                    let repaired = repairJson(jsonStr);
                    repaired = repaired.replace(/,(\s*[}\]])/g, '$1');
                    parsed = JSON.parse(repaired);
                    console.log('[LLM] Deep JSON repair succeeded');
                }
                catch (e3) {
                    // Last resort: replace smart quotes with escaped \" then repair
                    console.warn('[LLM] Deep repair failed, trying smart quote escape + repair...');
                    let escaped = jsonStr.replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '\\"');
                    let repaired = repairJson(escaped);
                    repaired = repaired
                        .replace(/[\r\n]+/g, ' ')
                        .replace(/,(\s*[}\]])/g, '$1');
                    parsed = JSON.parse(repaired);
                    console.log('[LLM] Smart quote escape + repair succeeded');
                }
            }
        }
        if (!parsed.summary || !Array.isArray(parsed.summary)) {
            throw new Error('AI response missing required field: summary');
        }
        if (!parsed.keyClauses || !Array.isArray(parsed.keyClauses)) {
            throw new Error('AI response missing required field: keyClauses');
        }
        const riskFlags = parsed.riskFlags || [];
        const summaryArray = Array.isArray(parsed.summary) ? parsed.summary : [];
        const summary = {
            title: 'Document Summary',
            content: summaryArray.join(' '),
            keyPoints: summaryArray,
        };
        const importantDates = parsed.importantDates || [];
        const missingElements = parsed.missingElements || [];
        const keyClauses = parsed.keyClauses.map((clause, index) => ({
            ...clause,
            citation: extractCitation(originalText, [clause.title, clause.content], index),
        }));
        const riskFlagsWithCitations = riskFlags.map((flag, index) => ({
            ...flag,
            citation: extractCitation(originalText, [flag.category, flag.explanation], index + 10),
        }));
        const readabilityScore = calculateReadabilityScore(originalText);
        const overallRiskScore = calculateOverallRiskScore(riskFlagsWithCitations);
        const clarityScore = calculateClarityScore(originalText, {
            summary,
            keyClauses,
            riskFlags: riskFlagsWithCitations,
            importantDates,
            readabilityScore,
            overallRiskScore,
            missingElements,
        });
        return {
            summary,
            keyClauses,
            riskFlags: riskFlagsWithCitations,
            importantDates,
            readabilityScore,
            overallRiskScore,
            missingElements,
            clarityScore,
        };
    }
    catch (error) {
        console.error('[LLM] Failed to parse AI response:', error);
        console.log('[LLM] AI Response (first 500 chars):', aiResponse?.substring(0, 500));
        throw new Error('Failed to parse AI response as JSON. The model returned invalid JSON.');
    }
}
function generateMockSummary(text, language = 'en') {
    const lowerText = text.toLowerCase();
    const buildSummary = (title, keyPoints) => ({
        title,
        content: keyPoints.map(p => p.replace(/^•\s*/, '')).join(' '),
        keyPoints: keyPoints.map(p => p.replace(/^•\s*/, '')),
    });
    if (language === 'de') {
        if (lowerText.includes('miet') || lowerText.includes('wohnung')) {
            return buildSummary('Mietvertrag', [
                '12-monatiger Wohnraummietvertrag mit festgelegtem Beginn',
                'Monatliche Mietzahlung fällig am 1. eines jeden Monats mit Kulanzfrist',
                'Kaution in Höhe einer Monatsmiete, rückzahlbar bei Vertragsende',
                'Mieter verantwortlich für Nebenkosten, sofern nicht anders angegeben',
                'Kündigungsfrist für Vertragsbeendigung oder Nichtverlängerung erforderlich',
            ]);
        }
        if (lowerText.includes('arbeits') || lowerText.includes('anstellung')) {
            return buildSummary('Arbeitsvertrag', [
                'Arbeitsvertrag mit Definition der Rolle, Verantwortlichkeiten und Vergütung',
                'Vergütungsstruktur einschließlich Grundgehalt und möglicher Zusatzleistungen',
                'Arbeitszeiten, Standort und Homeoffice-Regelungen festgelegt',
                'Vertraulichkeits- und Urheberrechtsklauseln enthalten',
                'Kündigungsbedingungen und Kündigungsfristen dargelegt',
            ]);
        }
        if (lowerText.includes('nutzungsbedingungen') || lowerText.includes('agb')) {
            return buildSummary('Nutzungsbedingungen', [
                'Nutzungsbedingungen für die Verwendung der Plattform oder des Dienstes',
                'Nutzerrechte, Pflichten und Richtlinien für die akzeptable Nutzung',
                'Datenerfassung, -speicherung und Datenschutzpraktiken offengelegt',
                'Haftungsbeschränkungen und Garantieausschlüsse',
                'Streitbeilegungsverfahren und geltendes Recht festgelegt',
            ]);
        }
        return buildSummary('Rechtsdokument', [
            'Dieses Dokument begründet eine formelle Vereinbarung zwischen den Parteien',
            'Umreißt wichtige Rechte, Pflichten und Verantwortlichkeiten',
            'Enthält Zahlungsbedingungen, Vergütung oder finanzielle Vereinbarungen',
            'Legt Dauer, Verlängerung und Kündigungsbedingungen fest',
            'Beinhaltet rechtliche Bestimmungen für Streitigkeiten und Haftung',
        ]);
    }
    if (lowerText.includes('lease') || lowerText.includes('rent') || lowerText.includes('miet')) {
        return buildSummary('Lease Agreement', [
            '12-month residential lease agreement starting on the specified date',
            'Monthly rent payment due on the 1st of each month with grace period',
            'Security deposit equal to one month\'s rent, refundable upon lease end',
            'Tenant responsible for utilities unless otherwise specified',
            'Requires notice period for lease termination or non-renewal',
        ]);
    }
    if (lowerText.includes('employment') || lowerText.includes('hire') || lowerText.includes('arbeits')) {
        return buildSummary('Employment Agreement', [
            'Employment agreement defining role, responsibilities, and compensation',
            'Compensation structure including base salary and potential benefits',
            'Working hours, location, and remote work policies specified',
            'Non-disclosure and intellectual property clauses included',
            'Termination conditions and notice periods outlined',
        ]);
    }
    if (lowerText.includes('terms') && lowerText.includes('service')) {
        return buildSummary('Terms of Service', [
            'Terms of Service governing use of the platform or service',
            'User rights, responsibilities, and acceptable use policies',
            'Data collection, storage, and privacy practices disclosed',
            'Limitation of liability and warranty disclaimers',
            'Dispute resolution process and governing law specified',
        ]);
    }
    return buildSummary('Legal Document', [
        'This document establishes a formal agreement between parties',
        'Outlines key rights, obligations, and responsibilities',
        'Contains payment terms, compensation, or financial arrangements',
        'Specifies duration, renewal, and termination conditions',
        'Includes legal provisions for disputes and liability',
    ]);
}
function extractCitation(text, keywords, fallbackIndex) {
    if (!text || keywords.length === 0)
        return undefined;
    const sentences = text.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 20);
    if (sentences.length === 0)
        return undefined;
    const scoredSentences = sentences.map((sentence, index) => {
        const lowerSentence = sentence.toLowerCase();
        let score = 0;
        let matchedKeywords = 0;
        for (const keyword of keywords) {
            if (lowerSentence.includes(keyword.toLowerCase())) {
                matchedKeywords++;
                score += keyword.length;
            }
        }
        if (matchedKeywords > 1) {
            score *= matchedKeywords;
        }
        if (sentence.length > 100) {
            score += 10;
        }
        const hasNumbering = /^\s*\d+\./.test(sentence);
        const isAllCaps = sentence.toUpperCase() === sentence && sentence.length < 100;
        if (hasNumbering || isAllCaps) {
            score += 20;
        }
        return { sentence, score, index };
    });
    scoredSentences.sort((a, b) => b.score - a.score);
    const bestMatch = scoredSentences[0];
    if (bestMatch && bestMatch.score > 0) {
        const bestIndex = bestMatch.index;
        let citation = bestMatch.sentence;
        if (bestMatch.sentence.length < 80 && bestIndex + 1 < sentences.length) {
            citation += ' ' + sentences[bestIndex + 1];
        }
        return citation.trim();
    }
    if (fallbackIndex !== undefined && fallbackIndex < sentences.length) {
        return sentences[fallbackIndex].trim();
    }
    return sentences[0].trim();
}
function generateMockKeyClauses(text, language = 'en') {
    const lowerText = text.toLowerCase();
    const clauses = [];
    if (lowerText.includes('payment') || lowerText.includes('rent') || lowerText.includes('fee')) {
        clauses.push({
            title: 'Payment Terms',
            content: 'Specifies the amount, due date, and acceptable payment methods. Late fees may apply for payments received after the grace period.',
            importance: 'high',
            citation: extractCitation(text, ['payment', 'rent', 'fee', 'due'], 2),
        });
    }
    if (lowerText.includes('termination') || lowerText.includes('cancel')) {
        clauses.push({
            title: 'Termination Clause',
            content: 'Outlines conditions under which either party can terminate the agreement, including required notice periods and potential penalties.',
            importance: 'high',
            citation: extractCitation(text, ['termination', 'terminate', 'cancel', 'notice'], 5),
        });
    }
    if (lowerText.includes('liability') || lowerText.includes('damage')) {
        clauses.push({
            title: 'Liability and Damages',
            content: 'Defines responsibility for damages, losses, or injuries. May include limitations on liability and indemnification provisions.',
            importance: 'medium',
            citation: extractCitation(text, ['liability', 'liable', 'damage', 'indemnify'], 8),
        });
    }
    if (lowerText.includes('confidential') || lowerText.includes('privacy')) {
        clauses.push({
            title: 'Confidentiality Agreement',
            content: 'Requires parties to keep certain information confidential and not disclose it to third parties without permission.',
            importance: 'medium',
            citation: extractCitation(text, ['confidential', 'privacy', 'disclose'], 10),
        });
    }
    if (lowerText.includes('dispute') || lowerText.includes('arbitration')) {
        clauses.push({
            title: 'Dispute Resolution',
            content: 'Establishes how conflicts will be resolved, potentially through arbitration or mediation rather than court litigation.',
            importance: 'medium',
            citation: extractCitation(text, ['dispute', 'arbitration', 'mediation', 'resolution'], 12),
        });
    }
    if (clauses.length < 3) {
        clauses.push({
            title: 'General Provisions',
            content: 'Contains miscellaneous terms including severability, entire agreement clause, and amendment procedures.',
            importance: 'low',
            citation: extractCitation(text, ['agreement', 'provision', 'entire'], 15),
        });
    }
    return clauses;
}
function generateMockGlossary(text, language = 'en') {
    const lowerText = text.toLowerCase();
    const glossary = [];
    const potentialTerms = [
        {
            condition: () => lowerText.includes('party') || lowerText.includes('parties'),
            term: 'Party/Parties',
            explanation: 'The individuals or entities entering into the agreement. Each party has rights and obligations under the contract.',
        },
        {
            condition: () => lowerText.includes('herein') || lowerText.includes('hereto'),
            term: 'Herein/Hereto',
            explanation: 'Legal terms meaning "in this document" or "to this document." Used to refer to the agreement itself.',
        },
        {
            condition: () => lowerText.includes('indemnify') || lowerText.includes('indemnification'),
            term: 'Indemnification',
            explanation: 'A promise to compensate someone for harm or loss. One party agrees to cover costs if the other suffers damages.',
        },
        {
            condition: () => lowerText.includes('force majeure'),
            term: 'Force Majeure',
            explanation: 'Unforeseeable circumstances preventing contract fulfillment (e.g., natural disasters, war). May excuse performance.',
        },
        {
            condition: () => lowerText.includes('severability'),
            term: 'Severability',
            explanation: 'If one part of the contract is found invalid, the rest remains enforceable. Prevents entire contract from failing.',
        },
        {
            condition: () => lowerText.includes('whereas'),
            term: 'Whereas Clause',
            explanation: 'Introductory statements providing background and context for the agreement. Not legally binding but aids interpretation.',
        },
        {
            condition: () => lowerText.includes('liquidated damages'),
            term: 'Liquidated Damages',
            explanation: 'Pre-determined amount parties agree will be paid if contract is breached, avoiding need to prove actual damages.',
        },
    ];
    for (const item of potentialTerms) {
        if (item.condition()) {
            glossary.push({
                term: item.term,
                explanation: item.explanation,
            });
        }
    }
    if (glossary.length < 3) {
        glossary.push({
            term: 'Effective Date',
            explanation: 'The date when the agreement officially begins and parties become bound by its terms.',
        }, {
            term: 'Governing Law',
            explanation: 'The jurisdiction whose laws will be used to interpret and enforce the contract.',
        }, {
            term: 'Amendment',
            explanation: 'A formal change or addition to the contract, typically requiring written agreement from all parties.',
        });
    }
    return glossary.slice(0, 6);
}
function generateMockRiskFlags(text, language = 'en') {
    const lowerText = text.toLowerCase();
    const flags = [];
    flags.push({
        level: 'green',
        category: 'Standard Legal Language',
        explanation: 'This document uses common legal terminology and standard clauses typically found in similar agreements.',
        citation: extractCitation(text, ['agreement', 'contract', 'parties'], 1),
    });
    if (lowerText.includes('automatic renewal') || lowerText.includes('auto-renew')) {
        flags.push({
            level: 'yellow',
            category: 'Automatic Renewal',
            explanation: 'Agreement automatically renews unless you provide advance notice. Set a calendar reminder to avoid unwanted renewal.',
            citation: extractCitation(text, ['automatic', 'renew', 'renewal'], 3),
        });
    }
    if (lowerText.includes('non-refundable')) {
        flags.push({
            level: 'yellow',
            category: 'Non-Refundable Fees',
            explanation: 'Certain payments are non-refundable even if you cancel. Understand which fees you cannot recover.',
            citation: extractCitation(text, ['non-refundable', 'refund'], 4),
        });
    }
    if (lowerText.includes('liability waiver') || lowerText.includes('waive')) {
        flags.push({
            level: 'yellow',
            category: 'Liability Waiver',
            explanation: 'You may be waiving certain legal rights or claims. Consider the scope of what you\'re giving up.',
            citation: extractCitation(text, ['waive', 'waiver', 'liability'], 7),
        });
    }
    if (lowerText.includes('arbitration') && lowerText.includes('waive')) {
        flags.push({
            level: 'red',
            category: 'Arbitration Clause with Jury Waiver',
            explanation: 'You may be giving up your right to sue in court or have a jury trial. Disputes would be resolved through arbitration.',
            citation: extractCitation(text, ['arbitration', 'jury', 'waive'], 11),
        });
    }
    if (lowerText.includes('unlimited liability')) {
        flags.push({
            level: 'red',
            category: 'Unlimited Liability',
            explanation: 'No cap on your financial responsibility for damages. This could expose you to significant financial risk.',
            citation: extractCitation(text, ['unlimited', 'liability'], 9),
        });
    }
    return flags;
}
function generateMockDates(text) {
    const datePattern = /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s+\d{4}\b/gi;
    const matches = text.match(datePattern);
    const dates = [];
    if (matches && matches.length > 0) {
        matches.slice(0, 3).forEach((dateStr, index) => {
            dates.push({
                date: new Date(dateStr).toISOString().split('T')[0],
                description: index === 0 ? 'Agreement effective date' : `Important date mentioned in document`,
            });
        });
    }
    if (dates.length === 0) {
        const futureDate1 = new Date();
        futureDate1.setMonth(futureDate1.getMonth() + 1);
        const futureDate2 = new Date();
        futureDate2.setMonth(futureDate2.getMonth() + 11);
        dates.push({
            date: new Date().toISOString().split('T')[0],
            description: 'Document effective date',
        }, {
            date: futureDate1.toISOString().split('T')[0],
            description: 'First renewal or review date',
        }, {
            date: futureDate2.toISOString().split('T')[0],
            description: 'Agreement expiration or renewal deadline',
        });
    }
    return dates;
}
function calculateReadabilityScore(text) {
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const words = text.split(/\s+/).filter(w => w.length > 0);
    const syllables = words.reduce((count, word) => count + countSyllables(word), 0);
    if (sentences.length === 0 || words.length === 0) {
        return {
            score: 50,
            grade: 'College Level',
            explanation: 'Standard legal document complexity.',
        };
    }
    const avgWordsPerSentence = words.length / sentences.length;
    const avgSyllablesPerWord = syllables / words.length;
    const fleschScore = Math.max(0, Math.min(100, 206.835 - 1.015 * avgWordsPerSentence - 84.6 * avgSyllablesPerWord));
    let grade;
    let explanation;
    if (fleschScore >= 60) {
        grade = '8th-9th Grade';
        explanation = 'Relatively easy to read. Plain language with clear structure.';
    }
    else if (fleschScore >= 50) {
        grade = 'High School';
        explanation = 'Moderately difficult. Some legal terminology but generally accessible.';
    }
    else if (fleschScore >= 30) {
        grade = 'College Level';
        explanation = 'Difficult. Heavy use of legal jargon and complex sentence structures.';
    }
    else {
        grade = 'Graduate Level';
        explanation = 'Very difficult. Extensive legalese requiring legal knowledge to fully understand.';
    }
    return {
        score: Math.round(fleschScore),
        grade,
        explanation,
    };
}
function countSyllables(word) {
    word = word.toLowerCase().replace(/[^a-z]/g, '');
    if (word.length <= 3)
        return 1;
    const vowels = word.match(/[aeiouy]+/g);
    let count = vowels ? vowels.length : 1;
    if (word.endsWith('e') && count > 1)
        count--;
    return Math.max(1, count);
}
function calculateOverallRiskScore(riskFlags) {
    const redCount = riskFlags.filter(f => f.level === 'red').length;
    const yellowCount = riskFlags.filter(f => f.level === 'yellow').length;
    const greenCount = riskFlags.filter(f => f.level === 'green').length;
    const rawScore = (redCount * 3 + yellowCount * 1);
    const maxPossible = riskFlags.length * 3;
    const normalizedScore = maxPossible > 0 ? (rawScore / maxPossible) * 10 : 3;
    const score = Math.min(10, Math.round(normalizedScore * 10) / 10);
    let level;
    let explanation;
    if (score <= 3) {
        level = 'low';
        explanation = `This document has ${redCount} critical concerns. Mostly standard terms with minimal risk.`;
    }
    else if (score <= 6) {
        level = 'medium';
        explanation = `This document has ${redCount} critical and ${yellowCount} moderate concerns. Review carefully before signing.`;
    }
    else {
        level = 'high';
        explanation = `This document has ${redCount} critical concerns. Consider legal review before proceeding.`;
    }
    return { score, level, explanation };
}
function calculateClarityScore(text, analysis, language = 'en') {
    const criticalMissing = analysis.missingElements.filter(m => m.importance === 'critical').length;
    const recommendedMissing = analysis.missingElements.filter(m => m.importance === 'recommended').length;
    let completeness = 100;
    completeness -= criticalMissing * 20;
    completeness -= recommendedMissing * 10;
    completeness = Math.max(0, completeness);
    const fairness = Math.round((10 - analysis.overallRiskScore.score) * 10);
    let structure = 50;
    if (analysis.keyClauses.length >= 7)
        structure += 20;
    else if (analysis.keyClauses.length >= 5)
        structure += 15;
    else if (analysis.keyClauses.length >= 3)
        structure += 10;
    if (analysis.importantDates.length >= 3)
        structure += 15;
    else if (analysis.importantDates.length > 0)
        structure += 10;
    if (analysis.summary.keyPoints.length >= 3)
        structure += 10;
    const avgSentenceLength = text.length / (text.split(/[.!?]+/).length || 1);
    if (avgSentenceLength > 200)
        structure -= 10;
    structure = Math.max(0, Math.min(100, structure));
    let precision = 70;
    if (analysis.importantDates.length >= 5)
        precision += 10;
    if (analysis.keyClauses.length >= 5)
        precision += 10;
    precision = Math.max(0, Math.min(100, precision));
    const overall = Math.round(completeness * 0.35 +
        fairness * 0.30 +
        structure * 0.20 +
        precision * 0.15);
    let grade;
    if (overall >= 97)
        grade = 'A+';
    else if (overall >= 93)
        grade = 'A';
    else if (overall >= 87)
        grade = 'B+';
    else if (overall >= 83)
        grade = 'B';
    else if (overall >= 77)
        grade = 'C+';
    else if (overall >= 70)
        grade = 'C';
    else if (overall >= 60)
        grade = 'D';
    else
        grade = 'F';
    const strengths = [];
    if (completeness >= 90)
        strengths.push('Complete and comprehensive coverage of essential clauses');
    if (fairness >= 70)
        strengths.push('Fair and balanced terms for both parties');
    if (structure >= 80)
        strengths.push('Well-organized and logically structured');
    if (precision >= 75)
        strengths.push('Precise definitions and specific terms');
    if (analysis.importantDates.length >= 3)
        strengths.push('Clear timeline and important dates specified');
    if (analysis.keyClauses.length >= 5)
        strengths.push('Thorough documentation of key terms and obligations');
    const weaknesses = [];
    if (completeness < 70)
        weaknesses.push(`Missing ${criticalMissing + recommendedMissing} important clauses`);
    if (fairness < 50)
        weaknesses.push('Contains concerning terms or one-sided provisions');
    if (structure < 60)
        weaknesses.push('Could benefit from better organization and structure');
    if (precision < 60)
        weaknesses.push('Lacks specific definitions or precise terminology');
    let recommendation;
    if (overall >= 90) {
        recommendation = 'This is an excellent contract with comprehensive coverage, fair terms, and precise definitions. Safe to proceed with confidence.';
    }
    else if (overall >= 80) {
        recommendation = 'This is a well-drafted contract with mostly favorable terms. Review the highlighted areas and proceed when comfortable.';
    }
    else if (overall >= 70) {
        recommendation = 'This contract is acceptable but has some formal deficiencies. Carefully review the risk flags and missing elements before signing.';
    }
    else if (overall >= 60) {
        recommendation = 'This contract has significant issues with completeness or fairness. Consider requesting amendments to address missing clauses and concerning terms.';
    }
    else {
        recommendation = 'This contract has major formal deficiencies or unfair terms. We strongly recommend legal review before proceeding. Consider negotiating better terms.';
    }
    return {
        overall,
        grade,
        breakdown: {
            completeness: Math.round(completeness),
            fairness: Math.round(fairness),
            structure: Math.round(structure),
            precision: Math.round(precision),
        },
        strengths,
        weaknesses,
        recommendation,
    };
}
function detectMissingElements(text, language = 'en', summary = [], keyClauses = []) {
    const lowerText = text.toLowerCase();
    const aiFindings = [
        ...summary,
        ...keyClauses.map(c => `${c.title} ${c.content}`)
    ].join(' ').toLowerCase();
    const missing = [];
    const elements = [
        {
            keywords: ['termination', 'cancel', 'end'],
            element: 'Termination Clause',
            importance: 'critical',
            explanation: 'Specifies how either party can end the agreement and what notice is required.',
        },
        {
            keywords: ['indemnif', 'hold harmless'],
            element: 'Indemnification Clause',
            importance: 'critical',
            explanation: 'Defines who is responsible for damages or legal costs if issues arise.',
        },
        {
            keywords: [
                'governing law', 'jurisdiction', 'governed by', 'subject to the laws',
                'applicable law', 'laws of', 'legal system', 'venue',
                'anwendbares recht', 'gerichtsstand', 'zuständigkeit', 'deutsches recht',
                'schweizer recht', 'österreichisches recht', 'geltendes recht',
                'droit applicable', 'juridiction', 'loi applicable',
                'ley aplicable', 'jurisdicción',
                'cyprus', 'england', 'wales', 'scotland', 'ireland', 'united states',
                'new york', 'california', 'delaware', 'texas', 'florida',
                'germany', 'france', 'switzerland', 'singapore', 'hong kong',
                'deutschland', 'frankreich', 'schweiz', 'österreich'
            ],
            element: 'Governing Law',
            importance: 'critical',
            explanation: 'Specifies which state or country\'s laws apply to this agreement.',
        },
        {
            keywords: ['confidential', 'proprietary'],
            element: 'Confidentiality Clause',
            importance: 'recommended',
            explanation: 'Protects sensitive information shared between parties.',
        },
        {
            keywords: ['force majeure', 'act of god'],
            element: 'Force Majeure Clause',
            importance: 'recommended',
            explanation: 'Addresses what happens if unforeseeable events prevent performance.',
        },
        {
            keywords: ['amendment', 'modif'],
            element: 'Amendment Procedure',
            importance: 'recommended',
            explanation: 'Defines how changes to the agreement can be made.',
        },
        {
            keywords: ['severability', 'invalid'],
            element: 'Severability Clause',
            importance: 'optional',
            explanation: 'Ensures rest of contract remains valid if one part is found unenforceable.',
        },
    ];
    for (const elem of elements) {
        const foundInText = elem.keywords.some(kw => lowerText.includes(kw));
        const foundByAI = elem.keywords.some(kw => aiFindings.includes(kw));
        const debugInfo = `[MISSING] ${elem.element} | InText:${foundInText} | ByAI:${foundByAI}${!foundInText && !foundByAI ? ` | Keywords:[${elem.keywords.slice(0, 3).join(',')}...] | AIFindings:"${aiFindings.substring(0, 150)}..."` : ''}`;
        console.log(debugInfo);
        if (!foundInText && !foundByAI && elem.importance !== 'optional') {
            missing.push({
                element: elem.element,
                importance: elem.importance,
                explanation: elem.explanation,
            });
        }
    }
    return missing
        .sort((a, b) => a.importance === 'critical' ? -1 :
        b.importance === 'critical' ? 1 : 0)
        .slice(0, 3);
}
const modelRouter_1 = require("./modelRouter");
const llmCache_1 = require("./llmCache");
async function callLLM(messages, options = {}) {
    const provider = process.env.LLM_PROVIDER || 'mock';
    let temperature;
    let maxTokens;
    let useFastModel;
    if (options.taskType) {
        temperature = (0, modelRouter_1.enforceTemperatureLimit)(options.taskType, options.temperature);
        const modelConfig = (0, modelRouter_1.getModelConfig)(options.taskType);
        maxTokens = options.maxTokens ?? modelConfig.maxTokens;
        useFastModel = options.useFastModel ?? (modelConfig.model === 'fast');
    }
    else {
        temperature = options.temperature ?? 0.3;
        maxTokens = options.maxTokens ?? 2048;
        useFastModel = options.useFastModel ?? false;
    }
    const modelName = useFastModel ? (process.env.OLLAMA_MODEL_FAST || 'qwen3:14b') + ' (fast)' : (process.env.OLLAMA_MODEL || 'qwen3:14b') + ' (full)';
    const taskInfo = options.taskType ? ` | Task: ${options.taskType}` : '';
    const cacheableTypes = ['clause_extraction', 'document_analysis', 'risk_assessment', 'deadline_extraction', 'rights_extraction', 'entity_extraction', 'legal_explanation'];
    const shouldCache = options.taskType && cacheableTypes.includes(options.taskType);
    if (shouldCache) {
        const cachedResponse = (0, llmCache_1.getCachedResponse)(messages, {
            taskType: options.taskType,
            model: modelName,
            temperature
        });
        if (cachedResponse) {
            console.log(`[LLM Chat] Cache hit for ${options.taskType}`);
            return cachedResponse;
        }
    }
    console.log(`[LLM Chat] Provider: ${provider} | Model: ${modelName} | Temp: ${temperature} | MaxTokens: ${maxTokens}${taskInfo}`);
    try {
        let response;
        switch (provider) {
            case 'ollama':
                response = await chatWithOllama(messages, temperature, maxTokens, useFastModel);
                break;
            case 'openai':
                throw new Error('OpenAI chat not yet implemented');
            case 'mock':
            default:
                response = await chatWithMock(messages);
        }
        if (shouldCache && response) {
            (0, llmCache_1.setCachedResponse)(messages, response, {
                taskType: options.taskType,
                model: modelName,
                temperature
            });
        }
        return response;
    }
    catch (error) {
        console.error(`[LLM Chat] Failed with ${provider}:`, error);
        console.error(`[LLM Chat] Error details:`, error instanceof Error ? error.message : error);
        if (provider === 'ollama') {
            console.log('[LLM Chat] Retrying with mock provider');
            return await chatWithMock(messages);
        }
        return "I'm having trouble processing your request right now. Please try again in a moment.";
    }
}
async function chatWithOllama(messages, temperature, maxTokens, useFastModel = false) {
    const primaryUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    const fallbackUrl = process.env.OLLAMA_FALLBACK_URL || 'http://172.17.0.1:11434';
    const fastModel = process.env.OLLAMA_MODEL_FAST || 'qwen3:14b';
    const fullModel = process.env.OLLAMA_MODEL || 'qwen3:14b';
    const model = useFastModel ? fastModel : fullModel;
    const doFetch = async (url) => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 900000); // 15 min timeout
        const response = await fetch(`${url}/api/chat`, {
            signal: controller.signal,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model,
                messages: messages.map(m => ({
                    role: m.role,
                    content: m.role === 'system' ? '/no_think\n' + m.content : m.content
                })),
                stream: true, think: false,  // Enable streaming to keep connection alive
                think: false,
                options: { temperature, num_predict: maxTokens },
            }),
        });
        clearTimeout(timeoutId);
        if (!response.ok) {
            throw new Error(`Ollama API error: ${response.statusText}`);
        }
        // Collect streamed response
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullResponse = '';
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            // Parse NDJSON lines
            const lines = chunk.split('\n').filter(line => line.trim());
            for (const line of lines) {
                try {
                    const data = JSON.parse(line);
                    if (data.message?.content) {
                        fullResponse += data.message.content;
                    }
                } catch (e) {
                    // Skip non-JSON lines
                }
            }
        }
        return fullResponse || "I couldn't generate a response.";
    };
    try {
        return await doFetch(primaryUrl);
    }
    catch (err) {
        console.log(`[LLM Fallback] Primary (${primaryUrl}) failed: ${err.message}`);
        if (primaryUrl !== fallbackUrl) {
            console.log(`[LLM Fallback] Trying fallback at ${fallbackUrl}...`);
            try {
                const result = await doFetch(fallbackUrl);
                console.log('[LLM Fallback] Success using fallback');
                return result;
            }
            catch (err2) {
                console.log(`[LLM Fallback] Fallback also failed: ${err2.message}`);
                throw err2;
            }
        }
        throw err;
    }
}
async function* callLLMStream(messages, options = {}) {
    const provider = process.env.LLM_PROVIDER || 'mock';
    let temperature;
    let maxTokens;
    let useFastModel;
    if (options.taskType) {
        temperature = (0, modelRouter_1.enforceTemperatureLimit)(options.taskType, options.temperature);
        const modelConfig = (0, modelRouter_1.getModelConfig)(options.taskType);
        maxTokens = options.maxTokens ?? modelConfig.maxTokens;
        useFastModel = options.useFastModel ?? (modelConfig.model === 'fast');
    }
    else {
        temperature = options.temperature ?? 0.3;
        maxTokens = options.maxTokens ?? 1024;
        useFastModel = options.useFastModel ?? true;
    }
    const taskInfo = options.taskType ? ` | Task: ${options.taskType}` : '';
    console.log(`[LLM Stream] Provider: ${provider} | Fast: ${useFastModel} | Temp: ${temperature}${taskInfo}`);
    try {
        if (provider === 'ollama') {
            yield* streamWithOllama(messages, temperature, maxTokens, useFastModel);
        }
        else {
            const response = await chatWithMock(messages);
            const words = response.split(' ');
            for (const word of words) {
                yield word + ' ';
                await new Promise(r => setTimeout(r, 50));
            }
        }
    }
    catch (error) {
        console.error('[LLM Stream] Error:', error);
        yield 'I encountered an error generating the response.';
    }
}
async function* streamWithOllama(messages, temperature, maxTokens, useFastModel) {
    const ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    const fallbackUrl = process.env.OLLAMA_FALLBACK_URL || 'http://172.17.0.1:11434';
    const fastModel = process.env.OLLAMA_MODEL_FAST || 'qwen3:14b';
    const fullModel = process.env.OLLAMA_MODEL || 'qwen3:14b';
    const model = useFastModel ? fastModel : fullModel;
    const body = JSON.stringify({
        model,
        messages: messages.map(m => ({
            role: m.role,
            content: m.role === 'system' ? '/no_think\n' + m.content : m.content
        })),
        stream: true,
        think: false,
        options: { temperature, num_predict: maxTokens },
    });
    let response;
    let usedFallback = false;
    try {
        response = await fetch(`${ollamaUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
            signal: AbortSignal.timeout(60000), // 60s for GPU prompt processing
        });
        if (!response.ok || !response.body) {
            throw new Error(`Ollama stream error: ${response.statusText}`);
        }
    } catch (primaryErr) {
        if (ollamaUrl !== fallbackUrl) {
            console.log(`[LLM Stream Fallback] Primary failed (${primaryErr.message}), trying fallback at ${fallbackUrl}...`);
            response = await fetch(`${fallbackUrl}/api/chat`, {
                signal: AbortSignal.timeout(180000), // 3min for CPU
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body,
            });
            if (!response.ok || !response.body) {
                throw new Error(`Ollama stream fallback error: ${response.statusText}`);
            }
            usedFallback = true;
            console.log('[LLM Stream Fallback] Success using CPU fallback');
        } else {
            throw primaryErr;
        }
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
        const { done, value } = await reader.read();
        if (done)
            break;
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n').filter(l => l.trim());
        for (const line of lines) {
            try {
                const data = JSON.parse(line);
                if (data.message?.content) {
                    yield data.message.content;
                }
            }
            catch {
            }
        }
    }
}
async function chatWithMock(messages) {
    await new Promise(resolve => setTimeout(resolve, 500));
    const userMessage = messages.filter(m => m.role === 'user').pop();
    const messageLower = userMessage?.content.toLowerCase() || '';
    if (messageLower.includes('document') && (messageLower.includes('upload') || messageLower.includes('recent'))) {
        return "You've uploaded 3 documents this week. Your most recent upload was analyzed and shows a medium risk level with good clarity. Would you like me to walk you through the key findings?";
    }
    if (messageLower.includes('vault')) {
        return "Your vault contains 6 saved items including templates and clauses. What would you like to find or organize?";
    }
    if (messageLower.includes('create') || messageLower.includes('document')) {
        return "You can create documents using three methods: Smart Navigator for AI-guided creation, Quick Templates for fast generation, or Business Bundles for complete packages. Which approach interests you?";
    }
    return "I'm here to help you navigate LexVault. You can ask me about your uploaded documents, search your vault, or get guidance on creating new legal documents. What would you like to know?";
}
async function generateFlashcardsWithAI(text, filename) {
    const provider = process.env.LLM_PROVIDER || 'mock';
    console.log(`[LLM] Generating flashcards with provider: ${provider}`);
    try {
        switch (provider) {
            case 'ollama':
                return await generateFlashcardsWithOllama(text, filename);
            case 'openai':
                return await generateFlashcardsWithOpenAI(text, filename);
            case 'mock':
            default:
                return await generateFlashcardsWithMock(text, filename);
        }
    }
    catch (error) {
        console.error(`[LLM] Flashcard generation failed with ${provider}:`, error);
        console.log('[LLM] Falling back to mock generation');
        return await generateFlashcardsWithMock(text, filename);
    }
}
async function generateFlashcardsWithOllama(text, filename) {
    const ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    const model = process.env.OLLAMA_MODEL || 'qwen3:14b';
    console.log(`[LLM] Calling Ollama for flashcard generation at ${ollamaUrl} with model ${model}`);
    const isGerman = /\b(der|die|das|und|oder|gem\.|gemäß|nach|laut|Vertrag|Vertragspartei|Auftraggeber|Auftragnehmer)\b/i.test(text.substring(0, 1000));
    const language = isGerman ? 'German' : 'English';
    const prompt = `You are creating flashcards for LAW STUDENTS studying CONTRACT LAW.

CRITICAL LANGUAGE RULE: The document is in ${language}. You MUST write ALL flashcards ENTIRELY in ${language}.
- ${language === 'German' ? 'NEVER use English legal terms like "indemnification", "breach of contract", "consideration". ALWAYS use German terms like "Schadensersatz", "Vertragsverletzung", "Gegenleistung".' : 'Use English legal terms.'}
- Term, definition, and example must ALL be in ${language}.
- NO mixing of languages within a single flashcard.

STRICT RULE: ONLY create flashcards about LEGAL TERMINOLOGY and LEGAL CONCEPTS that appear in law textbooks.

Ask yourself for EACH potential flashcard: "Would this term appear in a contract law textbook?"
- If YES → create flashcard
- If NO → skip it

✅ CREATE flashcards about:
${language === 'German'
        ? '- Legal terms defined in law (e.g., "Werkvertrag", "Haftung", "Gewährleistung", "Verzug", "Schadensersatz")\n- Legal concepts (e.g., "Mängelansprüche", "Vertragsstrafe", "höhere Gewalt")'
        : '- Legal terms defined in law (e.g., "consideration", "breach of contract", "indemnification", "force majeure")\n- Legal concepts (e.g., "material breach", "liquidated damages", "statute of frauds")'}
- Legal rights and obligations that exist in law
- Legal doctrines and principles

❌ DO NOT create flashcards about:
- Business terms (e.g., "SEO", "Leads", "Marketing")
- Industry-specific procedures (e.g., "OTS-Verfahren", "On-Page SEO")
- Specific details from THIS contract (dates, times, party names, amounts)
- Project-specific definitions
- Any term that is NOT primarily a legal concept

CRITICAL: INCLUDE DOCUMENT EXCERPTS
For the "example" field, you MUST include a SHORT excerpt (1-2 sentences max) from the document that shows this legal term in context. Use quotation marks around the excerpt.

EXAMPLES OF GOOD FLASHCARDS WITH EXCERPTS:
${language === 'German'
        ? '✅ GOOD: {"term":"Schadensersatz","definition":"Der Ersatz eines durch eine rechtswidrige Handlung verursachten Schadens","example":"Aus dem Dokument: \\"Der Auftragnehmer haftet für Schadensersatz bei vorsätzlicher oder grob fahrlässiger Vertragsverletzung.\\"","difficulty":"medium","importance":"high"}\n✅ GOOD: {"term":"Gewährleistung","definition":"Die gesetzliche Haftung des Verkäufers für Mängel","example":"Aus dem Dokument: \\"Die Gewährleistungsfrist beträgt 24 Monate ab Abnahme der Leistung.\\"","difficulty":"easy","importance":"high"}'
        : '✅ GOOD: {"term":"Indemnification","definition":"A contractual obligation to compensate for harm or loss","example":"From document: \\"The Service Provider shall indemnify the Client against any claims arising from intellectual property infringement.\\"","difficulty":"medium","importance":"high"}\n✅ GOOD: {"term":"Material Breach","definition":"A substantial failure to perform under a contract that permits the other party to terminate","example":"From document: \\"Either party may terminate this Agreement immediately upon material breach by the other party.\\"","difficulty":"medium","importance":"high"}'}

EXAMPLES OF BAD FLASHCARDS:
❌ BAD: {"term":"Arbeitstag","example":"Ein Tag ist ein Tag"} - No document excerpt, not a legal term
❌ BAD: {"term":"Leads","example":"Marketing term"} - Business term, not legal
❌ BAD: {"term":"Force Majeure","example":"Natural disasters"} - No actual quote from document

If you cannot find at least 5 LEGAL terms with clear document excerpts, return fewer flashcards. DO NOT create flashcards about non-legal content just to reach a number.

Document:
${text.substring(0, 8000)}

Return ONLY valid JSON in this exact format:
{"flashcards":[{"term":"Legal Term","definition":"Clear definition","example":"From document: \\"Actual excerpt from the document showing this term in use.\\"","difficulty":"easy|medium|hard","importance":"low|medium|high"}]}`;
    const response = await fetch(`${ollamaUrl}/api/generate`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model,
            prompt,
            stream: false, think: false,
            format: "json",
            options: {
                temperature: 0.2,
                top_p: 0.85,
                top_k: 40,
                num_ctx: 81920,
                num_predict: 2048,
                repeat_penalty: 1.15,
                presence_penalty: 0.4,
                frequency_penalty: 0.2,
            },
        }),
    });
    if (!response.ok) {
        throw new Error(`Ollama API error: ${response.statusText}`);
    }
    const data = await response.json();
    const responseText = String(data.response || '');
    console.log(`[LLM] Ollama flashcard response length: ${responseText.length}`);
    try {
        let jsonText = responseText.trim();
        if (jsonText.includes('```json')) {
            jsonText = jsonText.split('```json')[1].split('```')[0].trim();
        }
        else if (jsonText.includes('```')) {
            jsonText = jsonText.split('```')[1].split('```')[0].trim();
        }
        else {
            const jsonStart = jsonText.indexOf('{');
            if (jsonStart !== -1) {
                let braceCount = 0;
                let jsonEnd = -1;
                for (let i = jsonStart; i < jsonText.length; i++) {
                    if (jsonText[i] === '{')
                        braceCount++;
                    if (jsonText[i] === '}')
                        braceCount--;
                    if (braceCount === 0) {
                        jsonEnd = i + 1;
                        break;
                    }
                }
                if (jsonEnd !== -1) {
                    jsonText = jsonText.substring(jsonStart, jsonEnd);
                }
            }
        }
        const parsed = JSON.parse(jsonText);
        const flashcards = parsed.flashcards || [];
        console.log(`[LLM] Generated ${flashcards.length} flashcards with Ollama`);
        return flashcards.map((card) => ({
            term: card.term || 'Unknown Term',
            definition: card.definition || 'No definition provided',
            example: card.example || null,
            difficulty: card.difficulty || 'medium',
            importance: card.importance || 'medium'
        }));
    }
    catch (parseError) {
        console.error('[LLM] Failed to parse Ollama flashcard response:', parseError);
        console.error('[LLM] Response text:', responseText.substring(0, 500));
        throw new Error('Failed to parse flashcard response from Ollama');
    }
}
async function generateFlashcardsWithOpenAI(text, filename) {
    console.log('[LLM] OpenAI flashcard generation not implemented, using mock');
    return generateFlashcardsWithMock(text, filename);
}
async function generateFlashcardsWithMock(text, filename) {
    console.log('[LLM] Using basic flashcard extraction');
    const flashcards = [];
    const sections = text.split('\n\n').filter(s => s.trim().length > 50);
    const definitionPatterns = [
        /(.+?)\s+is\s+(.+?)[\.\n]/gi,
        /(.+?)\s+means\s+(.+?)[\.\n]/gi,
        /(.+?):\s+(.+?)[\.\n]/gi,
        /(.+?)\s+refers to\s+(.+?)[\.\n]/gi,
    ];
    for (const section of sections.slice(0, 30)) {
        for (const pattern of definitionPatterns) {
            const matches = [...section.matchAll(pattern)];
            for (const match of matches.slice(0, 2)) {
                const term = match[1].trim().substring(0, 100);
                const definition = match[2].trim().substring(0, 300);
                if (term.length > 5 && definition.length > 10) {
                    flashcards.push({
                        term,
                        definition,
                        difficulty: 'medium',
                        importance: 'medium'
                    });
                }
            }
        }
    }
    const lines = text.split('\n').filter(l => l.trim().length > 0);
    for (let i = 0; i < lines.length - 1 && flashcards.length < 20; i++) {
        const line = lines[i].trim();
        const nextLine = lines[i + 1].trim();
        if ((line.endsWith('?') || line.endsWith(':') || line.match(/^\d+\.|^[A-Z][^a-z]+$/)) &&
            nextLine.length > 20) {
            flashcards.push({
                term: line.substring(0, 100),
                definition: nextLine.substring(0, 300),
                difficulty: 'medium',
                importance: 'medium'
            });
        }
    }
    if (flashcards.length < 10) {
        const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 50);
        for (const sentence of sentences.slice(0, 15)) {
            const words = sentence.trim().split(' ');
            if (words.length >= 10 && words.length <= 30) {
                const term = `What is the key point about: ${words.slice(0, 5).join(' ')}...?`;
                const definition = sentence.trim().substring(0, 300);
                flashcards.push({
                    term,
                    definition,
                    difficulty: 'medium',
                    importance: 'low'
                });
            }
        }
    }
    if (flashcards.length < 5) {
        const chunks = text.match(/.{1,400}/g) || [];
        for (let i = 0; i < Math.min(10, chunks.length); i++) {
            flashcards.push({
                term: `Key Concept ${i + 1} from ${filename}`,
                definition: chunks[i].trim(),
                difficulty: 'medium',
                importance: 'medium'
            });
        }
    }
    const unique = flashcards.filter((card, index, self) => index === self.findIndex(c => c.term.toLowerCase() === card.term.toLowerCase()));
    console.log(`[LLM] Generated ${unique.length} flashcards using basic extraction`);
    return unique.slice(0, 25);
}
async function analyzeDocumentForStudy(text, filename, type = 'learning') {
    const provider = process.env.LLM_PROVIDER || 'mock';
    console.log(`[LLM] Analyzing document for study with provider: ${provider}, type: ${type}`);
    if (type === 'legal') {
        try {
            switch (provider) {
                case 'ollama':
                    return await analyzeLegalDocumentWithOllama(text, filename);
                case 'openai':
                    return await analyzeLegalDocumentWithOpenAI(text, filename);
                case 'mock':
                default:
                    return await analyzeLegalDocumentWithMock(text, filename);
            }
        }
        catch (error) {
            console.error(`[LLM] Legal document analysis failed with ${provider}:`, error);
            console.log('[LLM] Falling back to mock legal analysis');
            return await analyzeLegalDocumentWithMock(text, filename);
        }
    }
    try {
        switch (provider) {
            case 'ollama':
                return await analyzeStudyWithOllama(text, filename);
            case 'openai':
                return await analyzeStudyWithOpenAI(text, filename);
            case 'mock':
            default:
                return await analyzeStudyWithMock(text, filename);
        }
    }
    catch (error) {
        console.error(`[LLM] Study analysis failed with ${provider}:`, error);
        console.log('[LLM] Falling back to mock analysis');
        return await analyzeStudyWithMock(text, filename);
    }
}
async function analyzeStudyWithOllama(text, filename) {
    const ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    const model = process.env.OLLAMA_MODEL || 'qwen3:14b';
    console.log(`[LLM] Calling Ollama for study analysis at ${ollamaUrl} with model ${model}`);
    const prompt = `You are a legal education expert helping law students study effectively. Analyze this document and create a HIGHLY USEFUL study guide.

=== CRITICAL REQUIREMENTS ===

Your analysis must be ACTIONABLE and SPECIFIC - not generic advice. Students need concrete, practical guidance.

TASK BREAKDOWN:

1. SUMMARY (2-3 sentences):
   - What legal area/topic does this cover?
   - Why is this important for law students to know?
   - What practical skills or knowledge does it build?
   - Be SPECIFIC - avoid phrases like "covers various topics" or "important concepts"

2. CHAPTERS (3-5 main sections):
   - Identify the ACTUAL structure of the document
   - Each chapter needs: clear title, what it covers, and 2-4 concrete key points
   - Key points should be SPECIFIC facts, rules, or principles - NOT generic statements
   - Example GOOD: "§242 BGB establishes the principle of good faith in contract performance"
   - Example BAD: "This section covers important contract principles"

3. IMPORTANT TOPICS (5-8 specific concepts):
   - List EXACT legal terms, doctrines, or principles mentioned in the document
   - Use precise terminology (not "contract rules" but "offer and acceptance doctrine")
   - These should be concepts students can research further

4. LEARNING OBJECTIVES (3-5 outcomes):
   - Must be MEASURABLE and SPECIFIC
   - Use action verbs: "Identify", "Explain", "Distinguish", "Apply", "Analyze"
   - Example GOOD: "Explain the three elements required for a valid contract formation"
   - Example BAD: "Understand contracts better"

5. MAIN CONCEPTS (3-5 principles):
   - The CORE legal principles or doctrines in this document
   - Should be fundamental ideas that connect to broader legal theory
   - Example: "Freedom of contract vs. mandatory consumer protection rules"

6. STUDY TIPS (3-5 practical strategies):
   - SPECIFIC to THIS document's content
   - Provide ACTIONABLE advice on how to master THIS material
   - Example GOOD: "Create a timeline of the contract formation process with §§145-151 BGB"
   - Example BAD: "Read the material carefully and take notes"

7. SUGGESTED FLASHCARDS (10-30):
   - Realistic estimate based on density of legal terms and concepts
   - More complex documents = more flashcards needed

Document: ${filename}
Text: ${text.substring(0, 10000)}

Return ONLY valid JSON:
{"summary":"Specific 2-3 sentence overview with practical relevance","chapters":[{"title":"Actual section name from document","content":"Specific description of what this section covers","keyPoints":["Concrete fact/rule 1","Concrete fact/rule 2","Concrete fact/rule 3"]}],"importantTopics":["Exact legal term 1","Exact legal term 2","Exact legal term 3","Exact legal term 4","Exact legal term 5"],"learningObjectives":["Measurable objective 1 using action verb","Measurable objective 2","Measurable objective 3"],"mainConcepts":["Fundamental principle 1","Fundamental principle 2","Fundamental principle 3"],"studyTips":["Specific actionable tip for THIS document","Specific actionable tip 2","Specific actionable tip 3"],"suggestedFlashcards":20}`;
    const response = await fetch(`${ollamaUrl}/api/generate`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model,
            prompt,
            stream: false, think: false,
            format: "json",
            options: {
                temperature: 0.3,
                top_p: 0.85,
                top_k: 40,
                num_ctx: 81920,
                num_predict: 2048,
                repeat_penalty: 1.15,
                presence_penalty: 0.3,
                frequency_penalty: 0.2,
            },
        }),
    });
    if (!response.ok) {
        throw new Error(`Ollama API error: ${response.statusText}`);
    }
    const data = await response.json();
    const responseText = String(data.response || '');
    console.log(`[LLM] Ollama study analysis response length: ${responseText.length}`);
    try {
        let jsonText = responseText.trim();
        if (jsonText.includes('```json')) {
            jsonText = jsonText.split('```json')[1].split('```')[0].trim();
        }
        else if (jsonText.includes('```')) {
            jsonText = jsonText.split('```')[1].split('```')[0].trim();
        }
        else {
            const jsonStart = jsonText.indexOf('{');
            if (jsonStart !== -1) {
                let braceCount = 0;
                let jsonEnd = -1;
                for (let i = jsonStart; i < jsonText.length; i++) {
                    if (jsonText[i] === '{')
                        braceCount++;
                    if (jsonText[i] === '}')
                        braceCount--;
                    if (braceCount === 0) {
                        jsonEnd = i + 1;
                        break;
                    }
                }
                if (jsonEnd !== -1) {
                    jsonText = jsonText.substring(jsonStart, jsonEnd);
                }
            }
        }
        const parsed = JSON.parse(jsonText);
        console.log(`[LLM] Successfully analyzed document for study with Ollama`);
        return {
            summary: parsed.summary || 'Document analysis',
            chapters: parsed.chapters || [],
            importantTopics: parsed.importantTopics || [],
            suggestedFlashcards: parsed.suggestedFlashcards || 15,
            learningObjectives: parsed.learningObjectives || [],
            mainConcepts: parsed.mainConcepts || [],
            studyTips: parsed.studyTips || []
        };
    }
    catch (parseError) {
        console.error('[LLM] Failed to parse Ollama study analysis response:', parseError);
        throw new Error('Failed to parse study analysis response from Ollama');
    }
}
async function analyzeStudyWithOpenAI(text, filename) {
    console.log('[LLM] OpenAI study analysis not implemented, using mock');
    return analyzeStudyWithMock(text, filename);
}
async function analyzeStudyWithMock(text, filename) {
    console.log('[LLM] Using improved mock study analysis');
    const sections = text.split('\n\n').filter(s => s.trim().length > 0);
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 30);
    const chapters = sections.slice(0, 5).map((section, index) => {
        const lines = section.split('\n').filter(l => l.trim());
        const title = lines[0]?.substring(0, 80) || `Section ${index + 1}`;
        const content = lines.slice(1, 4).join(' ').substring(0, 250);
        const keyPoints = [];
        lines.forEach(line => {
            const trimmed = line.trim();
            if (/^[-•*]\s/.test(trimmed) || /^\d+[\.)]\s/.test(trimmed)) {
                keyPoints.push(trimmed.replace(/^[-•*]\s/, '').replace(/^\d+[\.)]\s/, '').substring(0, 150));
            }
            else if (/(important|key|must|should|critical|essential|note|remember)/i.test(trimmed)) {
                keyPoints.push(trimmed.substring(0, 150));
            }
        });
        return {
            title,
            content: content || 'Content to review',
            keyPoints: keyPoints.slice(0, 5)
        };
    });
    const words = text.toLowerCase().split(/\s+/);
    const commonWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can', 'this', 'that', 'these', 'those']);
    const wordFreq = {};
    words.forEach(word => {
        const cleaned = word.replace(/[^a-z]/g, '');
        if (cleaned.length > 4 && !commonWords.has(cleaned)) {
            wordFreq[cleaned] = (wordFreq[cleaned] || 0) + 1;
        }
    });
    const importantTopics = Object.entries(wordFreq)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([word]) => word.charAt(0).toUpperCase() + word.slice(1));
    const learningObjectives = [
        `Understand the main concepts and structure presented in ${filename}`,
        `Identify and explain key terminology and definitions`,
        `Apply the principles and ideas to practical scenarios`
    ];
    const mainConcepts = [];
    chapters.forEach(ch => {
        if (ch.title && !ch.title.startsWith('Section ')) {
            mainConcepts.push(ch.title);
        }
    });
    importantTopics.slice(0, 3).forEach(topic => {
        mainConcepts.push(`${topic} and its applications`);
    });
    const studyTips = [
        'Create flashcards for key terms and definitions',
        'Summarize each chapter in your own words',
        'Connect concepts to real-world examples',
        'Review key points regularly using spaced repetition',
        'Test yourself on the learning objectives'
    ];
    const wordCount = words.length;
    const estimatedReadTime = Math.ceil(wordCount / 200);
    const summary = `This ${estimatedReadTime}-minute read covers ${chapters.length} main sections with ${importantTopics.length} key topics. The material focuses on ${importantTopics.slice(0, 3).join(', ')}, providing comprehensive coverage of essential concepts and practical applications.`;
    return {
        summary,
        chapters,
        importantTopics,
        suggestedFlashcards: Math.min(Math.max(10, chapters.length * 4), 30),
        learningObjectives,
        mainConcepts: mainConcepts.slice(0, 5),
        studyTips: studyTips.slice(0, 5)
    };
}
async function analyzeLegalDocumentWithOllama(text, filename) {
    const ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    const model = process.env.OLLAMA_MODEL || 'qwen3:14b';
    console.log(`[LLM] Calling Ollama for legal document analysis at ${ollamaUrl} with model ${model}`);
    const prompt = `You are a legal educator evaluating a legal document for study purposes. Analyze this document for quality and educational value.

IMPORTANT: Detect the primary language of the document and respond in that SAME language. If the document is in German, respond in German. If it's in English, respond in English. Match the document's language exactly.

TASK:
1. Identify the EXACT type of legal document (e.g., "Employment Contract", "Service Agreement", "Lease Agreement", "Terms of Service", "Non-Disclosure Agreement")
2. Write a 2-3 sentence summary explaining what this document establishes (in the document's language)
3. List 3-5 strengths: what was done well (specific clauses, clear language, comprehensive coverage) (in the document's language)
4. List 3-5 weaknesses: what could be improved (missing clauses, unclear terms, one-sided provisions) (in the document's language)
5. Extract 5-8 key legal terms that students should learn (in the document's language)
6. Estimate suggested flashcards (10-25) for legal concepts in this document

Document: ${filename}
Text: ${text.substring(0, 10000)}

Return ONLY valid JSON:
{"documentType":"Exact document type in document's language","summary":"2-3 sentence overview in document's language","strengths":["Specific strength 1","Specific strength 2","Specific strength 3"],"weaknesses":["Specific weakness 1","Specific weakness 2","Specific weakness 3"],"keyTerms":["Term 1","Term 2","Term 3","Term 4","Term 5"],"suggestedFlashcards":15}`;
    const response = await fetch(`${ollamaUrl}/api/generate`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model,
            prompt,
            stream: false, think: false,
            format: "json",
            options: {
                temperature: 0.2,
                top_p: 0.85,
                top_k: 40,
                num_ctx: 81920,
                num_predict: 1536,
                repeat_penalty: 1.15,
                presence_penalty: 0.3,
                frequency_penalty: 0.2,
            },
        }),
    });
    if (!response.ok) {
        throw new Error(`Ollama API error: ${response.statusText}`);
    }
    const data = await response.json();
    const responseText = String(data.response || '');
    console.log(`[LLM] Ollama legal document analysis response length: ${responseText.length}`);
    try {
        let jsonText = responseText.trim();
        if (jsonText.includes('```json')) {
            jsonText = jsonText.split('```json')[1].split('```')[0].trim();
        }
        else if (jsonText.includes('```')) {
            jsonText = jsonText.split('```')[1].split('```')[0].trim();
        }
        else {
            const jsonStart = jsonText.indexOf('{');
            if (jsonStart !== -1) {
                let braceCount = 0;
                let jsonEnd = -1;
                for (let i = jsonStart; i < jsonText.length; i++) {
                    if (jsonText[i] === '{')
                        braceCount++;
                    if (jsonText[i] === '}')
                        braceCount--;
                    if (braceCount === 0) {
                        jsonEnd = i + 1;
                        break;
                    }
                }
                if (jsonEnd !== -1) {
                    jsonText = jsonText.substring(jsonStart, jsonEnd);
                }
            }
        }
        const parsed = JSON.parse(jsonText);
        console.log(`[LLM] Successfully analyzed legal document with Ollama`);
        return {
            documentType: parsed.documentType || 'Legal Document',
            summary: parsed.summary || 'Legal document analysis',
            strengths: parsed.strengths || [],
            weaknesses: parsed.weaknesses || [],
            suggestedFlashcards: parsed.suggestedFlashcards || 15,
            keyTerms: parsed.keyTerms || []
        };
    }
    catch (parseError) {
        console.error('[LLM] Failed to parse Ollama legal document analysis response:', parseError);
        throw new Error('Failed to parse legal document analysis response from Ollama');
    }
}
async function analyzeLegalDocumentWithOpenAI(text, filename) {
    console.log('[LLM] OpenAI legal document analysis not implemented, using mock');
    return analyzeLegalDocumentWithMock(text, filename);
}
async function analyzeLegalDocumentWithMock(text, filename) {
    console.log('[LLM] Using mock legal document analysis');
    const lowerText = text.toLowerCase();
    let documentType = 'Legal Document';
    if (lowerText.includes('employment') || lowerText.includes('hire')) {
        documentType = 'Employment Agreement';
    }
    else if (lowerText.includes('service') && (lowerText.includes('agreement') || lowerText.includes('contract'))) {
        documentType = 'Service Agreement';
    }
    else if (lowerText.includes('lease') || lowerText.includes('rental')) {
        documentType = 'Lease Agreement';
    }
    else if (lowerText.includes('terms of service') || lowerText.includes('terms and conditions')) {
        documentType = 'Terms of Service';
    }
    else if (lowerText.includes('non-disclosure') || lowerText.includes('nda') || lowerText.includes('confidentiality agreement')) {
        documentType = 'Non-Disclosure Agreement';
    }
    else if (lowerText.includes('purchase') || lowerText.includes('sale')) {
        documentType = 'Purchase Agreement';
    }
    const summary = `This ${documentType.toLowerCase()} establishes the legal relationship between parties, defining their rights, obligations, and responsibilities. It outlines payment terms, duration, termination conditions, and dispute resolution procedures.`;
    const strengths = [
        'Clear identification of parties and their roles',
        'Specific payment terms and deadlines are well-defined',
        'Includes termination clauses with notice periods',
        'Uses standard legal language appropriate for this document type'
    ];
    const weaknesses = [
        'Could benefit from more specific performance metrics',
        'Limited detail on dispute resolution procedures',
        'Some terms could be defined more precisely',
        'Missing examples or clarifications for complex clauses'
    ];
    const keyTerms = [
        'Parties',
        'Consideration',
        'Term',
        'Termination',
        'Indemnification',
        'Governing Law',
        'Force Majeure',
        'Severability'
    ];
    return {
        documentType,
        summary,
        strengths,
        weaknesses,
        suggestedFlashcards: 15,
        keyTerms
    };
}
async function validateAnswer(userAnswer, correctDefinition, term) {
    const provider = process.env.LLM_PROVIDER || 'mock';
    console.log(`[LLM] Validating answer with provider: ${provider}`);
    try {
        switch (provider) {
            case 'ollama':
                return await validateAnswerWithOllama(userAnswer, correctDefinition, term);
            case 'openai':
                return await validateAnswerWithOpenAI(userAnswer, correctDefinition, term);
            case 'mock':
            default:
                return validateAnswerWithMock(userAnswer, correctDefinition, term);
        }
    }
    catch (error) {
        console.error(`[LLM] Answer validation failed with ${provider}:`, error);
        console.log('[LLM] Falling back to mock validation');
        return validateAnswerWithMock(userAnswer, correctDefinition, term);
    }
}
async function validateAnswerWithOllama(userAnswer, correctDefinition, term) {
    const ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    const model = process.env.OLLAMA_MODEL || 'qwen3:14b';
    const prompt = `Evaluate if the student understood the legal concept.

Term: "${term}"
Correct definition: "${correctDefinition}"
Student's answer: "${userAnswer}"

Grade the answer:
- 90-100: Fully correct, all key concepts present
- 70-89: Mostly correct, minor details missing
- 50-69: Partially correct, some key concepts missing
- 0-49: Incorrect or major concepts missing

Provide constructive feedback. Be lenient with wording but strict on legal accuracy.

Return JSON only:
{"isCorrect":true|false,"score":0-100,"feedback":"Brief specific feedback","keyConceptsMissed":["concept1"],"keyConceptsIncluded":["concept2"]}`;
    const response = await fetch(`${ollamaUrl}/api/generate`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model,
            prompt,
            stream: false, think: false,
            options: {
                temperature: 0.15,
                top_p: 0.85,
                top_k: 40,
                num_ctx: 8192,
                num_predict: 512,
                repeat_penalty: 1.15,
                presence_penalty: 0.3,
            },
        }),
    });
    if (!response.ok) {
        throw new Error(`Ollama API error: ${response.statusText}`);
    }
    const data = await response.json();
    const responseText = String(data.response || '');
    try {
        let jsonText = responseText.trim();
        if (jsonText.includes('```json')) {
            jsonText = jsonText.split('```json')[1].split('```')[0].trim();
        }
        else if (jsonText.includes('```')) {
            jsonText = jsonText.split('```')[1].split('```')[0].trim();
        }
        const parsed = JSON.parse(jsonText);
        return {
            isCorrect: parsed.isCorrect || parsed.score >= 70,
            score: parsed.score || 0,
            feedback: parsed.feedback || 'No feedback available',
            keyConceptsMissed: parsed.keyConceptsMissed || [],
            keyConceptsIncluded: parsed.keyConceptsIncluded || []
        };
    }
    catch (parseError) {
        console.error('[LLM] Failed to parse Ollama answer validation response:', parseError);
        throw new Error('Failed to parse answer validation response from Ollama');
    }
}
async function validateAnswerWithOpenAI(userAnswer, correctDefinition, term) {
    console.log('[LLM] OpenAI answer validation not implemented, using mock');
    return validateAnswerWithMock(userAnswer, correctDefinition, term);
}
function validateAnswerWithMock(userAnswer, correctDefinition, term) {
    const normalizedAnswer = userAnswer.toLowerCase().trim()
        .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, '')
        .replace(/\s+/g, ' ');
    const normalizedCorrect = correctDefinition.toLowerCase().trim()
        .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, '')
        .replace(/\s+/g, ' ');
    const stopWords = new Set(['a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
        'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'should', 'could', 'may', 'might',
        'must', 'can', 'of', 'to', 'for', 'in', 'on', 'at', 'by', 'with', 'from', 'as', 'or', 'and',
        'but', 'if', 'then', 'than', 'that', 'this', 'these', 'those', 'it', 'its', 'such']);
    const extractKeyWords = (text) => {
        return text.split(' ')
            .filter(word => word.length > 2 && !stopWords.has(word))
            .map(word => {
            if (word.endsWith('ies'))
                return word.slice(0, -3) + 'y';
            if (word.endsWith('es'))
                return word.slice(0, -2);
            if (word.endsWith('s') && word.length > 3)
                return word.slice(0, -1);
            if (word.endsWith('ed') && word.length > 4)
                return word.slice(0, -2);
            if (word.endsWith('ing') && word.length > 5)
                return word.slice(0, -3);
            return word;
        });
    };
    const answerKeyWords = extractKeyWords(normalizedAnswer);
    const correctKeyWords = extractKeyWords(normalizedCorrect);
    const answerSet = new Set(answerKeyWords);
    const correctSet = new Set(correctKeyWords);
    const included = [...answerSet].filter(x => correctSet.has(x));
    const missed = [...correctSet].filter(x => !answerSet.has(x));
    const intersection = new Set(included);
    const union = new Set([...answerSet, ...correctSet]);
    const jaccardSimilarity = intersection.size / union.size;
    const coverage = intersection.size / correctSet.size;
    let score = Math.round(Math.max(jaccardSimilarity, coverage) * 100);
    let isCorrect = score >= 70;
    let feedback = '';
    if (score >= 90) {
        feedback = 'Excellent! You have a strong understanding of this concept.';
    }
    else if (score >= 70) {
        feedback = 'Good! You captured the main idea, though some details could be more precise.';
    }
    else if (score >= 50) {
        feedback = 'You have a partial understanding. Review the key concepts you missed.';
    }
    else {
        feedback = 'This answer needs work. Make sure you understand all the key concepts in the definition.';
    }
    return {
        isCorrect,
        score,
        feedback,
        keyConceptsMissed: missed.slice(0, 5),
        keyConceptsIncluded: included.slice(0, 5)
    };
}
async function extractRelationshipsFromDocument(documentText, documentName) {
    const ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    const model = process.env.OLLAMA_MODEL || 'qwen3:14b';
    console.log(`[LLM] Extracting relationships from document: ${documentName}`);
    const prompt = `You are a legal analyst. Extract ONLY the MOST IMPORTANT entities and relationships from this REAL legal document.

⚠️ CRITICAL FILTERING RULES - READ CAREFULLY:
DO NOT extract ANY of the following:
❌ Example entities (e.g., "John Doe", "Jane Smith", "Acme Corp", "Example Corp")
❌ Placeholder text (e.g., "Sample Company", "Your Name Here", "[Insert Name]")
❌ Template instructions (e.g., "Fill in your details", "Add party name")
❌ Draft markers (anything with "DRAFT", "TEMPLATE", "SAMPLE", "TEST", "EXAMPLE" in the name)
❌ Generic references (e.g., "the parties", "the company", "the individual")
❌ Hypothetical scenarios or example cases mentioned in templates

✅ ONLY extract REAL entities that appear in an ACTUAL case/contract:
✓ Specific named individuals (real full names)
✓ Actual companies with real business names
✓ Real addresses, emails, phone numbers
✓ Specific signed documents with real titles
✓ Entities that are CENTRAL to THIS specific case

RULES:
- Detect document language and respond in that language
- Extract ONLY key parties that are REAL and NAMED in the document
- Focus on PRIMARY relationships between REAL entities
- Maximum 8 entities total (prefer fewer high-quality entities)
- Maximum 6 relationships total (only significant connections)
- If document appears to be a template/draft with no real parties, return empty arrays

ENTITIES (choose most important REAL ones only):
- name: Full legal name (must be a SPECIFIC real name, not generic)
- type: "person", "organization", or "document"
- role: Primary role (e.g., "Plaintiff", "Attorney", "Contractor", "Client")
- email: Only if explicitly stated
- phone: Only if explicitly stated

RELATIONSHIPS (only significant ones between REAL entities):
- fromEntity: Exact name from entities
- toEntity: Exact name from entities
- relationType: "employs" | "represents" | "contracts with" | "opposes" | "signed by" | "party to"
- label: 3-5 words max
- strength: "strong" (core parties) | "normal" (secondary) | "weak" (mentions)

Document: ${documentName}
Text: ${documentText.substring(0, 6000)}

Return ONLY JSON, no explanations:
{
  "entities": [
    {"name": "John Smith", "type": "person", "role": "Plaintiff"},
    {"name": "TechCorp Inc.", "type": "organization", "role": "Defendant"}
  ],
  "relationships": [
    {"fromEntity": "John Smith", "toEntity": "Jane Doe", "relationType": "represented by", "label": "Legal representation", "strength": "strong"}
  ]
}`;
    try {
        const response = await fetch(`${ollamaUrl}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model,
                prompt,
                stream: false, think: false,
                format: 'json',
                options: {
                    temperature: 0.1,
                    top_p: 0.9,
                    top_k: 20,
                    num_ctx: 8192,
                    num_predict: 800,
                    repeat_penalty: 1.1,
                },
            }),
            signal: AbortSignal.timeout(180000),
        });
        if (!response.ok) {
            throw new Error(`Ollama API error: ${response.statusText}`);
        }
        const data = await response.json();
        const responseText = String(data.response || '');
        let jsonText = responseText.trim();
        if (jsonText.includes('```json')) {
            jsonText = jsonText.split('```json')[1].split('```')[0].trim();
        }
        else if (jsonText.includes('```')) {
            jsonText = jsonText.split('```')[1].split('```')[0].trim();
        }
        else {
            const jsonStart = jsonText.indexOf('{');
            if (jsonStart !== -1) {
                let braceCount = 0;
                let jsonEnd = -1;
                for (let i = jsonStart; i < jsonText.length; i++) {
                    if (jsonText[i] === '{')
                        braceCount++;
                    if (jsonText[i] === '}')
                        braceCount--;
                    if (braceCount === 0) {
                        jsonEnd = i + 1;
                        break;
                    }
                }
                if (jsonEnd !== -1) {
                    jsonText = jsonText.substring(jsonStart, jsonEnd);
                }
            }
        }
        const result = JSON.parse(jsonText);
        return {
            entities: result.entities || [],
            relationships: result.relationships || []
        };
    }
    catch (error) {
        console.error('[LLM] Error extracting relationships:', error);
        return { entities: [], relationships: [] };
    }
}
async function extractTimelineFromDocument(documentText, documentName) {
    const ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    const model = process.env.OLLAMA_MODEL || 'qwen3:14b';
    console.log(`[LLM] Extracting timeline events from document: ${documentName}`);
    const prompt = `Extract ALL dates mentioned in this legal document and convert them to timeline events.

IMPORTANT INSTRUCTIONS:
- Look for dates in ALL formats: "15.01.2025", "January 15 2025", "15/01/2025", "2025-01-15"
- Extract dates from: contract signing dates, effective dates, termination dates, payment deadlines, delivery dates, warranty periods, renewal dates
- In contracts, look for phrases like: "signed on", "effective from", "terminating on", "due by", "delivered by", "valid until"
- Maximum 15 events (prioritize most important if more exist)
- Detect document language and use that language for title/description

FOR EACH DATE FOUND:
- title: What happened (3-5 words, in document language)
- description: Brief context from document (one sentence, in document language)
- date: ISO format YYYY-MM-DD (convert ALL date formats to this)
- eventType: "deadline" | "other"
- severity: "critical" | "high" | "normal"
- color: "#EF4444" (critical) | "#D4AF37" (high) | "#3B82F6" (normal)

EXAMPLES of dates to extract:
- "signed on 15.01.2025" → date: "2025-01-15", title: "Contract signed"
- "payment due by March 1st 2025" → date: "2025-03-01", title: "Payment deadline"
- "effective from 2025-02-01" → date: "2025-02-01", title: "Contract effective"

Document: ${documentName}
Text: ${documentText.substring(0, 8000)}

Return ONLY JSON array:
{
  "events": [
    {
      "title": "Contract signed",
      "description": "Work contract signed by both parties",
      "date": "2025-01-15",
      "eventType": "other",
      "severity": "high",
      "color": "#D4AF37"
    }
  ]
}`;
    try {
        const response = await fetch(`${ollamaUrl}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model,
                prompt,
                stream: false, think: false,
                format: 'json',
                options: {
                    temperature: 0.1,
                    top_p: 0.9,
                    top_k: 20,
                    num_ctx: 8192,
                    num_predict: 800,
                    repeat_penalty: 1.1,
                },
            }),
            signal: AbortSignal.timeout(180000),
        });
        if (!response.ok) {
            throw new Error(`Ollama API error: ${response.statusText}`);
        }
        const data = await response.json();
        const responseText = String(data.response || '');
        let jsonText = responseText.trim();
        if (jsonText.includes('```json')) {
            jsonText = jsonText.split('```json')[1].split('```')[0].trim();
        }
        else if (jsonText.includes('```')) {
            jsonText = jsonText.split('```')[1].split('```')[0].trim();
        }
        else {
            const jsonStart = jsonText.indexOf('{');
            if (jsonStart !== -1) {
                let braceCount = 0;
                let jsonEnd = -1;
                for (let i = jsonStart; i < jsonText.length; i++) {
                    if (jsonText[i] === '{')
                        braceCount++;
                    if (jsonText[i] === '}')
                        braceCount--;
                    if (braceCount === 0) {
                        jsonEnd = i + 1;
                        break;
                    }
                }
                if (jsonEnd !== -1) {
                    jsonText = jsonText.substring(jsonStart, jsonEnd);
                }
            }
        }
        const result = JSON.parse(jsonText);
        return {
            events: result.events || []
        };
    }
    catch (error) {
        console.error('[LLM] Error extracting timeline:', error);
        return { events: [] };
    }
}
//# sourceMappingURL=llmAdapter.js.map