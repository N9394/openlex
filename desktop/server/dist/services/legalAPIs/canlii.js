"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.IMPORTANT_CANADIAN_LEGISLATION = exports.IMPORTANT_CANADIAN_COURTS = exports.CanLIIClient = void 0;
exports.getCanLIIClient = getCanLIIClient;
exports.searchCanLII = searchCanLII;
exports.fetchCanLIICase = fetchCanLIICase;
const bottleneck_1 = __importDefault(require("bottleneck"));
const crypto = __importStar(require("crypto"));
const types_1 = require("./types");
const DEFAULT_CONFIG = types_1.DEFAULT_API_CONFIGS.canlii;
class CanLIIClient {
    baseUrl;
    apiKey;
    timeout;
    userAgent;
    limiter;
    language;
    constructor(config = {}) {
        this.baseUrl = config.baseUrl || DEFAULT_CONFIG.baseUrl;
        this.apiKey = config.apiKey || process.env.CANLII_API_KEY;
        this.timeout = config.timeout || DEFAULT_CONFIG.timeout;
        this.userAgent = config.userAgent || DEFAULT_CONFIG.userAgent;
        this.language = 'en';
        const rateLimit = config.rateLimit || DEFAULT_CONFIG.rateLimit;
        this.limiter = new bottleneck_1.default({
            maxConcurrent: 2,
            minTime: rateLimit.minDelay,
        });
        if (!this.apiKey) {
            console.warn('[CanLII] No API key provided. Set CANLII_API_KEY environment variable. ' +
                'API access may be limited without a key.');
        }
    }
    setLanguage(lang) {
        this.language = lang;
    }
    async request(endpoint, options = {}) {
        const { params } = options;
        const url = new URL(`${this.baseUrl}${endpoint}`);
        if (this.apiKey) {
            url.searchParams.set('api_key', this.apiKey);
        }
        url.searchParams.set('language', this.language);
        if (params) {
            for (const [key, value] of Object.entries(params)) {
                if (value !== undefined) {
                    url.searchParams.set(key, String(value));
                }
            }
        }
        return this.limiter.schedule(async () => {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), this.timeout);
            try {
                const response = await fetch(url.toString(), {
                    method: 'GET',
                    headers: {
                        'User-Agent': this.userAgent,
                        'Accept': 'application/json',
                    },
                    signal: controller.signal,
                });
                clearTimeout(timeoutId);
                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`CanLII API error ${response.status}: ${errorText}`);
                }
                return await response.json();
            }
            catch (error) {
                clearTimeout(timeoutId);
                if (error instanceof Error && error.name === 'AbortError') {
                    throw new Error('CanLII API request timeout');
                }
                throw error;
            }
        });
    }
    async listDatabases(type) {
        const response = await this.request('/caseBrowse');
        const databases = [];
        if (response.caseDatabases && (!type || type === 'case_law')) {
            databases.push(...response.caseDatabases.map(db => ({
                databaseId: db.databaseId,
                jurisdiction: db.jurisdiction,
                name: db.name,
                type: 'case_law',
            })));
        }
        if (response.legislationDatabases && (!type || type === 'legislation')) {
            databases.push(...response.legislationDatabases.map(db => ({
                databaseId: db.databaseId,
                jurisdiction: db.jurisdiction,
                name: db.name,
                type: 'legislation',
            })));
        }
        return databases;
    }
    async getDatabasesByJurisdiction(jurisdiction) {
        const all = await this.listDatabases();
        return all.filter(db => db.jurisdiction.toLowerCase() === jurisdiction.toLowerCase());
    }
    async searchCases(query, filters = {}, options = {}) {
        const { offset = 0, resultCount = 20 } = options;
        const params = {
            text: query,
            offset,
            resultCount,
        };
        if (filters.databaseId) {
            params.databaseId = filters.databaseId;
        }
        if (filters.jurisdiction) {
            params.jurisdiction = filters.jurisdiction;
        }
        if (filters.decisionDateRange?.start) {
            params.decisionDateAfter = filters.decisionDateRange.start;
        }
        if (filters.decisionDateRange?.end) {
            params.decisionDateBefore = filters.decisionDateRange.end;
        }
        const response = await this.request('/search/caseBrowse', { params });
        const results = response.results.map(r => ({
            caseId: r.caseId,
            databaseId: r.databaseId,
            title: r.title,
            citation: r.citation,
            decisionDate: r.decisionDate || '',
            language: (r.language === 'en' || r.language === 'fr') ? r.language : 'bilingual',
            docketNumber: r.docketNumber,
            keywords: r.keywords,
        }));
        return {
            resultCount: response.resultCount,
            results,
        };
    }
    async searchAll(query, filters = {}, options = {}) {
        const { maxResults = 500, onProgress } = options;
        const results = [];
        const pageSize = 20;
        let offset = 0;
        while (results.length < maxResults) {
            const response = await this.searchCases(query, filters, {
                offset,
                resultCount: pageSize,
            });
            results.push(...response.results);
            onProgress?.(results.length, Math.min(response.resultCount, maxResults));
            if (response.results.length < pageSize || results.length >= maxResults) {
                break;
            }
            offset += pageSize;
        }
        return results.slice(0, maxResults);
    }
    async getCaseMetadata(databaseId, caseId) {
        try {
            const response = await this.request(`/caseBrowse/${databaseId}/${caseId}`);
            return {
                caseId: response.caseId,
                databaseId: response.databaseId,
                title: response.title,
                citation: response.citation,
                decisionDate: response.decisionDate || '',
                language: (response.language === 'en' || response.language === 'fr')
                    ? response.language
                    : 'bilingual',
                docketNumber: response.docketNumber,
                keywords: response.keywords,
            };
        }
        catch (error) {
            console.error(`[CanLII] Error fetching case metadata ${databaseId}/${caseId}:`, error);
            return null;
        }
    }
    async getCase(databaseId, caseId) {
        try {
            const metadata = await this.getCaseMetadata(databaseId, caseId);
            if (!metadata) {
                return null;
            }
            const content = await this.request(`/caseBrowse/${databaseId}/${caseId}/en`);
            if (!content.content) {
                return null;
            }
            const contentHash = crypto.createHash('sha256').update(content.content).digest('hex');
            return {
                sourceId: `canlii_${databaseId}_${caseId}`,
                source: 'canlii',
                title: metadata.title,
                content: this.stripHtml(content.content),
                url: `https://www.canlii.org/en/${this.getJurisdictionPath(databaseId)}/${databaseId}/doc/${caseId}`,
                jurisdiction: this.extractJurisdiction(databaseId),
                date: metadata.decisionDate ? new Date(metadata.decisionDate) : undefined,
                citation: metadata.citation,
                caseId: metadata.caseId.en,
                databaseId,
                officialCitation: metadata.citation,
                docketNumber: metadata.docketNumber,
                keywords: metadata.keywords,
                citedCases: content.citedCases,
                citingCases: content.citingCases,
                contentHash,
                fetchedAt: new Date(),
            };
        }
        catch (error) {
            console.error(`[CanLII] Error fetching case ${databaseId}/${caseId}:`, error);
            return null;
        }
    }
    async listLegislation(databaseId, options = {}) {
        const { offset = 0, resultCount = 50 } = options;
        const response = await this.request(`/legislationBrowse/${databaseId}`, { params: { offset, resultCount } });
        return response.legislations || [];
    }
    async getLegislation(databaseId, legislationId) {
        try {
            const response = await this.request(`/legislationBrowse/${databaseId}/${legislationId}/en`);
            const content = response.content || '';
            const contentHash = crypto.createHash('sha256').update(content).digest('hex');
            return {
                sourceId: `canlii_leg_${databaseId}_${legislationId}`,
                source: 'canlii',
                title: response.title,
                content: this.stripHtml(content),
                url: `https://www.canlii.org/en/${this.getJurisdictionPath(databaseId)}/${databaseId}/laws/${legislationId}`,
                jurisdiction: this.extractJurisdiction(databaseId),
                citation: response.citation,
                legislationId,
                databaseId,
                legislationType: this.parseLegislationType(response.type),
                inForce: response.inForce,
                sections: response.sections?.map(s => ({
                    number: s.number,
                    title: s.title,
                    content: this.stripHtml(s.content),
                })),
                contentHash,
                fetchedAt: new Date(),
            };
        }
        catch (error) {
            console.error(`[CanLII] Error fetching legislation ${databaseId}/${legislationId}:`, error);
            return null;
        }
    }
    async fetchCasesFromCourt(databaseId, options = {}) {
        const { limit = 100, startDate, endDate, onProgress } = options;
        const filters = {
            databaseId,
        };
        if (startDate || endDate) {
            filters.decisionDateRange = {
                start: startDate,
                end: endDate,
            };
        }
        const searchResults = await this.searchAll('*', filters, {
            maxResults: limit,
            onProgress,
        });
        const cases = [];
        for (const metadata of searchResults) {
            try {
                const fullCase = await this.getCase(metadata.databaseId, metadata.caseId.en);
                if (fullCase) {
                    cases.push(fullCase);
                }
            }
            catch (error) {
                console.error(`[CanLII] Error fetching case ${metadata.caseId.en}:`, error);
            }
        }
        return cases;
    }
    async fetchSCCCases(options = {}) {
        const { daysBack = 365, limit = 50, onProgress } = options;
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - daysBack);
        return this.fetchCasesFromCourt('scc-csc', {
            limit,
            startDate: startDate.toISOString().split('T')[0],
            onProgress,
        });
    }
    async fetchFCACases(options = {}) {
        const { daysBack = 365, limit = 50, onProgress } = options;
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - daysBack);
        return this.fetchCasesFromCourt('fca-caf', {
            limit,
            startDate: startDate.toISOString().split('T')[0],
            onProgress,
        });
    }
    getJurisdictionPath(databaseId) {
        const jurisdictionMap = {
            'scc-csc': 'ca',
            'fca-caf': 'ca',
            'fc-cf': 'ca',
            'tcc-cci': 'ca',
        };
        const provinceMatch = databaseId.match(/^(on|bc|ab|qc|mb|sk|ns|nb|nl|pe|yt|nt|nu)/);
        if (provinceMatch) {
            return provinceMatch[1];
        }
        return jurisdictionMap[databaseId] || 'ca';
    }
    extractJurisdiction(databaseId) {
        const jurisdictionMap = {
            'scc-csc': 'CA',
            'fca-caf': 'CA',
            'fc-cf': 'CA',
            'tcc-cci': 'CA',
            'on': 'CA-ON',
            'bc': 'CA-BC',
            'ab': 'CA-AB',
            'qc': 'CA-QC',
            'mb': 'CA-MB',
            'sk': 'CA-SK',
            'ns': 'CA-NS',
            'nb': 'CA-NB',
            'nl': 'CA-NL',
            'pe': 'CA-PE',
            'yt': 'CA-YT',
            'nt': 'CA-NT',
            'nu': 'CA-NU',
        };
        if (jurisdictionMap[databaseId]) {
            return jurisdictionMap[databaseId];
        }
        for (const [prefix, jurisdiction] of Object.entries(jurisdictionMap)) {
            if (databaseId.startsWith(prefix)) {
                return jurisdiction;
            }
        }
        return 'CA';
    }
    parseLegislationType(type) {
        if (!type)
            return 'statute';
        const lower = type.toLowerCase();
        if (lower.includes('regulation'))
            return 'regulation';
        if (lower.includes('rule'))
            return 'rule';
        if (lower.includes('order'))
            return 'order';
        return 'statute';
    }
    stripHtml(html) {
        return html
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/\s+/g, ' ')
            .trim();
    }
}
exports.CanLIIClient = CanLIIClient;
let clientInstance = null;
function getCanLIIClient() {
    if (!clientInstance) {
        clientInstance = new CanLIIClient();
    }
    return clientInstance;
}
async function searchCanLII(query, filters) {
    const client = getCanLIIClient();
    const result = await client.searchCases(query, filters);
    return result.results;
}
async function fetchCanLIICase(databaseId, caseId) {
    const client = getCanLIIClient();
    return client.getCase(databaseId, caseId);
}
exports.IMPORTANT_CANADIAN_COURTS = [
    'scc-csc',
    'fca-caf',
    'fc-cf',
    'tcc-cci',
    'onca',
    'bcca',
    'abca',
    'qcca',
    'mbca',
];
exports.IMPORTANT_CANADIAN_LEGISLATION = [
    'csc-rsc',
    'src-crc',
    'rso-1990',
    'rsbc-1996',
    'rsa-2000',
];
//# sourceMappingURL=canlii.js.map