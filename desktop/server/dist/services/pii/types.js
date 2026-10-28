"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CONFIDENCE_THRESHOLDS = exports.DEFAULT_PLACEHOLDERS = exports.NER_LABEL_MAP = void 0;
exports.NER_LABEL_MAP = {
    'PERSON': 'person',
    'ORG': 'organization',
    'GPE': 'location',
    'LOC': 'location',
    'DATE': 'date',
    'MONEY': 'money',
    'NORP': 'organization',
};
exports.DEFAULT_PLACEHOLDERS = {
    person: '[PERSON_{n}]',
    organization: '[COMPANY_{n}]',
    location: '[ADDRESS_{n}]',
    default: '[REDACTED_{n}]',
};
exports.CONFIDENCE_THRESHOLDS = {
    low: 0.5,
    medium: 0.75,
    high: 0.9,
};
//# sourceMappingURL=types.js.map