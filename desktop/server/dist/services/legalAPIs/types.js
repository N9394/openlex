"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_API_CONFIGS = void 0;
exports.DEFAULT_API_CONFIGS = {
    courtlistener: {
        baseUrl: 'https://www.courtlistener.com/api/rest/v4',
        timeout: 30000,
        userAgent: 'OpenLex-Bot/1.0 (+https://github.com/N9394/openlex)',
        rateLimit: {
            maxRequests: 5000,
            windowMs: 60 * 60 * 1000,
            minDelay: 750,
        },
    },
    eurlex: {
        baseUrl: 'https://eur-lex.europa.eu',
        sparqlEndpoint: 'https://publications.europa.eu/webapi/rdf/sparql',
        timeout: 30000,
        userAgent: 'OpenLex-Bot/1.0 (+https://github.com/N9394/openlex)',
        rateLimit: {
            maxRequests: 1000,
            windowMs: 60 * 60 * 1000,
            minDelay: 1000,
        },
    },
    canlii: {
        baseUrl: 'https://api.canlii.org/v1',
        timeout: 30000,
        userAgent: 'OpenLex-Bot/1.0 (+https://github.com/N9394/openlex)',
        rateLimit: {
            maxRequests: 1000,
            windowMs: 60 * 60 * 1000,
            minDelay: 1000,
        },
    },
};
//# sourceMappingURL=types.js.map