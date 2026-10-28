"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyCitations = verifyCitations;
exports.extractClaims = extractClaims;
exports.verifyResponse = verifyResponse;
const retrieval_1 = require("./retrieval");
const chunking_1 = require("./chunking");
async function verifyCitations(text, options = {}) {
    const { jurisdiction, strictMode = false } = options;
    const citations = (0, chunking_1.extractCitations)(text);
    if (citations.length === 0) {
        return {
            citations: [],
            verifiedCount: 0,
            unverifiedCount: 0,
            verificationRatio: 1,
            confidence: 'insufficient',
        };
    }
    const verified = [];
    for (const citation of citations) {
        const result = await verifySingleCitation(citation, {
            jurisdiction: jurisdiction || citation.jurisdiction,
            strictMode,
        });
        verified.push(result);
    }
    const verifiedCount = verified.filter((c) => c.verified).length;
    const unverifiedCount = verified.filter((c) => !c.verified).length;
    const verificationRatio = citations.length > 0 ? verifiedCount / citations.length : 1;
    let confidence;
    if (citations.length === 0) {
        confidence = 'insufficient';
    }
    else if (verificationRatio >= 0.9) {
        confidence = 'high';
    }
    else if (verificationRatio >= 0.6) {
        confidence = 'medium';
    }
    else {
        confidence = 'low';
    }
    return {
        citations: verified,
        verifiedCount,
        unverifiedCount,
        verificationRatio,
        confidence,
    };
}
async function verifySingleCitation(citation, options) {
    const { jurisdiction, strictMode = false } = options;
    try {
        const searchQuery = buildSearchQuery(citation);
        const results = await (0, retrieval_1.search)(searchQuery, {
            jurisdiction,
            limit: 3,
            sourceTypes: citation.type === 'case' ? ['case_law'] : ['legislation', 'jurisdiction_kb'],
        });
        if (results.length === 0) {
            return {
                ...citation,
                verified: false,
                confidence: 0,
            };
        }
        const bestMatch = findBestMatch(citation, results, strictMode);
        if (bestMatch) {
            return {
                ...citation,
                verified: true,
                confidence: bestMatch.confidence,
                foundIn: bestMatch.sourceName,
                snippet: bestMatch.content.slice(0, 200),
            };
        }
        return {
            ...citation,
            verified: false,
            confidence: 0,
        };
    }
    catch (error) {
        console.error('[CitationVerifier] Error verifying citation:', error instanceof Error ? error.message : error);
        return {
            ...citation,
            verified: false,
            confidence: 0,
        };
    }
}
function buildSearchQuery(citation) {
    const text = citation.text;
    const sectionMatch = text.match(/§\s*(\d+[a-z]?)/i);
    const lawMatch = text.match(/(ABGB|MRG|WEG|KSchG|UGB|StGB|BGB|DSGVO|GDPR)/i);
    if (sectionMatch && lawMatch) {
        return `§ ${sectionMatch[1]} ${lawMatch[1]}`;
    }
    const articleMatch = text.match(/Art(?:ikel|icle)?\.?\s*(\d+)/i);
    if (articleMatch) {
        const euLawMatch = text.match(/(DSGVO|GDPR|EUV|AEUV)/i);
        return euLawMatch
            ? `Artikel ${articleMatch[1]} ${euLawMatch[1]}`
            : `Artikel ${articleMatch[1]}`;
    }
    return text;
}
function findBestMatch(citation, results, strictMode) {
    for (const result of results) {
        const confidence = calculateMatchConfidence(citation, result, strictMode);
        if (confidence > 0.3) {
            return {
                sourceName: result.sourceName,
                content: result.content,
                confidence,
            };
        }
    }
    return null;
}
function calculateMatchConfidence(citation, result, strictMode) {
    const citationLower = citation.text.toLowerCase();
    const contentLower = result.content.toLowerCase();
    const sourceNameLower = result.sourceName.toLowerCase();
    let score = 0;
    if (contentLower.includes(citationLower)) {
        score += 0.5;
    }
    const sectionMatch = citation.text.match(/§\s*(\d+[a-z]?)/i);
    if (sectionMatch) {
        const sectionPattern = new RegExp(`§\\s*${sectionMatch[1]}\\b`, 'i');
        if (sectionPattern.test(result.content)) {
            score += 0.3;
        }
    }
    const lawMatch = citation.text.match(/(ABGB|MRG|WEG|KSchG|UGB|StGB|BGB|DSGVO)/i);
    if (lawMatch && sourceNameLower.includes(lawMatch[1].toLowerCase())) {
        score += 0.2;
    }
    if (strictMode && score < 0.6) {
        return 0;
    }
    return Math.min(1, score);
}
function extractClaims(text) {
    const claims = [];
    const citations = (0, chunking_1.extractCitations)(text);
    for (const citation of citations) {
        claims.push({
            text: citation.text,
            type: citation.type === 'case' ? 'case_citation' : 'statute_reference',
            citation,
            startIndex: citation.startIndex,
            endIndex: citation.endIndex,
        });
    }
    const principlePatterns = [
        /(?:according to|pursuant to|under|gemäß|nach)\s+[^,.]+/gi,
        /(?:the law requires|legally required|must|shall)\s+[^,.]+/gi,
        /(?:is entitled to|has the right to|darf|kann)\s+[^,.]+/gi,
    ];
    for (const pattern of principlePatterns) {
        let match;
        while ((match = pattern.exec(text)) !== null) {
            const overlaps = claims.some((c) => (match.index >= c.startIndex && match.index <= c.endIndex) ||
                (match.index + match[0].length >= c.startIndex &&
                    match.index + match[0].length <= c.endIndex));
            if (!overlaps) {
                claims.push({
                    text: match[0].trim(),
                    type: 'legal_principle',
                    startIndex: match.index,
                    endIndex: match.index + match[0].length,
                });
            }
        }
    }
    claims.sort((a, b) => a.startIndex - b.startIndex);
    return claims;
}
async function verifyResponse(text, options = {}) {
    const claims = extractClaims(text);
    const citationVerification = await verifyCitations(text, options);
    const potentialHallucinations = [];
    for (const verified of citationVerification.citations) {
        if (!verified.verified) {
            potentialHallucinations.push(`Unverified citation: "${verified.text}" (${verified.type})`);
        }
    }
    if (options.ragSources && options.ragSources.length > 0) {
        const ragContent = options.ragSources.map((s) => s.content).join(' ');
        for (const claim of claims) {
            if (claim.type === 'legal_principle') {
                const keyTerms = claim.text
                    .toLowerCase()
                    .split(/\s+/)
                    .filter((t) => t.length > 4);
                const grounded = keyTerms.some((term) => ragContent.toLowerCase().includes(term));
                if (!grounded) {
                    potentialHallucinations.push(`Ungrounded claim: "${claim.text.slice(0, 100)}..."`);
                }
            }
        }
    }
    let confidence;
    if (claims.length === 0) {
        confidence = 'insufficient';
    }
    else if (potentialHallucinations.length === 0) {
        confidence = 'high';
    }
    else if (potentialHallucinations.length <= 2) {
        confidence = 'medium';
    }
    else {
        confidence = 'low';
    }
    return {
        claims,
        citationVerification,
        potentialHallucinations,
        confidence,
    };
}
//# sourceMappingURL=citationVerifier.js.map