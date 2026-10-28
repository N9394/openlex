"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectLegalContexts = detectLegalContexts;
exports.legalContextToPIIDetections = legalContextToPIIDetections;
const LEGAL_PATTERNS = {
    signatureBlock: [
        /(?:By|Signed|Signature|Executed by):\s*_{2,}[\s\S]{0,200}?(?=\n\n|\n[A-Z]|$)/gi,
        /(?:Witness|Witnessed by|Attested):\s*_{2,}[\s\S]{0,200}?(?=\n\n|\n[A-Z]|$)/gi,
        /(?:Name|Print Name):\s*_{2,}.{0,100}/gi,
        /(?:Title|Position):\s*_{2,}.{0,100}/gi,
        /(?:Date):\s*_{2,}.{0,50}/gi,
    ],
    partyDefinition: [
        /(?:hereinafter (?:referred to as|called)|"[^"]+"|'[^']+')\s*["']?(?:the\s+)?(?:Party|Licensor|Licensee|Buyer|Seller|Landlord|Tenant|Employer|Employee|Company|Contractor|Client|Customer|Provider|Supplier)["']?/gi,
        /\b(?:between|among)\s+([A-Z][a-zA-Z\s,.'&]+?)(?:\s*,?\s*(?:a|an)\s+[a-zA-Z\s]+(?:company|corporation|LLC|Inc\.|Ltd\.?|GmbH|AG))/gi,
        /(?:PARTY [A-Z]|FIRST PARTY|SECOND PARTY):\s*.+?(?=\n|;|,\s*and)/gi,
    ],
    recitals: [
        /WHEREAS[,:]?\s+.+?(?=WHEREAS|NOW,?\s*THEREFORE|WITNESSETH|$)/gis,
        /RECITALS?\s*:?\s*[\s\S]+?(?=NOW,?\s*THEREFORE|AGREEMENT|1\.|ARTICLE)/gi,
    ],
    noticeSection: [
        /(?:NOTICE|NOTICES|NOTICE ADDRESS)[\s\S]*?(?:Attention|Attn\.?|To|Address):\s*.+?(?=\n\n|\n[A-Z]{2,}|$)/gi,
        /(?:If to|All notices to)\s*(?:the\s+)?(?:Licensor|Licensee|Buyer|Seller|Landlord|Tenant|Employer|Employee|Company|Party)[\s\S]*?(?=If to|All notices|$)/gi,
        /(?:Address|Email|Phone|Fax|Contact):\s*.+/gi,
    ],
    schedules: [
        /(?:SCHEDULE|EXHIBIT|ANNEX|APPENDIX)\s+[A-Z0-9]+[\s\S]*?(?=SCHEDULE|EXHIBIT|ANNEX|APPENDIX|$)/gi,
    ],
    confidentialInfo: [
        /"Confidential Information"[\s\S]{0,500}?(?:includes?|means?|shall mean)[\s\S]{0,1000}?(?=\n\n|\d\.\s|[A-Z]{2,}\s)/gi,
    ],
};
const ENTITY_EXTRACTION_PATTERNS = {
    signatureName: /(?:By|Signed|Name|Print Name):\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/g,
    companyName: /([A-Z][a-zA-Z\s&.,]+?)\s*(?:,?\s*(?:a|an)\s+)?(?:Delaware|Nevada|California|New York|[A-Z][a-z]+)\s*(?:corporation|company|LLC|Inc\.|Ltd\.?|GmbH|AG|limited liability company)/gi,
    address: /\d+\s+[A-Za-z\s]+(?:Street|St\.?|Avenue|Ave\.?|Boulevard|Blvd\.?|Road|Rd\.?|Drive|Dr\.?|Lane|Ln\.?|Way|Court|Ct\.?)[,\s]+[A-Za-z\s]+,?\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?/gi,
    email: /(?:Email|E-mail):\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi,
    phone: /(?:Phone|Tel|Telephone|Fax):\s*([\d\s\-\(\)\+\.]{10,})/gi,
};
function detectLegalContexts(text) {
    const contexts = [];
    for (const [type, patterns] of Object.entries(LEGAL_PATTERNS)) {
        for (const pattern of patterns) {
            pattern.lastIndex = 0;
            let match;
            while ((match = pattern.exec(text)) !== null) {
                const matchedText = match[0];
                const entities = extractEntitiesFromContext(matchedText, match.index);
                const typeMap = {
                    signatureBlock: 'signature_block',
                    partyDefinition: 'party_definition',
                    recitals: 'recital',
                    noticeSection: 'notice_section',
                    schedules: 'schedule',
                    confidentialInfo: 'schedule',
                };
                contexts.push({
                    type: typeMap[type] || 'schedule',
                    start: match.index,
                    end: match.index + matchedText.length,
                    text: matchedText,
                    entities,
                });
            }
        }
    }
    return mergeOverlappingContexts(contexts);
}
function extractEntitiesFromContext(contextText, contextStart) {
    const entities = [];
    for (const pattern of [ENTITY_EXTRACTION_PATTERNS.signatureName]) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(contextText)) !== null) {
            const entityText = match[1] || match[0];
            entities.push({
                text: entityText,
                category: 'person',
                start: contextStart + match.index,
                end: contextStart + match.index + entityText.length,
                method: 'legal_context',
                confidence: 0.85,
                confidenceLevel: 'high',
                context: 'signature block',
            });
        }
    }
    ENTITY_EXTRACTION_PATTERNS.companyName.lastIndex = 0;
    let match;
    while ((match = ENTITY_EXTRACTION_PATTERNS.companyName.exec(contextText)) !== null) {
        entities.push({
            text: match[1] || match[0],
            category: 'organization',
            start: contextStart + match.index,
            end: contextStart + match.index + match[0].length,
            method: 'legal_context',
            confidence: 0.9,
            confidenceLevel: 'high',
            context: 'party definition',
        });
    }
    ENTITY_EXTRACTION_PATTERNS.address.lastIndex = 0;
    while ((match = ENTITY_EXTRACTION_PATTERNS.address.exec(contextText)) !== null) {
        entities.push({
            text: match[0],
            category: 'location',
            start: contextStart + match.index,
            end: contextStart + match.index + match[0].length,
            method: 'legal_context',
            confidence: 0.9,
            confidenceLevel: 'high',
            context: 'notice section',
        });
    }
    ENTITY_EXTRACTION_PATTERNS.email.lastIndex = 0;
    while ((match = ENTITY_EXTRACTION_PATTERNS.email.exec(contextText)) !== null) {
        entities.push({
            text: match[1] || match[0],
            category: 'email',
            start: contextStart + match.index,
            end: contextStart + match.index + match[0].length,
            method: 'legal_context',
            confidence: 0.95,
            confidenceLevel: 'high',
            context: 'notice section',
        });
    }
    ENTITY_EXTRACTION_PATTERNS.phone.lastIndex = 0;
    while ((match = ENTITY_EXTRACTION_PATTERNS.phone.exec(contextText)) !== null) {
        entities.push({
            text: match[1] || match[0],
            category: 'phone',
            start: contextStart + match.index,
            end: contextStart + match.index + match[0].length,
            method: 'legal_context',
            confidence: 0.9,
            confidenceLevel: 'high',
            context: 'notice section',
        });
    }
    return entities;
}
function mergeOverlappingContexts(contexts) {
    if (contexts.length === 0)
        return [];
    const sorted = contexts.sort((a, b) => a.start - b.start);
    const merged = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
        const current = sorted[i];
        const last = merged[merged.length - 1];
        if (current.start <= last.end) {
            last.end = Math.max(last.end, current.end);
            last.entities = [...last.entities, ...current.entities];
        }
        else {
            merged.push(current);
        }
    }
    return merged;
}
function legalContextToPIIDetections(contexts) {
    const detections = [];
    for (const context of contexts) {
        detections.push(...context.entities);
        if (context.type === 'signature_block') {
            detections.push({
                text: context.text,
                category: 'signature',
                start: context.start,
                end: context.end,
                method: 'legal_context',
                confidence: 0.95,
                confidenceLevel: 'high',
                context: 'signature block section',
            });
        }
        else if (context.type === 'party_definition') {
            detections.push({
                text: context.text,
                category: 'party',
                start: context.start,
                end: context.end,
                method: 'legal_context',
                confidence: 0.85,
                confidenceLevel: 'high',
                context: 'party definition section',
            });
        }
        else if (context.type === 'notice_section') {
            detections.push({
                text: context.text,
                category: 'notice',
                start: context.start,
                end: context.end,
                method: 'legal_context',
                confidence: 0.9,
                confidenceLevel: 'high',
                context: 'notice section',
            });
        }
    }
    return detections;
}
//# sourceMappingURL=legalContext.js.map