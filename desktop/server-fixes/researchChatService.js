"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OFFICIAL_DATABASES = exports.JURISDICTION_INFO = exports.RESEARCH_ACTIONS = void 0;
exports.chat = chat;
exports.chatStream = chatStream;
exports.getConversations = getConversations;
exports.getConversation = getConversation;
exports.deleteConversation = deleteConversation;
exports.formatSourceXML = formatSourceXML;
exports.estimateSourceBudget = estimateSourceBudget;
exports.splitSourcesByBudget = splitSourcesByBudget;
exports.compressOverflowSources = compressOverflowSources;
exports.CONTEXT_CHAR_LIMIT = undefined; // assigned after const declaration below
const client_1 = require("@prisma/client");
const llmAdapter_1 = require("./llmAdapter");
const legalApiService_1 = require("./legalApiService");
const rag_1 = require("./rag");
const outputSanitizer_1 = require("../utils/outputSanitizer");
const mandatoryTerms_1 = require("../data/mandatoryTerms");
const aiAuditService_1 = require("./aiAuditService");
const aiContext_1 = require("./aiContext");
const clauseNLIService_1 = require("./clauseNLIService");
const RAG_ONLY_MODE = true;

// Direct Qdrant source_name lookup for query3 statute references
// When query3 = "Obchodný zákonník § 105 § 106 § 107", this does a filtered scroll
// by source_name to directly find those exact sections (bypasses embeddings)
async function searchBySourceName(statuteQuery, jurisdiction) {
    if (!statuteQuery || !jurisdiction) return [];
    // Extract statute name and section numbers from query3
    // Pattern: "StatuteName § N1 § N2 § N3 keywords"
    const sectionMatches = statuteQuery.match(/§\s*(\d+[a-z]?)/gi);
    if (!sectionMatches || sectionMatches.length === 0) return [];
    // Extract the statute name (everything before the first §)
    const statuteName = statuteQuery.split(/§/)[0].trim();
    if (!statuteName || statuteName.length < 3) return [];
    const sectionNums = sectionMatches.map(m => m.replace(/§\s*/i, '').trim());
    console.log(`[RAG] Source-name lookup: "${statuteName}" sections ${sectionNums.join(', ')} in ${jurisdiction}`);
    try {
        const results = [];
        // Query Qdrant for each section by source_name filter
        // Try both original case and UPPERCASE (Qdrant text match is case-sensitive;
        // SK statutes stored as "OBCHODNÝ ZÁKONNÍK", AT as "Allgemeines bürgerliches Gesetzbuch")
        await Promise.all(sectionNums.slice(0, 6).map(async (secNum) => {
            const searchName = `${statuteName} - § ${secNum}`;
            const searchNameUpper = `${statuteName.toUpperCase()} - § ${secNum}`;
            const namesToTry = [searchName];
            if (searchNameUpper !== searchName) namesToTry.push(searchNameUpper);
            let points = [];
            for (const name of namesToTry) {
                // Same Qdrant + collection as the rest of retrieval (env from the
                // App supervisor / server compose). Never a hard-coded remote host:
                // in the desktop App this must stay on the local index (offline).
                const qdrantUrl = process.env.QDRANT_URL || 'http://127.0.0.1:6333';
                const qdrantCollection = process.env.QDRANT_COLLECTION || 'legal_chunks_hybrid_v2';
                const response = await fetch(`${qdrantUrl}/collections/${qdrantCollection}/points/scroll`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        filter: {
                            must: [
                                { key: 'jurisdiction', match: { value: jurisdiction } },
                                { key: 'source_name', match: { text: name } }
                            ]
                        },
                        limit: 2,
                        with_payload: true
                    })
                });
                const data = await response.json();
                points = data?.result?.points || [];
                if (points.length > 0) break; // Found with this case variant
            }
            for (const p of points) {
                if (p.payload) {
                    results.push({
                        id: String(p.id),
                        chunkId: String(p.id),
                        sourceName: p.payload.source_name || '',
                        content: p.payload.content || '',
                        jurisdiction: p.payload.jurisdiction || jurisdiction,
                        score: 0.95, // High score — exact match
                        rerankScore: 0.95,
                        source_name: p.payload.source_name || '',
                    });
                }
            }
        }));
        console.log(`[RAG] Source-name lookup found ${results.length} exact matches`);
        return results;
    } catch (err) {
        console.error('[RAG] Source-name lookup error:', err.message);
        return [];
    }
}

const SEARCH_LANGUAGE = {
    'AT': 'German', 'DE': 'German', 'CH': 'German',
    'SK': 'Slovak', 'CZ': 'Czech',
    'FR': 'French', 'RO': 'Romanian',
    'HU': 'Hungarian', 'NL': 'Dutch',
    'CY': 'Greek',
};

const LANGUAGE_NAMES = {
    'en': 'English', 'de': 'German', 'sk': 'Slovak', 'cs': 'Czech',
    'ro': 'Romanian', 'el': 'Greek', 'fr': 'French', 'hu': 'Hungarian',
    'nl': 'Dutch', 'it': 'Italian', 'es': 'Spanish', 'pt': 'Portuguese',
};

const SUPPORTED_RESPONSE_LANGUAGES = new Set(['auto', 'en', 'de', 'sk', 'cs', 'ro', 'el']);

function getLanguageDirective(language) {
    // 'auto' is the right default for solo lawyers — they ask questions in
    // their working language (German, Slovak, Romanian, …) and want the
    // response to match. Treat empty / null / "en" the same as "auto":
    // English-speaking users still get English (the model picks it up from
    // their query), but multilingual users no longer get hardcoded English
    // back when their language column wasn't explicitly set to "auto".
    if (!language || language === 'auto' || language === 'en') {
        return `\nRESPONSE LANGUAGE: Detect the language of the USER's most recent message and respond in that same language. The user's prompt language ALWAYS wins — even when the retrieved sources are in a different language (e.g. user asks in English, retrieved Cyprus case headnotes are in Greek → respond in English; user asks in German, retrieved Romanian Codul Civil is in Romanian → respond in German). Only the LITERAL NAMES of statutes and cases stay in their original language ("Obchodný zákonník", "Bürgerliches Gesetzbuch", "Codul civil", "Αστικός Κώδικας", "Code civil", "(2009) 1 CLR 11"). Everything else — explanations, holdings, reasoning, conclusions, headings — MUST be in the user's prompt language. Do not mix languages mid-paragraph. When the source content is in a foreign language, translate the substance into the user's language.\n`;
    }
    const name = LANGUAGE_NAMES[language] || language;
    return `\nRESPONSE LANGUAGE: Respond exclusively in ${name}. All explanations, headings, conclusions, and section labels must be in ${name}, regardless of which language the user wrote in. Statute and case names stay in their original language — never translate them.\n`;
}

const SEARCH_TOOLS = [{
    type: "function",
    function: {
        name: "search_legal_database",
        description: "Search the legal database for statutes, regulations, case law, and legal information. ALWAYS use this tool for any legal question. Only skip for greetings or thanks.",
        parameters: {
            type: "object",
            properties: {
                query: {
                    type: "string",
                    description: "The user's query translated to the jurisdiction's language if needed. Keep the query faithful to what the user asked — do NOT add extra legal terms, synonyms, or concepts that the user did not mention. Examples: user asks 'Factoringgeschäft' (AT) → query='Factoringgeschäft Bankwesengesetz' (NOT 'Factoring Österreich Regelung'); user asks 'Wie lange ist die Verjährungsfrist?' (RO) → query='termenul prescripției extinctive' (translate German concept into Romanian formal term, NEVER pass German words to RO search); user asks 'statute of limitations' (SK) → query='premlčacia lehota'. If the query is already in the jurisdiction's language, pass it through as-is."
                },
                query2: {
                    type: "string",
                    description: "REQUIRED for legal queries. The formal/statutory term for the same legal concept. Statutes use technical language that differs from everyday speech. You MUST provide query2 whenever the legal concept could be described differently in a statute title. Examples: query='konkurenčná doložka' query2='obmedzenie zárobkovej činnosti po skončení pracovného pomeru'; query='povinnosti pri pracovnom úraze' query2='evidencia a registrácia pracovných úrazov'; query='výpovedná lehota' query2='skončenie pracovného pomeru výpoveďou'; query='Kündigungsschutz' query2='Bestandschutz Arbeitsverhältnis'; query='non-compete clause' query2='restrictive covenant post-employment'; query='termenul de prescripție pentru daune' query2='prescripția extinctivă termen general dreptul material la acțiune'; query='când expiră dreptul la acțiune' query2='termenul prescripției dreptului material la acțiune Codul civil'. Do NOT just rephrase — use the ACTUAL statutory/formal name."
                },
                query3: {
                    type: "string",
                    description: "REQUIRED. You MUST provide specific statute section numbers from the CORRECT jurisdiction. Use statute names from the jurisdiction in the system prompt — AT uses ABGB/UGB/KSchG, SK uses Zákonník práce/Obchodný zákonník, DE uses BGB/HGB, US uses U.S. Code Title. Format: 'StatuteName § Number keywords'. Examples: AT Werkvertrag: 'ABGB § 919 § 1170 Werkvertrag'; AT Verjährung: 'ABGB § 1489 § 1480 Verjährung Schadenersatz'; AT Gewährleistung: 'ABGB § 922 § 924 § 932'; SK s.r.o. založenie: 'Obchodný zákonník § 105 § 106 § 107 § 108 spoločnosť s ručením obmedzeným'; SK Arbeitsvertrag: 'Zákonník práce § 42 § 43 pracovná zmluva'; SK Kündigung: 'Zákonník práce § 62 § 63 výpoveď'; SK a.s. založenie: 'Obchodný zákonník § 154 § 162 § 163 akciová spoločnosť'; DE Mietrecht: 'BGB § 542 § 573 § 580a Kündigung Mietvertrag'; DE GmbH: 'GmbHG § 1 § 2 § 3 § 5 Gründung'; DE Kaufvertrag: 'BGB § 433 § 437 Gewährleistung'; US LLC: 'U.S. Code Title 26 § 301.7701 limited liability company'; US contracts: 'U.S. Code Title 41 § 3901 government contracts'. Always include 2-4 section numbers you believe are most relevant."
                }
            },
            required: ["query"]
        }
    }
}];
async function routeWithTools(systemPrompt, history, message, jurisdiction) {
    const ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
    const fallbackUrl = process.env.OLLAMA_FALLBACK_URL || 'http://ollama:11434';
    const model = process.env.OLLAMA_MODEL || 'qwen3:14b';
    const messages = [
        { role: 'system', content: systemPrompt },
        ...history.map(m => ({
            role: m.role,
            content: m.content
        })),
        { role: 'user', content: message }
    ];
    try {
        // Try OpenRouter first (OpenAI-compatible tool calling)
        const orApiKey = process.env.OPENROUTER_API_KEY;
        if (orApiKey) {
            try {
                const orModel = process.env.OPENROUTER_MODEL || 'qwen/qwen3.5-9b';
                const orResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${orApiKey}`,
                    },
                    body: JSON.stringify({
                        model: orModel,
                        messages: messages.map(m => ({ role: m.role, content: m.content })),
                        tools: SEARCH_TOOLS,
                        temperature: 0,
                        max_tokens: 200,
                        reasoning: { effort: 'none' },
                        provider: { order: ['Together', 'Venice'], allow_fallbacks: true },
                    }),
                    signal: AbortSignal.timeout(90000),
                });
                const orData = await orResponse.json();
                if (!orResponse.ok) {
                    throw new Error(`OpenRouter ${orResponse.status}: ${orData.error?.message || orResponse.statusText}`);
                }
                const orMsg = orData.choices?.[0]?.message;
                if (orMsg?.tool_calls?.length > 0) {
                    const call = orMsg.tool_calls[0];
                    let args;
                    try {
                        args = typeof call.function.arguments === 'string'
                            ? JSON.parse(call.function.arguments)
                            : call.function.arguments;
                    } catch {
                        args = { query: message };
                    }
                    console.log(`[ToolRouter] OpenRouter requested search: "${args.query}"${args.query2 ? ` + synonym: "${args.query2}"` : ''}${args.query3 ? ` + statutes: "${args.query3}"` : ''}`);
                    return { needsSearch: true, query: args.query || message, query2: args.query2 || null, query3: args.query3 || null };
                }
                console.log('[ToolRouter] OpenRouter chose to answer from context (no tool call)');
                return { needsSearch: false };
            } catch (orErr) {
                console.warn(`[ToolRouter] OpenRouter tool routing failed, falling back to Ollama:`, orErr.message);
            }
        }
        // Fallback to Ollama
        const body = JSON.stringify({
            model,
            messages,
            tools: SEARCH_TOOLS,
            stream: false,
            think: false,
            options: { temperature: 0, num_predict: 200, num_ctx: 12288 },
        });
        let response;
        try {
            response = await fetch(`${ollamaUrl}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body,
                signal: AbortSignal.timeout(90000),
            });
        } catch (primaryErr) {
            if (ollamaUrl !== fallbackUrl) {
                console.log(`[ToolRouter] Primary failed (${primaryErr.message}), trying fallback...`);
                response = await fetch(`${fallbackUrl}/api/chat`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body,
                    signal: AbortSignal.timeout(120000),
                });
            } else {
                throw primaryErr;
            }
        }
        const data = await response.json();
        if (!response.ok) {
            throw new Error(`Ollama returned ${response.status}: ${data.error || response.statusText}`);
        }
        if (data.message?.tool_calls?.length > 0) {
            const call = data.message.tool_calls[0];
            let args;
            try {
                args = typeof call.function.arguments === 'string'
                    ? JSON.parse(call.function.arguments)
                    : call.function.arguments;
            } catch {
                args = { query: message };
            }
            console.log(`[ToolRouter] LLM requested search: "${args.query}"${args.query2 ? ` + synonym: "${args.query2}"` : ''}${args.query3 ? ` + statutes: "${args.query3}"` : ''}`);
            return { needsSearch: true, query: args.query || message, query2: args.query2 || null, query3: args.query3 || null };
        }
        console.log('[ToolRouter] LLM chose to answer from context (no tool call)');
        return { needsSearch: false };
    } catch (err) {
        console.warn('[ToolRouter] Tool routing failed, defaulting to search:', err.message);
        return { needsSearch: true, query: message };
    }
}

function extractClaimsFromResponse(response) {
    const claims = [];
    const sentences = response.split(/[.!?]+/).filter(s => s.trim().length > 30);
    for (const sentence of sentences) {
        const trimmed = sentence.trim();
        // Skip meta-sentences (headings, list intros, etc.)
        if (/^(here|the following|below|note|please|in summary|to summarize|overall|in conclusion)/i.test(trimmed)) continue;
        if (trimmed.split(/\s+/).length < 5) continue; // Too short to be a legal claim
        const hasLegalRef = /§|Article|Section|Artikel|Abschnitt|zákon|Abs\.|Art\./i.test(trimmed);
        const hasLegalNumber = /\b(\d+[,.]?\d*)\s*(%|EUR|USD|GBP|€|\$|days?|months?|years?|hours?)\b/i.test(trimmed);
        const hasStatuteNumber = /§\s*\d+|Art\.?\s*\d+|Section\s*\d+/i.test(trimmed);
        const hasDefinitive = /\b(must|shall|requires?|minimum|maximum|mandatory|prohibited|obligat|at least|no more than|within \d|liable|penalty|fine|entitled)\b/i.test(trimmed);
        const hasSourceRef = /(?:according to|under|per|as per|pursuant to|gemäß|nach|podľa)\s+/i.test(trimmed);
        // Require at least TWO signals, or a legal reference (strong signal)
        const signals = [hasLegalRef, hasLegalNumber, hasStatuteNumber, hasDefinitive, hasSourceRef].filter(Boolean).length;
        if (signals >= 2 || hasStatuteNumber) {
            const sourceMatch = trimmed.match(/(?:according to|under|per|as per|pursuant to|gemäß|nach|podľa)\s+([^,]+)/i);
            const parenMatch = !sourceMatch && trimmed.match(/\(([^)]*(?:§|Art|Section|Abs)[^)]+)\)/i);
            claims.push({
                claim: trimmed,
                sourceRef: sourceMatch?.[1]?.trim() || parenMatch?.[1]?.trim(),
                context: trimmed.substring(0, 100),
            });
        }
    }
    return claims;
}
function extractClaimFromSentence(sentence) {
    const trimmed = sentence.trim();
    if (trimmed.length < 30) return null;
    if (/^(here|the following|below|note|please|in summary|to summarize|overall|in conclusion)/i.test(trimmed)) return null;
    if (trimmed.split(/\s+/).length < 5) return null;
    const hasLegalRef = /§|Article|Section|Artikel|Abschnitt|zákon|Abs\.|Art\./i.test(trimmed);
    const hasLegalNumber = /\b(\d+[,.]?\d*)\s*(%|EUR|USD|GBP|€|\$|days?|months?|years?|hours?)\b/i.test(trimmed);
    const hasStatuteNumber = /§\s*\d+|Art\.?\s*\d+|Section\s*\d+/i.test(trimmed);
    const hasDefinitive = /\b(must|shall|requires?|minimum|maximum|mandatory|prohibited|obligat|at least|no more than|within \d|liable|penalty|fine|entitled)\b/i.test(trimmed);
    const hasSourceRef = /(?:according to|under|per|as per|pursuant to|gemäß|nach|podľa)\s+/i.test(trimmed);
    const signals = [hasLegalRef, hasLegalNumber, hasStatuteNumber, hasDefinitive, hasSourceRef].filter(Boolean).length;
    if (signals >= 2 || hasStatuteNumber) {
        const sourceMatch = trimmed.match(/(?:according to|under|per|as per|pursuant to|gemäß|nach|podľa)\s+([^,]+)/i);
        const parenMatch = !sourceMatch && trimmed.match(/\(([^)]*(?:§|Art|Section|Abs)[^)]+)\)/i);
        return {
            claim: trimmed,
            sourceRef: sourceMatch?.[1]?.trim() || parenMatch?.[1]?.trim(),
            context: trimmed.substring(0, 100),
        };
    }
    return null;
}
async function verifyClaimsAgainstSources(claims, sources, auditContext) {
    if (claims.length === 0 || sources.length === 0) {
        return { verified: 0, total: 0, confidence: 'unverified', failedClaims: [], verifiedClaims: [] };
    }
    const nliReady = await (0, clauseNLIService_1.isNLIAvailable)();
    if (!nliReady) {
        console.log('[ResearchChat] NLI service not available, skipping verification');
        return { verified: 0, total: claims.length, confidence: 'unverified', failedClaims: claims, verifiedClaims: [] };
    }
    let verified = 0;
    let highConfidenceCount = 0;
    const failedClaims = [];
    const verifiedClaims = [];
    for (const claim of claims) {
        let bestSource = null;
        if (claim.sourceRef) {
            const ref = claim.sourceRef.toLowerCase().trim();
            bestSource = sources.find(s => (s.title || s.source || "").toLowerCase().includes(ref));
            if (!bestSource) {
                bestSource = sources.find(s => {
                    const title = (s.title || s.source || "").toLowerCase().trim();
                    return title.length > 10 && ref.includes(title);
                });
            }
            if (!bestSource) {
                const sectionMatch = claim.sourceRef.match(/§\s*(\d+[a-z]?)/i);
                if (sectionMatch) {
                    const sectionNum = sectionMatch[1];
                    const statutePart = claim.sourceRef.replace(/[-–—]\s*§.*$/, '').replace(/§.*$/, '').trim().toLowerCase();
                    bestSource = sources.find(s => {
                        const title = (s.title || s.source || "").toLowerCase();
                        const hasSection = title.includes("§ " + sectionNum) || title.includes("§" + sectionNum);
                        if (statutePart.length > 5 && hasSection) {
                            return title.includes(statutePart) || statutePart.includes(title.replace(/\s*-\s*§.*$/, '').trim());
                        }
                        return hasSection;
                    });
                }
            }
            if (!bestSource) {
                const refWords = ref.split(/[\s\-–—,]+/).filter(w => w.length > 3);
                if (refWords.length >= 2) {
                    let bestOverlap = 0;
                    for (const s of sources) {
                        const title = (s.title || s.source || "").toLowerCase();
                        const overlap = refWords.filter(w => title.includes(w)).length;
                        if (overlap > bestOverlap && overlap >= 2) {
                            bestOverlap = overlap;
                            bestSource = s;
                        }
                    }
                }
            }
        }
        // No matching source found — count as unverified (not silently skipped)
        if (!bestSource) {
            failedClaims.push({ claim: claim.claim, label: 'unmatched', confidence: 0 });
            continue;
        }
        const sourceText = bestSource.excerpt || bestSource.content || "";
        if (sourceText.length < 50) {
            failedClaims.push({ claim: claim.claim, label: 'insufficient_source', confidence: 0 });
            continue;
        }
        const startTime = Date.now();
        // Don't pass auditContext to avoid double-counting
        const result = await (0, clauseNLIService_1.verifyEntailment)(sourceText.substring(0, 2000), claim.claim, {});
        auditContext.logNLIVerification({
            claim: claim.claim,
            sourceText: sourceText.substring(0, 500),
            sourceRef: bestSource.title || bestSource.source || 'Unknown',
            result: result.label,
            confidence: result.confidence,
            verificationDurationMs: Date.now() - startTime,
        });
        if (result.label === 'entailment' && result.confidence >= 0.6) {
            verified++;
            verifiedClaims.push({ claim: claim.claim, confidence: result.confidence });
            if (result.confidence >= 0.8)
                highConfidenceCount++;
        } else {
            failedClaims.push({ claim: claim.claim, label: result.label, confidence: result.confidence });
        }
    }
    let confidence;
    const ratio = claims.length > 0 ? verified / claims.length : 0;
    if (ratio >= 0.8 && highConfidenceCount >= verified * 0.5) {
        confidence = 'high';
    }
    else if (ratio >= 0.5) {
        confidence = 'medium';
    }
    else if (verified > 0) {
        confidence = 'low';
    }
    else {
        confidence = 'unverified';
    }
    return { verified, total: claims.length, confidence, failedClaims, verifiedClaims };
}
// Word-overlap ratio for comparing claims (shared with _tryReplace)
function _claimWordOverlap(a, b) {
    const wordsA = new Set(a.toLowerCase().replace(/[.,;:!?()""„"'\-]/g, ' ').split(/\s+/).filter(w => w.length > 2));
    const wordsB = new Set(b.toLowerCase().replace(/[.,;:!?()""„"'\-]/g, ' ').split(/\s+/).filter(w => w.length > 2));
    if (wordsA.size === 0 || wordsB.size === 0) return 0;
    let overlap = 0;
    for (const w of wordsA) { if (wordsB.has(w)) overlap++; }
    return overlap / Math.min(wordsA.size, wordsB.size);
}
async function regenerateClaim(claim, sourceText, auditContext) {
    try {
        const prompt = `SOURCE TEXT:
${sourceText.substring(0, 2500)}

FLAGGED CLAIM:
${claim}

If the source text is about an ENTIRELY UNRELATED area of law (e.g. claim about tax law but source about criminal procedure), respond: UNSUPPORTED

Note: The same legal concept may have different names. For example, "non-compete clause" and "restriction of gainful activity" are the SAME topic. "Company formation" and "founding of a limited liability company" are the SAME topic.

Otherwise, rewrite the claim to be accurate based ONLY on what the source text says. Keep the same style. 1-2 sentences max. Output ONLY the rewritten claim, nothing else.`;
        const result = await (0, llmAdapter_1.callLLM)(
            [{ role: 'system', content: 'You rewrite legal claims to match source text. Output only the rewritten claim or UNSUPPORTED. No explanations.' },
             { role: 'user', content: prompt }],
            { taskType: 'claim_regeneration', maxTokens: 200, useFastModel: false }
        );
        const rewritten = (result || '').trim();
        if (!rewritten || rewritten === 'UNSUPPORTED' || rewritten.startsWith('UNSUPPORTED')) {
            console.log(`[ClaimVerifier] Regen: LLM returned UNSUPPORTED, removing claim`);
            return { status: 'removed', rewrittenClaim: null };
        }
        // Detect reasoning/explanation instead of a rewritten claim
        const reasoningPatterns = [
            /^(the|this)\s+(claim|statement|assertion)\s+(is|was|appears|seems)\s/i,
            /^based on\s+(the\s+)?source/i,
            /^according to\s+(the\s+)?source/i,
            /^(yes|no|correct|incorrect|accurate|inaccurate)[.,:\s]/i,
            /^I\s+(can|cannot|would|found|think)/i,
            /^(here|sure|certainly|of course)[.,:\s]/i,
            /^(note|importantly|however)[.,:\s]/i,
        ];
        const isReasoning = reasoningPatterns.some(p => p.test(rewritten));
        if (isReasoning) {
            console.log(`[ClaimVerifier] Regen: LLM returned reasoning instead of rewrite ("${rewritten.substring(0, 60)}..."), treating as verified`);
            return { status: 'verified_by_regen', rewrittenClaim: claim };
        }
        // Check similarity using word overlap — if >=85% words match, claim was essentially correct
        const overlap = _claimWordOverlap(claim, rewritten);
        if (overlap >= 0.85) {
            console.log(`[ClaimVerifier] Regen: Rewrite ~identical to original (${(overlap * 100).toFixed(0)}% word overlap), marking as verified`);
            return { status: 'verified_by_regen', rewrittenClaim: claim };
        }
        // Verify rewrite: same topic + supported by source
        try {
            const verifyPrompt = `ORIGINAL: ${claim}
REWRITTEN: ${rewritten}
SOURCE: ${sourceText.substring(0, 1500)}

Answer exactly "SAME YES", "SAME NO", "DIFF YES", or "DIFF NO".
First word: SAME if both claims are about the same legal topic, DIFF if different topics.
Second word: YES if the source contains the facts in the rewritten claim, NO if not.`;
            const judgeResult = await (0, llmAdapter_1.callLLM)(
                [{ role: 'system', content: 'Answer in exactly 2 words: SAME/DIFF then YES/NO.' },
                 { role: 'user', content: verifyPrompt }],
                { taskType: 'claim_regeneration', maxTokens: 20, useFastModel: false }
            );
            const verdict = (judgeResult || '').trim().toUpperCase();
            const isSameTopic = verdict.includes('SAME');
            const isSupported = /\bYES\b/.test(verdict);
            console.log(`[ClaimVerifier] Regen: Judge verdict: "${verdict}" → sameTopic=${isSameTopic}, supported=${isSupported}`);
            if (isSameTopic && isSupported) {
                return { status: 'regenerated', rewrittenClaim: rewritten };
            }
            if (!isSameTopic) {
                console.log(`[ClaimVerifier] Regen: Different topic rewrite — removing`);
                return { status: 'removed', rewrittenClaim: null };
            }
            // Same topic but not supported — remove
            return { status: 'removed', rewrittenClaim: null };
        } catch (judgeErr) {
            console.warn(`[ClaimVerifier] Regen: Judge verify failed (${judgeErr.message}), removing claim`);
            return { status: 'removed', rewrittenClaim: null };
        }
    } catch (err) {
        console.warn(`[ClaimVerifier] Regen: LLM rewrite failed: ${err.message}, removing claim`);
        return { status: 'removed', rewrittenClaim: null };
    }
    return { status: 'removed', rewrittenClaim: null };
}
// === Version deduplication: remove duplicate statute sections, keep highest-scored ===
function _deduplicateBySection(results) {
    if (results.length <= 1) return results;
    const seen = new Map(); // key: normalized "statute - § N" → best result
    const out = [];
    for (const r of results) {
        const name = (r.sourceName || r.title || '').replace(/\s*\(Part \d+\/\d+\)/, '');
        // Extract "§ N" section identifier from source name
        const sectionMatch = name.match(/§\s*(\d+[a-z]?)/i);
        if (!sectionMatch) {
            out.push(r); // no section number, always keep
            continue;
        }
        // Normalize key: extract statute name before § + section number
        const statutePart = name.replace(/\s*[-–—]\s*§.*$/, '').replace(/§.*$/, '').trim()
            .replace(/\s+/g, ' ').substring(0, 80).toLowerCase();
        const key = `${statutePart}|§${sectionMatch[1]}`;
        const score = r.rerankScore ?? r.relevanceScore ?? r.score ?? 0;
        const existing = seen.get(key);
        if (!existing || score > existing.score) {
            seen.set(key, { result: r, score });
        }
    }
    // Collect: non-section results first, then best-of-each-section in original order
    const bestByKey = new Set([...seen.values()].map(v => v.result));
    for (const r of results) {
        if (out.includes(r) || bestByKey.has(r)) {
            if (!out.includes(r)) out.push(r);
        }
    }
    return out;
}
// === Multi-stage context overflow helpers ===
const CONTEXT_CHAR_LIMIT = 28000; // ~9.3K input tokens, fits num_ctx:12288 with 3K output tokens
exports.CONTEXT_CHAR_LIMIT = CONTEXT_CHAR_LIMIT;
const PRIMARY_BUDGET_RATIO = 0.7; // 70% of budget for primary (full text) sources
const GROUNDING_RULES = `\n\n---\n## GROUNDING RULES (MANDATORY):\n1. **Citation format**: ALWAYS cite by FULL SOURCE NAME (e.g., "Obchodný zákonník - § 108"), NEVER by number like [1]\n2. **Numbers are SACRED**: Any number you cite MUST appear in the sources AND with the SAME MEANING.\n   - If source says "5 000 Euro bar einzuzahlen" (cash payment), do NOT cite it as "minimum capital"\n   - If source says "mindestens 10 000 Euro" for Stammkapital, the minimum capital is 10,000 EUR\n   - If you cannot find the exact number for a specific concept, say "the law specifies" without guessing\n3. **When uncertain about a number**: Say "according to [Source Name], the minimum is..." and quote directly\n4. **NEVER invent**: case names, case numbers, statute sections, amounts, dates, or any specific legal detail not in sources\n5. **Jurisdiction separation**: Each source has a <jurisdiction> tag (AT, SK, US, etc.). ONLY apply rules from AT sources to Austrian law, SK sources to Slovak law. NEVER attribute a provision from one country's statute to another country.\n6. **Summaries must match citations**: Your summary/practical implications MUST NOT contradict or invert the meaning of cited provisions. If a source says X is allowed WITH approval, do NOT summarize it as X being prohibited. Re-read each summary point against its citation before including it.\n7. **Court decisions (sources marked Leitsatz)**: Explain the court's interpretation and cite by court name, case number, and date (e.g., "OGH 3 Ob 45/21k (2021-03-15)"). Note if from a lower court. Court decisions are interpretive — they may be superseded by later rulings. Statutes are definitive; case law is persuasive interpretation. Where both apply, lead with the statute and use case law to show how courts have read it.\n`;

// Trim conversation history to fit context budget.
// Keep last MAX_HISTORY_MESSAGES and cap total history chars.
const MAX_HISTORY_MESSAGES = 8; // 4 user-assistant turns
const MAX_HISTORY_CHARS = 6000; // ~2K tokens for history

function trimHistory(history) {
    if (history.length <= MAX_HISTORY_MESSAGES) {
        // Still cap per-message length for very long responses
        const totalChars = history.reduce((sum, m) => sum + (m.content || '').length, 0);
        if (totalChars <= MAX_HISTORY_CHARS) return history;
        // Trim oldest messages' content proportionally
        const ratio = MAX_HISTORY_CHARS / totalChars;
        return history.map((m, i) => {
            if (i >= history.length - 2) return m; // keep last exchange full
            const maxLen = Math.max(200, Math.floor((m.content || '').length * ratio));
            return { ...m, content: (m.content || '').substring(0, maxLen) };
        });
    }
    // Drop oldest messages, keep last N
    const trimmed = history.slice(-MAX_HISTORY_MESSAGES);
    const totalChars = trimmed.reduce((sum, m) => sum + (m.content || '').length, 0);
    if (totalChars <= MAX_HISTORY_CHARS) return trimmed;
    // Further trim older messages in the kept set
    const ratio = MAX_HISTORY_CHARS / totalChars;
    return trimmed.map((m, i) => {
        if (i >= trimmed.length - 2) return m; // keep last exchange full
        const maxLen = Math.max(200, Math.floor((m.content || '').length * ratio));
        return { ...m, content: (m.content || '').substring(0, maxLen) };
    });
}

function formatSourceXML(source, index) {
    const sourceName = source.title || 'Unknown Source';
    const excerpt = source.excerpt ? source.excerpt.replace(/\s+/g, ' ').trim() : '';
    const jur = source.jurisdiction || '';
    return `<document index="${index + 1}"><source>${sourceName}</source><jurisdiction>${jur}</jurisdiction><content>${excerpt}</content></document>`;
}

function estimateSourceBudget(systemPrompt, history, message) {
    // Estimate chars consumed by system prompt + history + user message + grounding rules
    const systemChars = (systemPrompt || '').length;
    const historyChars = history.reduce((sum, m) => sum + (m.content || '').length, 0);
    const messageChars = (message || '').length;
    const groundingRulesChars = 800; // grounding rules template ~750 chars
    const outputReserve = 10000; // reserve for LLM output (~3K tokens streaming)
    const nonSourceChars = systemChars + historyChars + messageChars + groundingRulesChars + outputReserve;
    const sourceBudget = Math.max(CONTEXT_CHAR_LIMIT - nonSourceChars, 8000);
    return sourceBudget;
}

// Keywords that signal an interpretive / common-law question — the kind
// where statutes alone won't answer (e.g. "frustration", "test for X",
// "court has held", "doctrine of"). Used to (a) trigger the case-law
// boost in diversifyTopK, and (b) loosen the top-K split so the LLM
// actually sees how courts have read the statutes.
const INTERPRETIVE_KEYWORDS = [
    'frustration', 'doctrine', 'test for', 'court has held', 'court held',
    'when does', 'when is', 'has the court', 'have courts', 'whether',
    'interpret', 'precedent', 'case law', 'rechtsprechung', 'judikatur',
    'leitsatz', 'headnote', 'common law',
];
function isInterpretiveQuery(query) {
    const q = (query || '').toLowerCase();
    return INTERPRETIVE_KEYWORDS.some(k => q.includes(k));
}

// Diversity-aware top-K. When the reranker returns a mix of statute + case
// law above threshold but raw-score-sorted top-K accidentally is statute-
// only, force at least a few case-law slots so the LLM gets BOTH types as
// primary sources. Without this, an interpretive query like "frustration
// of contract in CY" sees 6 Cyprus statutes (none of which define the
// common-law doctrine) and the LLM correctly says "no case law cited" —
// even though we retrieved 18 relevant Supreme Court headnotes.
function diversifyTopK(sources, pageSize, opts = {}) {
    const query = opts.query || '';
    if (sources.length <= pageSize) return sources;

    const isCaseLaw = s => {
        // Try every reasonable field name — source shapes differ at this
        // point (post-rerank vs post-enrichment); be defensive.
        const t = (s.sourceType || s.source_type || s.type ||
                   s.payload?.source_type || s.payload?.type || '').toString().toLowerCase();
        if (t === 'case_law' || t === 'caselaw' || t === 'case-law') return true;
        // Title fallback — case-law source_names always end in "Leitsatz" or
        // "Headnote" and contain a court name + case-number pattern (CLR, Ob,
        // BGH, OGH, …).  Cheap regex check on any string-shaped field.
        const blob = ([s.sourceName, s.title, s.source_name, s.source, s.name,
                       s.payload?.source_name, s.payload?.title]
                      .filter(x => typeof x === 'string').join(' ')).toLowerCase();
        if (!blob) return false;
        return blob.includes('leitsatz')
            || blob.includes('headnote')
            || / clr \d/i.test(blob)              // "1 CLR 700"
            || /\b(ogh|bgh|vwgh|vfgh)\b/i.test(blob);
    };

    const statutes = sources.filter(s => !isCaseLaw(s));
    const caseLaw  = sources.filter(s =>  isCaseLaw(s));

    // No case law in the candidate set → nothing to diversify, return top-K.
    if (caseLaw.length === 0) return sources.slice(0, pageSize);
    // No statutes → also nothing to balance, return top-K.
    if (statutes.length === 0) return sources.slice(0, pageSize);

    // Reserve case-law slots: 30% for interpretive queries (3 of 10), 20% otherwise (2 of 10).
    const interpretive = isInterpretiveQuery(query);
    const caseLawReserved = Math.min(
        caseLaw.length,
        Math.max(2, Math.floor(pageSize * (interpretive ? 0.30 : 0.20)))
    );
    const statuteSlots = pageSize - caseLawReserved;

    // Interleave: put case-law BEFORE the lowest-scored statutes so case-law
    // makes it into the primary-XML slot (top ~6 by position) instead of the
    // compressed overflow slot. For interpretive queries we front-load even
    // more aggressively — case-law lands in positions 2-4 between strong
    // statutes. The LLM still sees the top statute first (correct precedent
    // hierarchy: statute is definitive, case-law explains how courts read it).
    const sTop = statutes.slice(0, statuteSlots);
    const cTop = caseLaw.slice(0, caseLawReserved);

    const result = [];
    if (interpretive) {
        // Pattern: [stat#1, case#1, stat#2, case#2, stat#3, case#3, stat#4...]
        // case-law lands in positions 2/4/6 — definitely inside primary XML.
        const maxLen = Math.max(sTop.length, cTop.length);
        for (let i = 0; i < maxLen; i++) {
            if (i < sTop.length) result.push(sTop[i]);
            if (i < cTop.length) result.push(cTop[i]);
        }
    } else {
        // Non-interpretive: statutes lead (positions 1-N), case-law tail.
        // But still inside top-K so they show up at all.
        result.push(...sTop, ...cTop);
    }
    return result.slice(0, pageSize);
}

function splitSourcesByBudget(sources, sourceBudget) {
    const primaryBudget = Math.floor(sourceBudget * PRIMARY_BUDGET_RATIO);
    const primary = [];
    const overflow = [];
    let usedChars = 0;
    for (let i = 0; i < sources.length; i++) {
        const xml = formatSourceXML(sources[i], i);
        if (usedChars + xml.length <= primaryBudget && primary.length < 15) {
            primary.push(sources[i]);
            usedChars += xml.length;
        } else {
            overflow.push(sources[i]);
        }
    }
    return { primary, overflow };
}

// Compress overflow sources to brief citations — no LLM call, instant.
// Gives the main LLM awareness of additional statutes for citation.
function compressOverflowSources(overflowSources, charBudget) {
    const perSource = Math.max(80, Math.floor(charBudget / Math.max(overflowSources.length, 1)));
    return overflowSources.map(s => {
        const name = s.title || 'Unknown Source';
        const jur = s.jurisdiction || '';
        const text = (s.excerpt || '').replace(/\s+/g, ' ').trim();
        // Extract first sentence or up to perSource chars
        const firstSentenceEnd = text.search(/[.!?]\s/) + 1;
        const snippet = firstSentenceEnd > 0 && firstSentenceEnd <= perSource
            ? text.substring(0, firstSentenceEnd)
            : text.substring(0, perSource) + '...';
        return `- ${name} [${jur}]: ${snippet}`;
    }).join('\n');
}

class ClaimVerifier {
    constructor(sources, auditContext) {
        this.sources = sources;
        this.auditContext = auditContext;
        this.fullResponse = '';
    }
    addToken(token) {
        this.fullResponse += token;
    }
    // Find best matching source for a given reference string (4-tier matching)
    _findSource(sourceRef) {
        if (!sourceRef) return null;
        const ref = sourceRef.toLowerCase().trim();
        // 1. Exact: source title contains full ref
        let best = this.sources.find(s => (s.title || s.source || "").toLowerCase().includes(ref));
        // 2. Reverse: ref contains source title
        if (!best) {
            best = this.sources.find(s => {
                const title = (s.title || s.source || "").toLowerCase().trim();
                return title.length > 10 && ref.includes(title);
            });
        }
        // 3. Section number + statute name
        if (!best) {
            const sectionMatch = sourceRef.match(/§\s*(\d+[a-z]?)/i);
            if (sectionMatch) {
                const sectionNum = sectionMatch[1];
                const statutePart = sourceRef.replace(/[-–—]\s*§.*$/, '').replace(/§.*$/, '').trim().toLowerCase();
                best = this.sources.find(s => {
                    const title = (s.title || s.source || "").toLowerCase();
                    const hasSection = title.includes("§ " + sectionNum) || title.includes("§" + sectionNum);
                    if (statutePart.length > 5 && hasSection) {
                        return title.includes(statutePart) || statutePart.includes(title.replace(/\s*-\s*§.*$/, '').trim());
                    }
                    return hasSection;
                });
            }
        }
        // 4. Word overlap (min 2 significant words)
        if (!best) {
            const refWords = ref.split(/[\s\-–—,]+/).filter(w => w.length > 3);
            if (refWords.length >= 2) {
                let bestOverlap = 0;
                for (const s of this.sources) {
                    const title = (s.title || s.source || "").toLowerCase();
                    const overlap = refWords.filter(w => title.includes(w)).length;
                    if (overlap > bestOverlap && overlap >= 2) {
                        bestOverlap = overlap;
                        best = s;
                    }
                }
            }
        }
        return best;
    }
    async *finalize(sanitizedResponse) {
        const baseResponse = sanitizedResponse || this.fullResponse;
        let finalResponse = baseResponse;
        // Build source summary for LLM judge — include ALL sources, scale excerpt length
        const sourceCount = this.sources.length;
        const excerptLen = sourceCount > 20 ? 400 : sourceCount > 15 ? 500 : 600;
        const sourceSummary = this.sources.map((s, i) => {
            const name = s.title || s.source || 'Unknown';
            const jur = s.jurisdiction || '';
            const text = (s.excerpt || s.content || '').substring(0, excerptLen).replace(/\s+/g, ' ').trim();
            return `[Source ${i + 1}: ${name}]${jur ? ` (Jurisdiction: ${jur})` : ''}\n${text}`;
        }).join('\n\n');
        if (!sourceSummary || finalResponse.trim().length < 50) {
            return {
                finalResponse,
                verification: { verified: 0, total: 0, regenerated: 0, removed: 0, confidence: 'none', claims: [], llmJudge: null },
            };
        }
        // === STAGE 1: LLM-as-Judge (chunked for long responses) ===
        const judgeStartTime = Date.now();
        let judgeFlags = { supported: [], unsupported: [], summary: '' };

        // Split response into ~4K chunks at sentence boundaries for long responses
        const JUDGE_CHUNK_SIZE = 4000;
        const responseChunks = [];
        if (finalResponse.length <= JUDGE_CHUNK_SIZE) {
            responseChunks.push(finalResponse);
        } else {
            let remaining = finalResponse;
            while (remaining.length > 0) {
                if (remaining.length <= JUDGE_CHUNK_SIZE) {
                    responseChunks.push(remaining);
                    break;
                }
                // Find last sentence boundary within the chunk size
                const slice = remaining.substring(0, JUDGE_CHUNK_SIZE);
                const lastSentence = Math.max(
                    slice.lastIndexOf('. '),
                    slice.lastIndexOf('.\n'),
                    slice.lastIndexOf('? '),
                    slice.lastIndexOf('! ')
                );
                const splitAt = lastSentence > JUDGE_CHUNK_SIZE * 0.5 ? lastSentence + 1 : JUDGE_CHUNK_SIZE;
                responseChunks.push(remaining.substring(0, splitAt).trim());
                remaining = remaining.substring(splitAt).trim();
            }
        }
        console.log(`[ClaimVerifier] Verifying response: ${finalResponse.length} chars in ${responseChunks.length} chunk(s), ${sourceCount} sources (excerpt ${excerptLen} chars)`);
        yield { type: 'progress', message: `Fact-checking against ${sourceCount} sources...` };

        // Run judge on each chunk sequentially (GPU serves one request at a time)
        let fullJudgeResponse = '';
        for (let ci = 0; ci < responseChunks.length; ci++) {
            const chunk = responseChunks[ci];
            if (responseChunks.length > 1) {
                yield { type: 'progress', message: `Fact-checking chunk ${ci + 1} of ${responseChunks.length}...` };
            }
            try {
                const chunkLabel = responseChunks.length > 1 ? ` (chunk ${ci + 1}/${responseChunks.length})` : '';
                const judgePrompt = `Fact-check RESPONSE against SOURCES. Return JSON only.

SOURCES:
${sourceSummary}

RESPONSE${chunkLabel}:
${chunk}

Return:
{"supported":[{"claim":"EXACT sentence from response","source":"Source N (single best match)","confidence":"high|medium"}],"unsupported":[{"claim":"EXACT sentence from response","reason":"why","source":"closest source or null"}],"summary":"1 sentence"}

Rules:
- Copy claims EXACTLY verbatim from the response. Do NOT paraphrase.
- Flag UNSUPPORTED only for specific facts (numbers, dates, legal requirements) not found in sources.
- General legal concepts need no source support. Cross-language equivalence counts as support.
- JURISDICTION: "in Austria, X" supported only by AT sources, "in Slovakia, X" only by SK sources.
- NUMBERS: Verify the number means the SAME thing. "5,000 EUR cash payment" ≠ "minimum capital 5,000 EUR".
- SCOPE: If response says "the minimum capital is X" but source says X only for a special procedure (e.g. simplified formation), flag as UNSUPPORTED with reason "applies only to [specific procedure], not general rule".
- MEANING INVERSION: If response says "X is prohibited" but source says "X is allowed with approval", flag as UNSUPPORTED with reason "inverts source meaning — source allows X with conditions, response claims prohibition". This includes summaries and practical implications sections.
- CASE LAW (sources whose name ends in "Leitsatz" — court decisions): the check is "does the court's reasoning support this interpretation?". Treat headnotes as evidence of how courts read a statute, not as the statute itself. A claim is supported if the Leitsatz expresses the same legal principle, even if wording differs.
- SOURCE: For each claim, cite the ONE most relevant source (e.g. "Source 3"). Do NOT list multiple sources like "Source 1, 2, 3".
- Be concise. Return ONLY the JSON.`;

                const chunkStartTime = Date.now();
                const judgeResponse = await (0, llmAdapter_1.callLLM)(
                    [{ role: 'system', content: 'You are a precise legal fact-checker. Return only valid JSON.' }, { role: 'user', content: judgePrompt }],
                    { taskType: 'claim_regeneration', maxTokens: 2000, useFastModel: false, temperature: 0 }
                );
                const chunkMs = Date.now() - chunkStartTime;
                fullJudgeResponse += (judgeResponse || '') + '\n';
                console.log(`[ClaimVerifier] LLM Judge chunk ${ci + 1}/${responseChunks.length} completed in ${chunkMs}ms (${(judgeResponse || '').length} chars)`);

                // Parse this chunk's judge response (with truncated JSON repair)
                const jsonMatch = (judgeResponse || '').match(/\{[\s\S]*\}?/);
                if (jsonMatch) {
                    let jsonStr = jsonMatch[0];
                    let parsed;
                    try {
                        parsed = JSON.parse(jsonStr);
                    } catch (parseErr) {
                        // Truncated JSON repair: close unclosed strings, arrays, objects
                        console.warn(`[ClaimVerifier] Judge JSON parse failed, attempting repair...`);
                        // Remove trailing incomplete object (cut at last complete entry)
                        jsonStr = jsonStr.replace(/,\s*\{[^}]*$/, '');  // remove last incomplete {...
                        jsonStr = jsonStr.replace(/,\s*"[^"]*$/, '');   // remove trailing incomplete string
                        // Close unclosed brackets
                        const opens = (jsonStr.match(/\[/g) || []).length;
                        const closes = (jsonStr.match(/\]/g) || []).length;
                        for (let b = 0; b < opens - closes; b++) jsonStr += ']';
                        // Close unclosed braces
                        const openBraces = (jsonStr.match(/\{/g) || []).length;
                        const closeBraces = (jsonStr.match(/\}/g) || []).length;
                        for (let b = 0; b < openBraces - closeBraces; b++) jsonStr += '}';
                        try {
                            parsed = JSON.parse(jsonStr);
                            console.log(`[ClaimVerifier] JSON repair successful`);
                        } catch (repairErr) {
                            console.warn(`[ClaimVerifier] JSON repair failed: ${repairErr.message}`);
                        }
                    }
                    if (parsed) {
                        if (Array.isArray(parsed.supported)) judgeFlags.supported.push(...parsed.supported);
                        if (Array.isArray(parsed.unsupported)) judgeFlags.unsupported.push(...parsed.unsupported);
                        if (parsed.summary && !judgeFlags.summary) judgeFlags.summary = parsed.summary;
                    }
                } else {
                    console.warn(`[ClaimVerifier] LLM Judge chunk ${ci + 1} returned non-JSON, treating as no flags`);
                }

                // Log each chunk to audit
                this.auditContext.logLLMCall({
                    model: 'qwen3:14b',
                    taskType: 'llm_judge',
                    prompt: `Fact-check response chunk ${ci + 1}/${responseChunks.length} (${chunk.length} chars) against ${sourceCount} sources`,
                    response: (judgeResponse || '').substring(0, 1000),
                    durationMs: chunkMs,
                    supportedCount: Array.isArray(judgeFlags.supported) ? judgeFlags.supported.length : 0,
                    unsupportedCount: Array.isArray(judgeFlags.unsupported) ? judgeFlags.unsupported.length : 0,
                    chunkIndex: ci,
                    totalChunks: responseChunks.length,
                });
            } catch (judgeErr) {
                console.warn(`[ClaimVerifier] LLM Judge chunk ${ci + 1} failed:`, judgeErr.message);
            }
        }
        const judgeMs = Date.now() - judgeStartTime;
        console.log(`[ClaimVerifier] LLM Judge total: ${judgeMs}ms, ${judgeFlags.supported.length} supported, ${judgeFlags.unsupported.length} unsupported across ${responseChunks.length} chunk(s)`);
        // === STAGE 2: NLI confirmation on judge-flagged unsupported claims only ===
        const verified = [];
        const failed = [];
        const removed = [];
        const regenerated = [];
        // Helper: resolve "Source 14" or "Source 1, 2, 3" → actual source name
        const resolveSourceRef = (ref, claim) => {
            if (!ref) return '';
            // Extract all source indices from refs like "Source 1, 2, 3" or "Source 1, Source 2"
            const allIndices = [];
            for (const m of ref.matchAll(/(\d+)/g)) {
                const idx = parseInt(m[1], 10) - 1;
                if (idx >= 0 && idx < this.sources.length) allIndices.push(idx);
            }
            if (allIndices.length === 0) return ref;
            if (allIndices.length === 1) {
                return this.sources[allIndices[0]].title || this.sources[allIndices[0]].source || ref;
            }
            // Multiple sources: pick the one whose title best matches the claim text
            if (claim) {
                const claimLower = claim.toLowerCase();
                let bestIdx = allIndices[0];
                let bestScore = 0;
                for (const idx of allIndices) {
                    const title = (this.sources[idx].title || this.sources[idx].source || '').toLowerCase();
                    // Score by word overlap between source title and claim
                    const words = title.split(/[\s\-§–—]+/).filter(w => w.length > 3);
                    const score = words.filter(w => claimLower.includes(w)).length;
                    if (score > bestScore) { bestScore = score; bestIdx = idx; }
                }
                return this.sources[bestIdx].title || this.sources[bestIdx].source || ref;
            }
            return this.sources[allIndices[0]].title || this.sources[allIndices[0]].source || ref;
        };
        // Track seen claim texts to prevent duplicates
        const seenClaims = new Set();
        // Mark all supported claims as verified
        for (const s of judgeFlags.supported) {
            const claimNorm = (s.claim || '').toLowerCase().replace(/\s+/g, ' ').trim();
            if (seenClaims.has(claimNorm)) continue;
            seenClaims.add(claimNorm);
            const resolvedSource = resolveSourceRef(s.source, s.claim);
            verified.push({
                claim: s.claim,
                status: 'verified',
                confidence: s.confidence === 'high' ? 0.9 : 0.7,
                sourceRef: resolvedSource,
                nliLabel: 'llm_supported',
                judgeVerdict: 'supported',
            });
            this.auditContext.logNLIVerification({
                claim: s.claim,
                sourceRef: resolvedSource,
                result: 'llm_supported',
                confidence: s.confidence === 'high' ? 0.9 : 0.7,
                method: 'llm_judge',
            });
        }
        // Process judge-flagged unsupported claims: regenerate or remove
        const unsupportedCount = judgeFlags.unsupported.length;
        if (unsupportedCount > 0) {
            yield { type: 'progress', message: `Fixing ${unsupportedCount} flagged claim${unsupportedCount > 1 ? 's' : ''}...` };
        } else {
            yield { type: 'progress', message: 'All claims supported' };
        }
        let regenIndex = 0;
        const usedSourceIds = new Set();
        for (const u of judgeFlags.unsupported) {
            const claimNorm = (u.claim || '').toLowerCase().replace(/\s+/g, ' ').trim();
            if (seenClaims.has(claimNorm)) continue;
            seenClaims.add(claimNorm);
            const resolvedRef = resolveSourceRef(u.source, u.claim);
            let matchedSource = this._findSource(u.source) || this._findSource(resolvedRef);
            // Fallback: when judge returns null/no source ref, find best source by claim-to-content word overlap
            if (!matchedSource && u.claim && this.sources.length > 0) {
                const claimWords = u.claim.toLowerCase().split(/[\s,.\-–—;:()*]+/).filter(w => w.length >= 3);
                if (claimWords.length >= 2) {
                    let bestScore = 0;
                    for (const s of this.sources) {
                        const text = ((s.excerpt || s.content || '') + ' ' + (s.title || '')).toLowerCase();
                        const overlap = claimWords.filter(w => text.includes(w)).length;
                        if (overlap > bestScore && overlap >= 2) {
                            bestScore = overlap;
                            matchedSource = s;
                        }
                    }
                    if (matchedSource) {
                        console.log(`[ClaimVerifier] Fallback source match by content overlap (${bestScore}/${claimWords.length} words): ${(matchedSource.title || matchedSource.source || '').substring(0, 80)}`);
                    }
                }
            }
            // Last resort: search unused sources for the most relevant content to this claim
            if (!matchedSource && u.claim && this.sources.length > 0) {
                const claimWords = u.claim.toLowerCase().split(/[\s,.\-–—;:()*§]+/).filter(w => w.length >= 3);
                let bestScore = 0;
                let bestSource = null;
                for (const s of this.sources) {
                    if (usedSourceIds.has(s.id || s.title)) continue;
                    const text = ((s.excerpt || s.content || '') + ' ' + (s.title || '')).toLowerCase();
                    const overlap = claimWords.filter(w => text.includes(w)).length;
                    if (overlap > bestScore) {
                        bestScore = overlap;
                        bestSource = s;
                    }
                }
                if (bestSource && bestScore > 0) {
                    matchedSource = bestSource;
                    console.log(`[ClaimVerifier] Last-resort: best unused source by relevance (${bestScore}/${claimWords.length} words): ${(matchedSource.title || matchedSource.source || '').substring(0, 80)}`);
                }
            }
            if (matchedSource) usedSourceIds.add(matchedSource.id || matchedSource.title);
            const sourceText = matchedSource ? (matchedSource.excerpt || matchedSource.content || '') : '';
            regenIndex++;
            if (unsupportedCount > 1) {
                yield { type: 'progress', message: `Fixing claim ${regenIndex} of ${unsupportedCount}...` };
            }
            // No sources at all — remove (should be rare, only if zero sources in conversation)
            if (!sourceText) {
                console.log(`[ClaimVerifier] Judge flagged unsupported: "${u.claim.substring(0, 60)}..." — no sources available at all, removing`);
                removed.push({
                    claim: u.claim,
                    originalClaim: u.claim,
                    status: 'removed',
                    confidence: 0,
                    sourceRef: resolvedRef || '',
                    nliLabel: 'judge_removed',
                    judgeVerdict: 'unsupported_no_source',
                    judgeReason: u.reason,
                });
                continue;
            }
            console.log(`[ClaimVerifier] Judge flagged unsupported: "${u.claim.substring(0, 60)}..." — regenerating`);
            try {
                const regen = await regenerateClaim(u.claim, sourceText, this.auditContext);
                if (regen.status === 'verified_by_regen') {
                    // Rewrite was identical → original claim was correct, treat as verified
                    verified.push({
                        claim: u.claim,
                        status: 'verified',
                        confidence: 0.75,
                        sourceRef: matchedSource?.title || matchedSource?.source || resolvedRef || '',
                        nliLabel: 'llm_supported',
                        judgeVerdict: 'verified_by_regen',
                    });
                    this.auditContext.logNLIVerification({
                        claim: u.claim,
                        sourceRef: resolvedRef || '',
                        result: 'verified_by_regen',
                        confidence: 0.75,
                        method: 'llm_judge',
                        judgeReason: u.reason,
                    });
                } else if (regen.status === 'regenerated') {
                    regenerated.push({
                        claim: regen.rewrittenClaim,
                        originalClaim: u.claim,
                        status: 'regenerated',
                        confidence: 0.8,
                        sourceRef: matchedSource?.title || matchedSource?.source || resolvedRef || '',
                        nliLabel: 'judge_regenerated',
                        judgeVerdict: 'unsupported',
                        judgeReason: u.reason,
                    });
                    this.auditContext.logNLIVerification({
                        claim: u.claim,
                        sourceRef: resolvedRef || '',
                        result: 'judge_regenerated',
                        confidence: 0.8,
                        method: 'llm_judge',
                        judgeReason: u.reason,
                    });
                } else {
                    removed.push({
                        claim: u.claim,
                        originalClaim: u.claim,
                        status: 'removed',
                        confidence: 0,
                        sourceRef: resolvedRef || '',
                        nliLabel: 'judge_removed',
                        judgeVerdict: 'unsupported',
                        judgeReason: u.reason,
                    });
                    this.auditContext.logNLIVerification({
                        claim: u.claim,
                        sourceRef: resolvedRef || '',
                        result: 'judge_removed',
                        confidence: 0,
                        method: 'llm_judge',
                        judgeReason: u.reason,
                    });
                }
            } catch (regenErr) {
                console.warn(`[ClaimVerifier] Regeneration failed: ${regenErr.message}`);
                failed.push({
                    claim: u.claim,
                    status: 'judge_flagged',
                    confidence: 0,
                    sourceRef: resolvedRef || '',
                    nliLabel: 'judge_flagged',
                    judgeVerdict: 'unsupported',
                    judgeReason: u.reason,
                });
                this.auditContext.logNLIVerification({
                    claim: u.claim,
                    sourceRef: resolvedRef || '',
                    result: 'judge_flagged',
                    confidence: 0,
                    method: 'llm_judge',
                    judgeReason: u.reason,
                });
            }
        }
        // Apply replacements/removals to response
        const _escRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const _makeFlexPattern = (s) => _escRegex(s).replace(/\s+/g, '\\s+');
        // Word-overlap ratio between two strings (for fuzzy sentence matching)
        const _wordOverlap = (a, b) => {
            const wordsA = new Set(a.toLowerCase().replace(/[.,;:!?()""„"'\-]/g, ' ').split(/\s+/).filter(w => w.length > 2));
            const wordsB = new Set(b.toLowerCase().replace(/[.,;:!?()""„"'\-]/g, ' ').split(/\s+/).filter(w => w.length > 2));
            if (wordsA.size === 0 || wordsB.size === 0) return 0;
            let overlap = 0;
            for (const w of wordsA) { if (wordsB.has(w)) overlap++; }
            return overlap / Math.min(wordsA.size, wordsB.size);
        };
        const _tryReplace = (text, original, replacement) => {
            // Try 1: exact substring match (replaceAll for multi-mention claims)
            if (text.includes(original)) {
                return text.split(original).join(replacement);
            }
            // Try 2: whitespace-flexible regex match (global flag for all occurrences)
            try {
                const regex = new RegExp(_makeFlexPattern(original), 'gi');
                if (regex.test(text)) {
                    regex.lastIndex = 0; // reset after test()
                    return text.replace(regex, replacement);
                }
            } catch {}
            // Try 3: match first 60 chars (handles paraphrased endings)
            const prefix = original.substring(0, Math.min(60, original.length));
            if (prefix.length >= 20) {
                try {
                    const prefixRegex = new RegExp(_makeFlexPattern(prefix) + '[^\\n]*', 'gi');
                    if (prefixRegex.test(text)) {
                        prefixRegex.lastIndex = 0;
                        return text.replace(prefixRegex, replacement);
                    }
                } catch {}
            }
            // Try 4: sentence-level fuzzy match (judge often paraphrases slightly)
            // Split response into sentences, find the one with highest word overlap
            const sentences = text.split(/(?<=[.!?])\s+/).filter(s => s.length > 15);
            let bestSentence = null;
            let bestOverlap = 0;
            for (const sentence of sentences) {
                const overlap = _wordOverlap(original, sentence);
                if (overlap > bestOverlap) {
                    bestOverlap = overlap;
                    bestSentence = sentence;
                }
            }
            if (bestSentence && bestOverlap >= 0.7) {
                console.log(`[ClaimVerifier] Fuzzy match (${(bestOverlap * 100).toFixed(0)}% overlap): "${bestSentence.substring(0, 50)}..." → ${replacement ? 'replace' : 'remove'}`);
                return text.replace(bestSentence, replacement);
            }
            return null; // failed
        };
        for (const r of regenerated) {
            const result = _tryReplace(finalResponse, r.originalClaim, r.claim);
            if (result !== null) {
                finalResponse = result;
            } else {
                // Fallback: append the corrected claim so it's not lost
                console.warn(`[ClaimVerifier] Could not find claim to replace, appending corrected version: "${r.originalClaim.substring(0, 60)}..."`);
                finalResponse = finalResponse.trimEnd() + '\n\n' + r.claim;
            }
        }
        for (const r of removed) {
            const result = _tryReplace(finalResponse, r.originalClaim, '');
            if (result !== null) {
                finalResponse = result;
                console.log(`[ClaimVerifier] Removed unsupported: "${r.originalClaim.substring(0, 80)}..."`);
            } else {
                console.warn(`[ClaimVerifier] Could not find claim to remove: "${r.originalClaim.substring(0, 80)}..."`);
            }
        }
        // Clean up artifacts from removals: empty list items, double blank lines, trailing whitespace
        finalResponse = finalResponse.replace(/^[-*•]\s*$/gm, '');  // empty bullet points
        finalResponse = finalResponse.replace(/^\d+\.\s*$/gm, '');  // empty numbered items
        finalResponse = finalResponse.replace(/\n{3,}/g, '\n\n').trim();
        // Safety: don't shrink response below 50 chars
        if (finalResponse.trim().length < 50 && baseResponse.trim().length >= 50) {
            console.warn('[ClaimVerifier] Response shrunk too much, keeping original');
            finalResponse = baseResponse;
        }
        const totalClaims = verified.length + failed.length + removed.length + regenerated.length;
        let overallConfidence;
        if (totalClaims === 0) {
            overallConfidence = 'none';
        } else {
            const passRate = (verified.length + regenerated.length) / totalClaims;
            if (passRate >= 0.8) overallConfidence = 'high';
            else if (passRate >= 0.5) overallConfidence = 'medium';
            else if (verified.length > 0) overallConfidence = 'low';
            else overallConfidence = 'unverified';
        }
        const claimDetails = [
            ...verified.map(v => ({ claim: v.claim, status: v.status, confidence: v.confidence, sourceRef: v.sourceRef, nliLabel: v.nliLabel, judgeVerdict: v.judgeVerdict })),
            ...regenerated.map(r => ({ claim: r.claim, originalClaim: r.originalClaim, status: 'regenerated', confidence: r.confidence, sourceRef: r.sourceRef, nliLabel: r.nliLabel, judgeVerdict: r.judgeVerdict })),
            ...removed.map(r => ({ claim: r.claim, originalClaim: r.originalClaim, status: 'removed', confidence: r.confidence, sourceRef: r.sourceRef, nliLabel: r.nliLabel, judgeVerdict: r.judgeVerdict })),
            ...failed.map(f => ({ claim: f.claim, status: 'judge_flagged', confidence: f.confidence, sourceRef: f.sourceRef, nliLabel: f.nliLabel, judgeVerdict: f.judgeVerdict })),
        ];
        // Store claim outcomes in quoteVerifications for audit trail display
        for (const c of claimDetails) {
            this.auditContext.logQuoteVerification({
                claim: c.claim,
                originalClaim: c.originalClaim || null,
                status: c.status,
                confidence: c.confidence,
                sourceRef: c.sourceRef || null,
                nliLabel: c.nliLabel || null,
                isVerified: c.status === 'verified' || c.status === 'regenerated',
            });
        }
        console.log(`[ClaimVerifier] Result: ${verified.length} verified, ${failed.length} flagged, ${regenerated.length} regenerated, ${removed.length} removed (${overallConfidence}) [judge]`);
        yield {
            type: 'result',
            finalResponse,
            verification: {
                verified: verified.length,
                total: totalClaims,
                regenerated: regenerated.length,
                removed: removed.length,
                confidence: overallConfidence,
                claims: claimDetails,
                llmJudge: {
                    summary: judgeFlags.summary || '',
                    supportedCount: judgeFlags.supported?.length || 0,
                    unsupportedCount: judgeFlags.unsupported?.length || 0,
                    rawResponse: fullJudgeResponse.substring(0, 2000),
                },
            },
        };
    }
}
function autoDetectJurisdictionFromQuery(query) {
    const detection = (0, mandatoryTerms_1.detectJurisdiction)(query);
    if (detection.isExplicit) {
        return {
            jurisdiction: detection.detected,
            wasAutoDetected: true,
            needsConfirmation: false,
            detectionMessage: `Detected jurisdiction: ${exports.JURISDICTION_INFO[detection.detected]?.name || detection.detected}`,
        };
    }
    if (detection.detected && detection.confidence >= 0.7) {
        return {
            jurisdiction: detection.detected,
            wasAutoDetected: true,
            needsConfirmation: false,
            detectionMessage: `Detected jurisdiction from legal references: ${exports.JURISDICTION_INFO[detection.detected]?.name || detection.detected}`,
        };
    }
    if (detection.isAmbiguous && detection.allMatches.length >= 2) {
        const top = detection.allMatches[0];
        const alternatives = detection.allMatches.slice(1, 3).map(m => exports.JURISDICTION_INFO[m.jurisdiction]?.name || m.jurisdiction);
        return {
            jurisdiction: top.jurisdiction,
            wasAutoDetected: true,
            needsConfirmation: true,
            detectionMessage: `Multiple jurisdictions detected: using ${exports.JURISDICTION_INFO[top.jurisdiction]?.name || top.jurisdiction}, but also found references to ${alternatives.join(', ')}. Use the jurisdiction selector if this is incorrect.`,
        };
    }
    if (detection.detected) {
        return {
            jurisdiction: detection.detected,
            wasAutoDetected: true,
            needsConfirmation: true,
            detectionMessage: `Weak jurisdiction signal: ${exports.JURISDICTION_INFO[detection.detected]?.name || detection.detected}. Use the jurisdiction selector to confirm.`,
        };
    }
    return {
        jurisdiction: 'US',
        wasAutoDetected: false,
        needsConfirmation: true,
        detectionMessage: 'No jurisdiction detected in query. Defaulting to US. Use the jurisdiction selector to specify a different jurisdiction.',
    };
}
const prisma = new client_1.PrismaClient();
function validateAndSanitizeResponse(response, providedSources, hadSources) {
    const warnings = [];
    let sanitized = response;
    const citationPatterns = [
        /\b([A-Z][a-z]+(?:\s+(?:v\.?|vs\.?|gegen|contre|c\.)\s+[A-Z][a-z]+[^,.\n]*?))\s*\[?\d{4}\]?/g,
        /\[\d{4}\]\s*[A-Z]{2,5}\s*\d+/g,
        /\b(OGH|BGH|BVerwG|VfGH|VwGH)\s*[IVX]*\s*[A-Za-z]+\s*\d+\/\d+[a-z]?/gi,
        /\b\d+\s*(?:C|Cdo|Co|Cb|Obdo|O|S|AS|Nc|Nco|Ns|Ncs|T|To|Tdo|Tk|Tz|E|Ek|Er|Ec|R|Rs|Ro)\s*\d+\/\d{2,4}/gi,
        /\b(?:Najvyšší súd|Ústavný súd|Krajský súd|Okresný súd)\s*(?:SR|ČR)?\s*[^,.\n]{0,30}\d+\/\d{2,4}/gi,
        /(?:§|Art\.?|čl\.?)\s*\d+[a-z]?(?:\s*(?:Abs\.?\s*\d+|ods\.?\s*\d+|lit\.?\s*[a-z]|Satz\s*\d+|písm\.?\s*[a-z]))*\s+[A-ZÄÖÜ][a-zA-ZäöüÄÖÜáéíóúýčďěňřšťžÁÉÍÓÚÝČĎĚŇŘŠŤŽ\s\.]{2,}/g,
        /(?:Sp\.?\s*zn\.?|č\.?\s*j\.?|Az\.?)\s*[\d\w\s\/\-]+\/\d{2,4}/gi,
    ];
    const officialLegalUrls = [
        'ris.bka.gv.at',
        'slov-lex.sk',
        'nsud.sk',
        'ustavnysud.sk',
        'justice.gov.sk',
        'eur-lex.europa.eu',
        'curia.europa.eu',
        'bailii.org',
        'canlii.org',
        'austlii.edu.au',
        'saflii.org',
        'legifrance.gouv.fr',
        'gesetze-im-internet.de',
        'beck-online.de',
        'dejure.org',
    ];
    if (!hadSources) {
        for (const pattern of citationPatterns) {
            const matches = sanitized.match(pattern);
            if (matches && matches.length > 0) {
                const unmarkedMatches = matches.filter(m => !m.includes('Unverified') && !m.includes('⚠️'));
                if (unmarkedMatches.length > 0) {
                    warnings.push(`Response may contain unverified citations: ${unmarkedMatches.slice(0, 2).join(', ')}`);
                    for (const match of unmarkedMatches) {
                        sanitized = sanitized.replace(match, `[Unverified: ${match}]`);
                    }
                }
            }
        }
        if (warnings.length > 0 && !sanitized.includes('verify all citations independently')) {
            sanitized = `${sanitized}\n\n---\n**Note:** Some citations could not be verified. Please verify independently.`;
        }
    }
    else {
        const bracketRefs = sanitized.match(/\[(\d+)\]/g) || [];
        const maxSourceNum = providedSources.length;
        for (const ref of bracketRefs) {
            const num = parseInt(ref.replace(/[\[\]]/g, ''));
            if (num > maxSourceNum) {
                warnings.push(`Citation ${ref} references non-existent source (only ${maxSourceNum} sources provided)`);
                sanitized = sanitized.replace(ref, `⚠️ *[Invalid reference: ${ref}]*`);
            }
        }
        const moneyPatterns = [
            /(\d{1,3}(?:[,.\s]\d{3})*)\s*(?:EUR|eur|€|euro|Euro)/g,
            /(?:EUR|€)\s*(\d{1,3}(?:[,.\s]\d{3})*)/g,
            /(\d{1,3}(?:[,.\s]\d{3})*)\s*(?:SKK|Sk|korún)/gi,
        ];
        const allSourceText = providedSources
            .map(s => `${s.excerpt || ''} ${s.title || ''}`)
            .join(' ')
            .toLowerCase()
            .replace(/\s+/g, ' ');
        for (const pattern of moneyPatterns) {
            const matches = sanitized.matchAll(pattern);
            for (const match of matches) {
                const fullMatch = match[0];
                const numStr = match[1] || match[0];
                const normalizedNum = numStr.replace(/[\s,\.]/g, '');
                const numVariants = [
                    normalizedNum,
                    normalizedNum.replace(/(\d)(?=(\d{3})+$)/g, '$1 '),
                    normalizedNum.replace(/(\d)(?=(\d{3})+$)/g, '$1,'),
                ];
                const foundInSource = numVariants.some(variant => allSourceText.includes(variant.toLowerCase()));
                if (!foundInSource && !fullMatch.includes('⚠️')) {
                    warnings.push(`Amount "${fullMatch}" not found in provided sources - may be hallucinated`);
                    console.warn(`[NumberValidation] Potentially hallucinated amount: ${fullMatch}`);
                }
            }
        }
        for (const pattern of citationPatterns) {
            const matches = sanitized.match(pattern) || [];
            for (const match of matches) {
                const isInSources = providedSources.some(source => source.title?.toLowerCase().includes(match.toLowerCase().substring(0, 20)) ||
                    source.citation?.toLowerCase().includes(match.toLowerCase().substring(0, 20)) ||
                    source.excerpt?.toLowerCase().includes(match.toLowerCase().substring(0, 20)));
                if (!isInSources && !match.includes('Unverified') && !match.includes('⚠️')) {
                    warnings.push(`Citation "${match.substring(0, 40)}..." not found in provided sources`);
                    sanitized = sanitized.replace(match, `[Unverified: ${match}]`);
                }
            }
        }
    }
    return { sanitizedResponse: sanitized, warnings };
}
exports.RESEARCH_ACTIONS = {
    SEARCH_LEGAL_DB: 'search_legal_db',
    SEARCH_WEB: 'search_web',
    SEARCH_VAULT: 'search_vault',
    SEARCH_DOCUMENTS: 'search_documents',
    SEARCH_CASE_DATA: 'search_case_data',
    SAVE_TO_CASE: 'save_to_case',
    SAVE_TO_VAULT: 'save_to_vault',
    CREATE_CITATION: 'create_citation',
    SUMMARIZE_SOURCE: 'summarize_source',
    COMPARE_CASES: 'compare_cases',
    ANALYZE_PRECEDENT: 'analyze_precedent',
    DRAFT_MEMO: 'draft_memo',
};
exports.JURISDICTION_INFO = {
    US: {
        name: 'United States',
        citationFormat: 'Bluebook (21st ed.)',
        legalSystem: 'Common Law (Federal/State)',
        primarySources: ['U.S. Code', 'CFR', 'State Codes', 'Case Law'],
    },
    'US-CA': {
        name: 'California',
        citationFormat: 'Bluebook (21st ed.)',
        legalSystem: 'Common Law (State)',
        primarySources: ['California Codes', 'California Code of Regulations'],
    },
    EW: {
        name: 'England & Wales',
        citationFormat: 'OSCOLA (4th ed.)',
        legalSystem: 'Common Law',
        primarySources: ['UK Public General Acts', 'Statutory Instruments', 'Senedd Acts (Wales)', 'BAILII case law'],
    },
    SC: {
        name: 'Scotland',
        citationFormat: 'OSCOLA (Scottish style)',
        legalSystem: 'Mixed (Civil + Common Law)',
        primarySources: ['Acts of the Scottish Parliament (asp)', 'Scottish Statutory Instruments', 'Scottish-extent UK Parliament Acts'],
    },
    NI: {
        name: 'Northern Ireland',
        citationFormat: 'OSCOLA',
        legalSystem: 'Common Law',
        primarySources: ['Acts of the NI Assembly', 'NI Statutory Rules', 'NI-extent UK Parliament Acts'],
    },
    UK: {
        name: 'United Kingdom',
        citationFormat: 'OSCOLA (4th ed.)',
        legalSystem: 'Common Law',
        primarySources: ['UK Legislation', 'Case Law', 'Statutory Instruments'],
    },
    DE: {
        name: 'Germany',
        citationFormat: 'German Standard (BGH style)',
        legalSystem: 'Civil Law (Codified)',
        primarySources: ['BGB', 'HGB', 'Rechtsprechung'],
    },
    AT: {
        name: 'Austria',
        citationFormat: 'Austrian Standard (OGH style)',
        legalSystem: 'Civil Law (Codified)',
        primarySources: ['ABGB', 'UGB', 'RIS'],
    },
    CH: {
        name: 'Switzerland',
        citationFormat: 'Swiss Standard (SR/RS numbers)',
        legalSystem: 'Civil Law (Codified, Federal)',
        primarySources: ['OR', 'ZGB', 'BGE'],
    },
    EU: {
        name: 'European Union',
        citationFormat: 'ECLI for cases, OJ for legislation',
        legalSystem: 'Sui Generis (Supranational)',
        primarySources: ['EUR-Lex', 'ECJ Case Law', 'Directives', 'Regulations'],
    },
    FR: {
        name: 'France',
        citationFormat: 'French Standard (Bulletin reference)',
        legalSystem: 'Civil Law (Codified)',
        primarySources: ['Code civil', 'Code de commerce', 'Légifrance'],
    },
    CA: {
        name: 'Canada',
        citationFormat: 'McGill Guide',
        legalSystem: 'Mixed (Common Law + Quebec Civil Law)',
        primarySources: ['Federal Statutes', 'Provincial Statutes', 'CanLII'],
    },
    AU: {
        name: 'Australia',
        citationFormat: 'AGLC (4th ed.)',
        legalSystem: 'Common Law (Federal)',
        primarySources: ['Federal Legislation', 'State Legislation', 'AustLII'],
    },
    SK: {
        name: 'Slovakia',
        citationFormat: 'Slovak Standard',
        legalSystem: 'Civil Law (Codified)',
        primarySources: ['Slov-Lex', 'Zbierka zákonov', 'Súdne rozhodnutia'],
    },
    RO: {
        name: 'Romania',
        citationFormat: 'Romanian Standard (Monitorul Oficial)',
        legalSystem: 'Civil Law (Codified)',
        primarySources: ['Codul Civil', 'Codul Comercial', 'Monitorul Oficial', 'legislatie.just.ro'],
    },
    CZ: {
        name: 'Czech Republic',
        citationFormat: 'Czech Standard (Sbírka zákonů)',
        legalSystem: 'Civil Law (Codified)',
        primarySources: ['Občanský zákoník', 'Zákon o obchodních korporacích', 'Sbírka zákonů'],
    },
    CY: {
        name: 'Cyprus',
        citationFormat: 'Cyprus Standard',
        legalSystem: 'Mixed (Common Law & Continental)',
        primarySources: ['Cyprus Legislation', 'Official Gazette', 'Supreme Court Decisions'],
    },
    ZA: {
        name: 'South Africa',
        citationFormat: 'South African Law Reports style',
        legalSystem: 'Mixed (Roman-Dutch & Common Law)',
        primarySources: ['SAFLII', 'Government Gazette', 'Constitutional Court'],
    },
};
exports.OFFICIAL_DATABASES = {
    US: [
        { name: 'CourtListener', url: 'https://www.courtlistener.com', description: 'Free case law database', type: 'cases' },
        { name: 'Congress.gov', url: 'https://www.congress.gov', description: 'Federal legislation', type: 'legislation' },
        { name: 'Google Scholar', url: 'https://scholar.google.com', description: 'Case law search', type: 'cases' },
        { name: 'Cornell LII', url: 'https://www.law.cornell.edu', description: 'Legal encyclopedia', type: 'comprehensive' },
    ],
    'US-CA': [
        { name: 'California Legislature', url: 'https://leginfo.legislature.ca.gov', description: 'Official California statutes', type: 'legislation' },
        { name: 'CalRegs', url: 'https://govt.westlaw.com/calregs', description: 'California Code of Regulations', type: 'legislation' },
    ],
    UK: [
        { name: 'Find Case Law', url: 'https://caselaw.nationalarchives.gov.uk', description: 'Official UK case law', type: 'cases' },
        { name: 'Legislation.gov.uk', url: 'https://www.legislation.gov.uk', description: 'Official UK legislation', type: 'legislation' },
        { name: 'BAILII', url: 'https://www.bailii.org', description: 'British and Irish legal information', type: 'comprehensive' },
    ],
    DE: [
        { name: 'Gesetze im Internet', url: 'https://www.gesetze-im-internet.de', description: 'Official German federal law', type: 'legislation' },
        { name: 'dejure.org', url: 'https://dejure.org', description: 'German legal database', type: 'comprehensive' },
        { name: 'OpenJur', url: 'https://openjur.de', description: 'German case law', type: 'cases' },
    ],
    AT: [
        { name: 'RIS', url: 'https://www.ris.bka.gv.at', description: 'Official Austrian legal information system', type: 'comprehensive' },
        { name: 'ALEX', url: 'https://alex.onb.ac.at', description: 'Historical Austrian legal sources', type: 'legislation' },
    ],
    CH: [
        { name: 'Fedlex', url: 'https://www.fedlex.admin.ch', description: 'Official Swiss federal law', type: 'legislation' },
        { name: 'BGer', url: 'https://www.bger.ch', description: 'Swiss Federal Supreme Court', type: 'cases' },
    ],
    EU: [
        { name: 'EUR-Lex', url: 'https://eur-lex.europa.eu', description: 'Official EU law database', type: 'comprehensive' },
        { name: 'CURIA', url: 'https://curia.europa.eu', description: 'EU Court of Justice case law', type: 'cases' },
    ],
    FR: [
        { name: 'Légifrance', url: 'https://www.legifrance.gouv.fr', description: 'Official French law database', type: 'comprehensive' },
    ],
    CA: [
        { name: 'CanLII', url: 'https://www.canlii.org', description: 'Canadian legal information', type: 'comprehensive' },
        { name: 'Justice Laws', url: 'https://laws-lois.justice.gc.ca', description: 'Federal statutes and regulations', type: 'legislation' },
    ],
    AU: [
        { name: 'AustLII', url: 'https://www.austlii.edu.au', description: 'Australian legal information', type: 'comprehensive' },
        { name: 'Federal Register', url: 'https://www.legislation.gov.au', description: 'Federal legislation', type: 'legislation' },
    ],
    SK: [
        { name: 'Slov-Lex', url: 'https://www.slov-lex.sk', description: 'Official Slovak legal portal', type: 'comprehensive' },
        { name: 'Otvorené Súdy', url: 'https://otvorenesudy.sk', description: 'Slovak court decisions', type: 'cases' },
    ],
    RO: [
        { name: 'legislatie.just.ro', url: 'https://legislatie.just.ro', description: 'Official Romanian legislation portal', type: 'legislation' },
        { name: 'Monitorul Oficial', url: 'https://www.monitoruloficial.ro', description: 'Romanian Official Gazette', type: 'legislation' },
    ],
    CZ: [
        { name: 'Zákony pro lidi', url: 'https://www.zakonyprolidi.cz', description: 'Czech legislation database', type: 'legislation' },
        { name: 'ASPI', url: 'https://www.aspi.cz', description: 'Czech legal information system', type: 'comprehensive' },
    ],
    CY: [
        { name: 'CyLaw', url: 'https://www.cylaw.org', description: 'Cyprus legal information', type: 'comprehensive' },
        { name: 'Official Gazette', url: 'https://www.mof.gov.cy', description: 'Cyprus Official Gazette', type: 'legislation' },
    ],
    ZA: [
        { name: 'SAFLII', url: 'https://www.saflii.org', description: 'Southern African Legal Information Institute', type: 'comprehensive' },
        { name: 'Constitutional Court', url: 'https://www.concourt.org.za', description: 'Constitutional Court judgments', type: 'cases' },
        { name: 'Government Gazette', url: 'https://www.gov.za/documents/acts', description: 'South African legislation', type: 'legislation' },
    ],
};
function getOfficialDatabaseRecommendations(jurisdiction) {
    const databases = exports.OFFICIAL_DATABASES[jurisdiction.toUpperCase()] || exports.OFFICIAL_DATABASES['US'];
    if (!databases || databases.length === 0) {
        return '   - No specific databases configured for this jurisdiction';
    }
    return databases
        .map(db => `   - ${db.name} (${db.url}): ${db.description}`)
        .join('\n');
}
const JURISDICTION_KEYWORDS = {
    US: ['united states', 'american', 'u.s.', 'federal law', 'state law', 'congress'],
    UK: ['united kingdom', 'british', 'english law', 'parliament', 'common law uk'],
    DE: ['germany', 'german', 'deutschland', 'bgb', 'hgb', 'bundesgerichtshof'],
    AT: ['austria', 'austrian', 'österreich', 'abgb', 'ugb', 'ogh', 'ris.bka'],
    SK: ['slovakia', 'slovak', 'slovensko', 'slov-lex', 'slovenský'],
    CH: ['switzerland', 'swiss', 'schweiz', 'suisse'],
    EU: ['european union', 'eu law', 'eu directive', 'eu regulation', 'eur-lex', 'cjeu', 'ecj'],
    FR: ['france', 'french', 'code civil', 'légifrance'],
    CA: ['canada', 'canadian', 'canlii'],
    AU: ['australia', 'australian', 'austlii'],
};
function detectJurisdictionsInQuery(query) {
    const lowerQuery = query.toLowerCase();
    const detected = [];
    for (const [code, keywords] of Object.entries(JURISDICTION_KEYWORDS)) {
        for (const keyword of keywords) {
            if (lowerQuery.includes(keyword)) {
                detected.push(code);
                break;
            }
        }
    }
    return detected;
}
function detectJurisdictionConflict(query, selectedJurisdiction, selectedJurisdictions = []) {
    const mentioned = detectJurisdictionsInQuery(query);
    const allSelected = selectedJurisdictions.length > 0
        ? selectedJurisdictions
        : [selectedJurisdiction];
    if (mentioned.length === 0) {
        return { hasConflict: false, mentionedJurisdictions: [], suggestedJurisdictions: allSelected };
    }
    const unselectedMentions = mentioned.filter(m => !allSelected.includes(m));
    if (unselectedMentions.length === 0) {
        return { hasConflict: false, mentionedJurisdictions: mentioned, suggestedJurisdictions: allSelected };
    }
    const suggestedJurisdictions = [...new Set([...allSelected, ...mentioned])];
    const conflictMessage = `Query mentions ${unselectedMentions.map(j => exports.JURISDICTION_INFO[j]?.name || j).join(', ')} ` +
        `but searching in ${allSelected.map(j => exports.JURISDICTION_INFO[j]?.name || j).join(', ')}. ` +
        `Expanding search to include mentioned jurisdictions.`;
    console.log(`[ResearchChat] Jurisdiction conflict detected: ${conflictMessage}`);
    return {
        hasConflict: true,
        mentionedJurisdictions: mentioned,
        suggestedJurisdictions,
        conflictMessage,
    };
}
async function chat(userId, message, options = {}) {
    const { conversationId, caseId, jurisdictionOverride, jurisdictions = [], ipAddress, userAgent } = options;
    const auditContext = new aiAuditService_1.AIAuditContext(userId, 'research_chat', message);
    if (ipAddress || userAgent) auditContext.setRequestMetadata(ipAddress, userAgent);
    // Set organization for audit trail
    try { const _u = await prisma.user.findUnique({ where: { id: userId }, select: { organizationId: true } }); if (_u?.organizationId) auditContext.setOrganization(_u.organizationId); } catch {}
    if (caseId)
        auditContext.setCase(caseId);
    let conversation = conversationId
        ? await prisma.researchConversation.findUnique({
            where: { id: conversationId },
            include: { messages: { orderBy: { createdAt: 'asc' }, take: 20 } },
        })
        : null;
    if (!conversation) {
        conversation = await prisma.researchConversation.create({
            data: {
                userId,
                caseId,
                jurisdiction: jurisdictionOverride,
                title: message.substring(0, 100),
            },
            include: { messages: true },
        });
    }
    const context = await gatherResearchContext(userId, caseId);
    let jurisdiction;
    let jurisdictionWarning;
    if (jurisdictionOverride) {
        jurisdiction = jurisdictionOverride;
        const autoDetection = autoDetectJurisdictionFromQuery(message);
        if (autoDetection.wasAutoDetected && autoDetection.jurisdiction !== jurisdictionOverride) {
            jurisdictionWarning = `Note: Your query mentions ${exports.JURISDICTION_INFO[autoDetection.jurisdiction]?.name || autoDetection.jurisdiction}, but you're searching in ${exports.JURISDICTION_INFO[jurisdictionOverride]?.name || jurisdictionOverride}. Change jurisdiction if needed.`;
        }
    }
    else if (jurisdictions.length > 0) {
        jurisdiction = jurisdictions[0];
    }
    else if (conversation.jurisdiction) {
        jurisdiction = conversation.jurisdiction;
        const autoDetection = autoDetectJurisdictionFromQuery(message);
        if (autoDetection.wasAutoDetected && autoDetection.jurisdiction !== conversation.jurisdiction) {
            jurisdictionWarning = `Note: Your query mentions ${exports.JURISDICTION_INFO[autoDetection.jurisdiction]?.name || autoDetection.jurisdiction}, but using ${exports.JURISDICTION_INFO[conversation.jurisdiction]?.name || conversation.jurisdiction} from conversation. Change jurisdiction if needed.`;
        }
    }
    else {
        const autoDetection = autoDetectJurisdictionFromQuery(message);
        jurisdiction = autoDetection.jurisdiction;
        if (autoDetection.needsConfirmation) {
            jurisdictionWarning = autoDetection.detectionMessage;
        }
    }
    if (jurisdictionOverride && jurisdictionOverride !== conversation.jurisdiction) {
        await prisma.researchConversation.update({
            where: { id: conversation.id },
            data: { jurisdiction: jurisdictionOverride },
        });
    }
    auditContext.setJurisdiction(jurisdiction, jurisdictionOverride ? 'user_selected' :
        conversation.jurisdiction ? 'conversation_default' : 'auto_detected');
    const rawHistory = conversation.messages.map(m => ({
        role: m.role,
        content: m.content,
    }));
    const history = trimHistory(rawHistory);
    if (rawHistory.length !== history.length) {
        console.log(`[ResearchChat] History trimmed: ${rawHistory.length} → ${history.length} messages`);
    }
    const effectiveJurisdictions = jurisdictions.length > 0 ? jurisdictions : [jurisdiction];
    const systemPrompt = buildResearchSystemPrompt(context, jurisdiction, context.user.language, effectiveJurisdictions);
    auditContext.setSystemPrompt(systemPrompt);
    const actionResults = [];
    const sources = [];
    if (jurisdictionWarning) {
        actionResults.push({
            success: true,
            message: jurisdictionWarning,
            data: { type: 'jurisdiction_detection', jurisdiction },
        });
    }
    const searchLang = SEARCH_LANGUAGE[jurisdiction];
    const langHint = searchLang
        ? ` MANDATORY: ALL search queries (query, query2, query3) MUST be written in ${searchLang} (the jurisdiction's legal language). If the user wrote in a different language, translate the legal CONCEPT into ${searchLang} formal/statutory terminology before searching. Never pass non-${searchLang} words to the search tool. Example: user asks "Verjährungsfrist" (German) for ${jurisdiction} → translate to ${searchLang} formal term, do not search "Verjährungsfrist".`
        : '';
    const routingPrompt = `You are a legal research assistant for ${jurisdiction} law.${langHint} You MUST use the search_legal_database tool for any legal question. Never answer legal questions without searching first. Only skip the tool for greetings or thanks.`;
    const routingResult = await routeWithTools(routingPrompt, history, message, jurisdiction);
    const isResearchQuery = routingResult.needsSearch;
    const toolSearchQuery = routingResult.query;
    if (isResearchQuery) {
        const conflictCheck = detectJurisdictionConflict(message, jurisdiction, effectiveJurisdictions);
        if (conflictCheck.hasConflict) {
            console.log(`[ResearchChat] Jurisdiction mismatch detected: query mentions ${conflictCheck.mentionedJurisdictions.join(', ')} but user selected ${jurisdiction}. Respecting user selection.`);
            actionResults.push({
                success: true,
                message: `Note: Your query mentions ${conflictCheck.mentionedJurisdictions.map(j => exports.JURISDICTION_INFO[j]?.name || j).join(', ')}, but searching in ${exports.JURISDICTION_INFO[jurisdiction]?.name || jurisdiction} as selected. Change your jurisdiction if you want to search elsewhere.`,
                data: { type: 'jurisdiction_mismatch', mentioned: conflictCheck.mentionedJurisdictions, selected: jurisdiction },
            });
        }
        const isMultiJurisdiction = effectiveJurisdictions.length > 1;
        // Dict-grounded routing happened upstream (the routing prompt was
        // injected with the formal statutory term as ground truth). The LLM
        // produced query2/query3 using it, so we just read them off.
        const synonymQuery = routingResult.query2 || null;
        const statuteQuery = routingResult.query3 || null;
        console.log(`[ResearchChat] Auto-searching for: "${message.substring(0, 50)}..." (RAG_ONLY_MODE: ${RAG_ONLY_MODE}, jurisdictions: ${effectiveJurisdictions.join(',')}, conflict: ${conflictCheck.hasConflict}${synonymQuery ? `, synonym: "${synonymQuery}"` : ''}${statuteQuery ? `, statutes: "${statuteQuery}"` : ''})`);
        // For multi-jurisdiction: use original message (tool router narrows to one jurisdiction)
        // For single-jurisdiction: use tool router's extracted query (better keyword extraction)
        const searchQuery = isMultiJurisdiction ? message : (toolSearchQuery || extractSearchQuery(message));
        const sourceTypes = ['legislation', 'case_law', 'jurisdiction_kb'];
        try {
            if (isMultiJurisdiction) {
                console.log(`[ResearchChat] Multi-jurisdiction search across: ${effectiveJurisdictions.join(', ')}`);
                const multiResults = await (0, rag_1.searchMultiJurisdiction)(searchQuery, effectiveJurisdictions, {
                    sourceTypes,
                    limit: 20,
                });
                for (const jurisdictionResult of multiResults) {
                    if (jurisdictionResult.results.length > 0) {
                        const ragAsSources = jurisdictionResult.results.map((r, index) => ({
                            id: r.chunkId || r.id,
                            source: `${jurisdictionResult.jurisdictionName} Database`,
                            jurisdiction: r.jurisdiction || jurisdictionResult.jurisdiction,
                            title: r.sourceName || 'Unknown',
                            citation: r.clauseType ? `[${r.clauseType}]` : '',
                            date: '',
                            excerpt: r.content.substring(0, 2500),
                            url: '',
                            relevance: Math.max(70, 95 - index * 3),
                        }));
                        sources.push(...ragAsSources);
                    }
                }
                const totalResults = multiResults.reduce((sum, r) => sum + r.results.length, 0);
                if (totalResults > 0) {
                    actionResults.push({
                        success: true,
                        message: `Found ${totalResults} verified results across ${effectiveJurisdictions.join(', ')}`,
                        data: { jurisdictions: effectiveJurisdictions, resultsByJurisdiction: multiResults },
                    });
                    console.log(`[ResearchChat] Found ${totalResults} multi-jurisdiction results`);
                }
            }
            else {
                const ragSearchStart = Date.now();
                // Run main + synonym + statute search + source_name lookup in parallel
                const searchPromises = [(0, rag_1.enhancedSearch)(searchQuery, { sourceTypes, jurisdiction, limit: 20 })];
                if (synonymQuery) {
                    searchPromises.push((0, rag_1.enhancedSearch)(synonymQuery, { sourceTypes, jurisdiction, limit: 10 }));
                }
                if (statuteQuery) {
                    searchPromises.push((0, rag_1.enhancedSearch)(statuteQuery, { sourceTypes, jurisdiction, limit: 10 }));
                }
                // Direct source_name lookup for query3 (bypasses embeddings, finds exact sections)
                const sourceNamePromise = statuteQuery ? searchBySourceName(statuteQuery, jurisdiction) : Promise.resolve([]);
                const [ragResults, synonymResults, statuteResults] = await Promise.all(searchPromises);
                const sourceNameResults = await sourceNamePromise;
                // Merge all results: interleave to ensure each query contributes to top N
                let mergedResults = [...ragResults];
                const seenIds = new Set(ragResults.map(r => r.chunkId || r.id));
                const extraResults = [];
                // Source-name exact matches get highest priority (prepended)
                if (sourceNameResults.length > 0) {
                    const newResults = sourceNameResults.filter(r => !seenIds.has(r.chunkId || r.id));
                    newResults.forEach(r => seenIds.add(r.chunkId || r.id));
                    if (newResults.length > 0) {
                        mergedResults = [...newResults, ...mergedResults]; // Prepend exact matches
                        console.log(`[ResearchChat] Source-name lookup added ${newResults.length} exact section matches`);
                    }
                }
                if (synonymResults && synonymResults.length > 0) {
                    const newResults = synonymResults.filter(r => !seenIds.has(r.chunkId || r.id));
                    newResults.forEach(r => seenIds.add(r.chunkId || r.id));
                    extraResults.push(...newResults);
                    if (newResults.length > 0) {
                        console.log(`[ResearchChat] Synonym search added ${newResults.length} new results (${synonymResults.length} total, ${synonymResults.length - newResults.length} deduped)`);
                    }
                }
                if (statuteResults && statuteResults.length > 0) {
                    const newResults = statuteResults.filter(r => !seenIds.has(r.chunkId || r.id));
                    newResults.forEach(r => seenIds.add(r.chunkId || r.id));
                    extraResults.push(...newResults);
                    if (newResults.length > 0) {
                        console.log(`[ResearchChat] Statute search added ${newResults.length} new results (${statuteResults.length} total, ${statuteResults.length - newResults.length} deduped)`);
                    }
                }
                if (extraResults.length > 0) {
                    mergedResults = [];
                    const maxLen = Math.max(ragResults.length, extraResults.length);
                    for (let i = 0; i < maxLen; i++) {
                        if (i < ragResults.length) mergedResults.push(ragResults[i]);
                        if (i < extraResults.length) mergedResults.push(extraResults[i]);
                    }
                }
                auditContext.logRAGSearch({
                    query: searchQuery,
                    jurisdiction,
                    sourceTypes,
                    resultsCount: ragResults.length,
                    results: ragResults.map((r) => ({
                        id: r.chunkId || r.id,
                        sourceName: r.sourceName || 'Unknown',
                        relevanceScore: r.relevanceScore || r.score || 0,
                        wasUsed: false,
                    })),
                    searchDurationMs: Date.now() - ragSearchStart,
                });
                if (synonymQuery && synonymResults) {
                    auditContext.logRAGSearch({
                        query: `[synonym] ${synonymQuery}`,
                        jurisdiction,
                        sourceTypes,
                        resultsCount: synonymResults.length,
                        results: synonymResults.slice(0, 10).map((r) => ({
                            id: r.chunkId || r.id,
                            sourceName: r.sourceName || 'Unknown',
                            relevanceScore: r.relevanceScore || r.score || 0,
                            wasUsed: false,
                        })),
                        searchDurationMs: Date.now() - ragSearchStart,
                    });
                }
                if (statuteQuery && statuteResults) {
                    auditContext.logRAGSearch({
                        query: `[statute] ${statuteQuery}`,
                        jurisdiction,
                        sourceTypes,
                        resultsCount: statuteResults.length,
                        results: statuteResults.slice(0, 10).map((r) => ({
                            id: r.chunkId || r.id,
                            sourceName: r.sourceName || 'Unknown',
                            relevanceScore: r.relevanceScore || r.score || 0,
                            wasUsed: false,
                        })),
                        searchDurationMs: Date.now() - ragSearchStart,
                    });
                }
                // Quality guardrail: filter by reranker confidence
                const MIN_CONFIDENCE_SCORE = 0.01;
                const qualityResults = mergedResults.filter(r => {
                    const score = r.rerankScore ?? r.relevanceScore ?? r.score ?? 0;
                    return score >= MIN_CONFIDENCE_SCORE;
                });
                const topScore = mergedResults.length > 0 ? (mergedResults[0].rerankScore ?? mergedResults[0].relevanceScore ?? mergedResults[0].score ?? 0) : 0;
                if (qualityResults.length === 0 && mergedResults.length > 0) {
                    console.log('[ResearchChat] GUARDRAIL: ' + mergedResults.length + ' results found but ALL below confidence ' + MIN_CONFIDENCE_SCORE + ' (top: ' + topScore.toFixed(4) + '). Treating as no sources.');
                } else if (qualityResults.length < mergedResults.length) {
                    console.log('[ResearchChat] Quality filter: ' + mergedResults.length + ' -> ' + qualityResults.length + ' results (dropped ' + (mergedResults.length - qualityResults.length) + ' below ' + MIN_CONFIDENCE_SCORE + ')');
                }
                // Version dedup (non-streaming): remove duplicate statute § sections, keep highest-scored
                const dedupedResults = _deduplicateBySection(qualityResults);
                if (dedupedResults.length < qualityResults.length) {
                    console.log(`[ResearchChat] Version dedup: ${qualityResults.length} -> ${dedupedResults.length} (removed ${qualityResults.length - dedupedResults.length} duplicate sections)`);
                }
                const effectiveResults = dedupedResults.length > 0 ? dedupedResults : [];
                if (effectiveResults.length > 0) {
                    const ragAsSources = effectiveResults.map((r, index) => ({
                        id: r.chunkId || r.id,
                        source: `Local ${jurisdiction} Database`,
                        jurisdiction: r.jurisdiction || jurisdiction,
                        title: r.sourceName || 'Unknown',
                        citation: r.clauseType ? `[${r.clauseType}]` : '',
                        date: '',
                        excerpt: r.content.substring(0, 2500),
                        url: '',
                        relevance: Math.max(70, 95 - index * 3),
                    }));
                    sources.push(...ragAsSources);
                    actionResults.push({
                        success: true,
                        message: `Found ${mergedResults.length} verified results from local ${jurisdiction} legal database`,
                        data: { results: ragAsSources },
                    });
                    console.log(`[ResearchChat] Found ${mergedResults.length} local RAG results`);
                }
            }
        }
        catch (error) {
            console.error('[ResearchChat] RAG search error:', error);
        }
        if (!RAG_ONLY_MODE) {
            try {
                const legalResponse = await (0, legalApiService_1.searchByJurisdiction)(jurisdiction, searchQuery, { limit: 5 });
                if (legalResponse.success && legalResponse.results.length > 0) {
                    const externalResults = legalResponse.results.map(r => ({
                        ...r,
                        relevance: Math.max(20, r.relevance - 30),
                    }));
                    sources.push(...externalResults);
                    actionResults.push({
                        success: true,
                        message: `Found ${legalResponse.results.length} results from external ${jurisdiction} databases`,
                        data: { results: externalResults },
                    });
                    console.log(`[ResearchChat] Found ${legalResponse.results.length} external sources`);
                }
            }
            catch (error) {
                console.error('[ResearchChat] External search error:', error);
            }
        }
        if (RAG_ONLY_MODE && sources.length === 0) {
            const searchedJurisdictions = effectiveJurisdictions.join(', ');
            console.log(`[ResearchChat] RAG-only mode: No verified sources found for query in ${searchedJurisdictions}`);
            actionResults.push({
                success: false,
                message: `No verified sources found in ${searchedJurisdictions} legal database(s). The system only provides answers from verified legal data.`,
            });
        }
    }
    let searchContext = '';
    if (sources.length > 0) {
        const sourceBudget = estimateSourceBudget(systemPrompt, history, message);
        const allFormattedXML = sources.map((s, i) => formatSourceXML(s, i));
        const totalSourceChars = allFormattedXML.reduce((sum, xml) => sum + xml.length, 0);
        if (totalSourceChars > sourceBudget) {
            // Split: primary sources at full text + overflow compressed to brief citations (no LLM call)
            const { primary, overflow } = splitSourcesByBudget(sources, sourceBudget);
            const primaryXML = primary.map((s, i) => formatSourceXML(s, i)).join('\n');
            const primaryChars = primaryXML.length;
            const overflowBudget = Math.max(sourceBudget - primaryChars - 200, 2000);
            const overflowSection = overflow.length > 0
                ? `\n\n## Additional Sources (${overflow.length} — brief excerpts)\n${compressOverflowSources(overflow, overflowBudget)}`
                : '';
            console.log(`[ResearchChat] Split: ${primary.length} primary (${primaryChars} chars) + ${overflow.length} overflow (${overflowSection.length} chars) | budget: ${sourceBudget}`);
            searchContext = `\n\n## Verified Legal Sources\n\n${primaryXML}${overflowSection}${GROUNDING_RULES}`;
        } else {
            const formattedSources = allFormattedXML.join('\n');
            searchContext = `\n\n## Verified Legal Sources\n\n${formattedSources}${GROUNDING_RULES}`;
        }
    }
    else if (isResearchQuery) {
        searchContext = `\n\n## Search Results\nZERO VERIFIED SOURCES FOUND. You have NO authoritative sources to cite.\n\nRULES:\n1. Start with: "I could not find verified sources in our database for this query."\n2. NEVER invent case names, case numbers, statute citations, court decisions, or specific numbers\n3. Provide only general conceptual guidance without citations\n4. Recommend official databases: slov-lex.sk (SK), ris.bka.gv.at (AT), eur-lex.europa.eu (EU)`;
    }
    else {
        // No search was done (conversational/follow-up). Still add anti-hallucination rules.
        searchContext = `\n\nIMPORTANT: You have NO legal sources available for this response. Do NOT cite specific statute names, section numbers, institution names, standard numbers, or legal requirements unless they are commonly known general knowledge. If the user is asking a legal question, suggest they rephrase it or recommend official databases.`;
    }
    history.push({ role: 'user', content: message + searchContext });
    const totalInputChars = systemPrompt.length + history.reduce((s, m) => s + (m.content || '').length, 0);
    console.log(`[ResearchChat] Context: ${totalInputChars} chars (~${Math.round(totalInputChars/3)} tokens), ${sources.length} sources, ${history.length} messages`);
    const response = await (0, llmAdapter_1.callLLM)([{ role: 'system', content: systemPrompt }, ...history], { taskType: 'legal_research', maxTokens: 2000 });
    const { text: responseText, actions: llmActions } = parseActionsFromResponse(response);
    for (const action of llmActions) {
        const result = await executeResearchAction(action, userId, context, jurisdiction);
        actionResults.push(result);
        if (result.data?.results && Array.isArray(result.data.results)) {
            sources.push(...result.data.results);
        }
    }
    const hadSourcesBeforeSearch = sources.length > 0;
    const cleanedResponse = (0, outputSanitizer_1.sanitizeOutput)(responseText);
    const cleanedSources = (0, outputSanitizer_1.sanitizeSources)(sources);
    // NLI verify-before-send with parallel ClaimVerifier + regeneration
    // Judge gets clean text first; citation validation runs AFTER to avoid double [Unverified] nesting
    let finalResponse = cleanedResponse;
    auditContext.setRawResponse(cleanedResponse);
    let verification = { verified: 0, total: 0, regenerated: 0, removed: 0, confidence: 'none', claims: [] };
    try {
        if (cleanedSources.length > 0) {
            const verifier = new ClaimVerifier(cleanedSources, auditContext);
            verifier.addToken(cleanedResponse);
            for await (const ev of verifier.finalize(cleanedResponse)) {
                if (ev.type === 'result') {
                    finalResponse = ev.finalResponse;
                    verification = ev.verification;
                }
            }
            console.log(`[ResearchChat] Verification: ${verification.verified}/${verification.total} verified, ${verification.regenerated} regenerated, ${verification.removed} removed (${verification.confidence}) [judge]`);
        }
    }
    catch (nliError) {
        console.warn('[ResearchChat] NLI verification failed (continuing with unfiltered):', nliError);
    }
    // Citation validation after judge to avoid double [Unverified] nesting
    const { sanitizedResponse, warnings } = validateAndSanitizeResponse(finalResponse, sources, hadSourcesBeforeSearch);
    if (warnings.length > 0) {
        console.warn('[ResearchChat] Citation validation warnings:', warnings);
    }
    finalResponse = sanitizedResponse;
    await prisma.researchMessage.create({
        data: {
            conversationId: conversation.id,
            role: 'user',
            content: message,
        },
    });
    const assistMsg = await prisma.researchMessage.create({
        data: {
            conversationId: conversation.id,
            role: 'assistant',
            content: finalResponse,
            sources: cleanedSources.length > 0 ? JSON.stringify(cleanedSources) : null,
            actions: actionResults.length > 0 ? JSON.stringify(actionResults) : null,
        },
    });
    // Write verification via raw SQL (column exists in DB but not in Prisma schema)
    if (verification.total > 0) {
        await prisma.$executeRaw`UPDATE research_messages SET verification = ${JSON.stringify(verification)} WHERE id = ${assistMsg.id}`;
    }
    await prisma.researchConversation.update({
        where: { id: conversation.id },
        data: { updatedAt: new Date() },
    });
    try {
        auditContext.setConversation(conversation.id);
        auditContext.setResponse(finalResponse, cleanedSources.map(s => ({
            id: s.id || '',
            sourceName: s.title || s.source || 'Unknown',
            citation: s.citation,
            excerpt: s.excerpt?.substring(0, 2000),
        })));
        const auditEnabled = await (0, aiAuditService_1.isAuditEnabled)(null);
        if (auditEnabled) {
            await (0, aiAuditService_1.saveAIAudit)(auditContext.finalize());
        }
    }
    catch (auditError) {
        console.error('[ResearchChat] Audit logging failed:', auditError);
    }
    return {
        message: finalResponse,
        sources: cleanedSources,
        actions: actionResults,
        conversationId: conversation.id,
    };
}
const SOURCE_PAGE_SIZE = 10;
async function* chatStream(userId, message, options = {}) {
    const { conversationId, caseId, jurisdictionOverride, jurisdictions = [], sourceOffset = 0, ipAddress, userAgent } = options;
    const _routeLogStart = Date.now();  // for routeAnalytics duration_ms
    const auditContext = new aiAuditService_1.AIAuditContext(userId, 'research_chat', message);
    if (ipAddress || userAgent) auditContext.setRequestMetadata(ipAddress, userAgent);
    // Set organization for audit trail
    try { const _u = await prisma.user.findUnique({ where: { id: userId }, select: { organizationId: true } }); if (_u?.organizationId) auditContext.setOrganization(_u.organizationId); } catch {}
    if (caseId)
        auditContext.setCase(caseId);
    yield { type: 'status', data: { step: 'starting', message: 'Initializing research assistant...' } };
    let conversation = conversationId
        ? await prisma.researchConversation.findUnique({
            where: { id: conversationId },
            include: { messages: { orderBy: { createdAt: 'asc' }, take: 20 } },
        })
        : null;
    if (!conversation) {
        conversation = await prisma.researchConversation.create({
            data: {
                userId,
                caseId,
                jurisdiction: jurisdictionOverride,
                title: message.substring(0, 100),
            },
            include: { messages: true },
        });
    }
    yield { type: 'status', data: { step: 'context', message: 'Gathering context...', conversationId: conversation.id } };
    const context = await gatherResearchContext(userId, caseId);
    let jurisdiction;
    let jurisdictionWarning;
    if (jurisdictionOverride) {
        jurisdiction = jurisdictionOverride;
        const autoDetection = autoDetectJurisdictionFromQuery(message);
        if (autoDetection.wasAutoDetected && autoDetection.jurisdiction !== jurisdictionOverride) {
            jurisdictionWarning = `Note: Your query mentions ${exports.JURISDICTION_INFO[autoDetection.jurisdiction]?.name || autoDetection.jurisdiction}, but searching in ${exports.JURISDICTION_INFO[jurisdictionOverride]?.name || jurisdictionOverride}.`;
        }
    }
    else if (jurisdictions.length > 0) {
        jurisdiction = jurisdictions[0];
    }
    else if (conversation.jurisdiction) {
        jurisdiction = conversation.jurisdiction;
        const autoDetection = autoDetectJurisdictionFromQuery(message);
        if (autoDetection.wasAutoDetected && autoDetection.jurisdiction !== conversation.jurisdiction) {
            jurisdictionWarning = `Note: Your query mentions ${exports.JURISDICTION_INFO[autoDetection.jurisdiction]?.name || autoDetection.jurisdiction}, but using ${exports.JURISDICTION_INFO[conversation.jurisdiction]?.name || conversation.jurisdiction} from conversation.`;
        }
    }
    else {
        const autoDetection = autoDetectJurisdictionFromQuery(message);
        jurisdiction = autoDetection.jurisdiction;
        if (autoDetection.needsConfirmation) {
            jurisdictionWarning = autoDetection.detectionMessage;
        }
    }
    if (jurisdictionOverride && jurisdictionOverride !== conversation.jurisdiction) {
        await prisma.researchConversation.update({
            where: { id: conversation.id },
            data: { jurisdiction: jurisdictionOverride },
        });
    }
    const rawHistory = conversation.messages.map(m => ({
        role: m.role,
        content: m.content,
    }));
    const history = trimHistory(rawHistory);
    if (rawHistory.length !== history.length) {
        console.log(`[ResearchChat/Stream] History trimmed: ${rawHistory.length} → ${history.length} messages`);
    }
    const effectiveJurisdictions = jurisdictions.length > 0 ? jurisdictions : [jurisdiction];
    const actionResults = [];
    let sources = [];
    let allStoredSources = []; // all sources from RAG (for pagination)
    let isSourceContinuation = sourceOffset > 0;

    // === SOURCE CONTINUATION MODE ===
    // When sourceOffset > 0, skip RAG search and load stored sources from previous message
    if (isSourceContinuation) {
        yield { type: 'status', data: { step: 'searching', message: `Loading additional sources (batch ${Math.floor(sourceOffset / SOURCE_PAGE_SIZE) + 1})...` } };
        // Find last assistant message with sources in this conversation
        const lastAssistant = conversation.messages
            .filter(m => m.role === 'assistant' && m.sources)
            .pop();
        if (lastAssistant?.sources) {
            try {
                allStoredSources = JSON.parse(lastAssistant.sources);
                sources = allStoredSources.slice(sourceOffset, sourceOffset + SOURCE_PAGE_SIZE);
                console.log(`[ResearchChat/Stream] Source continuation: offset=${sourceOffset}, batch=${sources.length}, total=${allStoredSources.length}`);
            } catch { /* parse error, treat as no sources */ }
        }
        if (sources.length === 0) {
            yield { type: 'status', data: { step: 'done', message: 'No more sources to analyze.' } };
            yield { type: 'complete', data: { message: '', sources: [], actions: [], conversationId: conversation.id } };
            return;
        }
    }

    if (jurisdictionWarning && !isSourceContinuation) {
        yield { type: 'status', data: { step: 'jurisdiction_note', message: jurisdictionWarning } };
        actionResults.push({
            success: true,
            message: jurisdictionWarning,
            data: { type: 'jurisdiction_detection', jurisdiction },
        });
    }
    yield { type: 'status', data: { step: 'analyzing', message: isSourceContinuation ? `Analyzing sources ${sourceOffset + 1}–${sourceOffset + sources.length}...` : 'Analyzing your question...' } };
    let isResearchQuery = isSourceContinuation; // continuation always has sources
    let toolSearchQuery = null;
    if (!isSourceContinuation) {
    const searchLang = SEARCH_LANGUAGE[jurisdiction];
    const langHint = searchLang
        ? ` MANDATORY: ALL search queries (query, query2, query3) MUST be written in ${searchLang} (the jurisdiction's legal language). If the user wrote in a different language, translate the legal CONCEPT into ${searchLang} formal/statutory terminology before searching. Never pass non-${searchLang} words to the search tool. Example: user asks "Verjährungsfrist" (German) for ${jurisdiction} → translate to ${searchLang} formal term, do not search "Verjährungsfrist".`
        : '';
    const routingPrompt = `You are a legal research assistant for ${jurisdiction} law.${langHint} You MUST use the search_legal_database tool for any legal question. Never answer legal questions without searching first. Only skip the tool for greetings or thanks.`;
    const routingResult = await routeWithTools(routingPrompt, history, message, jurisdiction);
    isResearchQuery = routingResult.needsSearch;
    toolSearchQuery = routingResult.query;
    const synonymQueryStream = routingResult.query2 || null;
    const statuteQueryStream = routingResult.query3 || null;
    if (isResearchQuery) {
        const conflictCheck = detectJurisdictionConflict(message, jurisdiction, effectiveJurisdictions);
        if (conflictCheck.hasConflict) {
            console.log(`[ResearchChat Stream] Jurisdiction mismatch: query mentions ${conflictCheck.mentionedJurisdictions.join(', ')} but user selected ${jurisdiction}. Respecting user selection.`);
            yield { type: 'status', data: {
                    step: 'jurisdiction_note',
                    message: `Note: Searching ${exports.JURISDICTION_INFO[jurisdiction]?.name || jurisdiction} as selected (query mentions other jurisdictions)`
                } };
        }
        const isMultiJurisdiction = effectiveJurisdictions.length > 1;
        const jurisdictionLabel = isMultiJurisdiction ? effectiveJurisdictions.join(', ') : jurisdiction;
        yield { type: 'status', data: { step: 'searching', message: `Searching ${jurisdictionLabel} legal databases...` } };
        // For multi-jurisdiction: use original message (tool router narrows to one jurisdiction)
        // For single-jurisdiction: use tool router's extracted query (better keyword extraction)
        const searchQuery = isMultiJurisdiction ? message : (toolSearchQuery || extractSearchQuery(message));
        const sourceTypes = ['legislation', 'case_law', 'jurisdiction_kb'];
        try {
            if (isMultiJurisdiction) {
                console.log(`[ResearchChat Stream] Multi-jurisdiction search across: ${effectiveJurisdictions.join(', ')} (conflict detected: ${conflictCheck.hasConflict})`);
                const multiResults = await (0, rag_1.searchMultiJurisdiction)(searchQuery, effectiveJurisdictions, {
                    sourceTypes,
                    limit: 20,
                });
                for (const jurisdictionResult of multiResults) {
                    if (jurisdictionResult.results.length > 0) {
                        const ragAsSources = jurisdictionResult.results.map((r, index) => ({
                            id: r.chunkId || r.id,
                            source: `${jurisdictionResult.jurisdictionName} Database`,
                            jurisdiction: r.jurisdiction || jurisdictionResult.jurisdiction,
                            title: r.sourceName || 'Unknown',
                            citation: r.clauseType ? `[${r.clauseType}]` : '',
                            date: '',
                            excerpt: r.content.substring(0, 2500),
                            url: '',
                            relevance: Math.max(70, 95 - index * 3),
                        }));
                        sources.push(...ragAsSources);
                        yield { type: 'sources', data: { sources: ragAsSources, jurisdiction: jurisdictionResult.jurisdiction } };
                    }
                }
                const totalResults = multiResults.reduce((sum, r) => sum + r.results.length, 0);
                if (totalResults > 0) {
                    actionResults.push({
                        success: true,
                        message: `Found ${totalResults} verified results across ${effectiveJurisdictions.join(', ')}`,
                        data: { jurisdictions: effectiveJurisdictions, resultsByJurisdiction: multiResults },
                    });
                }
                else {
                    yield { type: 'status', data: { step: 'searching', message: 'No matches found in selected jurisdictions...' } };
                }
            }
            else {
                const ragSearchStart = Date.now();
                // Run main + synonym + statute search + source_name lookup in parallel
                const searchPromises = [(0, rag_1.enhancedSearch)(searchQuery, { sourceTypes, jurisdiction, limit: 20 })];
                if (synonymQueryStream) {
                    searchPromises.push((0, rag_1.enhancedSearch)(synonymQueryStream, { sourceTypes, jurisdiction, limit: 10 }));
                }
                if (statuteQueryStream) {
                    searchPromises.push((0, rag_1.enhancedSearch)(statuteQueryStream, { sourceTypes, jurisdiction, limit: 10 }));
                }
                // Direct source_name lookup for query3 (bypasses embeddings, finds exact sections)
                const sourceNamePromise = statuteQueryStream ? searchBySourceName(statuteQueryStream, jurisdiction) : Promise.resolve([]);
                const [ragResults, synonymResults, statuteResults] = await Promise.all(searchPromises);
                const sourceNameResults = await sourceNamePromise;
                // Merge all results: interleave to ensure each query contributes to top N
                let mergedResults = [...ragResults];
                const seenIds = new Set(ragResults.map(r => r.chunkId || r.id));
                const extraResults = [];
                // Source-name exact matches get highest priority (prepended)
                if (sourceNameResults.length > 0) {
                    const newResults = sourceNameResults.filter(r => !seenIds.has(r.chunkId || r.id));
                    newResults.forEach(r => seenIds.add(r.chunkId || r.id));
                    if (newResults.length > 0) {
                        mergedResults = [...newResults, ...mergedResults]; // Prepend exact matches
                        console.log(`[ResearchChat Stream] Source-name lookup added ${newResults.length} exact section matches`);
                    }
                }
                if (synonymResults && synonymResults.length > 0) {
                    const newResults = synonymResults.filter(r => !seenIds.has(r.chunkId || r.id));
                    newResults.forEach(r => seenIds.add(r.chunkId || r.id));
                    extraResults.push(...newResults);
                    if (newResults.length > 0) {
                        console.log(`[ResearchChat Stream] Synonym search added ${newResults.length} new results (${synonymResults.length} total, ${synonymResults.length - newResults.length} deduped)`);
                    }
                }
                if (statuteResults && statuteResults.length > 0) {
                    const newResults = statuteResults.filter(r => !seenIds.has(r.chunkId || r.id));
                    newResults.forEach(r => seenIds.add(r.chunkId || r.id));
                    extraResults.push(...newResults);
                    if (newResults.length > 0) {
                        console.log(`[ResearchChat Stream] Statute search added ${newResults.length} new results (${statuteResults.length} total, ${statuteResults.length - newResults.length} deduped)`);
                    }
                }
                if (extraResults.length > 0) {
                    mergedResults = [];
                    const maxLen = Math.max(ragResults.length, extraResults.length);
                    for (let i = 0; i < maxLen; i++) {
                        if (i < ragResults.length) mergedResults.push(ragResults[i]);
                        if (i < extraResults.length) mergedResults.push(extraResults[i]);
                    }
                }
                auditContext.logRAGSearch({
                    query: searchQuery,
                    jurisdiction,
                    resultsCount: ragResults.length,
                    results: ragResults.map((r) => ({
                        id: r.chunkId || r.id,
                        sourceName: r.sourceName || 'Unknown',
                        relevanceScore: r.relevanceScore || r.score || 0,
                        wasUsed: false,
                    })),
                    searchDurationMs: Date.now() - ragSearchStart,
                });
                if (synonymQueryStream && synonymResults) {
                    auditContext.logRAGSearch({
                        query: `[synonym] ${synonymQueryStream}`,
                        jurisdiction,
                        resultsCount: synonymResults.length,
                        results: synonymResults.slice(0, 10).map((r) => ({
                            id: r.chunkId || r.id,
                            sourceName: r.sourceName || 'Unknown',
                            relevanceScore: r.relevanceScore || r.score || 0,
                            wasUsed: false,
                        })),
                        searchDurationMs: Date.now() - ragSearchStart,
                    });
                }
                if (statuteQueryStream && statuteResults) {
                    auditContext.logRAGSearch({
                        query: `[statute] ${statuteQueryStream}`,
                        jurisdiction,
                        resultsCount: statuteResults.length,
                        results: statuteResults.slice(0, 10).map((r) => ({
                            id: r.chunkId || r.id,
                            sourceName: r.sourceName || 'Unknown',
                            relevanceScore: r.relevanceScore || r.score || 0,
                            wasUsed: false,
                        })),
                        searchDurationMs: Date.now() - ragSearchStart,
                    });
                }
                // Quality guardrail: filter by reranker confidence
                const MIN_CONFIDENCE_SCORE = 0.01;
                const qualityResults = mergedResults.filter(r => {
                    const score = r.rerankScore ?? r.relevanceScore ?? r.score ?? 0;
                    return score >= MIN_CONFIDENCE_SCORE;
                });
                const topScore = mergedResults.length > 0 ? (mergedResults[0].rerankScore ?? mergedResults[0].relevanceScore ?? mergedResults[0].score ?? 0) : 0;
                if (qualityResults.length === 0 && mergedResults.length > 0) {
                    console.log('[ResearchChat] GUARDRAIL: ' + mergedResults.length + ' results found but ALL below confidence ' + MIN_CONFIDENCE_SCORE + ' (top: ' + topScore.toFixed(4) + '). Treating as no sources.');
                } else if (qualityResults.length < mergedResults.length) {
                    console.log('[ResearchChat] Quality filter: ' + mergedResults.length + ' -> ' + qualityResults.length + ' results (dropped ' + (mergedResults.length - qualityResults.length) + ' below ' + MIN_CONFIDENCE_SCORE + ')');
                }
                // Version dedup (streaming): remove duplicate statute § sections, keep highest-scored
                const dedupedResults = _deduplicateBySection(qualityResults);
                if (dedupedResults.length < qualityResults.length) {
                    console.log(`[ResearchChat Stream] Version dedup: ${qualityResults.length} -> ${dedupedResults.length} (removed ${qualityResults.length - dedupedResults.length} duplicate sections)`);
                }
                const effectiveResults = dedupedResults.length > 0 ? dedupedResults : [];
                if (effectiveResults.length > 0) {
                    const ragAsSources = effectiveResults.map((r, index) => ({
                        id: r.chunkId || r.id,
                        source: `Local ${jurisdiction} Database`,
                        jurisdiction: r.jurisdiction || jurisdiction,
                        title: r.sourceName || 'Unknown',
                        citation: r.clauseType ? `[${r.clauseType}]` : '',
                        date: '',
                        excerpt: r.content.substring(0, 2500),
                        url: '',
                        relevance: Math.max(70, 95 - index * 3),
                    }));
                    sources.push(...ragAsSources);
                    actionResults.push({
                        success: true,
                        message: `Found ${mergedResults.length} verified results from ${jurisdiction} legal database`,
                        data: { results: ragAsSources },
                    });
                    yield { type: 'sources', data: { sources: ragAsSources, jurisdiction, totalSourceCount: allStoredSources.length, sourceOffset: isSourceContinuation ? sourceOffset : 0, pageSize: SOURCE_PAGE_SIZE } };
                }
                else {
                    yield { type: 'status', data: { step: 'searching', message: 'No direct matches found, continuing...' } };
                }
            }
        }
        catch (error) {
            console.error('[ResearchChat Stream] RAG search error:', error);
            actionResults.push({
                success: false,
                message: 'Legal database search encountered an error',
            });
        }
    }
    } // end if (!isSourceContinuation)
    // For initial requests, store all sources for pagination
    if (!isSourceContinuation) {
        allStoredSources = [...sources];
    }
    // For initial requests with many sources, only use first page. Use
    // diversifyTopK so that when both statutes and case-law cleared the
    // reranker threshold, at least a few case-law slots survive the cut.
    if (!isSourceContinuation && sources.length > SOURCE_PAGE_SIZE) {
        // One-time debug: dump the keys + a sample of the first source so we
        // can see what fields actually exist at this point.
        if (sources[0]) {
            const sample = {};
            for (const k of Object.keys(sources[0]).slice(0, 12)) {
                const v = sources[0][k];
                sample[k] = typeof v === 'string' ? v.slice(0, 60) : (typeof v === 'object' ? '[obj]' : v);
            }
            console.log('[ResearchChat/Stream] source[0] shape:', JSON.stringify(sample));
        }
        const beforeCase = sources.filter(s => {
            const t = (s.sourceType || s.source_type || s.type || '').toString().toLowerCase();
            if (t === 'case_law') return true;
            const blob = ([s.sourceName, s.title, s.source_name, s.source, s.name].filter(x=>typeof x==='string').join(' ')).toLowerCase();
            return blob.includes('leitsatz') || blob.includes('headnote') || / clr \d/i.test(blob);
        }).length;
        sources = diversifyTopK(sources, SOURCE_PAGE_SIZE, { query: message });
        const afterCase = sources.filter(s => {
            const t = (s.sourceType || s.source_type || s.type || '').toString().toLowerCase();
            if (t === 'case_law') return true;
            const blob = ([s.sourceName, s.title, s.source_name, s.source, s.name].filter(x=>typeof x==='string').join(' ')).toLowerCase();
            return blob.includes('leitsatz') || blob.includes('headnote') || / clr \d/i.test(blob);
        }).length;
        console.log(`[ResearchChat/Stream] Paginating: using ${sources.length} of ${allStoredSources.length} sources (case-law in pool: ${beforeCase}, in top-K: ${afterCase}${isInterpretiveQuery(message) ? ', interpretive query' : ''})`);
    }
    yield { type: 'status', data: { step: 'thinking', message: 'Analyzing and formulating response...' } };
    yield { type: 'thinking', data: { active: true } };
    const systemPrompt = buildResearchSystemPrompt(context, jurisdiction, context.user.language, effectiveJurisdictions);
    auditContext.setSystemPrompt(systemPrompt);
    let searchContext = '';
    if (sources.length > 0) {
        const sourceBudget = estimateSourceBudget(systemPrompt, history, message);
        const allFormattedXML = sources.map((s, i) => formatSourceXML(s, i));
        const totalSourceChars = allFormattedXML.reduce((sum, xml) => sum + xml.length, 0);
        if (totalSourceChars > sourceBudget) {
            // Split: primary at full text + overflow compressed to brief citations (instant, no LLM)
            const { primary, overflow } = splitSourcesByBudget(sources, sourceBudget);
            const primaryXML = primary.map((s, i) => formatSourceXML(s, i)).join('\n');
            const primaryChars = primaryXML.length;
            const overflowBudget = Math.max(sourceBudget - primaryChars - 200, 2000);
            const overflowSection = overflow.length > 0
                ? `\n\n## Additional Sources (${overflow.length} — brief excerpts)\n${compressOverflowSources(overflow, overflowBudget)}`
                : '';
            console.log(`[ResearchChat/Stream] Split: ${primary.length} primary (${primaryChars} chars) + ${overflow.length} overflow (${overflowSection.length} chars) | budget: ${sourceBudget}`);
            searchContext = `\n\n## Verified Legal Sources\n\n${primaryXML}${overflowSection}${GROUNDING_RULES}`;
        } else {
            const formattedSources = allFormattedXML.join('\n');
            searchContext = `\n\n## Verified Legal Sources\n\n${formattedSources}${GROUNDING_RULES}`;
        }
    }
    else if (isResearchQuery) {
        searchContext = `\n\n## Search Results\nZERO VERIFIED SOURCES FOUND. You have NO authoritative sources to cite.\n\nRULES:\n1. Start with: "I could not find verified sources in our database for this query."\n2. NEVER invent case names, case numbers, statute citations, court decisions, or specific numbers\n3. Provide only general conceptual guidance without citations\n4. Recommend official databases: slov-lex.sk (SK), ris.bka.gv.at (AT), eur-lex.europa.eu (EU)`;
    }
    else {
        // No search was done (conversational/follow-up). Still add anti-hallucination rules.
        searchContext = `\n\nIMPORTANT: You have NO legal sources available for this response. Do NOT cite specific statute names, section numbers, institution names, standard numbers, or legal requirements unless they are commonly known general knowledge. If the user is asking a legal question, suggest they rephrase it or recommend official databases.`;
    }
    // For source continuation, modify the prompt to focus on new information
    const userContent = isSourceContinuation
        ? `Based on these additional legal sources (batch ${Math.floor(sourceOffset / SOURCE_PAGE_SIZE) + 1}), provide any NEW relevant information, details, or legal provisions not covered in the previous response. If these sources contain no new relevant information, briefly state that.${searchContext}`
        : message + searchContext;
    history.push({ role: 'user', content: userContent });
    const totalInputChars = systemPrompt.length + history.reduce((s, m) => s + (m.content || '').length, 0);
    console.log(`[ResearchChat/Stream] Context: ${totalInputChars} chars (~${Math.round(totalInputChars/3)} tokens), ${sources.length} sources, ${history.length} messages${isSourceContinuation ? ' [continuation]' : ''}`);
    yield { type: 'status', data: { step: 'responding', message: isSourceContinuation ? `Analyzing batch ${Math.floor(sourceOffset / SOURCE_PAGE_SIZE) + 1}...` : 'Generating response...' } };
    let fullResponse = '';
    const llmMessages = [{ role: 'system', content: systemPrompt }, ...history];
    // Create ClaimVerifier to run NLI in parallel during token streaming
    const verifier = sources.length > 0 ? new ClaimVerifier(sources, auditContext) : null;
    for await (const token of (0, llmAdapter_1.callLLMStream)(llmMessages, { taskType: 'legal_research', maxTokens: 3000, useFastModel: false })) {
        fullResponse += token;
        if (verifier) verifier.addToken(token);
        yield { type: 'token', data: { token } };
    }
    yield { type: 'thinking', data: { active: false } };
    const { text: responseText, actions: llmActions } = parseActionsFromResponse(fullResponse);
    if (llmActions.length > 0) {
        yield { type: 'status', data: { step: 'actions', message: 'Executing research actions...' } };
        for (const action of llmActions) {
            const result = await executeResearchAction(action, userId, context, jurisdiction);
            actionResults.push(result);
            if (result.data?.results && Array.isArray(result.data.results)) {
                sources.push(...result.data.results);
                yield { type: 'sources', data: { sources: result.data.results, action: action.type } };
            }
        }
    }
    if (actionResults.length > 0) {
        yield { type: 'actions', data: { actions: actionResults } };
    }
    // Judge gets clean text (no [Unverified] tags); citation validation runs after judge
    let finalResponse = responseText;
    auditContext.setRawResponse(responseText);
    let verification = { verified: 0, total: 0, regenerated: 0, removed: 0, confidence: 'none', claims: [] };
    try {
        if (verifier) {
            yield { type: 'status', data: { step: 'nli', message: 'Verifying claims...' } };
            for await (const ev of verifier.finalize(responseText)) {
                if (ev.type === 'progress') {
                    yield { type: 'status', data: { step: 'nli', message: ev.message } };
                } else if (ev.type === 'result') {
                    finalResponse = ev.finalResponse;
                    verification = ev.verification;
                }
            }
            // Claim outcomes already logged inside finalize() via logNLIVerification + logQuoteVerification
            console.log(`[ResearchChat/Stream] Verification: ${verification.verified}/${verification.total} verified, ${verification.regenerated} regenerated, ${verification.removed} removed (${verification.confidence}) [judge]`);
        }
    }
    catch (nliError) {
        console.warn('[ResearchChat/Stream] NLI verification failed:', nliError);
    }
    // Phase-1 routing analytics — append-only, never read by retrieval. Best-
    // effort: errors swallowed inside the logger. We log whichever sources
    // ended up in the LLM's primary XML (after diversifyTopK pagination), so
    // later cluster-analysis can see WHICH chunks each query type relied on.
    try {
        const routeAnalytics = require('./routeAnalytics')
        const caseLawCount = (sources || []).filter(s => {
            const t = (s.sourceType || s.source_type || '').toString().toLowerCase()
            if (t === 'case_law') return true
            const blob = ([s.sourceName, s.title, s.source_name].filter(x => typeof x === 'string').join(' ')).toLowerCase()
            return blob.includes('leitsatz') || blob.includes('headnote') || / clr \d/i.test(blob)
        }).length
        routeAnalytics.logQueryRoute({
            user_id: userId,
            query_text: message,
            jurisdictions: effectiveJurisdictions,
            interpretive: isInterpretiveQuery(message),
            source_count: (allStoredSources && allStoredSources.length) || (sources && sources.length) || 0,
            primary_count: (sources && sources.length) || 0,
            overflow_count: ((allStoredSources && allStoredSources.length) || 0) - ((sources && sources.length) || 0),
            case_law_count: caseLawCount,
            statute_count: ((sources && sources.length) || 0) - caseLawCount,
            chunk_ids_used: (sources || []).map(s => s.id || s.chunk_id || s.title || s.sourceName || '').filter(Boolean),
            judge_total: verification.total,
            judge_supported: verification.verified,
            judge_unsupported: (verification.total - verification.verified) || 0,
            judge_regenerated: verification.regenerated,
            judge_removed: verification.removed,
            judge_confidence: verification.confidence,
            response_chars: (finalResponse || '').length,
            duration_ms: Date.now() - _routeLogStart,
            pack_versions: {},  // populated later when we wire pack-version snapshot
        })
    } catch (e) {
        console.warn('[ResearchChat/Stream] routeAnalytics log error:', e.message)
    }
    // Citation validation runs AFTER judge to avoid double-nesting [Unverified] tags
    const hadSourcesBeforeSearch = sources.length > 0;
    const { sanitizedResponse, warnings } = validateAndSanitizeResponse(finalResponse, sources, hadSourcesBeforeSearch);
    if (warnings.length > 0) {
        console.warn('[ResearchChat] Citation validation warnings:', warnings);
    }
    finalResponse = sanitizedResponse;
    yield { type: 'content', data: { content: finalResponse } };
    // Compute remaining sources info BEFORE verification event
    const totalSources = allStoredSources.length;
    const nextOffset = isSourceContinuation ? sourceOffset + sources.length : sources.length;
    const remainingCount = totalSources - nextOffset;
    // Include remaining_sources info in verification event so frontend always gets it
    if (remainingCount > 0) {
        verification.remainingSources = { remaining: remainingCount, nextOffset, total: totalSources, pageSize: SOURCE_PAGE_SIZE };
    }
    // Always yield verification event so frontend knows NLI ran
    yield { type: 'verification', data: verification };
    // Also emit standalone remaining_sources event as backup
    if (remainingCount > 0) {
        yield { type: 'remaining_sources', data: { remaining: remainingCount, nextOffset, total: totalSources, pageSize: SOURCE_PAGE_SIZE } };
    }
    yield { type: 'status', data: { step: 'saving', message: 'Saving conversation...' } };
    // For source continuation, don't save a user message (it's automatic)
    if (!isSourceContinuation) {
        await prisma.researchMessage.create({
            data: {
                conversationId: conversation.id,
                role: 'user',
                content: message,
            },
        });
    }
    // Store ALL sources on the assistant message (for future continuation)
    const sourcesToStore = isSourceContinuation ? allStoredSources : allStoredSources;
    const streamAssistMsg = await prisma.researchMessage.create({
        data: {
            conversationId: conversation.id,
            role: 'assistant',
            content: finalResponse,
            sources: sourcesToStore.length > 0 ? JSON.stringify(sourcesToStore) : null,
            actions: actionResults.length > 0 ? JSON.stringify(actionResults) : null,
        },
    });
    // Write verification via raw SQL (column exists in DB but not in Prisma schema)
    if (verification.total > 0) {
        await prisma.$executeRaw`UPDATE research_messages SET verification = ${JSON.stringify(verification)} WHERE id = ${streamAssistMsg.id}`;
    }
    await prisma.researchConversation.update({
        where: { id: conversation.id },
        data: { updatedAt: new Date() },
    });
    try {
        auditContext.setConversation(conversation.id);
        auditContext.setJurisdiction(jurisdiction, jurisdictionOverride ? 'user_selected' : 'auto_detected');
        auditContext.setResponse(finalResponse, sources.map(s => ({
            id: s.id || '',
            sourceName: s.title || s.source || 'Unknown',
            citation: s.citation,
            excerpt: s.excerpt?.substring(0, 2000),
        })));
        const auditEnabled = await (0, aiAuditService_1.isAuditEnabled)(null);
        if (auditEnabled) {
            await (0, aiAuditService_1.saveAIAudit)(auditContext.finalize());
        }
    }
    catch (auditError) {
        console.error('[ResearchChat/Stream] Audit logging failed:', auditError);
    }
    yield {
        type: 'complete',
        data: {
            message: finalResponse,
            sources,
            actions: actionResults,
            conversationId: conversation.id,
            validationWarnings: warnings.length > 0 ? warnings : undefined,
            verification: verification.total > 0 ? verification : undefined,
            remainingSources: remainingCount > 0 ? { remaining: remainingCount, nextOffset, total: totalSources, pageSize: SOURCE_PAGE_SIZE } : undefined,
        },
    };
}
async function gatherResearchContext(userId, caseId) {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, language: true, tier: true },
    });
    if (!user)
        throw new Error('User not found');
    let caseData = undefined;
    if (caseId) {
        const c = await prisma.case.findUnique({
            where: { id: caseId },
            include: {
                entities: { take: 20 },
                timelineEvents: { take: 10, orderBy: { date: 'desc' } },
            },
        });
        if (c) {
            caseData = {
                id: c.id,
                title: c.title,
                type: c.caseType,
                entities: c.entities.map((e) => ({ name: e.name, type: e.type })),
                timeline: c.timelineEvents.map((e) => ({
                    title: e.title,
                    date: e.date?.toISOString() || '',
                })),
            };
        }
    }
    const vaultItems = await prisma.vaultItem.findMany({
        where: { userId },
        select: { id: true, title: true, type: true, tags: true },
        orderBy: { createdAt: 'desc' },
        take: 20,
    });
    const documents = await prisma.document.findMany({
        where: { userId },
        select: { id: true, filename: true, summary: true },
        orderBy: { createdAt: 'desc' },
        take: 10,
    });
    const recentSearches = await prisma.researchQuery.findMany({
        where: { userId },
        select: { query: true, sources: true },
        orderBy: { createdAt: 'desc' },
        take: 5,
    });
    return {
        user: {
            id: user.id,
            jurisdiction: 'US',
            language: user.language || 'en',
            tier: user.tier,
        },
        case: caseData,
        vault: vaultItems.map(v => ({
            id: v.id,
            title: v.title,
            type: v.type,
            tags: v.tags ? JSON.parse(v.tags) : [],
        })),
        documents: documents.map(d => ({
            id: d.id,
            filename: d.filename,
            summary: d.summary || undefined,
        })),
        recentSearches: recentSearches.map(r => ({
            query: r.query,
            sources: r.sources ? JSON.parse(r.sources) : [],
        })),
    };
}
function detectResearchIntent(message, history = []) {
    if (RAG_ONLY_MODE) return true; // Always search in RAG_ONLY_MODE
    const lowerMessage = message.toLowerCase().trim();
    // If no conversation history (first message), always search
    const hasHistory = history.filter(m => m.role === 'assistant').length > 0;
    if (!hasHistory) {
        return true;
    }
    // Follow-up indicators: references previous context, not a new topic
    const followUpPatterns = [
        /^(yes|no|ok|okay|sure|thanks|thank you|danke|ja|nein|genau|alles klar)/i,
        /^(can you|could you|please)\s+(explain|clarify|elaborate|simplify|summarize|translate|rephrase)/i,
        /^(what do you mean|what does that mean|i don.t understand)/i,
        /^(tell me more|go on|continue|more details|expand on|mehr details)/i,
        /^(in (simpler|other|different) (terms|words))/i,
        /^(und |also |aber |was meinst|kannst du das|erkl.r|zusammenfass)/i,
        /^(how about|what about) (that|this|it|the)/i,
        /^(why is that|why not|how so|how come|wieso|warum ist)/i,
    ];
    if (followUpPatterns.some(p => p.test(lowerMessage))) {
        console.log('[ResearchChat] Detected follow-up message, skipping search');
        return false;
    }
    // Referential language — message mostly talks about previous context
    const referentialWords = ['that', 'this', 'it', 'these', 'those', 'the above',
        'your answer', 'your response', 'you said', 'you mentioned', 'das', 'dies',
        'deine antwort', 'du hast', 'oben', 'vorher'];
    const refCount = referentialWords.filter(w => lowerMessage.includes(w)).length;
    // Strong new-topic signals — explicit legal search or new legal concepts
    const newTopicKeywords = [
        'search for', 'find me', 'look up', 'research about',
        'what is the law on', 'what are the rules for', 'what does the law say',
        'is it legal to', 'is it allowed to', 'ist es erlaubt', 'ist es legal',
        'gibt es ein gesetz', 'welches gesetz', 'under which law', 'nach welchem',
        'paragraph', '§', 'article', 'artikel',
        'gdpr', 'dsgvo', 'stvo', 'stgb', 'abgb', 'urhg', 'kfg', 'asvg',
    ];
    if (newTopicKeywords.some(kw => lowerMessage.includes(kw))) {
        console.log('[ResearchChat] Detected explicit legal query, will search');
        return true;
    }
    // Short messages (<80 chars) with referential words are almost always follow-ups
    if (lowerMessage.length < 80 && refCount >= 1) {
        console.log('[ResearchChat] Short referential message, skipping search');
        return false;
    }
    // Check if this introduces a clearly different topic from the last assistant message
    const lastAssistant = [...history].reverse().find(m => m.role === 'assistant');
    if (lastAssistant) {
        const lastTopicWords = lastAssistant.content.toLowerCase().split(/\s+/).filter(w => w.length > 5);
        const msgWords = lowerMessage.split(/\s+/).filter(w => w.length > 5);
        const overlap = msgWords.filter(w => lastTopicWords.includes(w)).length;
        const overlapRatio = msgWords.length > 0 ? overlap / msgWords.length : 0;
        // High overlap with previous response = follow-up about same topic
        if (overlapRatio > 0.3 && lowerMessage.length < 120) {
            console.log(`[ResearchChat] Topic overlap ${(overlapRatio * 100).toFixed(0)}% — follow-up, skipping search`);
            return false;
        }
    }
    // Substantive new legal questions (long + question + legal keyword)
    const legalKeywords = [
        'law', 'laws', 'legal', 'court', 'contract', 'liability',
        'negligence', 'breach', 'damages', 'employment', 'termination',
        'patent', 'trademark', 'copyright', 'tenant', 'landlord',
        'gesetz', 'recht', 'vertrag', 'haftung', 'gericht', 'klage',
        'mietrecht', 'arbeitsrecht', 'strafrecht', 'schadenersatz',
        'company', 'incorporation', 'divorce', 'custody', 'inheritance',
        'firma', 'gründung', 'scheidung', 'sorgerecht', 'erbrecht',
    ];
    const hasLegalKeyword = legalKeywords.some(kw => lowerMessage.includes(kw));
    const isQuestion = /\?$/.test(message.trim()) ||
        /^(what|who|where|when|why|how|welche|wer|wo|wann|warum|wie)\b/i.test(message);
    if (hasLegalKeyword && isQuestion && lowerMessage.length > 40) {
        console.log('[ResearchChat] New legal question detected, will search');
        return true;
    }
    // Long new question with no referential language → likely new topic
    if (isQuestion && lowerMessage.length > 80 && refCount === 0) {
        console.log('[ResearchChat] Long new question detected, will search');
        return true;
    }
    // Default: if there's history, assume follow-up (don't waste time searching)
    console.log('[ResearchChat] Defaulting to follow-up (has conversation history)');
    return false;
}

function extractSearchQuery(message) {
    let query = message
        .replace(/^(please\s+)?/i, '')
        .replace(/^(can you\s+)?/i, '')
        .replace(/^(could you\s+)?/i, '')
        .replace(/^(search for|find|look up|research)\s+/i, '')
        .replace(/^(what (is|are) (the )?)/i, '')
        .replace(/^(tell me about|explain)\s+/i, '')
        .trim();
    query = query.replace(/[?.!]+$/, '').trim();
    if (query.length > 100) {
        query = query.substring(0, 100).trim();
    }
    if (query.length < 3) {
        query = message.replace(/[?.!]+$/, '').trim();
    }
    return query;
}
// Generalized inventory block. We used to enumerate per-jurisdiction
// chunk counts here, but that list goes stale every time a new scrape
// finishes and forces a fresh deploy. Instead: tell the model HOW to
// reason about what it has, not what specifically is indexed at this
// moment. The retrieval layer is the source of truth — the model should
// trust the source list it actually receives and not pre-emptively
// refuse based on a hardcoded inventory.

function getDataInventoryBlock() {
    return [
        'CORPUS COVERAGE:',
        '• Statutes and codes are indexed for many jurisdictions worldwide. The retrieval step pulls the most relevant chunks for each query — trust what it returns.',
        '• Case law (court rulings, headnotes, dispositions) IS indexed for some jurisdictions. When the retrieval returns chunks with source_type "case_law" or sources clearly labeled as "Supreme Court", "OGH", "BGH", "Cour de Cassation", "CLR", etc., USE THEM as authoritative court rulings. Cite by full case name + reporter reference.',
        '• If retrieval returns ZERO sources of a given type (e.g. no case_law in the result list), do NOT preemptively claim "I have no case-law database for this jurisdiction." Say only: "The retrieval did not surface any case-law matching this question." That is honest and leaves room for the case to exist but be unreachable for that particular query.',
        '• Conversely: if retrieval returns case-law chunks, USE THEM. Do not paraphrase a statute when a court ruling on the same point was retrieved alongside it — the case-law is the most direct authority.',
        '• The corpus grows continuously. Never tell the user a specific jurisdiction is "not supported" — let the retrieval results speak.',
    ].join('\n');
}

function buildResearchSystemPrompt(context, jurisdiction, language, allJurisdictions) {
    const jurisdictionInfo = getJurisdictionInfo(jurisdiction);
    let prompt = `You are a legal research assistant specializing in ${jurisdictionInfo.name} law.

Jurisdiction: ${jurisdictionInfo.name} (${jurisdictionInfo.legalSystem})
Primary sources: ${jurisdictionInfo.primarySources.join(', ')}
Today: ${new Date().toISOString().split('T')[0]}

${getDataInventoryBlock()}
${getLanguageDirective(language)}
RULES:
- Cite sources by FULL NAME (e.g. "Obchodný zákonník - § 108"), NEVER by number like [1]
- NEVER invent case names, case numbers, statute sections, amounts, or dates not in provided sources
- If the retrieval step returned ZERO sources for the user's query, say so explicitly and provide only general guidance. Do NOT claim "I have no case law database" if the inventory above shows case law for this jurisdiction — instead, narrow the explanation to "no matching case for this specific question."
- Keep responses concise: summary first, then key points with citations, then practical implications
- DISTINGUISH standard vs simplified procedures: if a provision only applies to a special procedure (e.g. simplified formation, expedited process), say so explicitly. Do NOT present special-case rules as general requirements.
- SCOPE PRECISION: When citing a section, state what scope it covers (e.g. "for simplified formation under § 110a" not just "§ 110a requires..."). Never present a special provision as the default rule.
- TERMINOLOGY: Use proper legal terminology. Do not translate terms if the translation loses meaning — use the original term with an explanation in parentheses (e.g. "konateľ (managing director)").
`;
    if (allJurisdictions && allJurisdictions.length > 1) {
        const jurNames = allJurisdictions.map(j => getJurisdictionInfo(j).name).join(' and ');
        prompt += `\nCOMPARISON MODE: You are comparing across ${jurNames}. Keep each jurisdiction's rules STRICTLY SEPARATE — never apply one country's provisions to another. Structure your response by jurisdiction.\n`;
    }
    if (context.case) {
        prompt += `\nCurrent case: ${context.case.title} (${context.case.type})`;
    }
    return prompt;
}
function parseActionsFromResponse(response) {
    const actions = [];
    let text = response;
    const actionRegex = /\[ACTION:(\w+):(\{[^}]+\})\]/g;
    let match;
    while ((match = actionRegex.exec(response)) !== null) {
        try {
            const type = match[1];
            const params = JSON.parse(match[2]);
            actions.push({ type, params });
        }
        catch (e) {
            console.warn('[ResearchChat] Failed to parse action:', match[0]);
        }
    }
    text = text.replace(actionRegex, '').trim();
    return { text, actions };
}
async function executeResearchAction(action, userId, context, jurisdiction) {
    console.log(`[ResearchChat] Executing action: ${action.type}`, action.params);
    try {
        const params = action.params;
        switch (action.type) {
            case exports.RESEARCH_ACTIONS.SEARCH_LEGAL_DB:
                return await executeSearchLegalDb({ query: params.query || '', jurisdiction: params.jurisdiction, limit: params.limit }, jurisdiction);
            case exports.RESEARCH_ACTIONS.SEARCH_WEB:
                return await executeSearchWeb({ query: params.query || '' });
            case exports.RESEARCH_ACTIONS.SEARCH_VAULT:
                return await executeSearchVault(userId, { query: params.query || '', type: params.type });
            case exports.RESEARCH_ACTIONS.SEARCH_DOCUMENTS:
                return await executeSearchDocuments(userId, { query: params.query || '' });
            case exports.RESEARCH_ACTIONS.SEARCH_CASE_DATA:
                return await executeSearchCaseData(context.case, { type: params.type || 'all' });
            case exports.RESEARCH_ACTIONS.SAVE_TO_CASE:
                return await executeSaveToCase(context.case?.id, { title: params.title || '', content: params.content || '' });
            case exports.RESEARCH_ACTIONS.SAVE_TO_VAULT:
                return await executeSaveToVault(userId, { title: params.title || '', content: params.content || '', type: params.type });
            case exports.RESEARCH_ACTIONS.CREATE_CITATION:
                return executeCreateCitation({ title: params.title || '', citation: params.citation || '', date: params.date, court: params.court }, jurisdiction);
            case exports.RESEARCH_ACTIONS.SUMMARIZE_SOURCE:
                return await executeSummarizeSource({ content: params.content || '', url: params.url });
            case exports.RESEARCH_ACTIONS.DRAFT_MEMO:
                return await executeDraftMemo({ topic: params.topic || '', keyPoints: params.keyPoints || [] }, context.user.language);
            default:
                return { success: false, message: `Unknown action: ${action.type}` };
        }
    }
    catch (error) {
        console.error(`[ResearchChat] Action ${action.type} failed:`, error);
        return { success: false, message: error.message };
    }
}
async function executeSearchLegalDb(params, defaultJurisdiction) {
    const { query, jurisdiction = defaultJurisdiction, limit = 10 } = params;
    const response = await (0, legalApiService_1.searchByJurisdiction)(jurisdiction, query, { limit });
    if (!response.success && response.error) {
        return {
            success: false,
            message: `Legal database error: ${response.error.message} (${response.error.code})`,
            data: { error: response.error, jurisdiction },
        };
    }
    return {
        success: true,
        message: `Found ${response.results.length} results from ${jurisdiction} legal databases`,
        data: { results: response.results, jurisdiction },
    };
}
async function executeSearchWeb(params) {
    return {
        success: true,
        message: `Web search for: ${params.query}`,
        data: { query: params.query, note: 'Web search integration pending' },
    };
}
async function executeSearchVault(userId, params) {
    const { query, type } = params;
    const where = {
        userId,
        OR: [
            { title: { contains: query } },
            { content: { contains: query } },
        ],
    };
    if (type)
        where.type = type;
    const items = await prisma.vaultItem.findMany({
        where,
        select: { id: true, title: true, type: true, content: true, tags: true },
        take: 10,
    });
    return {
        success: true,
        message: `Found ${items.length} vault items matching "${query}"`,
        data: { results: items },
    };
}
async function executeSearchDocuments(userId, params) {
    const { query } = params;
    const documents = await prisma.document.findMany({
        where: {
            userId,
            OR: [
                { filename: { contains: query } },
                { summary: { contains: query } },
            ],
        },
        select: { id: true, filename: true, summary: true, status: true },
        take: 10,
    });
    return {
        success: true,
        message: `Found ${documents.length} documents matching "${query}"`,
        data: { results: documents },
    };
}
async function executeSearchCaseData(caseData, params) {
    if (!caseData) {
        return { success: false, message: 'No case context available' };
    }
    const { type } = params;
    if (type === 'entities') {
        return {
            success: true,
            message: `Found ${caseData.entities.length} entities in the case`,
            data: { entities: caseData.entities },
        };
    }
    else if (type === 'timeline') {
        return {
            success: true,
            message: `Found ${caseData.timeline.length} timeline events`,
            data: { timeline: caseData.timeline },
        };
    }
    else {
        return {
            success: true,
            message: `Case: ${caseData.title}`,
            data: { case: caseData },
        };
    }
}
async function executeSaveToCase(caseId, params) {
    if (!caseId) {
        return { success: false, message: 'No case context available. Save to vault instead.' };
    }
    const caseRecord = await prisma.case.findUnique({
        where: { id: caseId },
        select: { notes: true },
    });
    const existingNotes = caseRecord?.notes || '';
    const newNote = `\n\n## ${params.title}\n${params.content}\n*Added by Research Assistant on ${new Date().toLocaleDateString()}*`;
    await prisma.case.update({
        where: { id: caseId },
        data: { notes: existingNotes + newNote },
    });
    return {
        success: true,
        message: `Saved "${params.title}" to case notes`,
    };
}
async function executeSaveToVault(userId, params) {
    const { title, content, type = 'note' } = params;
    const item = await prisma.vaultItem.create({
        data: {
            userId,
            title,
            content,
            type,
            category: 'research',
        },
    });
    return {
        success: true,
        message: `Saved "${title}" to vault`,
        data: { vaultItemId: item.id },
    };
}
function executeCreateCitation(params, jurisdiction) {
    const result = {
        id: 'citation-manual',
        source: 'Manual Entry',
        jurisdiction,
        title: params.title,
        citation: params.citation,
        date: params.date || '',
        court: params.court,
        excerpt: '',
        url: '',
        relevance: 100,
    };
    const format = jurisdiction === 'US' ? 'bluebook'
        : jurisdiction === 'UK' ? 'oscola'
            : jurisdiction === 'DE' ? 'german'
                : 'default';
    const formatted = (0, legalApiService_1.formatCitation)(result, format);
    return {
        success: true,
        message: `Citation: ${formatted}`,
        data: { citation: formatted, format },
    };
}
async function executeSummarizeSource(params) {
    const { title, content } = params;
    if (!content && !params.url) {
        return { success: false, message: 'No content or URL provided to summarize' };
    }
    if (content) {
        const summary = await (0, llmAdapter_1.callLLM)([
            { role: 'system', content: 'Summarize the following legal text concisely, highlighting key points and holdings.' },
            { role: 'user', content: content.substring(0, 3000) },
        ], { taskType: 'summarize_short', maxTokens: 500, useFastModel: true });
        return {
            success: true,
            message: `Summary of "${title || 'source'}"`,
            data: { summary },
        };
    }
    return { success: false, message: 'URL fetching not yet implemented' };
}
async function executeDraftMemo(params, language) {
    const { topic, keyPoints = [] } = params;
    const prompt = `Draft a brief legal research memo on the topic: "${topic}"

${keyPoints.length > 0 ? `Key points to address:\n${keyPoints.map((p, i) => `${i + 1}. ${p}`).join('\n')}` : ''}

Format:
1. Issue
2. Brief Answer
3. Analysis
4. Conclusion

Keep it concise but thorough.`;
    const memo = await (0, llmAdapter_1.callLLM)([
        { role: 'system', content: `You are a legal research assistant drafting a memo.${getLanguageDirective(language)}` },
        { role: 'user', content: prompt },
    ], { taskType: 'research_synthesis', maxTokens: 1500 });
    return {
        success: true,
        message: 'Research memo drafted',
        data: { memo, topic },
    };
}
function getJurisdictionInfo(jurisdiction) {
    const info = {
        US: {
            name: 'United States',
            legalSystem: 'Common Law (Federal/State)',
            citationFormat: 'Bluebook (21st ed.)',
            primarySources: ['U.S. Code', 'CFR', 'State Codes', 'Federal/State Case Law'],
        },
        UK: {
            name: 'United Kingdom',
            legalSystem: 'Common Law',
            citationFormat: 'OSCOLA (4th ed.)',
            primarySources: ['UK Legislation', 'Case Law', 'Statutory Instruments'],
        },
        DE: {
            name: 'Germany',
            legalSystem: 'Civil Law (Codified)',
            citationFormat: 'German Standard (BGH style)',
            primarySources: ['BGB', 'HGB', 'StGB', 'ZPO', 'Rechtsprechung'],
        },
        AT: {
            name: 'Austria',
            legalSystem: 'Civil Law (Codified)',
            citationFormat: 'Austrian Standard',
            primarySources: ['ABGB', 'UGB', 'StGB', 'ZPO'],
        },
        SK: {
            name: 'Slovakia',
            legalSystem: 'Civil Law (Codified)',
            citationFormat: 'Slovak Standard',
            primarySources: ['Obchodný zákonník', 'Občiansky zákonník', 'Zákonník práce', 'Slov-Lex'],
        },
        CH: {
            name: 'Switzerland',
            legalSystem: 'Civil Law (Federal)',
            citationFormat: 'Swiss Standard',
            primarySources: ['OR', 'ZGB', 'StGB', 'Cantonal Law'],
        },
        EU: {
            name: 'European Union',
            legalSystem: 'Supranational',
            citationFormat: 'OSCOLA EU Citations',
            primarySources: ['EU Treaties', 'Regulations', 'Directives', 'ECJ Case Law'],
        },
        FR: {
            name: 'France',
            legalSystem: 'Civil Law (Codified)',
            citationFormat: 'French Standard',
            primarySources: ['Code civil', 'Code pénal', 'Code de commerce', 'Jurisprudence'],
        },
        CA: {
            name: 'Canada',
            legalSystem: 'Common Law (except Quebec)',
            citationFormat: 'McGill Guide',
            primarySources: ['Federal Statutes', 'Provincial Statutes', 'Case Law'],
        },
        AU: {
            name: 'Australia',
            legalSystem: 'Common Law (Federal/State)',
            citationFormat: 'AGLC (4th ed.)',
            primarySources: ['Commonwealth Legislation', 'State Legislation', 'Case Law'],
        },
    };
    return info[jurisdiction.toUpperCase()] || {
        name: jurisdiction,
        legalSystem: 'Unknown',
        citationFormat: 'Standard',
        primarySources: ['Case Law', 'Legislation'],
    };
}
async function getConversations(userId, options = {}) {
    const { caseId, limit = 20 } = options;
    const where = { userId };
    if (caseId)
        where.caseId = caseId;
    const conversations = await prisma.researchConversation.findMany({
        where,
        select: {
            id: true,
            title: true,
            caseId: true,
            jurisdiction: true,
            createdAt: true,
            updatedAt: true,
            _count: { select: { messages: true } },
        },
        orderBy: { updatedAt: 'desc' },
        take: limit,
    });
    return conversations.map(c => ({
        id: c.id,
        title: c.title,
        caseId: c.caseId,
        jurisdiction: c.jurisdiction,
        messageCount: c._count.messages,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
    }));
}
async function getConversation(conversationId, userId) {
    const conversation = await prisma.researchConversation.findFirst({
        where: { id: conversationId, userId },
    });
    if (!conversation)
        return null;
    // Use raw SQL to include verification column (not in Prisma schema)
    const messages = await prisma.$queryRaw`
        SELECT id, conversationId, role, content, sources, verification, createdAt
        FROM research_messages
        WHERE conversationId = ${conversationId}
        ORDER BY createdAt ASC`;
    return {
        id: conversation.id,
        title: conversation.title,
        caseId: conversation.caseId,
        jurisdiction: conversation.jurisdiction,
        messages: messages.map(m => ({
            id: m.id,
            role: m.role,
            content: m.content,
            sources: m.sources ? JSON.parse(m.sources) : [],
            verification: m.verification ? JSON.parse(m.verification) : undefined,
            createdAt: m.createdAt,
        })),
    };
}
async function deleteConversation(conversationId, userId) {
    const result = await prisma.researchConversation.deleteMany({
        where: { id: conversationId, userId },
    });
    return result.count > 0;
}
//# sourceMappingURL=researchChatService.js.map