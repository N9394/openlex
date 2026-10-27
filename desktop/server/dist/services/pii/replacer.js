"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.replaceWithPlaceholders = replaceWithPlaceholders;
exports.anonymizeText = anonymizeText;
exports.createReverseMap = createReverseMap;
exports.deanonymizeText = deanonymizeText;
exports.validateAnonymization = validateAnonymization;
exports.batchAnonymize = batchAnonymize;
const types_1 = require("./types");
const detector_1 = require("./detector");
function createPlaceholderState() {
    return {
        counters: new Map(),
        entityMap: new Map(),
    };
}
function getPlaceholder(entity, category, state, config) {
    const normalizedEntity = normalizeEntity(entity, category);
    if (state.entityMap.has(normalizedEntity)) {
        return state.entityMap.get(normalizedEntity);
    }
    const counter = (state.counters.get(category) || 0) + 1;
    state.counters.set(category, counter);
    let placeholder;
    switch (category) {
        case 'person':
            placeholder = config.person.replace('{n}', String(counter));
            break;
        case 'organization':
            placeholder = config.organization.replace('{n}', String(counter));
            break;
        case 'location':
            placeholder = config.location.replace('{n}', String(counter));
            break;
        case 'email':
            placeholder = `[EMAIL_${counter}]`;
            break;
        case 'phone':
            placeholder = `[PHONE_${counter}]`;
            break;
        case 'ssn':
            placeholder = `[SSN_${counter}]`;
            break;
        case 'tax_id':
            placeholder = `[TAX_ID_${counter}]`;
            break;
        case 'credit_card':
            placeholder = `[CARD_${counter}]`;
            break;
        case 'iban':
            placeholder = `[IBAN_${counter}]`;
            break;
        case 'date':
            placeholder = `[DATE_${counter}]`;
            break;
        case 'money':
            placeholder = `[AMOUNT_${counter}]`;
            break;
        case 'id_number':
            placeholder = `[ID_${counter}]`;
            break;
        case 'signature':
            placeholder = `[SIGNATURE_BLOCK_${counter}]`;
            break;
        case 'party':
            placeholder = `[PARTY_${counter}]`;
            break;
        case 'notice':
            placeholder = `[NOTICE_${counter}]`;
            break;
        default:
            placeholder = config.default.replace('{n}', String(counter));
    }
    state.entityMap.set(normalizedEntity, placeholder);
    return placeholder;
}
function normalizeEntity(entity, category) {
    let normalized = entity.trim();
    switch (category) {
        case 'person':
            normalized = normalized
                .replace(/\s+/g, ' ')
                .split(' ')
                .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
                .join(' ');
            break;
        case 'email':
            normalized = normalized.toLowerCase();
            break;
        case 'phone':
            normalized = normalized.replace(/\D/g, '');
            break;
        case 'organization':
            normalized = normalized
                .replace(/\s+/g, ' ')
                .replace(/,?\s*(Inc\.?|LLC|Ltd\.?|GmbH|AG|Corp\.?|Corporation|Company)$/i, '');
            break;
        default:
            normalized = normalized.replace(/\s+/g, ' ');
    }
    return normalized;
}
function replaceWithPlaceholders(text, detections, config = types_1.DEFAULT_PLACEHOLDERS) {
    if (detections.length === 0) {
        return { anonymizedText: text, placeholderMap: new Map() };
    }
    const state = createPlaceholderState();
    const sortedDetections = [...detections].sort((a, b) => b.start - a.start);
    let result = text;
    for (const detection of sortedDetections) {
        if (detection.start < 0 || detection.end > result.length) {
            continue;
        }
        const placeholder = getPlaceholder(detection.text, detection.category, state, config);
        detection.placeholder = placeholder;
        result = result.slice(0, detection.start) + placeholder + result.slice(detection.end);
    }
    return {
        anonymizedText: result,
        placeholderMap: state.entityMap,
    };
}
async function anonymizeText(text, options = {}) {
    const { language = 'en', minConfidence = 0.5, config = types_1.DEFAULT_PLACEHOLDERS } = options;
    const detections = await (0, detector_1.detectPII)(text, {
        language,
        minConfidence,
    });
    const { anonymizedText, placeholderMap } = replaceWithPlaceholders(text, detections, config);
    const byCategory = {};
    const byMethod = {};
    for (const detection of detections) {
        byCategory[detection.category] = (byCategory[detection.category] || 0) + 1;
        byMethod[detection.method] = (byMethod[detection.method] || 0) + 1;
    }
    const originalLength = text.length;
    const anonymizedLength = anonymizedText.length;
    const textReductionPercent = originalLength > 0
        ? ((originalLength - anonymizedLength) / originalLength) * 100
        : 0;
    return {
        originalText: text,
        anonymizedText,
        detections,
        placeholderMap,
        stats: {
            totalDetections: detections.length,
            byCategory,
            byMethod,
            textReductionPercent,
        },
    };
}
function createReverseMap(detections) {
    const reverseMap = new Map();
    for (const detection of detections) {
        if (detection.placeholder) {
            reverseMap.set(detection.placeholder, detection);
        }
    }
    return reverseMap;
}
function deanonymizeText(anonymizedText, detections) {
    const reverseMap = createReverseMap(detections);
    let result = anonymizedText;
    for (const [placeholder, detection] of reverseMap) {
        result = result.replace(new RegExp(escapeRegExp(placeholder), 'g'), detection.text);
    }
    return result;
}
function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function validateAnonymization(_original, anonymized, detections) {
    const issues = [];
    for (const detection of detections) {
        if (detection.confidence >= 0.75) {
            const searchText = detection.text.trim();
            if (searchText.length >= 3 && anonymized.includes(searchText)) {
                issues.push({
                    type: 'pii_leak',
                    description: `Detected PII "${searchText}" (${detection.category}) may still be present`,
                });
            }
        }
    }
    const orphanedPattern = /\[(?!PERSON_|COMPANY_|ADDRESS_|EMAIL_|PHONE_|SSN_|TAX_ID_|CARD_|IBAN_|DATE_|AMOUNT_|ID_|SIGNATURE_|PARTY_|NOTICE_|REDACTED_)[^\]]+\]/g;
    let match;
    while ((match = orphanedPattern.exec(anonymized)) !== null) {
        issues.push({
            type: 'placeholder_mismatch',
            description: `Unexpected placeholder format: ${match[0]}`,
            location: { start: match.index, end: match.index + match[0].length },
        });
    }
    let confidence = 1.0;
    for (const issue of issues) {
        if (issue.type === 'pii_leak') {
            confidence -= 0.2;
        }
        else if (issue.type === 'placeholder_mismatch') {
            confidence -= 0.05;
        }
        else {
            confidence -= 0.1;
        }
    }
    return {
        isValid: issues.filter(i => i.type === 'pii_leak').length === 0,
        issues,
        confidence: Math.max(0, confidence),
    };
}
async function batchAnonymize(documents, options = {}) {
    const { language = 'en', minConfidence = 0.5, config = types_1.DEFAULT_PLACEHOLDERS, sharedEntityMap = false, } = options;
    const results = [];
    let sharedState = null;
    if (sharedEntityMap) {
        sharedState = createPlaceholderState();
    }
    for (const doc of documents) {
        const detections = await (0, detector_1.detectPII)(doc.text, {
            language,
            minConfidence,
        });
        let anonymizedText;
        let placeholderMap;
        if (sharedState) {
            const sortedDetections = [...detections].sort((a, b) => b.start - a.start);
            let result = doc.text;
            for (const detection of sortedDetections) {
                if (detection.start < 0 || detection.end > result.length)
                    continue;
                const placeholder = getPlaceholder(detection.text, detection.category, sharedState, config);
                detection.placeholder = placeholder;
                result = result.slice(0, detection.start) + placeholder + result.slice(detection.end);
            }
            anonymizedText = result;
            placeholderMap = sharedState.entityMap;
        }
        else {
            const replacement = replaceWithPlaceholders(doc.text, detections, config);
            anonymizedText = replacement.anonymizedText;
            placeholderMap = replacement.placeholderMap;
        }
        const byCategory = {};
        const byMethod = {};
        for (const detection of detections) {
            byCategory[detection.category] = (byCategory[detection.category] || 0) + 1;
            byMethod[detection.method] = (byMethod[detection.method] || 0) + 1;
        }
        results.push({
            id: doc.id,
            result: {
                originalText: doc.text,
                anonymizedText,
                detections,
                placeholderMap,
                stats: {
                    totalDetections: detections.length,
                    byCategory,
                    byMethod,
                    textReductionPercent: doc.text.length > 0
                        ? ((doc.text.length - anonymizedText.length) / doc.text.length) * 100
                        : 0,
                },
            },
        });
    }
    return results;
}
//# sourceMappingURL=replacer.js.map