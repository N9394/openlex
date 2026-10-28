"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.chunkText = chunkText;
exports.extractKeyTerms = extractKeyTerms;
exports.getRelatedTerms = getRelatedTerms;
exports.extractCitations = extractCitations;
exports.isWithinCitation = isWithinCitation;
const DEFAULT_OPTIONS = {
    maxSize: 800,
    minSize: 100,
    preserveSections: true,
};
const DEFAULT_OVERLAP_PERCENT = 0.15;
function chunkText(text, options = {}) {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const overlapPercent = Math.min(0.5, Math.max(0, opts.overlapPercent ?? DEFAULT_OVERLAP_PERCENT));
    const chunks = [];
    const normalized = text.replace(/\r\n/g, '\n').trim();
    if (normalized.length <= opts.maxSize) {
        return [normalized];
    }
    if (opts.preserveSections) {
        const sections = splitBySections(normalized);
        for (const section of sections) {
            if (section.length <= opts.maxSize) {
                if (section.length >= opts.minSize) {
                    chunks.push(section);
                }
            }
            else {
                const subChunks = splitByParagraphsWithOverlap(section, opts.maxSize, opts.minSize, overlapPercent);
                chunks.push(...subChunks);
            }
        }
    }
    else {
        chunks.push(...splitByParagraphsWithOverlap(normalized, opts.maxSize, opts.minSize, overlapPercent));
    }
    if (overlapPercent > 0 && chunks.length > 1) {
        return addOverlapBetweenChunks(chunks, opts.maxSize, overlapPercent);
    }
    return chunks.filter((c) => c.length >= opts.minSize);
}
function addOverlapBetweenChunks(chunks, maxSize, overlapPercent) {
    if (chunks.length <= 1)
        return chunks;
    const overlapSize = Math.floor(maxSize * overlapPercent);
    const result = [];
    for (let i = 0; i < chunks.length; i++) {
        let chunk = chunks[i];
        if (i > 0) {
            const prevChunk = chunks[i - 1];
            const overlap = getOverlapSuffix(prevChunk, overlapSize);
            if (overlap && (overlap.length + chunk.length) <= maxSize) {
                chunk = overlap + '\n\n' + chunk;
            }
        }
        result.push(chunk);
    }
    return result;
}
function getOverlapSuffix(text, targetSize) {
    if (text.length <= targetSize)
        return text;
    const startPos = text.length - targetSize;
    const searchRegion = text.substring(startPos);
    const sentenceMatch = searchRegion.match(/^[^.!?]*[.!?]\s*/);
    if (sentenceMatch) {
        return searchRegion.substring(sentenceMatch[0].length).trim();
    }
    const words = searchRegion.trim().split(/\s+/);
    if (words.length > 1) {
        return words.slice(1).join(' ');
    }
    return searchRegion.trim();
}
function splitBySections(text) {
    const patterns = [
        /\n(?=§\s*\d+[a-z]?\.?\s)/g,
        /\n(?=Paragraph\s+\d+)/gi,
        /\n(?=Absatz\s+\d+)/gi,
        /\n(?=Artikel\s+[IVXLC\d]+)/gi,
        /\n(?=Art\.?\s*\d+)/g,
        /\n(?=Novellierungsanordnung\s+\d+)/gi,
        /\n(?=Ziffer\s+\d+)/gi,
        /\n(?=\d+\.\s+[A-Z])/g,
        /\n(?=ARTICLE\s+[IVXLC\d]+)/gi,
        /\n(?=SECTION\s+\d+)/gi,
        /\n(?=Part\s+[IVXLC\d]+)/gi,
        /\n(?=Chapter\s+\d+)/gi,
        /\n(?=Schedule\s+\d+)/gi,
        /\n(?=[A-Z][A-Z\s]{5,}:?\n)/g,
    ];
    const splitPoints = [0];
    for (const pattern of patterns) {
        let match;
        const regex = new RegExp(pattern.source, pattern.flags);
        while ((match = regex.exec(text)) !== null) {
            if (!splitPoints.includes(match.index)) {
                splitPoints.push(match.index);
            }
        }
    }
    splitPoints.push(text.length);
    splitPoints.sort((a, b) => a - b);
    const filtered = [0];
    for (let i = 1; i < splitPoints.length; i++) {
        if (splitPoints[i] - filtered[filtered.length - 1] > 50) {
            filtered.push(splitPoints[i]);
        }
    }
    const sections = [];
    for (let i = 0; i < filtered.length - 1; i++) {
        const section = text.slice(filtered[i], filtered[i + 1]).trim();
        if (section)
            sections.push(section);
    }
    return sections.length > 0 ? sections : [text];
}
function splitByParagraphs(text, maxSize, minSize) {
    return splitByParagraphsWithOverlap(text, maxSize, minSize, 0);
}
function splitByParagraphsWithOverlap(text, maxSize, minSize, overlapPercent) {
    const paragraphs = text.split(/\n\n+/);
    const chunks = [];
    let current = '';
    let previousChunkEnd = '';
    for (const para of paragraphs) {
        const trimmed = para.trim();
        if (!trimmed)
            continue;
        const overlapSize = Math.floor(maxSize * overlapPercent);
        const effectiveMax = overlapPercent > 0 ? maxSize - overlapSize : maxSize;
        if (current.length + trimmed.length + 2 <= effectiveMax) {
            current = current ? current + '\n\n' + trimmed : trimmed;
        }
        else {
            if (current.length >= minSize) {
                let chunkWithOverlap = current;
                if (previousChunkEnd && overlapPercent > 0) {
                    const overlap = getOverlapSuffix(previousChunkEnd, overlapSize);
                    if (overlap && (overlap.length + current.length) <= maxSize) {
                        chunkWithOverlap = overlap + '\n\n' + current;
                    }
                }
                chunks.push(chunkWithOverlap);
                previousChunkEnd = current;
            }
            if (trimmed.length > effectiveMax) {
                const sentences = splitBySentences(trimmed, maxSize, minSize);
                for (const sentence of sentences) {
                    if (previousChunkEnd && overlapPercent > 0) {
                        const overlap = getOverlapSuffix(previousChunkEnd, overlapSize);
                        if (overlap && (overlap.length + sentence.length) <= maxSize) {
                            chunks.push(overlap + '\n\n' + sentence);
                        }
                        else {
                            chunks.push(sentence);
                        }
                    }
                    else {
                        chunks.push(sentence);
                    }
                    previousChunkEnd = sentence;
                }
                current = '';
            }
            else {
                current = trimmed;
            }
        }
    }
    if (current.length >= minSize) {
        if (previousChunkEnd && overlapPercent > 0) {
            const overlapSize = Math.floor(maxSize * overlapPercent);
            const overlap = getOverlapSuffix(previousChunkEnd, overlapSize);
            if (overlap && (overlap.length + current.length) <= maxSize) {
                chunks.push(overlap + '\n\n' + current);
            }
            else {
                chunks.push(current);
            }
        }
        else {
            chunks.push(current);
        }
    }
    return chunks;
}
function splitBySentences(text, maxSize, minSize) {
    const sentences = text.split(/(?<=[.!?])\s+/);
    const chunks = [];
    let current = '';
    for (const sentence of sentences) {
        if (current.length + sentence.length + 1 <= maxSize) {
            current = current ? current + ' ' + sentence : sentence;
        }
        else {
            if (current.length >= minSize) {
                chunks.push(current);
            }
            current = sentence;
        }
    }
    if (current.length >= minSize) {
        chunks.push(current);
    }
    return chunks;
}
const LEGAL_TERMS = {
    contract: [
        'agreement', 'contract', 'covenant', 'obligation', 'consideration',
        'performance', 'breach', 'default', 'remedy', 'damages',
    ],
    parties: [
        'party', 'parties', 'counterparty', 'signatory', 'principal',
        'agent', 'representative', 'authorized', 'binding', 'capacity',
    ],
    confidentiality: [
        'confidential', 'proprietary', 'trade secret', 'non-disclosure',
        'nda', 'confidentiality', 'sensitive', 'classified', 'restricted',
    ],
    ip: [
        'intellectual property', 'patent', 'copyright', 'trademark',
        'trade secret', 'license', 'royalty', 'infringement', 'ownership',
    ],
    liability: [
        'liability', 'indemnify', 'indemnification', 'hold harmless',
        'limitation of liability', 'cap', 'exclusion', 'consequential',
        'negligence', 'gross negligence', 'willful misconduct',
    ],
    warranties: [
        'warranty', 'warranties', 'representation', 'guaranty', 'guarantee',
        'disclaimer', 'as is', 'merchantability', 'fitness for purpose',
    ],
    termination: [
        'termination', 'terminate', 'expiration', 'renewal', 'cancellation',
        'cure period', 'notice period', 'survival', 'wind down',
    ],
    disputes: [
        'dispute', 'arbitration', 'mediation', 'litigation', 'jurisdiction',
        'venue', 'governing law', 'choice of law', 'forum', 'injunctive',
    ],
    force_majeure: [
        'force majeure', 'act of god', 'unforeseeable', 'beyond control',
        'pandemic', 'natural disaster', 'war', 'terrorism',
    ],
    employment: [
        'employment', 'employee', 'employer', 'at-will', 'termination',
        'non-compete', 'non-solicitation', 'garden leave', 'severance',
        'compensation', 'benefits', 'bonus', 'equity', 'vesting',
    ],
    privacy: [
        'data protection', 'privacy', 'personal data', 'gdpr', 'ccpa',
        'data breach', 'consent', 'processing', 'controller', 'processor',
    ],
    general: [
        'waiver', 'amendment', 'assignment', 'notice', 'severability',
        'entire agreement', 'integration', 'counterparts', 'headings',
        'construction', 'interpretation', 'survival', 'successors',
    ],
    german: [
        'Vertraulich', 'Haftung', 'Kündigung', 'Gewährleistung', 'Gerichtsstand',
        'Vertragsstrafe', 'Wettbewerbsverbot', 'Schadensersatz', 'Verjährung',
        'Geheimhaltung', 'Lizenz', 'Nutzungsrecht', 'Urheberrecht',
    ],
    austrian: [
        'Mietrecht', 'Mietvertrag', 'Hauptmieter', 'Untermieter', 'Mietzins',
        'Kündigungsfrist', 'Räumung', 'Kaution', 'Betriebskosten',
        'ABGB', 'MRG', 'WEG', 'KSchG', 'UGB', 'GmbHG', 'AktG',
        'Bundesgesetz', 'Verordnung', 'Novelle', 'Paragraph', 'Absatz', 'Ziffer',
    ],
};
const ALL_LEGAL_TERMS = Object.values(LEGAL_TERMS).flat();
const LEGAL_SYNONYMS = {
    'breach': ['violation', 'default', 'non-compliance'],
    'terminate': ['cancel', 'end', 'rescind', 'void'],
    'liability': ['responsibility', 'obligation', 'accountability'],
    'confidential': ['secret', 'proprietary', 'private'],
    'indemnify': ['hold harmless', 'compensate', 'reimburse'],
    'warranty': ['guarantee', 'assurance', 'representation'],
};
function extractKeyTerms(text) {
    const found = new Set();
    const lowerText = text.toLowerCase();
    for (const term of ALL_LEGAL_TERMS) {
        if (lowerText.includes(term.toLowerCase())) {
            found.add(term.toLowerCase());
        }
    }
    for (const [canonical, synonyms] of Object.entries(LEGAL_SYNONYMS)) {
        for (const synonym of synonyms) {
            if (lowerText.includes(synonym.toLowerCase())) {
                found.add(canonical);
                break;
            }
        }
    }
    return Array.from(found);
}
function getRelatedTerms(term) {
    const related = [];
    const lowerTerm = term.toLowerCase();
    if (LEGAL_SYNONYMS[lowerTerm]) {
        related.push(...LEGAL_SYNONYMS[lowerTerm]);
    }
    for (const [canonical, synonyms] of Object.entries(LEGAL_SYNONYMS)) {
        if (synonyms.some((s) => s.toLowerCase() === lowerTerm)) {
            related.push(canonical);
        }
    }
    return related;
}
const CITATION_PATTERNS = [
    /§\s*\d+[a-z]?(?:\s+(?:Abs(?:atz)?\.?\s*\d+)?(?:\s+(?:Z(?:iffer)?\.?\s*\d+))?)?(?:\s+(?:ABGB|MRG|WEG|KSchG|UGB|StGB|DSG|GmbHG|AktG|ZPO|StPO))?/gi,
    /Art(?:ikel|icle)?\.?\s*\d+(?:\s+(?:Abs(?:atz)?\.?\s*\d+))?(?:\s+(?:DSGVO|GDPR|EUV|AEUV))?/gi,
    /§§?\s*\d+(?:\s*[-–]\s*\d+)?(?:\s+BGB)?/gi,
    /(?:OGH|BGH|BVerfG|EuGH|EGMR)\s+\d+[A-Za-z]+\s*\d+\/\d+/gi,
    /\d+\s+(?:U\.S\.|F\.\d+d?|S\.Ct\.)\s+\d+/g,
    /\[\d{4}\]\s+(?:UKSC|EWCA|EWHC|AC|QB|WLR)\s+\d+/g,
];
function extractCitations(text) {
    const citations = [];
    const seen = new Set();
    for (const pattern of CITATION_PATTERNS) {
        const regex = new RegExp(pattern.source, pattern.flags);
        let match;
        while ((match = regex.exec(text)) !== null) {
            const citationText = match[0].trim();
            if (seen.has(citationText.toLowerCase()))
                continue;
            seen.add(citationText.toLowerCase());
            let type = 'unknown';
            let jurisdiction;
            if (/§|Abs|ABGB|MRG|KSchG|UGB|WEG/i.test(citationText)) {
                type = 'statute';
                jurisdiction = /ABGB|MRG|KSchG|UGB|WEG/i.test(citationText) ? 'AT' : 'DE';
            }
            else if (/BGB|StGB|ZPO/i.test(citationText)) {
                type = 'statute';
                jurisdiction = 'DE';
            }
            else if (/Art|DSGVO|GDPR|EUV|AEUV/i.test(citationText)) {
                type = 'eu';
                jurisdiction = 'EU';
            }
            else if (/OGH|BGH|BVerfG|EuGH|EGMR/i.test(citationText)) {
                type = 'case';
                if (/OGH/i.test(citationText))
                    jurisdiction = 'AT';
                else if (/BGH|BVerfG/i.test(citationText))
                    jurisdiction = 'DE';
                else if (/EuGH/i.test(citationText))
                    jurisdiction = 'EU';
            }
            else if (/U\.S\.|F\.\d|S\.Ct/i.test(citationText)) {
                type = 'case';
                jurisdiction = 'US';
            }
            else if (/UKSC|EWCA|EWHC/i.test(citationText)) {
                type = 'case';
                jurisdiction = 'UK';
            }
            citations.push({
                text: citationText,
                type,
                jurisdiction,
                startIndex: match.index,
                endIndex: match.index + match[0].length,
            });
        }
    }
    citations.sort((a, b) => a.startIndex - b.startIndex);
    return citations;
}
function isWithinCitation(text, position, citations) {
    const citationList = citations || extractCitations(text);
    return citationList.some((c) => position >= c.startIndex && position <= c.endIndex);
}
//# sourceMappingURL=chunking.js.map