"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OFFICIAL_DATABASES = exports.JURISDICTION_INFO = exports.RESEARCH_ACTIONS = void 0;
exports.chat = chat;
exports.chatStream = chatStream;
exports.getConversations = getConversations;
exports.getConversation = getConversation;
exports.deleteConversation = deleteConversation;
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
function extractClaimsFromResponse(response) {
    const claims = [];
    const sentences = response.split(/[.!?]+/).filter(s => s.trim().length > 20);
    for (const sentence of sentences) {
        const trimmed = sentence.trim();
        const hasNumber = /\d+/.test(trimmed);
        const hasLegalRef = /§|Article|Section|Artikel|Abschnitt/i.test(trimmed);
        const hasDefinitive = /\b(must|shall|requires?|minimum|maximum|mandatory|prohibited|at least|no more than|within)\b/i.test(trimmed);
        if (hasNumber || hasLegalRef || hasDefinitive) {
            const sourceMatch = trimmed.match(/(?:according to|under|per|as per|pursuant to)\s+([^,]+)/i);
            claims.push({
                claim: trimmed,
                sourceRef: sourceMatch?.[1]?.trim(),
                context: trimmed.substring(0, 100),
            });
        }
    }
    return claims.slice(0, 5);
}
async function verifyClaimsAgainstSources(claims, sources, auditContext) {
    if (claims.length === 0 || sources.length === 0) {
        return { verified: 0, total: 0, confidence: 'unverified' };
    }
    const nliReady = await (0, clauseNLIService_1.isNLIAvailable)();
    if (!nliReady) {
        console.log('[ResearchChat] NLI service not available, skipping verification');
        return { verified: 0, total: claims.length, confidence: 'unverified' };
    }
    let verified = 0;
    let highConfidenceCount = 0;
    for (const claim of claims) {
        let bestSource = sources[0];
        if (claim.sourceRef) {
            const matchingSource = sources.find(s => (s.title || s.source || '').toLowerCase().includes(claim.sourceRef.toLowerCase()));
            if (matchingSource)
                bestSource = matchingSource;
        }
        const sourceText = bestSource.excerpt || bestSource.content || '';
        if (sourceText.length < 50)
            continue;
        const startTime = Date.now();
        const result = await (0, clauseNLIService_1.verifyEntailment)(sourceText.substring(0, 1000), claim.claim, { auditContext });
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
            if (result.confidence >= 0.8)
                highConfidenceCount++;
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
    return { verified, total: claims.length, confidence };
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
    const { conversationId, caseId, jurisdictionOverride, jurisdictions = [] } = options;
    const auditContext = new aiAuditService_1.AIAuditContext(userId, 'research_chat', message);
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
    const history = conversation.messages.map(m => ({
        role: m.role,
        content: m.content,
    }));
    const systemPrompt = buildResearchSystemPrompt(context, jurisdiction, context.user.language);
    const actionResults = [];
    const sources = [];
    if (jurisdictionWarning) {
        actionResults.push({
            success: true,
            message: jurisdictionWarning,
            data: { type: 'jurisdiction_detection', jurisdiction },
        });
    }
    const isResearchQuery = detectResearchIntent(message);
    if (isResearchQuery) {
        const effectiveJurisdictions = jurisdictions.length > 0 ? jurisdictions : [jurisdiction];
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
        console.log(`[ResearchChat] Auto-searching for: "${message.substring(0, 50)}..." (RAG_ONLY_MODE: ${RAG_ONLY_MODE}, jurisdictions: ${effectiveJurisdictions.join(',')}, conflict: ${conflictCheck.hasConflict})`);
        const searchQuery = extractSearchQuery(message);
        const sourceTypes = ['legislation', 'case_law', 'jurisdiction_kb'];
        try {
            if (isMultiJurisdiction) {
                console.log(`[ResearchChat] Multi-jurisdiction search across: ${effectiveJurisdictions.join(', ')}`);
                const multiResults = await (0, rag_1.searchMultiJurisdiction)(searchQuery, effectiveJurisdictions, {
                    sourceTypes,
                    limit: 8,
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
                            excerpt: r.content.substring(0, 400),
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
                const ragResults = await (0, rag_1.enhancedSearch)(searchQuery, {
                    sourceTypes,
                    jurisdiction,
                    limit: 10,
                });
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
                if (ragResults.length > 0) {
                    const ragAsSources = ragResults.map((r, index) => ({
                        id: r.chunkId || r.id,
                        source: `Local ${jurisdiction} Database`,
                        jurisdiction: r.jurisdiction || jurisdiction,
                        title: r.sourceName || 'Unknown',
                        citation: r.clauseType ? `[${r.clauseType}]` : '',
                        date: '',
                        excerpt: r.content.substring(0, 400),
                        url: '',
                        relevance: Math.max(70, 95 - index * 3),
                    }));
                    sources.push(...ragAsSources);
                    actionResults.push({
                        success: true,
                        message: `Found ${ragResults.length} verified results from local ${jurisdiction} legal database`,
                        data: { results: ragAsSources },
                    });
                    console.log(`[ResearchChat] Found ${ragResults.length} local RAG results`);
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
        const formattedSources = sources.slice(0, 8).map((s) => {
            const sourceName = s.title || 'Unknown Source';
            const excerpt = s.excerpt ? s.excerpt.substring(0, 800).replace(/\s+/g, ' ').trim() : '';
            return `SOURCE: ${sourceName}\n${excerpt}`;
        }).join('\n\n---\n\n');
        searchContext = `\n\n## Verified Legal Sources\n\n${formattedSources}\n\n---\n## GROUNDING RULES (MANDATORY):\n1. **Citation format**: ALWAYS cite by FULL SOURCE NAME (e.g., "Obchodný zákonník - § 108"), NEVER by number like [1]\n2. **Numbers are SACRED**: Any specific number you cite (amounts, percentages, minimums, deadlines) MUST appear EXACTLY in the source text above\n   - If source says "5 000 eur" → write "5,000 EUR", NOT "10,000 EUR"\n   - If source says "50 spoločníkov" → write "50 shareholders", NOT "100 shareholders"\n   - If you cannot find a specific number in the sources, say "the law specifies" without inventing a number\n3. **When uncertain about a number**: Say "according to [Source Name], the minimum is..." and quote directly\n4. **NEVER invent**: case names, case numbers, statute sections, amounts, dates, or any specific legal detail not in sources`;
    }
    else if (isResearchQuery) {
        searchContext = `\n\n## Search Results\n🚫 **ZERO VERIFIED SOURCES FOUND** 🚫\n\nThe legal database search returned ZERO results. This means you have NO authoritative sources to cite.\n\n⛔ STRICT RULES FOR THIS RESPONSE:\n1. START your response with: "I could not find verified sources in our database for this query."\n2. NEVER invent or guess:\n   - Case names (like "Smith v. Jones" or "Rozhodnutie NS SR")\n   - Case numbers (like "1 Cdo 123/2024" or "84 O 249/18")\n   - Statute citations (like "§ 123 Obč. zák." or "§ 47 ZP")\n   - Court names with decisions\n   - ANY specific legal citations\n   - ANY specific numbers (amounts, minimums, percentages, deadlines)\n3. You may ONLY provide:\n   - General conceptual explanations (without citations or specific numbers)\n   - Recommendations to check official databases:\n     * Slovakia: slov-lex.sk (legislation), nsud.sk (Supreme Court)\n     * Austria: ris.bka.gv.at (RIS database)\n     * EU: eur-lex.europa.eu\n4. If you're unsure, say "I don't have verified information on this"\n\n⚠️ VIOLATION OF THESE RULES IS STRICTLY PROHIBITED. Making up legal citations or numbers is harmful to users.`;
    }
    history.push({ role: 'user', content: message + searchContext });
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
    const { sanitizedResponse, warnings } = validateAndSanitizeResponse(responseText, sources, hadSourcesBeforeSearch);
    if (warnings.length > 0) {
        console.warn('[ResearchChat] Citation validation warnings:', warnings);
    }
    const cleanedResponse = (0, outputSanitizer_1.sanitizeOutput)(sanitizedResponse);
    const cleanedSources = (0, outputSanitizer_1.sanitizeSources)(sources);
    const finalResponse = cleanedResponse;
    await prisma.researchMessage.create({
        data: {
            conversationId: conversation.id,
            role: 'user',
            content: message,
        },
    });
    await prisma.researchMessage.create({
        data: {
            conversationId: conversation.id,
            role: 'assistant',
            content: finalResponse,
            sources: cleanedSources.length > 0 ? JSON.stringify(cleanedSources) : null,
            actions: actionResults.length > 0 ? JSON.stringify(actionResults) : null,
        },
    });
    await prisma.researchConversation.update({
        where: { id: conversation.id },
        data: { updatedAt: new Date() },
    });
    try {
        const claims = extractClaimsFromResponse(finalResponse);
        if (claims.length > 0 && cleanedSources.length > 0) {
            console.log(`[ResearchChat] Verifying ${claims.length} claims against ${cleanedSources.length} sources`);
            const verification = await verifyClaimsAgainstSources(claims, cleanedSources, auditContext);
            console.log(`[ResearchChat] NLI verification: ${verification.verified}/${verification.total} claims verified (${verification.confidence})`);
        }
    }
    catch (nliError) {
        console.warn('[ResearchChat] NLI verification failed:', nliError);
    }
    try {
        auditContext.setConversation(conversation.id);
        auditContext.setResponse(finalResponse, cleanedSources.map(s => ({
            id: s.id || '',
            sourceName: s.title || s.source || 'Unknown',
            citation: s.citation,
            excerpt: s.excerpt?.substring(0, 200),
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
async function* chatStream(userId, message, options = {}) {
    const { conversationId, caseId, jurisdictionOverride, jurisdictions = [] } = options;
    const auditContext = new aiAuditService_1.AIAuditContext(userId, 'research_chat', message);
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
    const history = conversation.messages.map(m => ({
        role: m.role,
        content: m.content,
    }));
    const actionResults = [];
    const sources = [];
    if (jurisdictionWarning) {
        yield { type: 'status', data: { step: 'jurisdiction_note', message: jurisdictionWarning } };
        actionResults.push({
            success: true,
            message: jurisdictionWarning,
            data: { type: 'jurisdiction_detection', jurisdiction },
        });
    }
    const isResearchQuery = detectResearchIntent(message);
    if (isResearchQuery) {
        const effectiveJurisdictions = jurisdictions.length > 0 ? jurisdictions : [jurisdiction];
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
        const searchQuery = extractSearchQuery(message);
        const sourceTypes = ['legislation', 'case_law', 'jurisdiction_kb'];
        try {
            if (isMultiJurisdiction) {
                console.log(`[ResearchChat Stream] Multi-jurisdiction search across: ${effectiveJurisdictions.join(', ')} (conflict detected: ${conflictCheck.hasConflict})`);
                const multiResults = await (0, rag_1.searchMultiJurisdiction)(searchQuery, effectiveJurisdictions, {
                    sourceTypes,
                    limit: 8,
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
                            excerpt: r.content.substring(0, 400),
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
                const ragResults = await (0, rag_1.enhancedSearch)(searchQuery, {
                    sourceTypes,
                    jurisdiction,
                    limit: 10,
                });
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
                if (ragResults.length > 0) {
                    const ragAsSources = ragResults.map((r, index) => ({
                        id: r.chunkId || r.id,
                        source: `Local ${jurisdiction} Database`,
                        jurisdiction: r.jurisdiction || jurisdiction,
                        title: r.sourceName || 'Unknown',
                        citation: r.clauseType ? `[${r.clauseType}]` : '',
                        date: '',
                        excerpt: r.content.substring(0, 400),
                        url: '',
                        relevance: Math.max(70, 95 - index * 3),
                    }));
                    sources.push(...ragAsSources);
                    actionResults.push({
                        success: true,
                        message: `Found ${ragResults.length} verified results from ${jurisdiction} legal database`,
                        data: { results: ragAsSources },
                    });
                    yield { type: 'sources', data: { sources: ragAsSources, jurisdiction } };
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
    yield { type: 'status', data: { step: 'thinking', message: 'Analyzing and formulating response...' } };
    yield { type: 'thinking', data: { active: true } };
    const systemPrompt = buildResearchSystemPrompt(context, jurisdiction, context.user.language);
    let searchContext = '';
    if (sources.length > 0) {
        const formattedSources = sources.slice(0, 8).map((s) => {
            const sourceName = s.title || 'Unknown Source';
            const excerpt = s.excerpt ? s.excerpt.substring(0, 800).replace(/\s+/g, ' ').trim() : '';
            return `SOURCE: ${sourceName}\n${excerpt}`;
        }).join('\n\n---\n\n');
        searchContext = `\n\n## Verified Legal Sources\n\n${formattedSources}\n\n---\n## GROUNDING RULES (MANDATORY):\n1. **Citation format**: ALWAYS cite by FULL SOURCE NAME (e.g., "Obchodný zákonník - § 108"), NEVER by number like [1]\n2. **Numbers are SACRED**: Any specific number you cite (amounts, percentages, minimums, deadlines) MUST appear EXACTLY in the source text above\n   - If source says "5 000 eur" → write "5,000 EUR", NOT "10,000 EUR"\n   - If source says "50 spoločníkov" → write "50 shareholders", NOT "100 shareholders"\n   - If you cannot find a specific number in the sources, say "the law specifies" without inventing a number\n3. **When uncertain about a number**: Say "according to [Source Name], the minimum is..." and quote directly\n4. **NEVER invent**: case names, case numbers, statute sections, amounts, dates, or any specific legal detail not in sources`;
    }
    else if (isResearchQuery) {
        searchContext = `\n\n## Search Results\n🚫 **ZERO VERIFIED SOURCES FOUND** 🚫\n\nThe legal database search returned ZERO results. This means you have NO authoritative sources to cite.\n\n⛔ STRICT RULES FOR THIS RESPONSE:\n1. START your response with: "I could not find verified sources in our database for this query."\n2. NEVER invent or guess:\n   - Case names (like "Smith v. Jones" or "Rozhodnutie NS SR")\n   - Case numbers (like "1 Cdo 123/2024" or "84 O 249/18")\n   - Statute citations (like "§ 123 Obč. zák." or "§ 47 ZP")\n   - Court names with decisions\n   - ANY specific legal citations\n   - ANY specific numbers (amounts, minimums, percentages, deadlines)\n3. You may ONLY provide:\n   - General conceptual explanations (without citations or specific numbers)\n   - Recommendations to check official databases:\n     * Slovakia: slov-lex.sk (legislation), nsud.sk (Supreme Court)\n     * Austria: ris.bka.gv.at (RIS database)\n     * EU: eur-lex.europa.eu\n4. If you're unsure, say "I don't have verified information on this"\n\n⚠️ VIOLATION OF THESE RULES IS STRICTLY PROHIBITED. Making up legal citations or numbers is harmful to users.`;
    }
    history.push({ role: 'user', content: message + searchContext });
    yield { type: 'status', data: { step: 'responding', message: 'Generating response...' } };
    let fullResponse = '';
    const llmMessages = [{ role: 'system', content: systemPrompt }, ...history];
    for await (const token of (0, llmAdapter_1.callLLMStream)(llmMessages, { taskType: 'legal_research', maxTokens: 1500, useFastModel: false })) {
        fullResponse += token;
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
    yield { type: 'status', data: { step: 'validating', message: 'Verifying citations...' } };
    const hadSourcesBeforeSearch = sources.length > 0;
    const { sanitizedResponse, warnings } = validateAndSanitizeResponse(responseText, sources, hadSourcesBeforeSearch);
    if (warnings.length > 0) {
        console.warn('[ResearchChat] Citation validation warnings:', warnings);
    }
    const finalResponse = sanitizedResponse;
    yield { type: 'status', data: { step: 'responding', message: 'Generating response...' } };
    yield { type: 'content', data: { content: finalResponse } };
    yield { type: 'status', data: { step: 'saving', message: 'Saving conversation...' } };
    await prisma.researchMessage.create({
        data: {
            conversationId: conversation.id,
            role: 'user',
            content: message,
        },
    });
    await prisma.researchMessage.create({
        data: {
            conversationId: conversation.id,
            role: 'assistant',
            content: finalResponse,
            sources: sources.length > 0 ? JSON.stringify(sources) : null,
            actions: actionResults.length > 0 ? JSON.stringify(actionResults) : null,
        },
    });
    await prisma.researchConversation.update({
        where: { id: conversation.id },
        data: { updatedAt: new Date() },
    });
    try {
        const claims = extractClaimsFromResponse(finalResponse);
        if (claims.length > 0 && sources.length > 0) {
            console.log(`[ResearchChat/Stream] Verifying ${claims.length} claims against ${sources.length} sources`);
            const verification = await verifyClaimsAgainstSources(claims, sources, auditContext);
            console.log(`[ResearchChat/Stream] NLI verification: ${verification.verified}/${verification.total} claims verified (${verification.confidence})`);
        }
    }
    catch (nliError) {
        console.warn('[ResearchChat/Stream] NLI verification failed:', nliError);
    }
    try {
        auditContext.setConversation(conversation.id);
        auditContext.setJurisdiction(jurisdiction, jurisdictionOverride ? 'user_selected' : 'auto_detected');
        auditContext.setResponse(finalResponse, sources.map(s => ({
            id: s.id || '',
            sourceName: s.title || s.source || 'Unknown',
            citation: s.citation,
            excerpt: s.excerpt?.substring(0, 200),
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
function detectResearchIntent(message) {
    const lowerMessage = message.toLowerCase();
    const researchKeywords = [
        'search', 'find', 'look up', 'research', 'case', 'cases',
        'precedent', 'precedents', 'ruling', 'rulings', 'decision', 'decisions',
        'statute', 'statutes', 'law', 'laws', 'regulation', 'regulations',
        'legal', 'court', 'judge', 'judgment', 'judgement',
        'contract', 'liability', 'negligence', 'breach', 'damages',
        'what is', 'what are', 'how does', 'explain', 'define',
        'gdpr', 'dsgvo', 'employment', 'termination', 'dismissal',
        'intellectual property', 'patent', 'trademark', 'copyright',
    ];
    const hasResearchKeyword = researchKeywords.some(kw => lowerMessage.includes(kw));
    const isQuestion = /\?$/.test(message.trim()) ||
        /^(what|who|where|when|why|how|is|are|can|could|does|do|should|would)\b/i.test(message);
    return hasResearchKeyword || isQuestion;
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
function buildResearchSystemPrompt(context, jurisdiction, language) {
    const { systemPrompt: basePrompt } = (0, aiContext_1.buildChatContext)({
        language,
        jurisdiction,
        userType: 'professional',
    });
    const jurisdictionInfo = getJurisdictionInfo(jurisdiction);
    let prompt = `${basePrompt}

You are a legal research assistant with access to legal databases, web search, and the user's personal legal documents.

## Your Jurisdiction
You are researching under **${jurisdictionInfo.name}** law.
- Legal System: ${jurisdictionInfo.legalSystem}
- Citation Format: ${jurisdictionInfo.citationFormat}
- Primary Sources: ${jurisdictionInfo.primarySources.join(', ')}

## Your Capabilities
You have access to powerful research tools. Use actions to search, analyze, and save findings.

### Available Actions
Use these action tags in your response when you need to perform operations:

1. **Search Legal Databases**
   \`[ACTION:search_legal_db:{"query":"contract breach", "jurisdiction":"${jurisdiction}", "limit":10}]\`
   Searches case law and legislation in the user's jurisdiction.

2. **Search Web**
   \`[ACTION:search_web:{"query":"recent changes to GDPR enforcement"}]\`
   Searches the web for legal news, articles, and general information.

3. **Search User's Vault**
   \`[ACTION:search_vault:{"query":"employment agreement", "type":"clause"}]\`
   Searches the user's saved clauses, templates, and notes.

4. **Search User's Documents**
   \`[ACTION:search_documents:{"query":"liability clause"}]\`
   Searches the user's uploaded documents.

5. **Search Case Data**
   \`[ACTION:search_case_data:{"type":"entities"}]\`
   Gets entities, timeline, or notes from the current case.

6. **Save to Case**
   \`[ACTION:save_to_case:{"title":"Key Precedent", "content":"Found relevant case..."}]\`
   Saves a finding to the current case notes.

7. **Save to Vault**
   \`[ACTION:save_to_vault:{"title":"Useful Citation", "content":"...", "type":"note"}]\`
   Saves content to the user's vault.

8. **Create Citation**
   \`[ACTION:create_citation:{"title":"Smith v. Jones", "citation":"123 F.3d 456", "date":"2023-01-15", "court":"9th Cir."}]\`
   Generates a properly formatted citation.

9. **Summarize Source**
   \`[ACTION:summarize_source:{"url":"https://...", "title":"Case Name"}]\`
   Summarizes a legal source.

10. **Draft Research Memo**
    \`[ACTION:draft_memo:{"topic":"Breach of contract damages", "keyPoints":["point1","point2"]}]\`
    Creates a research memo draft.

## User's Context
`;
    if (context.case) {
        prompt += `
### Current Case
- **Title**: ${context.case.title}
- **Type**: ${context.case.type}
- **Key Entities**: ${context.case.entities.slice(0, 5).map(e => `${e.name} (${e.type})`).join(', ') || 'None'}
`;
    }
    if (context.vault.length > 0) {
        const vaultByType = {};
        context.vault.forEach(v => {
            vaultByType[v.type] = (vaultByType[v.type] || 0) + 1;
        });
        prompt += `
### User's Vault
${Object.entries(vaultByType).map(([type, count]) => `- ${count} ${type}(s)`).join('\n')}
`;
    }
    if (context.documents.length > 0) {
        prompt += `
### User's Documents
${context.documents.slice(0, 5).map(d => `- ${d.filename}`).join('\n')}
`;
    }
    prompt += `
## Current Date
Today is ${new Date().toISOString().split('T')[0]}. NEVER use dates in the future.

## MANDATORY CITATION RULES
**THESE RULES ARE NON-NEGOTIABLE:**

1. **Every legal claim MUST cite sources:**
   - ALWAYS cite by the FULL SOURCE NAME, never by number
   - Format: "According to [Source Name]..." or "As stated in [Source Name]..."
   - Example: "According to Obchodný zákonník - § 57..." NOT "[1]"

2. **If sources were found:**
   - Cite them by their FULL NAME from the Sources section
   - Reference specific passages when possible
   - Format: "According to [Law Name - Section]..."

3. **If NO sources were found:**
   - Explicitly state: "I could not find verified sources for this topic"
   - Do NOT make up case names, citations, or statute numbers
   - Provide only GENERAL conceptual guidance
   - Recommend the user verify with official databases (see below)

4. **NEVER invent or fabricate:**
   - Case names (e.g., "Smith v. Jones")
   - Case numbers or citations of any format
   - Statute paragraph numbers (§) unless from Search Results
   - Court names, decision dates, or legal provisions
   - URLs to legal databases

5. **Recommend official databases for verification:**
${getOfficialDatabaseRecommendations(jurisdiction)}

## CRITICAL: Anti-Hallucination Rules
**Check the Search Results section:**
- If "NO SOURCES FOUND" → You have ZERO verified sources
- You may ONLY cite sources that appear in Search Results
- If zero sources, provide general guidance only

**Date rules:**
- Current year is ${new Date().getFullYear()}
- NEVER cite future dates

## Guidelines
1. Always cite your sources when providing legal information
2. Use ${jurisdictionInfo.citationFormat} format for citations
3. Search legal databases when asked about case law or statutes
4. Search the user's vault/documents when they reference their own materials
5. Be thorough but concise in your research
6. Acknowledge limitations - if something is outside your jurisdiction, say so
7. For complex questions, break down your research into steps
8. **If search results are empty, admit it - do not fabricate sources**
9. **Always recommend users verify findings with official sources**

## Response Format
Structure your responses clearly and professionally:

### For Research Answers:
1. **Summary** (1-2 sentences): Start with a direct answer to the question
2. **Key Points**: Use bullet points for the main findings
3. **Legal Basis**: Cite sources by their FULL NAME (e.g., "According to Obchodný zákonník § 57...")
4. **Practical Implications**: If relevant, explain what this means in practice
5. **Verification Note**: Recommend checking official databases

### Formatting Rules:
- Use **bold** for key terms and case names
- Use numbered lists for sequential steps or ranked items
- Use bullet points for unordered lists
- Keep paragraphs short (2-3 sentences max)
- Use headings (##, ###) to separate major sections
- Put legal citations in a consistent format

### Source Citations:
- ALWAYS cite by the FULL SOURCE NAME, never by number
- Use format: "According to [Source Name]..."
- NEVER cite sources not in the Verified Legal Sources section
- If no sources found, explicitly state: "No verified sources found for this query"

### Example Good Response:
\`\`\`
## Summary
Under Austrian law, employment contracts can be terminated with specific notice periods.

## Key Points
- **Notice Period**: Minimum 6 weeks for white-collar employees (Angestelltengesetz § 20)
- **Form Requirement**: Written notice recommended but oral is valid (Angestelltengesetz § 20)
- **Special Protection**: Pregnant employees have enhanced protection (MSchG)

## Legal Basis
According to Angestelltengesetz - § 20, the notice period depends on years of service...

## Recommendation
Verify these requirements on [RIS](https://www.ris.bka.gv.at).
\`\`\`
`;
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
        { role: 'system', content: `You are a legal research assistant drafting a memo. ${language !== 'en' ? `Respond in the user's language (${language}).` : ''}` },
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
        updatedAt: c.updatedAt,
    }));
}
async function getConversation(conversationId, userId) {
    const conversation = await prisma.researchConversation.findFirst({
        where: { id: conversationId, userId },
        include: {
            messages: { orderBy: { createdAt: 'asc' } },
        },
    });
    if (!conversation)
        return null;
    return {
        id: conversation.id,
        title: conversation.title,
        caseId: conversation.caseId,
        jurisdiction: conversation.jurisdiction,
        messages: conversation.messages.map(m => ({
            id: m.id,
            role: m.role,
            content: m.content,
            sources: m.sources ? JSON.parse(m.sources) : [],
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