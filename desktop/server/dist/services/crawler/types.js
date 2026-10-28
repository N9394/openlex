"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_SOURCE_CONFIGS = void 0;
exports.DEFAULT_SOURCE_CONFIGS = {
    ris_austria: {
        baseUrl: 'https://www.ris.bka.gv.at',
        rateLimit: 3000,
        maxConcurrent: 2,
        userAgent: 'LexVault-Bot/1.0 (+https://lexvault.app/bot)',
        respectRobotsTxt: true,
        jurisdictions: ['AT'],
        languages: ['de'],
        requiresAuth: false,
        useHeadless: true,
    },
    bailii_uk: {
        baseUrl: 'https://www.bailii.org',
        rateLimit: 2000,
        maxConcurrent: 3,
        userAgent: 'LexVault-Bot/1.0 (+https://lexvault.app/bot)',
        respectRobotsTxt: true,
        jurisdictions: ['UK', 'IE'],
        languages: ['en'],
        requiresAuth: false,
        useHeadless: false,
    },
    eur_lex: {
        baseUrl: 'https://eur-lex.europa.eu',
        rateLimit: 2000,
        maxConcurrent: 2,
        userAgent: 'LexVault-Bot/1.0 (+https://lexvault.app/bot)',
        respectRobotsTxt: true,
        jurisdictions: ['EU'],
        languages: ['en', 'de', 'fr'],
        requiresAuth: false,
        useHeadless: false,
    },
};
//# sourceMappingURL=types.js.map