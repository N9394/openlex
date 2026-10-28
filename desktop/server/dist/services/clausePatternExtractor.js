"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractClauses = extractClauses;
exports.extractAndStoreFromDocument = extractAndStoreFromDocument;
exports.batchExtractFromDocuments = batchExtractFromDocuments;
exports.getSupportedClauseTypes = getSupportedClauseTypes;
exports.getClauseTypeInfo = getClauseTypeInfo;
exports.extractAndValidateClauses = extractAndValidateClauses;
exports.analyzeDocumentCompliance = analyzeDocumentCompliance;
const client_1 = require("@prisma/client");
const firmMemoryService_1 = require("./firmMemoryService");
const clauseStatuteValidator_1 = require("./clauseStatuteValidator");
const mandatoryTerms_1 = require("../data/mandatoryTerms");
const prisma = new client_1.PrismaClient();
const CLAUSE_PATTERNS = [
    {
        type: 'share_capital',
        subtypes: ['minimum', 'contribution', 'increase', 'reduction'],
        indicators: [
            /share capital/i,
            /stammkapital/i,
            /základn[ée]\s+imanie/i,
            /authorized capital/i,
            /registered capital/i,
            /capital contribution/i,
            /vklad\s+spoločn[ií]ka/i,
            /\d{1,3}[,.\s]?\d{3}\s*(?:EUR|eur|€)/i,
        ],
        headerPatterns: [
            /share capital/i,
            /capital/i,
            /stammkapital/i,
            /základn[ée]\s+imanie/i,
            /contributions?/i,
            /vklady/i,
        ],
        minLength: 30,
        maxLength: 1500,
    },
    {
        type: 'termination',
        subtypes: ['for_cause', 'for_convenience', 'mutual', 'automatic'],
        indicators: [
            /terminat(e|ion|ing)/i,
            /end(ing)? (of|the) (agreement|contract)/i,
            /cancel(lation)?/i,
            /expir(e|ation|y)/i,
        ],
        headerPatterns: [
            /termination/i,
            /term and termination/i,
            /cancellation/i,
            /ending the agreement/i,
        ],
        minLength: 50,
        maxLength: 2000,
    },
    {
        type: 'confidentiality',
        subtypes: ['definition', 'obligations', 'exceptions', 'duration'],
        indicators: [
            /confidential(ity)?/i,
            /non-disclosure/i,
            /proprietary information/i,
            /trade secret/i,
            /shall not disclose/i,
        ],
        headerPatterns: [
            /confidential(ity)?/i,
            /non-disclosure/i,
            /proprietary information/i,
            /secrecy/i,
        ],
        minLength: 100,
        maxLength: 3000,
    },
    {
        type: 'indemnification',
        subtypes: ['general', 'ip', 'third_party', 'mutual'],
        indicators: [
            /indemnif(y|ication)/i,
            /hold harmless/i,
            /defend and indemnify/i,
            /losses and damages/i,
        ],
        headerPatterns: [
            /indemnif(y|ication)/i,
            /hold harmless/i,
            /defense and indemnity/i,
        ],
        minLength: 100,
        maxLength: 2500,
    },
    {
        type: 'limitation_of_liability',
        subtypes: ['cap', 'exclusions', 'consequential'],
        indicators: [
            /limit(ation)? of liability/i,
            /in no event shall/i,
            /maximum liability/i,
            /aggregate liability/i,
            /consequential damages/i,
            /indirect damages/i,
        ],
        headerPatterns: [
            /limit(ation)? of liability/i,
            /liability cap/i,
            /exclusion of damages/i,
        ],
        minLength: 50,
        maxLength: 1500,
    },
    {
        type: 'payment',
        subtypes: ['terms', 'late_fees', 'currency', 'taxes'],
        indicators: [
            /payment (terms|schedule|due)/i,
            /invoice/i,
            /net \d+ days/i,
            /within \d+ days/i,
            /late (payment|fee)/i,
        ],
        headerPatterns: [
            /payment/i,
            /fees and payment/i,
            /compensation/i,
            /pricing/i,
        ],
        minLength: 50,
        maxLength: 1500,
    },
    {
        type: 'intellectual_property',
        subtypes: ['ownership', 'license', 'assignment', 'background_ip'],
        indicators: [
            /intellectual property/i,
            /copyright/i,
            /patent/i,
            /trademark/i,
            /ownership of/i,
            /license grant/i,
            /work( |-)?for( |-)?hire/i,
        ],
        headerPatterns: [
            /intellectual property/i,
            /ip rights/i,
            /ownership/i,
            /license/i,
        ],
        minLength: 100,
        maxLength: 2500,
    },
    {
        type: 'warranty',
        subtypes: ['express', 'implied', 'disclaimer', 'remedies'],
        indicators: [
            /warrant(y|ies)/i,
            /as is/i,
            /merchantability/i,
            /fitness for a particular purpose/i,
            /disclaim/i,
        ],
        headerPatterns: [
            /warrant(y|ies)/i,
            /representations and warranties/i,
            /disclaimer/i,
        ],
        minLength: 50,
        maxLength: 2000,
    },
    {
        type: 'governing_law',
        subtypes: ['jurisdiction', 'venue', 'dispute_resolution'],
        indicators: [
            /govern(ing|ed by) (the )?law/i,
            /jurisdiction/i,
            /venue/i,
            /laws of (the )?state/i,
            /dispute resolution/i,
            /arbitration/i,
        ],
        headerPatterns: [
            /governing law/i,
            /jurisdiction/i,
            /dispute resolution/i,
            /applicable law/i,
        ],
        minLength: 30,
        maxLength: 1000,
    },
    {
        type: 'force_majeure',
        subtypes: [],
        indicators: [
            /force majeure/i,
            /act of god/i,
            /beyond .{0,20} control/i,
            /unforeseeable circumstances/i,
        ],
        headerPatterns: [
            /force majeure/i,
            /excusable delay/i,
            /events beyond control/i,
        ],
        minLength: 50,
        maxLength: 1500,
    },
    {
        type: 'assignment',
        subtypes: ['prohibition', 'consent', 'successor'],
        indicators: [
            /assign(ment)?/i,
            /transfer (of )?(rights|obligations)/i,
            /successor/i,
            /binding upon/i,
        ],
        headerPatterns: [
            /assignment/i,
            /transfer/i,
            /successors and assigns/i,
        ],
        minLength: 30,
        maxLength: 800,
    },
    {
        type: 'notice',
        subtypes: ['method', 'address', 'timing'],
        indicators: [
            /notice(s)? (shall|will|must) be/i,
            /written notice/i,
            /notify in writing/i,
            /deemed (to be )?(given|received)/i,
        ],
        headerPatterns: [
            /notice(s)?/i,
            /communications/i,
        ],
        minLength: 50,
        maxLength: 1000,
    },
    {
        type: 'entire_agreement',
        subtypes: [],
        indicators: [
            /entire agreement/i,
            /complete agreement/i,
            /supersede(s)? all (prior|previous)/i,
            /integration clause/i,
            /merger clause/i,
        ],
        headerPatterns: [
            /entire agreement/i,
            /integration/i,
            /complete agreement/i,
        ],
        minLength: 30,
        maxLength: 500,
    },
    {
        type: 'severability',
        subtypes: [],
        indicators: [
            /severab(le|ility)/i,
            /invalid(ity)?.*remain in (full )?force/i,
            /unenforceable.*remaining provisions/i,
        ],
        headerPatterns: [
            /severability/i,
            /partial invalidity/i,
        ],
        minLength: 30,
        maxLength: 500,
    },
];
function extractClauses(text) {
    const clauses = [];
    const normalizedText = normalizeText(text);
    const sections = splitIntoSections(normalizedText);
    for (const section of sections) {
        for (const pattern of CLAUSE_PATTERNS) {
            const match = matchClausePattern(section.text, pattern);
            if (match) {
                clauses.push({
                    type: pattern.type,
                    subtype: match.subtype,
                    text: section.text.trim(),
                    startIndex: section.startIndex,
                    endIndex: section.endIndex,
                    confidence: match.confidence,
                    indicators: match.matchedIndicators,
                });
            }
        }
    }
    return deduplicateClauses(clauses);
}
async function extractAndStoreFromDocument(organizationId, documentId) {
    const document = await prisma.document.findUnique({
        where: { id: documentId },
        select: {
            id: true,
            extractedText: true,
            filename: true,
        },
    });
    if (!document || !document.extractedText) {
        return {
            documentId,
            clauses: [],
            documentType: null,
            extractedAt: new Date(),
        };
    }
    const clauses = extractClauses(document.extractedText);
    for (const clause of clauses) {
        if (clause.confidence >= 0.5) {
            await (0, firmMemoryService_1.addClauseExample)(organizationId, documentId, clause.type, clause.text, true, clause.confidence);
            const existingPref = await (0, firmMemoryService_1.getClausePreference)(organizationId, clause.type, clause.subtype);
            if (!existingPref || existingPref.exampleCount < 10) {
                await (0, firmMemoryService_1.upsertClausePreference)(organizationId, clause.type, clause.text, {
                    clauseSubtype: clause.subtype,
                    confidence: clause.confidence,
                    sourceDocumentIds: [documentId],
                });
            }
        }
    }
    return {
        documentId,
        clauses,
        documentType: null,
        extractedAt: new Date(),
    };
}
async function batchExtractFromDocuments(organizationId, documentIds) {
    const results = [];
    for (const documentId of documentIds) {
        try {
            const result = await extractAndStoreFromDocument(organizationId, documentId);
            results.push(result);
        }
        catch (error) {
            console.error(`Failed to extract from document ${documentId}:`, error);
            results.push({
                documentId,
                clauses: [],
                documentType: null,
                extractedAt: new Date(),
            });
        }
    }
    return results;
}
function normalizeText(text) {
    return text
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/\t/g, ' ')
        .replace(/[ ]{2,}/g, ' ')
        .trim();
}
function splitIntoSections(text) {
    const sections = [];
    const headerPattern = /(?:^|\n)(\d+\.?\s*[A-Z][A-Za-z\s]+[:.]?|\n[A-Z][A-Z\s]+[:\.]?)/gm;
    const matches = [...text.matchAll(headerPattern)];
    if (matches.length === 0) {
        const paragraphs = text.split(/\n\n+/);
        let currentIndex = 0;
        for (const para of paragraphs) {
            if (para.trim().length > 30) {
                sections.push({
                    text: para.trim(),
                    startIndex: currentIndex,
                    endIndex: currentIndex + para.length,
                });
            }
            currentIndex += para.length + 2;
        }
    }
    else {
        for (let i = 0; i < matches.length; i++) {
            const startIndex = matches[i].index;
            const endIndex = i + 1 < matches.length ? matches[i + 1].index : text.length;
            const sectionText = text.substring(startIndex, endIndex);
            if (sectionText.trim().length > 30) {
                sections.push({
                    text: sectionText.trim(),
                    startIndex,
                    endIndex,
                    header: matches[i][1]?.trim(),
                });
            }
        }
    }
    return sections;
}
function matchClausePattern(text, pattern) {
    if (text.length < pattern.minLength || text.length > pattern.maxLength) {
        return null;
    }
    let headerMatch = false;
    for (const headerPattern of pattern.headerPatterns) {
        if (headerPattern.test(text.substring(0, 200))) {
            headerMatch = true;
            break;
        }
    }
    const matchedIndicators = [];
    for (const indicator of pattern.indicators) {
        const match = text.match(indicator);
        if (match) {
            matchedIndicators.push(match[0]);
        }
    }
    if (matchedIndicators.length === 0 && !headerMatch) {
        return null;
    }
    const indicatorScore = Math.min(matchedIndicators.length / pattern.indicators.length, 1);
    const headerScore = headerMatch ? 0.3 : 0;
    const confidence = Math.min(indicatorScore * 0.7 + headerScore + 0.1, 1);
    if (confidence < 0.3) {
        return null;
    }
    let subtype;
    if (pattern.subtypes && pattern.subtypes.length > 0) {
        subtype = determineSubtype(text, pattern.type, pattern.subtypes);
    }
    return {
        subtype,
        confidence,
        matchedIndicators,
    };
}
function determineSubtype(text, type, subtypes) {
    const subtypePatterns = {
        share_capital: {
            minimum: [/minimum/i, /mindest/i, /minimáln/i, /at least/i, /najmenej/i],
            contribution: [/contribution/i, /vklad/i, /einlage/i, /paid[- ]?in/i],
            increase: [/increase/i, /zvýšen/i, /erhöh/i, /additional/i],
            reduction: [/reduction/i, /decrease/i, /znížen/i, /herabsetz/i],
        },
        termination: {
            for_cause: [/for cause/i, /material breach/i, /default/i],
            for_convenience: [/for convenience/i, /without cause/i, /at any time/i],
            mutual: [/mutual/i, /either party/i, /both parties/i],
            automatic: [/automatic(ally)?/i, /upon expir/i],
        },
        confidentiality: {
            definition: [/means/i, /defined as/i, /includes?/i],
            obligations: [/shall not/i, /must not/i, /agrees? to/i],
            exceptions: [/except/i, /exclud/i, /not include/i],
            duration: [/year/i, /period/i, /terminat/i],
        },
        indemnification: {
            general: [/generally/i, /all claims/i],
            ip: [/intellectual property/i, /infringement/i, /patent/i],
            third_party: [/third party/i, /third-party/i],
            mutual: [/mutual/i, /each party/i],
        },
        payment: {
            terms: [/net \d+/i, /due (upon|within)/i],
            late_fees: [/late/i, /interest/i, /penalty/i],
            currency: [/usd|eur|gbp|currency/i],
            taxes: [/tax/i, /vat/i, /gst/i],
        },
    };
    const patterns = subtypePatterns[type];
    if (!patterns)
        return undefined;
    let bestMatch;
    let bestCount = 0;
    for (const subtype of subtypes) {
        const subtypeRegs = patterns[subtype];
        if (!subtypeRegs)
            continue;
        const count = subtypeRegs.filter(r => r.test(text)).length;
        if (count > bestCount) {
            bestCount = count;
            bestMatch = subtype;
        }
    }
    return bestCount > 0 ? bestMatch : undefined;
}
function deduplicateClauses(clauses) {
    const sorted = [...clauses].sort((a, b) => b.confidence - a.confidence);
    const kept = [];
    for (const clause of sorted) {
        const overlaps = kept.some(k => (clause.startIndex >= k.startIndex && clause.startIndex < k.endIndex) ||
            (clause.endIndex > k.startIndex && clause.endIndex <= k.endIndex) ||
            (clause.startIndex <= k.startIndex && clause.endIndex >= k.endIndex));
        if (!overlaps) {
            kept.push(clause);
        }
    }
    return kept;
}
function getSupportedClauseTypes() {
    return CLAUSE_PATTERNS.map(p => p.type);
}
function getClauseTypeInfo(type) {
    return CLAUSE_PATTERNS.find(p => p.type === type) || null;
}
async function extractAndValidateClauses(text, documentType, overrideJurisdiction) {
    console.log('[ClauseExtractor] Starting RAG-enhanced extraction...');
    const clauses = extractClauses(text);
    console.log(`[ClauseExtractor] Extracted ${clauses.length} clauses`);
    let jurisdiction = overrideJurisdiction || null;
    let jurisdictionConfidence = 1.0;
    let isExplicit = !!overrideJurisdiction;
    let governingLawClause;
    if (!overrideJurisdiction) {
        const governingLaw = (0, mandatoryTerms_1.extractGoverningLawClause)(text);
        if (governingLaw.found) {
            jurisdiction = governingLaw.jurisdiction;
            jurisdictionConfidence = 1.0;
            isExplicit = true;
            governingLawClause = governingLaw.clause;
            console.log(`[ClauseExtractor] Found governing law clause: ${governingLawClause} → ${jurisdiction}`);
        }
        else {
            const detected = (0, mandatoryTerms_1.detectJurisdiction)(text);
            jurisdiction = detected.detected;
            jurisdictionConfidence = detected.confidence;
            isExplicit = detected.isExplicit || false;
            console.log(`[ClauseExtractor] Auto-detected jurisdiction: ${jurisdiction} (confidence: ${jurisdictionConfidence})`);
        }
    }
    const validatedClauses = [];
    if (jurisdiction) {
        for (const clause of clauses) {
            try {
                const validation = await (0, clauseStatuteValidator_1.validateClauseAgainstStatutes)(clause, jurisdiction, documentType);
                validatedClauses.push({
                    ...clause,
                    validation,
                    detectedJurisdiction: jurisdiction,
                });
            }
            catch (error) {
                console.warn(`[ClauseExtractor] Validation failed for clause ${clause.type}:`, error);
                validatedClauses.push({
                    ...clause,
                    detectedJurisdiction: jurisdiction,
                });
            }
        }
    }
    else {
        validatedClauses.push(...clauses.map(c => ({ ...c })));
    }
    let missingClauses = [];
    if (jurisdiction && documentType) {
        try {
            missingClauses = await (0, clauseStatuteValidator_1.findMissingMandatoryClauses)(clauses, documentType, jurisdiction);
            console.log(`[ClauseExtractor] Found ${missingClauses.length} missing mandatory clauses`);
        }
        catch (error) {
            console.warn('[ClauseExtractor] Failed to find missing clauses:', error);
        }
    }
    let complianceScore = 100;
    if (validatedClauses.length > 0 || missingClauses.length > 0) {
        const violations = validatedClauses.reduce((sum, c) => sum + (c.validation?.violations?.length || 0), 0);
        const missingMandatory = missingClauses.filter(m => m.requirement === 'mandatory').length;
        complianceScore = Math.max(0, 100 - (violations * 10) - (missingMandatory * 15));
    }
    return {
        clauses: validatedClauses,
        missingClauses,
        detectedJurisdiction: {
            code: jurisdiction,
            confidence: jurisdictionConfidence,
            isExplicit,
            governingLawClause,
        },
        documentType: documentType || null,
        complianceScore,
        extractedAt: new Date(),
    };
}
async function analyzeDocumentCompliance(text, documentType, jurisdiction) {
    const result = await extractAndValidateClauses(text, documentType, jurisdiction);
    const finalJurisdiction = jurisdiction || result.detectedJurisdiction.code;
    if (!finalJurisdiction) {
        return {
            jurisdiction: 'unknown',
            documentType,
            clauseValidations: [],
            missingClauses: [],
            overallCompliance: 'non_compliant',
            complianceScore: 0,
            summary: 'Could not determine jurisdiction for compliance analysis.',
        };
    }
    return (0, clauseStatuteValidator_1.generateComplianceReport)(result.clauses, documentType, finalJurisdiction);
}
//# sourceMappingURL=clausePatternExtractor.js.map