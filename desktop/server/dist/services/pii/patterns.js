"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ALL_PATTERNS = void 0;
exports.getPatternsByJurisdiction = getPatternsByJurisdiction;
exports.getPatternsByCategory = getPatternsByCategory;
exports.detectWithPatterns = detectWithPatterns;
exports.validateSSN = validateSSN;
exports.validateCreditCard = validateCreditCard;
exports.validateIBAN = validateIBAN;
const US_PATTERNS = [
    {
        id: 'us_ssn',
        name: 'US Social Security Number',
        pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
        category: 'ssn',
        confidence: 0.95,
        jurisdictions: ['US'],
        description: 'US SSN in XXX-XX-XXXX format',
    },
    {
        id: 'us_ssn_no_dashes',
        name: 'US SSN (no dashes)',
        pattern: /\b(?<!\d)\d{9}(?!\d)\b/g,
        category: 'ssn',
        confidence: 0.7,
        jurisdictions: ['US'],
        description: 'US SSN as 9 consecutive digits',
    },
    {
        id: 'us_ein',
        name: 'US Employer ID Number',
        pattern: /\b\d{2}-\d{7}\b/g,
        category: 'tax_id',
        confidence: 0.85,
        jurisdictions: ['US'],
        description: 'US EIN in XX-XXXXXXX format',
    },
    {
        id: 'us_itin',
        name: 'US ITIN',
        pattern: /\b9\d{2}-[7-9]\d-\d{4}\b/g,
        category: 'tax_id',
        confidence: 0.9,
        jurisdictions: ['US'],
        description: 'US Individual Taxpayer ID Number',
    },
];
const EUROPEAN_PATTERNS = [
    {
        id: 'de_tax_id',
        name: 'German Tax ID (Steuernummer)',
        pattern: /\b\d{2}\/\d{3}\/\d{5}\b/g,
        category: 'tax_id',
        confidence: 0.9,
        jurisdictions: ['DE'],
        description: 'German Steuernummer format',
    },
    {
        id: 'de_id_number',
        name: 'German ID Number (Steuer-IdNr)',
        pattern: /\b\d{11}\b/g,
        category: 'tax_id',
        confidence: 0.6,
        jurisdictions: ['DE'],
        description: 'German Steueridentifikationsnummer (11 digits)',
    },
    {
        id: 'at_svn',
        name: 'Austrian Social Insurance Number',
        pattern: /\b\d{4}\s?\d{6}\b/g,
        category: 'ssn',
        confidence: 0.85,
        jurisdictions: ['AT'],
        description: 'Austrian Sozialversicherungsnummer (XXXX XXXXXX)',
    },
    {
        id: 'ch_ahv',
        name: 'Swiss AHV Number',
        pattern: /\b756\.\d{4}\.\d{4}\.\d{2}\b/g,
        category: 'ssn',
        confidence: 0.95,
        jurisdictions: ['CH'],
        description: 'Swiss AHV/OASI number',
    },
];
const FINANCIAL_PATTERNS = [
    {
        id: 'credit_card',
        name: 'Credit Card Number',
        pattern: /\b(?:\d{4}[\s\-]?){3}\d{4}\b/g,
        category: 'credit_card',
        confidence: 0.85,
        description: 'Credit card number (16 digits with optional separators)',
    },
    {
        id: 'credit_card_masked',
        name: 'Masked Credit Card',
        pattern: /\b(?:\*{4}[\s\-]?){3}\d{4}\b/g,
        category: 'credit_card',
        confidence: 0.95,
        description: 'Masked credit card showing last 4 digits',
    },
    {
        id: 'iban',
        name: 'IBAN',
        pattern: /\b[A-Z]{2}\d{2}[A-Z0-9]{4,30}\b/g,
        category: 'iban',
        confidence: 0.9,
        description: 'International Bank Account Number',
    },
    {
        id: 'bic_swift',
        name: 'BIC/SWIFT Code',
        pattern: /\b[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b/g,
        category: 'iban',
        confidence: 0.8,
        description: 'Bank Identifier Code',
    },
];
const CONTACT_PATTERNS = [
    {
        id: 'email',
        name: 'Email Address',
        pattern: /\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/g,
        category: 'email',
        confidence: 0.95,
        description: 'Email address',
    },
    {
        id: 'phone_intl',
        name: 'International Phone',
        pattern: /\+\d{1,3}[\s\-\.]?\(?\d{1,4}\)?[\s\-\.]?\d{1,4}[\s\-\.]?\d{1,9}/g,
        category: 'phone',
        confidence: 0.85,
        description: 'International phone number with country code',
    },
    {
        id: 'phone_us',
        name: 'US Phone Number',
        pattern: /\b(?:\+1[\s\-\.]?)?\(?\d{3}\)?[\s\-\.]?\d{3}[\s\-\.]?\d{4}\b/g,
        category: 'phone',
        confidence: 0.8,
        jurisdictions: ['US', 'CA'],
        description: 'US/Canada phone number',
    },
    {
        id: 'phone_de',
        name: 'German Phone Number',
        pattern: /\b(?:\+49[\s\-\.]?|0)[\d\s\-\.]{6,14}\b/g,
        category: 'phone',
        confidence: 0.75,
        jurisdictions: ['DE', 'AT'],
        description: 'German/Austrian phone number',
    },
    {
        id: 'url',
        name: 'URL',
        pattern: /https?:\/\/[^\s<>"{}|\\^`\[\]]+/g,
        category: 'other',
        confidence: 0.5,
        description: 'Web URL',
    },
];
const DATE_PATTERNS = [
    {
        id: 'date_iso',
        name: 'ISO Date',
        pattern: /\b\d{4}-\d{2}-\d{2}\b/g,
        category: 'date',
        confidence: 0.6,
        description: 'ISO format date (YYYY-MM-DD)',
    },
    {
        id: 'date_us',
        name: 'US Date Format',
        pattern: /\b(?:0?[1-9]|1[0-2])\/(?:0?[1-9]|[12]\d|3[01])\/(?:19|20)?\d{2}\b/g,
        category: 'date',
        confidence: 0.6,
        jurisdictions: ['US'],
        description: 'US date format (MM/DD/YYYY)',
    },
    {
        id: 'date_eu',
        name: 'EU Date Format',
        pattern: /\b(?:0?[1-9]|[12]\d|3[01])\.(?:0?[1-9]|1[0-2])\.(?:19|20)?\d{2}\b/g,
        category: 'date',
        confidence: 0.6,
        jurisdictions: ['DE', 'AT', 'CH'],
        description: 'European date format (DD.MM.YYYY)',
    },
    {
        id: 'date_written',
        name: 'Written Date',
        pattern: /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}\b/gi,
        category: 'date',
        confidence: 0.6,
        description: 'Written date (Month Day, Year)',
    },
];
const ID_PATTERNS = [
    {
        id: 'passport',
        name: 'Passport Number',
        pattern: /\bpassport\s*(?:#|no\.?|number)?:?\s*([A-Z0-9]{6,12})\b/gi,
        category: 'id_number',
        confidence: 0.9,
        description: 'Passport number with label',
    },
    {
        id: 'driver_license',
        name: 'Driver License',
        pattern: /\b(?:driver'?s?\s*)?licen[sc]e\s*(?:#|no\.?|number)?:?\s*([A-Z0-9\-]{5,20})\b/gi,
        category: 'id_number',
        confidence: 0.85,
        description: 'Driver license number with label',
    },
    {
        id: 'case_number',
        name: 'Case/Docket Number',
        pattern: /\b(?:case|docket|file)\s*(?:#|no\.?|number)?:?\s*([A-Z0-9\-:\/]{5,30})\b/gi,
        category: 'id_number',
        confidence: 0.7,
        description: 'Legal case or docket number',
    },
];
exports.ALL_PATTERNS = [
    ...US_PATTERNS,
    ...EUROPEAN_PATTERNS,
    ...FINANCIAL_PATTERNS,
    ...CONTACT_PATTERNS,
    ...DATE_PATTERNS,
    ...ID_PATTERNS,
];
function getPatternsByJurisdiction(jurisdiction) {
    if (!jurisdiction) {
        return exports.ALL_PATTERNS;
    }
    return exports.ALL_PATTERNS.filter(p => !p.jurisdictions || p.jurisdictions.includes(jurisdiction));
}
function getPatternsByCategory(categories) {
    return exports.ALL_PATTERNS.filter(p => categories.includes(p.category));
}
function detectWithPatterns(text, patterns = exports.ALL_PATTERNS, minConfidence = 0.5) {
    const detections = [];
    const seen = new Set();
    for (const patternDef of patterns) {
        if (patternDef.confidence < minConfidence) {
            continue;
        }
        patternDef.pattern.lastIndex = 0;
        let match;
        while ((match = patternDef.pattern.exec(text)) !== null) {
            const key = `${match.index}-${match[0]}`;
            if (seen.has(key))
                continue;
            seen.add(key);
            detections.push({
                text: match[0],
                category: patternDef.category,
                start: match.index,
                end: match.index + match[0].length,
                method: 'regex',
                confidence: patternDef.confidence,
                confidenceLevel: patternDef.confidence >= 0.9 ? 'high' :
                    patternDef.confidence >= 0.75 ? 'medium' : 'low',
                context: patternDef.name,
            });
        }
    }
    return detections.sort((a, b) => a.start - b.start);
}
function validateSSN(ssn) {
    const cleaned = ssn.replace(/\D/g, '');
    if (cleaned.length !== 9)
        return false;
    const area = parseInt(cleaned.substring(0, 3), 10);
    if (area === 0 || area === 666 || area >= 900)
        return false;
    const group = parseInt(cleaned.substring(3, 5), 10);
    if (group === 0)
        return false;
    const serial = parseInt(cleaned.substring(5, 9), 10);
    if (serial === 0)
        return false;
    return true;
}
function validateCreditCard(number) {
    const cleaned = number.replace(/\D/g, '');
    if (cleaned.length < 13 || cleaned.length > 19)
        return false;
    let sum = 0;
    let isEven = false;
    for (let i = cleaned.length - 1; i >= 0; i--) {
        let digit = parseInt(cleaned[i], 10);
        if (isEven) {
            digit *= 2;
            if (digit > 9) {
                digit -= 9;
            }
        }
        sum += digit;
        isEven = !isEven;
    }
    return sum % 10 === 0;
}
function validateIBAN(iban) {
    const cleaned = iban.replace(/\s/g, '').toUpperCase();
    if (cleaned.length < 15 || cleaned.length > 34)
        return false;
    const rearranged = cleaned.substring(4) + cleaned.substring(0, 4);
    let numStr = '';
    for (const char of rearranged) {
        if (char >= 'A' && char <= 'Z') {
            numStr += (char.charCodeAt(0) - 55).toString();
        }
        else {
            numStr += char;
        }
    }
    let remainder = 0;
    for (let i = 0; i < numStr.length; i++) {
        remainder = (remainder * 10 + parseInt(numStr[i], 10)) % 97;
    }
    return remainder === 1;
}
//# sourceMappingURL=patterns.js.map