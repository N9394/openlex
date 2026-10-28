"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectPII = detectPII;
exports.detectPIISync = detectPIISync;
exports.getDetectionStats = getDetectionStats;
exports.likelyContainsPII = likelyContainsPII;
exports.extractUniqueEntities = extractUniqueEntities;
const patterns_1 = require("./patterns");
const spacyService_1 = require("./spacyService");
const legalContext_1 = require("./legalContext");
async function detectPII(text, options = {}) {
    const { language = 'en', categories, minConfidence = 0.5, useNER = true, useRegex = true, useLegalContext = true, customPatterns = [], } = options;
    const allDetections = [];
    if (useRegex) {
        const patterns = customPatterns.length > 0
            ? [...patterns_1.ALL_PATTERNS, ...customPatterns]
            : patterns_1.ALL_PATTERNS;
        const regexDetections = (0, patterns_1.detectWithPatterns)(text, patterns, minConfidence);
        allDetections.push(...regexDetections);
    }
    if (useNER) {
        const { detections: nerDetections, serviceUsed } = await (0, spacyService_1.detectWithNERSafe)(text, language);
        if (serviceUsed) {
            allDetections.push(...nerDetections);
        }
        else {
            console.warn('[PII] NER service unavailable, using regex-only detection');
        }
    }
    if (useLegalContext) {
        const legalContexts = (0, legalContext_1.detectLegalContexts)(text);
        const contextDetections = (0, legalContext_1.legalContextToPIIDetections)(legalContexts);
        allDetections.push(...contextDetections);
    }
    let processedDetections = mergeDetections(allDetections);
    processedDetections = validateDetections(processedDetections, text);
    processedDetections = filterByConfidence(processedDetections, minConfidence);
    if (categories && categories.length > 0) {
        processedDetections = processedDetections.filter(d => categories.includes(d.category));
    }
    return processedDetections.sort((a, b) => a.start - b.start);
}
function detectPIISync(text, options = {}) {
    const { categories, minConfidence = 0.5, useRegex = true, useLegalContext = true, customPatterns = [], } = options;
    const allDetections = [];
    if (useRegex) {
        const patterns = customPatterns.length > 0
            ? [...patterns_1.ALL_PATTERNS, ...customPatterns]
            : patterns_1.ALL_PATTERNS;
        const regexDetections = (0, patterns_1.detectWithPatterns)(text, patterns, minConfidence);
        allDetections.push(...regexDetections);
    }
    if (useLegalContext) {
        const legalContexts = (0, legalContext_1.detectLegalContexts)(text);
        const contextDetections = (0, legalContext_1.legalContextToPIIDetections)(legalContexts);
        allDetections.push(...contextDetections);
    }
    let processedDetections = mergeDetections(allDetections);
    processedDetections = validateDetections(processedDetections, text);
    processedDetections = filterByConfidence(processedDetections, minConfidence);
    if (categories && categories.length > 0) {
        processedDetections = processedDetections.filter(d => categories.includes(d.category));
    }
    return processedDetections.sort((a, b) => a.start - b.start);
}
function mergeDetections(detections) {
    if (detections.length === 0)
        return [];
    const sorted = [...detections].sort((a, b) => a.start - b.start);
    const merged = [];
    for (const detection of sorted) {
        const existing = merged.find(m => overlaps(m, detection) && m.category === detection.category);
        if (existing) {
            if (detection.confidence > existing.confidence) {
                existing.text = detection.text;
                existing.confidence = detection.confidence;
                existing.confidenceLevel = detection.confidenceLevel;
                existing.method = detection.method;
            }
            existing.start = Math.min(existing.start, detection.start);
            existing.end = Math.max(existing.end, detection.end);
        }
        else {
            const duplicate = merged.find(m => m.text === detection.text && m.category === detection.category);
            if (duplicate) {
                if (duplicate.method !== detection.method) {
                    duplicate.confidence = Math.min(0.99, duplicate.confidence + 0.05);
                    duplicate.confidenceLevel = getConfidenceLevel(duplicate.confidence);
                    duplicate.context = `${duplicate.context}, ${detection.context}`;
                }
            }
            else {
                merged.push({ ...detection });
            }
        }
    }
    return merged;
}
function overlaps(a, b) {
    return !(a.end <= b.start || b.end <= a.start);
}
function validateDetections(detections, originalText) {
    return detections.map(detection => {
        const validated = { ...detection };
        switch (detection.category) {
            case 'ssn':
                if (!(0, patterns_1.validateSSN)(detection.text)) {
                    validated.confidence *= 0.5;
                    validated.confidenceLevel = getConfidenceLevel(validated.confidence);
                    validated.context = (validated.context || '') + ' (invalid format)';
                }
                break;
            case 'credit_card':
                if (!(0, patterns_1.validateCreditCard)(detection.text)) {
                    validated.confidence *= 0.6;
                    validated.confidenceLevel = getConfidenceLevel(validated.confidence);
                    validated.context = (validated.context || '') + ' (invalid checksum)';
                }
                break;
            case 'iban':
                if (!(0, patterns_1.validateIBAN)(detection.text)) {
                    validated.confidence *= 0.6;
                    validated.confidenceLevel = getConfidenceLevel(validated.confidence);
                    validated.context = (validated.context || '') + ' (invalid checksum)';
                }
                break;
            case 'email':
                if (!isValidEmail(detection.text)) {
                    validated.confidence *= 0.7;
                    validated.confidenceLevel = getConfidenceLevel(validated.confidence);
                }
                break;
            case 'person':
                const nameCount = countOccurrences(originalText, detection.text);
                if (nameCount > 1) {
                    validated.confidence = Math.min(0.99, validated.confidence + 0.05 * (nameCount - 1));
                    validated.confidenceLevel = getConfidenceLevel(validated.confidence);
                }
                break;
            case 'date':
                if (isLikelyNonPIIDate(detection.text, originalText, detection.start)) {
                    validated.confidence *= 0.5;
                    validated.confidenceLevel = getConfidenceLevel(validated.confidence);
                }
                break;
        }
        return validated;
    });
}
function isValidEmail(email) {
    const falsePositives = ['example.com', 'test.com', 'placeholder'];
    if (falsePositives.some(fp => email.toLowerCase().includes(fp))) {
        return false;
    }
    return true;
}
function isLikelyNonPIIDate(dateText, fullText, position) {
    const contextStart = Math.max(0, position - 50);
    const contextEnd = Math.min(fullText.length, position + dateText.length + 50);
    const context = fullText.substring(contextStart, contextEnd).toLowerCase();
    const nonPIIIndicators = [
        'effective date',
        'dated as of',
        'executed on',
        'agreement date',
        'contract date',
        'commencement date',
        'termination date',
        'expiration date',
    ];
    return nonPIIIndicators.some(indicator => context.includes(indicator));
}
function countOccurrences(text, search) {
    const regex = new RegExp(escapeRegExp(search), 'gi');
    return (text.match(regex) || []).length;
}
function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function filterByConfidence(detections, minConfidence) {
    return detections.filter(d => d.confidence >= minConfidence);
}
function getConfidenceLevel(confidence) {
    if (confidence >= 0.9)
        return 'high';
    if (confidence >= 0.75)
        return 'medium';
    return 'low';
}
function getDetectionStats(detections) {
    const byCategory = {};
    const byMethod = {};
    let totalConfidence = 0;
    for (const detection of detections) {
        byCategory[detection.category] = (byCategory[detection.category] || 0) + 1;
        byMethod[detection.method] = (byMethod[detection.method] || 0) + 1;
        totalConfidence += detection.confidence;
    }
    return {
        total: detections.length,
        byCategory: byCategory,
        byMethod,
        averageConfidence: detections.length > 0 ? totalConfidence / detections.length : 0,
    };
}
function likelyContainsPII(text) {
    const quickPatterns = [
        /\d{3}-\d{2}-\d{4}/,
        /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
        /\+?\d{10,}/,
        /\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}/,
        /[A-Z]{2}\d{2}[A-Z0-9]{10,30}/,
    ];
    return quickPatterns.some(pattern => pattern.test(text));
}
function extractUniqueEntities(detections) {
    const entities = new Map();
    for (const detection of detections) {
        if (!entities.has(detection.category)) {
            entities.set(detection.category, new Set());
        }
        entities.get(detection.category).add(detection.text);
    }
    return entities;
}
//# sourceMappingURL=detector.js.map