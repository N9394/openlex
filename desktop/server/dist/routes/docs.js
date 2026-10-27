"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const client_1 = require("@prisma/client");
const auth_1 = require("../middleware/auth");
const docParser_1 = require("../services/docParser");
const llmAdapter_1 = require("../services/llmAdapter");
const parallelProcessor_1 = require("../services/parallelProcessor");
const rightsExtractor_1 = require("../services/rightsExtractor");
const healthChecker_1 = require("../services/healthChecker");
const deadlineExtractor_1 = require("../services/deadlineExtractor");
const notifications_1 = require("../utils/notifications");
const preferences_1 = require("../types/preferences");
const pii_1 = require("../services/pii");
const entityLinkService_1 = require("../services/entityLinkService");
const aiAuditService_1 = require("../services/aiAuditService");
const clauseNLIService_1 = require("../services/clauseNLIService");
const promises_1 = __importDefault(require("fs/promises"));
const router = express_1.default.Router();
const prisma = new client_1.PrismaClient();
const storage = multer_1.default.diskStorage({
    destination: async (req, file, cb) => {
        const uploadDir = path_1.default.join(__dirname, '../../uploads');
        await promises_1.default.mkdir(uploadDir, { recursive: true });
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueName = `${Date.now()}_${file.originalname}`;
        cb(null, uniqueName);
    },
});
const upload = (0, multer_1.default)({
    storage,
    limits: {
        fileSize: 10 * 1024 * 1024,
    },
    fileFilter: (req, file, cb) => {
        const allowedMimes = [
            'application/pdf',
            'text/plain',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/msword'
        ];
        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true);
        }
        else {
            cb(new Error('Only PDF, DOCX, DOC, and TXT files are allowed'));
        }
    },
});
async function checkQuota(userId) {
    // Quota disabled — all users have unlimited access
    return { allowed: true };
    const user = await prisma.user.findUnique({
        where: { id: userId },
    });
    if (!user) {
        return { allowed: false, message: 'User not found' };
    }
    if (user.tier === 'annual') {
        return { allowed: true };
    }
    const now = new Date();
    if (now > user.weekResetDate) {
        await prisma.user.update({
            where: { id: userId },
            data: {
                documentsThisWeek: 0,
                weekResetDate: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
            },
        });
        return { allowed: true };
    }
    if (user.documentsThisWeek >= 5) {
        return {
            allowed: false,
            message: `Free tier limit reached (5 documents per month). Quota resets on ${user.weekResetDate.toISOString()}`,
        };
    }
    return { allowed: true };
}
router.post('/upload', auth_1.authenticateToken, upload.single('file'), async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const file = req.file;
        if (!file) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'No file uploaded',
            });
        }
        const language = (req.headers['accept-language']?.includes('de') ? 'de' : 'en');
        console.log(`[DOCS] Language preference: ${language}`);
        const quota = await checkQuota(userId);
        if (!quota.allowed) {
            await promises_1.default.unlink(file.path);
            return res.status(403).json({
                error: 'Quota Exceeded',
                message: quota.message,
            });
        }
        const document = await prisma.document.create({
            data: {
                userId,
                filename: file.originalname,
                filepath: file.path,
                filesize: file.size,
                mimetype: file.mimetype,
                status: 'processing',
            },
        });
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (user && user.tier === 'free') {
            await prisma.user.update({
                where: { id: userId },
                data: { documentsThisWeek: user.documentsThisWeek + 1 },
            });
        }
        let uploadJurisdictions = [];
        try {
            if (req.body.jurisdictions) {
                uploadJurisdictions = typeof req.body.jurisdictions === 'string'
                    ? JSON.parse(req.body.jurisdictions)
                    : req.body.jurisdictions;
            }
        } catch { uploadJurisdictions = []; }
        processDocumentAsync(document.id, file.path, uploadJurisdictions);
        const caseId = req.body.caseId;
        if (caseId) {
            try {
                await (0, entityLinkService_1.linkDocumentToCase)(userId, document.id, caseId, {
                    isAutoGenerated: false,
                });
                console.log(`[DOCS] Document ${document.id} linked to case ${caseId}`);
            }
            catch (linkError) {
                console.warn('[DOCS] Failed to link document to case:', linkError);
            }
        }
        console.log(`[DOCS] Document uploaded: ${document.id} by user ${userId}`);
        res.status(201).json({
            id: document.id,
            filename: document.filename,
            status: document.status,
            uploadedAt: document.createdAt,
        });
    }
    catch (error) {
        if (req.file) {
            await promises_1.default.unlink(req.file.path).catch(() => { });
        }
        next(error);
    }
});
function detectJurisdictionFromText(text) {
    const lowerText = text.toLowerCase();
    if (/(under|governed by|subject to|according to)\s+(german|germany|deutsch)/i.test(text))
        return 'DE';
    if (/(under|governed by|subject to|according to)\s+(uk|english|british|england)/i.test(text))
        return 'UK';
    if (/(under|governed by|subject to|according to)\s+(french|france)/i.test(text))
        return 'FR';
    if (/(under|governed by|subject to|according to)\s+(swiss|switzerland)/i.test(text))
        return 'CH';
    if (/(under|governed by|subject to|according to)\s+(austrian|austria)/i.test(text))
        return 'AT';
    if (/(under|governed by|subject to|according to)\s+(canadian|canada)/i.test(text))
        return 'CA';
    if (/(under|governed by|subject to|according to)\s+(australian|australia)/i.test(text))
        return 'AU';
    if (/(under|governed by|subject to|according to)\s+(eu|european)/i.test(text))
        return 'EU';
    if (/\b(BGB|HGB|Gerichtsstand|Vertragsrecht)\b/i.test(text))
        return 'DE';
    if (/\b(common law|English law|statute)\b/i.test(text))
        return 'UK';
    return null;
}
function detectDocumentType(text) {
    const lower = text.toLowerCase();
    if (/\b(lease|tenant|landlord|rent|premises|occupancy)\b/.test(lower)) return 'lease agreement';
    if (/\b(employment|employee|employer|salary|termination of employment|workplace)\b/.test(lower)) return 'employment contract';
    if (/\b(non-disclosure|confidential information|nda|proprietary)\b/.test(lower)) return 'non-disclosure agreement';
    if (/\b(purchase|buyer|seller|sale of goods|purchase price)\b/.test(lower)) return 'purchase agreement';
    if (/\b(loan|borrower|lender|interest rate|repayment)\b/.test(lower)) return 'loan agreement';
    if (/\b(partnership|partner|joint venture)\b/.test(lower)) return 'partnership agreement';
    if (/\b(service|contractor|independent contractor|scope of work)\b/.test(lower)) return 'service agreement';
    if (/\b(license|licensor|licensee|intellectual property|royalt)\b/.test(lower)) return 'license agreement';
    if (/\b(merger|acquisition|takeover|share purchase)\b/.test(lower)) return 'merger and acquisition agreement';
    if (/\b(insurance|policy|insured|premium|coverage)\b/.test(lower)) return 'insurance policy';
    return 'legal contract';
}
async function verifyAnalysisItemsWithNLI(analysis, ragSources, auditContext) {
    if (!ragSources || ragSources.length === 0) return analysis;
    let nliReady = false;
    try {
        nliReady = await (0, clauseNLIService_1.isNLIAvailable)();
    } catch { nliReady = false; }
    if (!nliReady) {
        console.log('[DOCS/NLI] NLI service not available, skipping verification');
        return analysis;
    }
    const sourceContext = ragSources.map(s => `${s.source_name || ''}: ${(s.text || '').substring(0, 2000)}`).join('\n\n');
    const verifiableClaims = [];
    // Collect risk flags with statute references
    if (analysis.riskFlags) {
        analysis.riskFlags.forEach((risk, idx) => {
            const text = risk.explanation || risk.category || '';
            if (/§|Article\s+\d|Section\s+\d|according to|pursuant to|under\s+the/i.test(text)) {
                verifiableClaims.push({ claim: text, type: 'riskFlag', index: idx });
            }
        });
    }
    // Collect key clauses with statute references
    if (analysis.keyClauses) {
        analysis.keyClauses.forEach((clause, idx) => {
            const text = clause.content || clause.clause || clause.title || '';
            if (/§|Article\s+\d|Section\s+\d|according to|pursuant to|under\s+the/i.test(text)) {
                verifiableClaims.push({ claim: text, type: 'keyClause', index: idx });
            }
        });
    }
    if (verifiableClaims.length === 0) {
        console.log('[DOCS/NLI] No verifiable claims found in analysis');
        return analysis;
    }
    console.log(`[DOCS/NLI] Verifying ${verifiableClaims.length} claims against ${ragSources.length} sources`);
    for (const item of verifiableClaims) {
        try {
            // Find best matching source by section number
            let bestSource = sourceContext;
            const sectionMatch = item.claim.match(/§\s*(\d+)/);
            if (sectionMatch) {
                const sectionNum = sectionMatch[1];
                const matchingSource = ragSources.find(s => (s.source_name || '').includes(`§ ${sectionNum}`) || (s.text || '').includes(`§ ${sectionNum}`));
                if (matchingSource) {
                    bestSource = (matchingSource.text || '').substring(0, 2000);
                }
            }
            const nliResult = await (0, clauseNLIService_1.verifyEntailment)(bestSource.substring(0, 2000), item.claim, {});
            const nliData = {
                nliVerified: nliResult.label === 'entailment',
                nliLabel: nliResult.label,
                nliConfidence: nliResult.confidence,
            };
            if (auditContext) {
                auditContext.logNLIVerification({
                    claim: item.claim.substring(0, 200),
                    sourceText: bestSource.substring(0, 200),
                    sourceRef: `${item.type}[${item.index}]`,
                    result: nliResult.label,
                    confidence: nliResult.confidence,
                    verificationDurationMs: 0,
                });
            }
            if (item.type === 'riskFlag') {
                Object.assign(analysis.riskFlags[item.index], nliData);
            } else if (item.type === 'keyClause') {
                Object.assign(analysis.keyClauses[item.index], nliData);
            }
        } catch (nliErr) {
            console.warn(`[DOCS/NLI] Verification failed for ${item.type}[${item.index}]:`, nliErr.message);
        }
    }
    return analysis;
}
const LARGE_DOCUMENT_THRESHOLD = 3000;
async function smartAnalyzeDocument(text, language, jurisdiction, options) {
    if (text.length > LARGE_DOCUMENT_THRESHOLD) {
        console.log(`[DOCS] Large document (${text.length} chars) - using parallel processor`);
        const parallelResult = await (0, parallelProcessor_1.analyzeDocument)(text);
        if (parallelResult.partial) {
            console.log(`[DOCS] Parallel analysis PARTIAL - ${parallelResult.chunksSucceeded}/${parallelResult.chunksProcessed} chunks succeeded`);
            if (parallelResult.errors) {
                console.log(`[DOCS] Errors: ${parallelResult.errors.slice(0, 3).join('; ')}`);
            }
        }
        else {
            console.log(`[DOCS] Parallel analysis completed in ${parallelResult.duration}ms (${parallelResult.chunksProcessed} chunks)`);
        }
        const summaryLines = parallelResult.summary
            ? parallelResult.summary.split(/\n+/).filter((line) => line.trim()).slice(0, 5)
            : ['Document analysis completed using parallel processing.'];
        if (parallelResult.partial) {
            summaryLines.unshift('⚠️ Some sections could not be fully analyzed due to timeout. Results shown are partial.');
        }
        const analysis = {
            summary: {
                title: 'Document Analysis',
                content: summaryLines.join(' '),
                keyPoints: summaryLines,
            },
            keyClauses: parallelResult.clauses.map((clause) => ({
                title: clause.title || 'Clause',
                content: clause.content || '',
                importance: clause.importance || 'medium',
                category: clause.type || 'general'
            })),
            riskFlags: parallelResult.riskFlags.map((risk) => ({
                level: risk.severity === 'high' ? 'red' : risk.severity === 'medium' ? 'yellow' : 'green',
                category: risk.title || 'Risk',
                explanation: risk.description || '',
                recommendation: risk.recommendation || ''
            })),
            importantDates: parallelResult.importantDates.map((date) => ({
                date: date.date || '',
                description: date.description || '',
                isDeadline: date.isDeadline || false,
                importance: date.importance || 'medium'
            })),
            readabilityScore: {
                score: 50,
                grade: 'Average',
                explanation: 'Readability analysis performed with parallel processing.'
            },
            overallRiskScore: {
                score: parallelResult.riskFlags.length > 0
                    ? Math.min(100, parallelResult.riskFlags.reduce((acc, r) => acc + (r.severity === 'high' ? 30 : r.severity === 'medium' ? 15 : 5), 0))
                    : 20,
                level: parallelResult.riskFlags.some((r) => r.severity === 'high') ? 'high' :
                    parallelResult.riskFlags.some((r) => r.severity === 'medium') ? 'medium' : 'low',
                explanation: `${parallelResult.riskFlags.length} risk factors identified.`
            },
            missingElements: [],
            clarityScore: {
                overall: parallelResult.partial ? 30 : 50,
                grade: parallelResult.partial ? 'D' : 'C+',
                breakdown: {
                    completeness: parallelResult.partial ? 30 : 50,
                    fairness: 50,
                    structure: 50,
                    precision: parallelResult.partial ? 30 : 50
                },
                strengths: parallelResult.partial
                    ? ['Partial analysis completed - some results available.']
                    : ['Document analyzed using parallel processing for faster results.'],
                weaknesses: parallelResult.partial
                    ? ['Some document sections could not be analyzed due to timeout.', 'Results may be incomplete.']
                    : ['Full clarity analysis not available for large documents.'],
                recommendation: parallelResult.partial
                    ? 'Consider splitting this document into smaller sections for complete analysis.'
                    : 'Review the extracted clauses and risk flags for detailed analysis.'
            }
        };
        return analysis;
    }
    console.log(`[DOCS] Standard document (${text.length} chars) - using standard analyzer`);
    return await (0, llmAdapter_1.analyzeDocument)(text, language, jurisdiction, options);
}
function formatRagContextForPrompt(ragSources, jurisdiction) {
    if (!ragSources || ragSources.length === 0) return '';
    const formatted = ragSources.map((s, i) => {
        const name = s.source_name || 'Legal Source';
        const jur = s.jurisdiction || jurisdiction || 'Unknown';
        const text = (s.text || '').substring(0, 6000);
        return `<document index="${i + 1}"><source>${name}</source><jurisdiction>${jur}</jurisdiction><content>${text}</content></document>`;
    }).join('\n');
    return `\n\nRELEVANT LEGAL PROVISIONS (${jurisdiction}):\nRULES: Only cite sources listed below. Do NOT invent statute references. If no relevant provision is listed, say so.\n${formatted}`;
}
async function processDocumentAsync(documentId, filepath, uploadJurisdictions = []) {
    try {
        const extractedText = await (0, docParser_1.parseDocument)(filepath);
        const document = await prisma.document.findUnique({
            where: { id: documentId },
            select: { userId: true },
        });
        const user = await prisma.user.findUnique({
            where: { id: document.userId },
            select: { jurisdiction: true, language: true, userType: true, userPreferences: true },
        });
        const language = user?.language || 'en';
        // Use uploaded jurisdictions if provided, otherwise detect/fallback
        const jurisdictions = uploadJurisdictions.length > 0
            ? uploadJurisdictions
            : [detectJurisdictionFromText(extractedText) || user?.jurisdiction || 'US'];
        const jurisdiction = jurisdictions[0]; // Primary jurisdiction for LLM context
        const userType = user?.userType || 'individual';
        const userPrefs = (0, preferences_1.parseUserPreferences)(user?.userPreferences || null);
        const preferences = (0, preferences_1.mergePreferences)(userType, userPrefs);
        const analysisDepth = preferences.ai?.analysisDepth ?? 'standard';
        // Run PII detection + RAG pre-fetch in parallel
        const docType = detectDocumentType(extractedText);
        console.log(`[DOCS] Document type: ${docType}, language: ${language}, jurisdictions: ${jurisdictions.join(', ')}`);
        console.log(`[DOCS] Analysis depth: ${analysisDepth} (user type: ${userType})`);
        let anonymizedTextContent = extractedText;
        let encryptedOriginal = null;
        let piiDetections = null;
        let ragSources = [];
        const piiPromise = (async () => {
            try {
                console.log(`[DOCS] Running PII detection for document: ${documentId}`);
                const piiResult = await (0, pii_1.anonymizeText)(extractedText, {
                    language: 'en',
                    minConfidence: 0.6,
                });
                anonymizedTextContent = piiResult.anonymizedText;
                piiDetections = JSON.stringify(piiResult.detections);
                console.log(`[DOCS] PII detection complete: ${piiResult.stats.totalDetections} items found`);
                if ((0, pii_1.isEncryptionConfigured)()) {
                    const masterSecret = (0, pii_1.getMasterSecretFromEnv)();
                    const encrypted = (0, pii_1.encryptText)(extractedText, masterSecret);
                    encryptedOriginal = JSON.stringify(encrypted);
                    console.log(`[DOCS] Original text encrypted for secure storage`);
                }
                else {
                    console.warn(`[DOCS] Encryption not configured - storing original unencrypted`);
                }
            }
            catch (piiError) {
                console.error(`[DOCS] PII detection failed, continuing without anonymization:`, piiError);
            }
        })();
        const ragPromise = (async () => {
            try {
                const { enhancedSearch } = require('../services/rag/retrieval');
                const searchStart = Date.now();
                // Search across all selected jurisdictions
                const ragResults = await Promise.all(
                    jurisdictions.map(jur =>
                        enhancedSearch(`${docType} legal requirements obligations ${jur}`, { jurisdiction: jur, limit: 10, rerank: true, minRerankScore: 0.01 })
                            .catch(() => [])
                    )
                );
                ragSources = ragResults.flat();
                console.log(`[DOCS] RAG pre-fetch: ${ragSources.length} sources in ${Date.now() - searchStart}ms`);
            }
            catch (ragErr) {
                console.warn(`[DOCS] RAG pre-fetch failed (continuing without):`, ragErr.message);
                ragSources = [];
            }
        })();
        await Promise.all([piiPromise, ragPromise]);
        // Audit trail for document analysis
        const auditContext = new aiAuditService_1.AIAuditContext(document.userId, 'document_analysis', `Analyze document ${documentId}`);
        auditContext.setJurisdiction(jurisdictions.join(', '));
        if (ragSources.length > 0) {
            auditContext.logRAGSearch({
                query: `${docType} legal requirements (${jurisdictions.join(', ')})`,
                jurisdiction: jurisdictions.join(', '),
                resultsCount: ragSources.length,
                results: ragSources.slice(0, 5).map(s => ({
                    id: s.id || 'unknown',
                    sourceName: s.source_name || 'Legal Source',
                    relevanceScore: s.score || 0,
                    wasUsed: true
                })),
                searchDurationMs: 0
            });
        }
        const analysisStart = Date.now();
        let analysis = await smartAnalyzeDocument(extractedText, language, jurisdiction, { analysisDepth, ragSources });
        // Phase 3: NLI verification of risk flags and key clauses
        try {
            analysis = await verifyAnalysisItemsWithNLI(analysis, ragSources, auditContext);
        } catch (nliErr) {
            console.warn('[DOCS] NLI verification of analysis items failed:', nliErr.message);
        }
        // Log the analysis to audit trail
        try {
            const summaryText = typeof analysis.summary === 'string' ? analysis.summary : (analysis.summary?.content || JSON.stringify(analysis.summary));
            auditContext.setResponse(summaryText, []);
            auditContext.logLLMCall({
                model: 'document_analysis',
                prompt: `Analyze document (${extractedText.length} chars, depth: ${analysisDepth})`,
                response: summaryText.substring(0, 500),
                durationMs: Date.now() - analysisStart,
                tokens: 0,
                usedFallback: false,
            });
            const auditEnabled = await (0, aiAuditService_1.isAuditEnabled)(null);
            if (auditEnabled) {
                await (0, aiAuditService_1.saveAIAudit)(auditContext.finalize());
            }
        } catch (auditErr) {
            console.warn('[DOCS] Audit logging failed:', auditErr);
        }
        const updatedDocument = await prisma.document.update({
            where: { id: documentId },
            data: {
                status: 'completed',
                extractedText,
                anonymizedText: anonymizedTextContent,
                encryptedOriginal,
                piiDetections,
                piiProcessedAt: piiDetections ? new Date() : null,
                summary: JSON.stringify(analysis.summary),
                keyClauses: JSON.stringify(analysis.keyClauses),
                riskFlags: JSON.stringify(analysis.riskFlags),
                importantDates: JSON.stringify(analysis.importantDates),
                readabilityScore: JSON.stringify(analysis.readabilityScore),
                overallRiskScore: JSON.stringify(analysis.overallRiskScore),
                missingElements: JSON.stringify(analysis.missingElements),
                clarityScore: JSON.stringify(analysis.clarityScore),
            },
        });
        console.log(`[DOCS] Document processed: ${documentId}`);
        try {
            await (0, notifications_1.notifyDocumentAnalysisComplete)(updatedDocument.userId, documentId, updatedDocument.filename);
        }
        catch (notifError) {
            console.error('[DOCS] Failed to send notification:', notifError);
        }
    }
    catch (error) {
        console.error(`[DOCS] Processing failed for ${documentId}:`, error);
        let errorMessage = 'Document analysis failed. Please try again.';
        let errorCode = 'ANALYSIS_ERROR';
        if (error instanceof llmAdapter_1.OllamaConnectionError) {
            errorMessage = 'AI service is unavailable. Please try again later or contact support.';
            errorCode = 'LLM_UNAVAILABLE';
        }
        else if (error instanceof llmAdapter_1.ModelNotFoundError) {
            errorMessage = 'AI model not configured. Please contact support.';
            errorCode = 'MODEL_NOT_FOUND';
        }
        else if (error instanceof llmAdapter_1.AnalysisTimeoutError) {
            errorMessage = 'Document analysis timed out. Try uploading a shorter document.';
            errorCode = 'ANALYSIS_TIMEOUT';
        }
        else if (error instanceof llmAdapter_1.LLMRetryExhaustedError) {
            errorMessage = 'Document analysis failed after multiple attempts. Please try again later.';
            errorCode = 'LLM_RETRY_EXHAUSTED';
        }
        else if (error instanceof llmAdapter_1.LLMError) {
            errorMessage = `AI analysis error: ${error.message}`;
            errorCode = error.code;
        }
        await prisma.document.update({
            where: { id: documentId },
            data: {
                status: 'failed',
                summary: JSON.stringify([`Error: ${errorMessage}`]),
                keyClauses: JSON.stringify([{ code: errorCode, message: errorMessage }]),
            },
        });
    }
}
async function* streamDocumentAnalysis(documentId, filepath, userId) {
    try {
        yield { type: 'status', data: { stage: 'parsing', message: 'Extracting text from document...', progress: 10 } };
        const extractedText = await (0, docParser_1.parseDocument)(filepath);
        yield { type: 'stage_complete', data: { stage: 'parsing', success: true, textLength: extractedText.length } };
        yield { type: 'status', data: { stage: 'pii_detection', message: 'Detecting sensitive information...', progress: 15 } };
        let anonymizedTextContent = extractedText;
        let encryptedOriginal = null;
        let piiDetections = null;
        let piiCount = 0;
        try {
            const piiResult = await (0, pii_1.anonymizeText)(extractedText, {
                language: 'en',
                minConfidence: 0.6,
            });
            anonymizedTextContent = piiResult.anonymizedText;
            piiDetections = JSON.stringify(piiResult.detections);
            piiCount = piiResult.stats.totalDetections;
            if ((0, pii_1.isEncryptionConfigured)()) {
                const masterSecret = (0, pii_1.getMasterSecretFromEnv)();
                const encrypted = (0, pii_1.encryptText)(extractedText, masterSecret);
                encryptedOriginal = JSON.stringify(encrypted);
            }
        }
        catch (piiError) {
            console.warn('[DOCS STREAM] PII detection failed:', piiError);
        }
        yield { type: 'stage_complete', data: { stage: 'pii_detection', piiFound: piiCount } };
        yield { type: 'status', data: { stage: 'preparing', message: 'Loading preferences and searching legal database...', progress: 20 } };
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { jurisdiction: true, language: true, userType: true, userPreferences: true },
        });
        const language = user?.language || 'en';
        const detectedJurisdiction = detectJurisdictionFromText(extractedText);
        const jurisdiction = detectedJurisdiction || user?.jurisdiction || 'US';
        const userType = user?.userType || 'individual';
        const userPrefs = (0, preferences_1.parseUserPreferences)(user?.userPreferences || null);
        const preferences = (0, preferences_1.mergePreferences)(userType, userPrefs);
        const analysisDepth = (preferences.ai?.analysisDepth ?? 'standard');
        // RAG pre-fetch for streaming path
        const docType = detectDocumentType(extractedText);
        const ragQuery = `${docType} legal requirements obligations ${jurisdiction}`;
        let ragSources = [];
        try {
            const { enhancedSearch } = require('../services/rag/retrieval');
            ragSources = await enhancedSearch(ragQuery, { jurisdiction, limit: 10, rerank: true, minRerankScore: 0.01 });
            console.log(`[DOCS/Stream] RAG pre-fetch: ${ragSources.length} sources`);
        } catch (ragErr) {
            console.warn(`[DOCS/Stream] RAG pre-fetch failed:`, ragErr.message);
        }
        yield { type: 'stage_complete', data: { stage: 'preparing', jurisdiction, language, ragSources: ragSources.length } };
        const isLargeDoc = extractedText.length > LARGE_DOCUMENT_THRESHOLD;
        yield {
            type: 'status',
            data: {
                stage: 'analyzing',
                message: isLargeDoc
                    ? 'Analyzing large document with parallel processing...'
                    : 'AI is analyzing your document...',
                progress: 30
            }
        };
        const streamAnalysisStart = Date.now();
        let analysis = await smartAnalyzeDocument(extractedText, language, jurisdiction, { analysisDepth, ragSources });
        yield { type: 'stage_complete', data: { stage: 'analyzing', success: true, parallelProcessed: isLargeDoc } };
        // NLI verification of risk flags and key clauses (streaming path)
        const streamAuditCtx = new aiAuditService_1.AIAuditContext(userId, 'document_analysis_stream', `Stream analyze document ${documentId}`);
        streamAuditCtx.setJurisdiction(jurisdiction);
        if (ragSources.length > 0) {
            streamAuditCtx.logRAGSearch({
                query: ragQuery,
                jurisdiction,
                resultsCount: ragSources.length,
                results: ragSources.slice(0, 5).map(s => ({
                    id: s.id || 'unknown',
                    sourceName: s.source_name || 'Legal Source',
                    relevanceScore: s.score || 0,
                    wasUsed: true
                })),
                searchDurationMs: 0
            });
        }
        try {
            analysis = await verifyAnalysisItemsWithNLI(analysis, ragSources, streamAuditCtx);
        } catch (nliErr) {
            console.warn('[DOCS/Stream] NLI verification failed:', nliErr.message);
        }
        // Audit trail for streaming document analysis
        try {
            const summaryText = typeof analysis.summary === 'string' ? analysis.summary : (analysis.summary?.content || 'Analysis complete');
            streamAuditCtx.setResponse(summaryText, []);
            streamAuditCtx.logLLMCall({
                model: 'document_analysis',
                prompt: `Stream analyze document (${extractedText.length} chars, depth: ${analysisDepth})`,
                response: summaryText.substring(0, 500),
                durationMs: Date.now() - streamAnalysisStart,
                tokens: 0,
                usedFallback: false,
            });
            const auditOn = await (0, aiAuditService_1.isAuditEnabled)(null);
            if (auditOn) {
                await (0, aiAuditService_1.saveAIAudit)(streamAuditCtx.finalize());
            }
        } catch (auditErr) {
            console.warn('[DOCS/Stream] Audit logging failed:', auditErr);
        }
        yield { type: 'progress', data: { progress: 40 } };
        if (analysis.clarityScore) {
            yield { type: 'section', data: { section: 'clarityScore', content: analysis.clarityScore } };
        }
        yield { type: 'progress', data: { progress: 50 } };
        if (analysis.summary && analysis.summary.keyPoints.length > 0) {
            yield { type: 'section', data: { section: 'summary', content: analysis.summary } };
        }
        yield { type: 'progress', data: { progress: 55 } };
        if (analysis.riskFlags && analysis.riskFlags.length > 0) {
            yield { type: 'section', data: { section: 'riskFlags', content: analysis.riskFlags } };
        }
        if (analysis.overallRiskScore) {
            yield { type: 'section', data: { section: 'overallRiskScore', content: analysis.overallRiskScore } };
        }
        yield { type: 'progress', data: { progress: 65 } };
        if (analysis.keyClauses && analysis.keyClauses.length > 0) {
            yield { type: 'section', data: { section: 'keyClauses', content: analysis.keyClauses } };
        }
        yield { type: 'progress', data: { progress: 75 } };
        if (analysis.importantDates && analysis.importantDates.length > 0) {
            yield { type: 'section', data: { section: 'importantDates', content: analysis.importantDates } };
        }
        yield { type: 'progress', data: { progress: 85 } };
        if (analysis.missingElements && analysis.missingElements.length > 0) {
            yield { type: 'section', data: { section: 'missingElements', content: analysis.missingElements } };
        }
        yield { type: 'progress', data: { progress: 90 } };
        if (analysis.readabilityScore) {
            yield { type: 'section', data: { section: 'readabilityScore', content: analysis.readabilityScore } };
        }
        yield { type: 'progress', data: { progress: 92 } };
        yield { type: 'status', data: { stage: 'saving', message: 'Saving analysis results...', progress: 95 } };
        const updatedDocument = await prisma.document.update({
            where: { id: documentId },
            data: {
                status: 'completed',
                extractedText,
                anonymizedText: anonymizedTextContent,
                encryptedOriginal,
                piiDetections,
                piiProcessedAt: piiDetections ? new Date() : null,
                summary: JSON.stringify(analysis.summary),
                keyClauses: JSON.stringify(analysis.keyClauses),
                riskFlags: JSON.stringify(analysis.riskFlags),
                importantDates: JSON.stringify(analysis.importantDates),
                readabilityScore: JSON.stringify(analysis.readabilityScore),
                overallRiskScore: JSON.stringify(analysis.overallRiskScore),
                missingElements: JSON.stringify(analysis.missingElements),
                clarityScore: JSON.stringify(analysis.clarityScore),
            },
        });
        yield { type: 'progress', data: { progress: 100 } };
        yield { type: 'complete', data: {
                documentId,
                status: 'completed',
                summary: analysis.summary,
                overallRiskScore: analysis.overallRiskScore,
                clarityScore: analysis.clarityScore,
            } };
        try {
            await (0, notifications_1.notifyDocumentAnalysisComplete)(userId, documentId, updatedDocument.filename);
        }
        catch (e) {
            console.warn('[DOCS] Notification failed:', e);
        }
    }
    catch (error) {
        console.error(`[DOCS STREAM] Processing failed for ${documentId}:`, error);
        let errorMessage = 'Document analysis failed. Please try again.';
        let errorCode = 'ANALYSIS_ERROR';
        if (error instanceof llmAdapter_1.OllamaConnectionError) {
            errorMessage = 'AI service is unavailable. Please try again later or contact support.';
            errorCode = 'LLM_UNAVAILABLE';
        }
        else if (error instanceof llmAdapter_1.ModelNotFoundError) {
            errorMessage = 'AI model not configured. Please contact support.';
            errorCode = 'MODEL_NOT_FOUND';
        }
        else if (error instanceof llmAdapter_1.AnalysisTimeoutError) {
            errorMessage = 'Document analysis timed out. Try uploading a shorter document.';
            errorCode = 'ANALYSIS_TIMEOUT';
        }
        else if (error instanceof llmAdapter_1.LLMRetryExhaustedError) {
            errorMessage = 'Document analysis failed after multiple attempts. Please try again later.';
            errorCode = 'LLM_RETRY_EXHAUSTED';
        }
        else if (error instanceof llmAdapter_1.LLMError) {
            errorMessage = `AI analysis error: ${error.message}`;
            errorCode = error.code;
        }
        await prisma.document.update({
            where: { id: documentId },
            data: {
                status: 'failed',
                summary: JSON.stringify([errorMessage]),
            },
        });
        yield { type: 'error', data: { message: errorMessage, code: errorCode } };
    }
}
router.get('/:id/analysis/stream', auth_1.authenticateToken, async (req, res) => {
    const userId = req.user.userId;
    const documentId = req.params.id;
    const document = await prisma.document.findFirst({
        where: { id: documentId, userId },
    });
    if (!document) {
        return res.status(404).json({ error: 'Document not found' });
    }
    if (document.status === 'completed') {
        return res.json({
            status: 'completed',
            message: 'Document already analyzed',
        });
    }
    if (document.status === 'processing') {
        return res.json({
            status: 'processing',
            message: 'Document analysis already in progress. Please wait for completion.',
        });
    }
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    const sendEvent = (event, data) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    try {
        for await (const event of streamDocumentAnalysis(documentId, document.filepath, userId)) {
            sendEvent(event.type, event.data);
        }
        sendEvent('done', { complete: true });
    }
    catch (error) {
        sendEvent('error', { message: error.message });
    }
    finally {
        res.end();
    }
});
router.post('/:id/reanalyze/stream', auth_1.authenticateToken, async (req, res) => {
    const userId = req.user.userId;
    const documentId = req.params.id;
    const document = await prisma.document.findFirst({
        where: { id: documentId, userId },
    });
    if (!document) {
        return res.status(404).json({ error: 'Document not found' });
    }
    await prisma.document.update({
        where: { id: documentId },
        data: { status: 'processing' },
    });
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    const sendEvent = (event, data) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    try {
        for await (const event of streamDocumentAnalysis(documentId, document.filepath, userId)) {
            sendEvent(event.type, event.data);
        }
        sendEvent('done', { complete: true });
    }
    catch (error) {
        sendEvent('error', { message: error.message });
    }
    finally {
        res.end();
    }
});
router.get('/', auth_1.authenticateToken, async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const allDocuments = await prisma.document.findMany({
            where: {
                userId,
                status: { in: ['completed', 'processing'] },
            },
            orderBy: { createdAt: 'desc' },
            select: {
                id: true,
                filename: true,
                status: true,
                createdAt: true,
                summary: true,
                filesize: true,
            },
        });
        const seenFilenames = new Set();
        const documents = allDocuments.filter(doc => {
            if (seenFilenames.has(doc.filename)) {
                return false;
            }
            seenFilenames.add(doc.filename);
            return true;
        });
        const user = await prisma.user.findUnique({
            where: { id: userId },
        });
        const quota = user?.tier === 'annual'
            ? { used: documents.length, limit: -1, resetDate: null }
            : {
                used: user?.documentsThisWeek || 0,
                limit: 1,
                resetDate: user?.weekResetDate,
            };
        const totalStorageBytes = documents.reduce((total, doc) => total + (doc.filesize || 0), 0);
        const totalStorageMB = (totalStorageBytes / (1024 * 1024)).toFixed(2);
        let storageLimitMB;
        switch (user?.tier) {
            case 'annual':
            case 'clarity':
                storageLimitMB = '5120';
                break;
            case 'clarity-plus':
                storageLimitMB = '25600';
                break;
            case 'teams':
                storageLimitMB = '102400';
                break;
            default:
                storageLimitMB = '100';
        }
        res.status(200).json({
            documents: documents.map(doc => ({
                id: doc.id,
                filename: doc.filename,
                status: doc.status,
                uploadedAt: doc.createdAt,
                summary: doc.summary ? JSON.parse(doc.summary)[0] : null,
            })),
            quota,
            storage: {
                usedBytes: totalStorageBytes,
                usedMB: totalStorageMB,
                limitMB: storageLimitMB,
            },
        });
    }
    catch (error) {
        next(error);
    }
});
router.get('/:id', auth_1.authenticateToken, async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const documentId = req.params.id;
        const document = await prisma.document.findUnique({
            where: { id: documentId },
        });
        if (!document) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Document not found',
            });
        }
        if (document.userId !== userId) {
            return res.status(403).json({
                error: 'Forbidden',
                message: 'You do not have access to this document',
            });
        }
        if (document.status === 'processing') {
            return res.status(202).json({
                id: document.id,
                status: 'processing',
                message: 'Document is still being analyzed',
            });
        }
        if (document.status === 'failed') {
            return res.status(500).json({
                id: document.id,
                status: 'failed',
                message: 'Document processing failed',
            });
        }
        const includeText = req.query.include === 'text';
        res.status(200).json({
            id: document.id,
            filename: document.filename,
            status: document.status,
            uploadedAt: document.createdAt,
            analysis: {
                summary: document.summary ? JSON.parse(document.summary) : [],
                keyClauses: document.keyClauses ? JSON.parse(document.keyClauses) : [],
                riskFlags: document.riskFlags ? JSON.parse(document.riskFlags) : [],
                importantDates: document.importantDates ? JSON.parse(document.importantDates) : [],
                readabilityScore: document.readabilityScore ? JSON.parse(document.readabilityScore) : null,
                overallRiskScore: document.overallRiskScore ? JSON.parse(document.overallRiskScore) : null,
                missingElements: document.missingElements ? JSON.parse(document.missingElements) : [],
                clarityScore: document.clarityScore ? JSON.parse(document.clarityScore) : null,
            },
            ...(includeText && document.extractedText ? { extractedText: document.extractedText } : {}),
            ...(includeText && document.anonymizedText ? { anonymizedText: document.anonymizedText } : {}),
        });
    }
    catch (error) {
        next(error);
    }
});
router.post('/:id/compare', auth_1.authenticateToken, async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const documentId = req.params.id;
        const { templateId } = req.body;
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (user?.tier !== 'annual') {
            return res.status(403).json({
                error: 'Forbidden',
                message: 'Document comparison is only available on the annual plan',
            });
        }
        const document = await prisma.document.findUnique({
            where: { id: documentId },
        });
        if (!document || document.userId !== userId) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Document not found',
            });
        }
        const mockComparison = {
            differences: [
                {
                    section: 'Termination Clause',
                    yourDoc: '30-day notice required',
                    template: '60-day notice standard',
                    severity: 'medium',
                },
                {
                    section: 'Late Fee Policy',
                    yourDoc: '$50 flat fee',
                    template: '5% of rent amount',
                    severity: 'low',
                },
            ],
            matchScore: 0.87,
            templateName: templateId === 'template_standard_lease' ? 'Standard Residential Lease' : 'Unknown Template',
        };
        res.status(200).json(mockComparison);
    }
    catch (error) {
        next(error);
    }
});
router.put('/:id/reupload', auth_1.authenticateToken, upload.single('file'), async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const documentId = req.params.id;
        const file = req.file;
        if (!file) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'No file uploaded',
            });
        }
        const existingDoc = await prisma.document.findUnique({
            where: { id: documentId },
        });
        if (!existingDoc || existingDoc.userId !== userId) {
            await promises_1.default.unlink(file.path).catch(() => { });
            return res.status(404).json({
                error: 'Not Found',
                message: 'Document not found',
            });
        }
        await promises_1.default.unlink(existingDoc.filepath).catch(() => {
            console.warn(`[DOCS] Old file not found: ${existingDoc.filepath}`);
        });
        const updatedDocument = await prisma.document.update({
            where: { id: documentId },
            data: {
                filename: file.originalname,
                filepath: file.path,
                filesize: file.size,
                mimetype: file.mimetype,
                status: 'processing',
                extractedText: null,
                summary: null,
                keyClauses: null,
                riskFlags: null,
                importantDates: null,
            },
        });
        processDocumentAsync(updatedDocument.id, file.path);
        console.log(`[DOCS] Document re-uploaded: ${documentId} by user ${userId}`);
        res.status(200).json({
            id: updatedDocument.id,
            filename: updatedDocument.filename,
            status: updatedDocument.status,
            uploadedAt: updatedDocument.createdAt,
            message: 'Document updated successfully',
        });
    }
    catch (error) {
        if (req.file) {
            await promises_1.default.unlink(req.file.path).catch(() => { });
        }
        next(error);
    }
});
router.delete('/:id', auth_1.authenticateToken, async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const documentId = req.params.id;
        const document = await prisma.document.findUnique({
            where: { id: documentId },
        });
        if (!document || document.userId !== userId) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Document not found',
            });
        }
        await promises_1.default.unlink(document.filepath).catch(() => {
            console.warn(`[DOCS] File not found: ${document.filepath}`);
        });
        await prisma.document.delete({
            where: { id: documentId },
        });
        console.log(`[DOCS] Document deleted: ${documentId} by user ${userId}`);
        res.status(200).json({
            message: 'Document deleted successfully',
        });
    }
    catch (error) {
        next(error);
    }
});
router.post('/:id/rights-obligations', auth_1.authenticateToken, async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const documentId = req.params.id;
        const document = await prisma.document.findUnique({
            where: { id: documentId },
        });
        if (!document || document.userId !== userId) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Document not found',
            });
        }
        if (!document.extractedText) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'Document must be processed first',
            });
        }
        if (document.rightsObligations) {
            return res.status(200).json(JSON.parse(document.rightsObligations));
        }
        const result = await (0, rightsExtractor_1.extractRightsAndObligations)(document.extractedText, document.filename);
        await prisma.document.update({
            where: { id: documentId },
            data: { rightsObligations: JSON.stringify(result) },
        });
        console.log(`[DOCS] Rights & Obligations extracted for: ${documentId}`);
        res.status(200).json(result);
    }
    catch (error) {
        next(error);
    }
});
router.post('/:id/health-check', auth_1.authenticateToken, async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const documentId = req.params.id;
        const document = await prisma.document.findUnique({
            where: { id: documentId },
        });
        if (!document || document.userId !== userId) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Document not found',
            });
        }
        if (!document.extractedText) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'Document must be processed first',
            });
        }
        const result = await (0, healthChecker_1.checkDocumentHealth)(document.extractedText, document.filename);
        console.log(`[DOCS] Health check completed for: ${documentId} - Score: ${result.overall}`);
        res.status(200).json(result);
    }
    catch (error) {
        next(error);
    }
});
router.post('/:id/deadlines', auth_1.authenticateToken, async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const documentId = req.params.id;
        const document = await prisma.document.findUnique({
            where: { id: documentId },
        });
        if (!document || document.userId !== userId) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Document not found',
            });
        }
        if (!document.extractedText) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'Document must be processed first',
            });
        }
        const result = await (0, deadlineExtractor_1.extractDeadlines)(document.extractedText, document.filename);
        console.log(`[DOCS] Deadlines extracted for: ${documentId} - Found ${result.deadlines.length} items`);
        res.status(200).json(result);
    }
    catch (error) {
        next(error);
    }
});
router.post('/:id/clauses', auth_1.authenticateToken, async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const documentId = req.params.id;
        console.log(`[DOCS] Extracting clauses for document: ${documentId}`);
        const document = await prisma.document.findUnique({
            where: { id: documentId },
        });
        if (!document || document.userId !== userId) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Document not found',
            });
        }
        if (!document.extractedText) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'Document must be processed first',
            });
        }
        const clauses = await (0, llmAdapter_1.extractClauses)(document.extractedText, 'en');
        console.log(`[DOCS] Clauses extracted for: ${documentId} - Found ${clauses.length} clauses`);
        res.status(200).json({
            documentId,
            documentName: document.filename,
            clauseCount: clauses.length,
            clauses,
        });
    }
    catch (error) {
        console.error('[DOCS] Error extracting clauses:', error);
        next(error);
    }
});
// Compliance routes removed — RAG-grounded analysis now covers compliance inline
exports.default = router;
//# sourceMappingURL=docs.js.map