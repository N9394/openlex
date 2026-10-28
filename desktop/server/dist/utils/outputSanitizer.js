"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sanitizeOutput = sanitizeOutput;
exports.sanitizeSources = sanitizeSources;
exports.isValidLegalResponse = isValidLegalResponse;
exports.extractCitations = extractCitations;
function sanitizeOutput(text) {
    if (!text)
        return '';
    let result = text;
    result = result.replace(/\[object Object\]/g, '');
    result = result.replace(/⚠️\s*\*?\[Unverified:\s*⚠️\s*\*?\[Unverified:\s*([^\]]+)\]\([^\)]+\)\]\*?\]\*?\s*-\s*verify independently\s*-\s*verify independently/g, '⚠️ [Unverified: $1] - verify independently');
    result = result.replace(/(\[Unverified:[^\]]+\])\s*-\s*verify independently\s*-\s*verify independently/g, '$1 - verify independently');
    result = result.replace(/\*?\]\*?\]\*?/g, '');
    result = result.replace(/\(\s*\)/g, '');
    result = result.replace(/\]\([^\)]*\)\]\(/g, '](');
    result = result.replace(/\]\(\[Unverified:\s*(https?:\/\/[^\]]+)\]\)/g, ']($1)');
    result = result.replace(/\[Unverified:\s*(\[[^\]]+\]\([^\)]+\))\]/g, '$1');
    result = result.replace(/(?<!\w)'(?!\w)|(?<!\w)'(?=\w)/g, '');
    result = result.replace(/(?<=\w)'(?!\w)/g, '');
    result = result.replace(/(?<!^|\n)#(?!\s|#)/gm, '');
    result = result.replace(/\n{3,}/g, '\n\n');
    result = result.replace(/[ \t]+$/gm, '');
    result = result.replace(/^\s*[-*]\s*$/gm, '');
    result = result.replace(/  +/g, ' ');
    result = result.replace(/##\s*##/g, '##');
    result = result.replace(/\[object\s+\w+\]/gi, '');
    result = result.replace(/(#{1,6}\s+[^\n]+)\n(?=[^\n#])/g, '$1\n\n');
    return result.trim();
}
function sanitizeSources(sources) {
    if (!Array.isArray(sources))
        return [];
    return sources.filter(source => {
        if (source.title?.includes('[object Object]'))
            return false;
        if (source.excerpt?.includes('[object Object]'))
            return false;
        if (!source.title || source.title.trim().length < 3)
            return false;
        if (source.relevance !== undefined && source.relevance < 20)
            return false;
        return true;
    }).map(source => ({
        ...source,
        title: sanitizeText(source.title),
        excerpt: sanitizeText(source.excerpt),
    }));
}
function sanitizeText(text) {
    if (!text)
        return '';
    return text
        .replace(/\[object Object\]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}
function isValidLegalResponse(text) {
    if (!text || text.length < 100)
        return false;
    const hasStructure = /##\s*(Summary|Key Points|Legal Basis)/i.test(text);
    const hasCitations = /\[\d+\]|\[§|\[Art\./.test(text);
    const hasLegalTerms = /(law|legal|statute|regulation|§|article|section|paragraph)/i.test(text);
    return hasStructure || (hasCitations && hasLegalTerms);
}
function extractCitations(text) {
    const citations = [];
    const patterns = [
        /§\s*\d+[a-z]?\s*(?:Abs\.?\s*\d+)?\s*(?:[A-Z][a-zA-Z]+(?:G|VO|StGB)?)/g,
        /Art\.?\s*\d+\s*(?:[A-Z][a-zA-Z]+)/g,
        /\d{4}\/\d+\/(?:EU|EG)/g,
        /ECLI:[A-Z]{2}:[A-Z]+:\d+:[A-Z0-9.]+/g,
    ];
    for (const pattern of patterns) {
        const matches = text.match(pattern);
        if (matches) {
            citations.push(...matches);
        }
    }
    return [...new Set(citations)];
}
//# sourceMappingURL=outputSanitizer.js.map