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
exports.KEY_EU_LEGISLATION = exports.EURLexClient = void 0;
exports.parseCELEX = parseCELEX;
exports.getDocumentTypeFromCELEX = getDocumentTypeFromCELEX;
exports.getEURLexClient = getEURLexClient;
exports.searchEURLex = searchEURLex;
exports.fetchEURLexDocument = fetchEURLexDocument;
const bottleneck_1 = __importDefault(require("bottleneck"));
const crypto = __importStar(require("crypto"));
const types_1 = require("./types");
const DEFAULT_CONFIG = types_1.DEFAULT_API_CONFIGS.eurlex;
function parseCELEX(celex) {
    const match = celex.match(/^(\d)(\d{4})([A-Z])(\d+)$/);
    if (!match)
        return null;
    return {
        full: celex,
        sector: parseInt(match[1], 10),
        year: parseInt(match[2], 10),
        type: match[3],
        number: parseInt(match[4], 10),
    };
}
function getDocumentTypeFromCELEX(celex) {
    if (celex.sector === 3) {
        switch (celex.type) {
            case 'R': return 'regulation';
            case 'L': return 'directive';
            case 'D': return 'decision';
            case 'H': return 'recommendation';
            case 'A': return 'opinion';
            default: return 'other';
        }
    }
    if (celex.sector === 1)
        return 'treaty';
    if (celex.sector === 2)
        return 'agreement';
    if (celex.sector === 6)
        return 'case_law';
    return 'other';
}
class EURLexClient {
    baseUrl;
    sparqlEndpoint;
    timeout;
    userAgent;
    limiter;
    preferredLanguage;
    constructor(config = {}) {
        this.baseUrl = config.baseUrl || DEFAULT_CONFIG.baseUrl;
        this.sparqlEndpoint = DEFAULT_CONFIG.sparqlEndpoint;
        this.timeout = config.timeout || DEFAULT_CONFIG.timeout;
        this.userAgent = config.userAgent || DEFAULT_CONFIG.userAgent;
        this.preferredLanguage = 'EN';
        const rateLimit = config.rateLimit || DEFAULT_CONFIG.rateLimit;
        this.limiter = new bottleneck_1.default({
            maxConcurrent: 2,
            minTime: rateLimit.minDelay,
        });
    }
    setPreferredLanguage(lang) {
        this.preferredLanguage = lang.toUpperCase();
    }
    async sparqlQuery(query) {
        return this.limiter.schedule(async () => {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), this.timeout);
            try {
                const response = await fetch(this.sparqlEndpoint, {
                    method: 'POST',
                    headers: {
                        'User-Agent': this.userAgent,
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Accept': 'application/sparql-results+json',
                    },
                    body: `query=${encodeURIComponent(query)}`,
                    signal: controller.signal,
                });
                clearTimeout(timeoutId);
                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`EUR-Lex SPARQL error ${response.status}: ${errorText}`);
                }
                return await response.json();
            }
            catch (error) {
                clearTimeout(timeoutId);
                if (error instanceof Error && error.name === 'AbortError') {
                    throw new Error('EUR-Lex SPARQL request timeout');
                }
                throw error;
            }
        });
    }
    async searchLegislation(query, filters = {}, options = {}) {
        const { limit = 50, offset = 0 } = options;
        let sparql = `
      PREFIX cdm: <http://publications.europa.eu/ontology/cdm#>
      PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>

      SELECT DISTINCT ?celex ?title ?date ?type ?inForce
      WHERE {
        ?work cdm:resource_legal_id_celex ?celex .
        ?work cdm:work_has_expression ?expr .
        ?expr cdm:expression_title ?title .
        OPTIONAL { ?work cdm:work_date_document ?date }
        OPTIONAL { ?work cdm:resource_legal_type ?type }
        OPTIONAL { ?work cdm:resource_legal_in-force ?inForce }

        FILTER(CONTAINS(LCASE(?title), LCASE("${this.escapeString(query)}")))
    `;
        if (filters.type) {
            const types = Array.isArray(filters.type) ? filters.type : [filters.type];
            const typeFilters = types.map(t => `?type = "${this.mapDocumentType(t)}"`).join(' || ');
            sparql += `\n        FILTER(${typeFilters})`;
        }
        if (filters.year) {
            if (Array.isArray(filters.year)) {
                sparql += `\n        FILTER(YEAR(?date) >= ${filters.year[0]} && YEAR(?date) <= ${filters.year[1]})`;
            }
            else {
                sparql += `\n        FILTER(YEAR(?date) = ${filters.year})`;
            }
        }
        if (filters.inForce !== undefined) {
            sparql += `\n        FILTER(?inForce = ${filters.inForce})`;
        }
        if (filters.language) {
            sparql += `\n        FILTER(LANG(?title) = "${filters.language.toLowerCase()}")`;
        }
        sparql += `
      }
      ORDER BY DESC(?date)
      LIMIT ${limit}
      OFFSET ${offset}
    `;
        try {
            const result = await this.sparqlQuery(sparql);
            const documents = result.results.bindings.map(binding => ({
                celex: binding.celex?.value || '',
                title: { [this.preferredLanguage]: binding.title?.value || '' },
                date: binding.date?.value,
                type: this.parseDocumentType(binding.type?.value),
                inForce: binding.inForce?.value === 'true',
                languages: [this.preferredLanguage],
            }));
            return {
                totalHits: documents.length,
                documents,
            };
        }
        catch (error) {
            console.error('[EUR-Lex] Search error:', error);
            return { totalHits: 0, documents: [] };
        }
    }
    async getDocumentMetadata(celex) {
        const sparql = `
      PREFIX cdm: <http://publications.europa.eu/ontology/cdm#>

      SELECT ?title ?date ?ojDate ?ojRef ?type ?author ?inForce ?lang
      WHERE {
        ?work cdm:resource_legal_id_celex "${celex}" .
        ?work cdm:work_has_expression ?expr .
        ?expr cdm:expression_title ?title .
        ?expr cdm:expression_uses_language ?langUri .
        BIND(REPLACE(STR(?langUri), ".*/", "") AS ?lang)

        OPTIONAL { ?work cdm:work_date_document ?date }
        OPTIONAL { ?work cdm:work_date_publication ?ojDate }
        OPTIONAL { ?work cdm:published_in_official-journal ?ojRef }
        OPTIONAL { ?work cdm:resource_legal_type ?type }
        OPTIONAL { ?work cdm:work_created_by_agent ?author }
        OPTIONAL { ?work cdm:resource_legal_in-force ?inForce }
      }
    `;
        try {
            const result = await this.sparqlQuery(sparql);
            if (result.results.bindings.length === 0) {
                return null;
            }
            const titles = {};
            const languages = [];
            for (const binding of result.results.bindings) {
                const lang = binding.lang?.value || 'EN';
                if (binding.title?.value && !titles[lang]) {
                    titles[lang] = binding.title.value;
                    languages.push(lang);
                }
            }
            const first = result.results.bindings[0];
            return {
                celex,
                title: titles,
                date: first.date?.value,
                ojDate: first.ojDate?.value,
                ojRef: first.ojRef?.value,
                type: this.parseDocumentType(first.type?.value),
                author: first.author?.value,
                inForce: first.inForce?.value === 'true',
                languages,
            };
        }
        catch (error) {
            console.error(`[EUR-Lex] Error fetching metadata for ${celex}:`, error);
            return null;
        }
    }
    async getDocument(celex, language) {
        const lang = language?.toUpperCase() || this.preferredLanguage;
        try {
            const metadata = await this.getDocumentMetadata(celex).catch(() => null);
            const htmlUrl = `${this.baseUrl}/legal-content/${lang}/TXT/HTML/?uri=CELEX:${celex}`;
            const content = await this.fetchDocumentContent(htmlUrl);
            if (!content) {
                const altUrl = `${this.baseUrl}/legal-content/${lang}/ALL/?uri=CELEX:${celex}`;
                const altContent = await this.fetchDocumentContent(altUrl);
                if (!altContent) {
                    console.warn(`[EUR-Lex] Could not fetch content for ${celex}`);
                    return null;
                }
            }
            const finalContent = content || '';
            const parsedCelex = parseCELEX(celex);
            const contentHash = crypto.createHash('sha256').update(finalContent).digest('hex');
            const title = metadata?.title[lang]
                || (metadata?.title && metadata.title[Object.keys(metadata.title)[0]])
                || celex;
            return {
                sourceId: `eurlex_${celex}`,
                source: 'eurlex',
                title,
                content: finalContent,
                url: `${this.baseUrl}/legal-content/${lang}/ALL/?uri=CELEX:${celex}`,
                jurisdiction: 'EU',
                date: metadata?.date ? new Date(metadata.date) : undefined,
                celex,
                documentType: parsedCelex ? getDocumentTypeFromCELEX(parsedCelex) : (metadata?.type || 'other'),
                ojReference: metadata?.ojRef,
                inForce: metadata?.inForce,
                languages: metadata?.languages || [lang],
                contentHash,
                fetchedAt: new Date(),
            };
        }
        catch (error) {
            console.error(`[EUR-Lex] Error fetching document ${celex}:`, error);
            return null;
        }
    }
    async fetchDocumentContent(url) {
        return this.limiter.schedule(async () => {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), this.timeout);
            try {
                const response = await fetch(url, {
                    method: 'GET',
                    headers: {
                        'User-Agent': this.userAgent,
                        'Accept': 'text/html',
                    },
                    signal: controller.signal,
                });
                clearTimeout(timeoutId);
                if (!response.ok) {
                    console.warn(`[EUR-Lex] HTTP ${response.status} for ${url}`);
                    return null;
                }
                const html = await response.text();
                const content = this.extractHtmlContent(html);
                if (!content || content.length < 100) {
                    console.warn(`[EUR-Lex] Content too short (${content?.length || 0} chars) for ${url}`);
                    return null;
                }
                return content;
            }
            catch (error) {
                clearTimeout(timeoutId);
                console.error(`[EUR-Lex] Fetch error for ${url}:`, error);
                return null;
            }
        });
    }
    extractHtmlContent(html) {
        const selectors = [
            /<div[^>]*id="document1"[^>]*>([\s\S]*?)<\/div>\s*(?:<div[^>]*id="document|$)/i,
            /<div[^>]*class="[^"]*eli-main-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
            /<div[^>]*class="[^"]*texte[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
            /<article[^>]*>([\s\S]*?)<\/article>/i,
            /<div[^>]*class="[^"]*docContent[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
            /<body[^>]*>([\s\S]*?)<\/body>/i,
        ];
        for (const selector of selectors) {
            const match = html.match(selector);
            if (match && match[1]) {
                const content = this.stripHtml(match[1]);
                if (content && content.length > 100) {
                    return content;
                }
            }
        }
        return this.stripHtml(html);
    }
    async getDirective(year, number, language) {
        const celex = `3${year}L${String(number).padStart(4, '0')}`;
        return this.getDocument(celex, language);
    }
    async getRegulation(year, number, language) {
        const celex = `3${year}R${String(number).padStart(4, '0')}`;
        return this.getDocument(celex, language);
    }
    async getDecision(year, number, language) {
        const celex = `3${year}D${String(number).padStart(4, '0')}`;
        return this.getDocument(celex, language);
    }
    async getCase(year, caseNumber, language) {
        const celex = `6${year}CJ${String(caseNumber).padStart(4, '0')}`;
        return this.getDocument(celex, language);
    }
    async fetchRecentLegislation(options = {}) {
        const { types = ['regulation', 'directive'], daysBack = 30, limit = 100, language, onProgress, } = options;
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - daysBack);
        const startYear = startDate.getFullYear();
        const searchResult = await this.searchLegislation('', {
            type: types,
            year: [startYear, new Date().getFullYear()],
            language: language || this.preferredLanguage.toLowerCase(),
        }, { limit });
        const documents = [];
        for (let i = 0; i < searchResult.documents.length; i++) {
            const meta = searchResult.documents[i];
            try {
                const doc = await this.getDocument(meta.celex, language);
                if (doc) {
                    documents.push(doc);
                }
            }
            catch (error) {
                console.error(`[EUR-Lex] Error fetching ${meta.celex}:`, error);
            }
            onProgress?.(i + 1, searchResult.documents.length);
        }
        return documents;
    }
    async fetchKeyRegulations() {
        const keyRegulations = [
            { year: 2016, number: 679 },
            { year: 2022, number: 1925 },
            { year: 2022, number: 2065 },
            { year: 2024, number: 1689 },
            { year: 2023, number: 2854 },
            { year: 2022, number: 868 },
            { year: 2019, number: 1150 },
            { year: 2014, number: 910 },
            { year: 2022, number: 2560 },
            { year: 2016, number: 1148 },
        ];
        const documents = [];
        for (const reg of keyRegulations) {
            try {
                const doc = await this.getRegulation(reg.year, reg.number);
                if (doc) {
                    documents.push(doc);
                    console.log(`[EUR-Lex] Fetched regulation ${reg.year}/${reg.number}`);
                }
            }
            catch (error) {
                console.error(`[EUR-Lex] Error fetching regulation ${reg.year}/${reg.number}:`, error);
            }
        }
        return documents;
    }
    mapDocumentType(type) {
        const mapping = {
            regulation: 'REG',
            directive: 'DIR',
            decision: 'DEC',
            recommendation: 'RECO',
            opinion: 'OPIN',
            treaty: 'TREATY',
            agreement: 'AGREE',
            case_law: 'CASE',
            other: 'OTHER',
        };
        return mapping[type] || 'OTHER';
    }
    parseDocumentType(typeUri) {
        if (!typeUri)
            return 'other';
        const type = typeUri.split('/').pop()?.toUpperCase() || '';
        const mapping = {
            'REG': 'regulation',
            'REGULATION': 'regulation',
            'DIR': 'directive',
            'DIRECTIVE': 'directive',
            'DEC': 'decision',
            'DECISION': 'decision',
            'RECO': 'recommendation',
            'RECOMMENDATION': 'recommendation',
            'OPIN': 'opinion',
            'OPINION': 'opinion',
        };
        return mapping[type] || 'other';
    }
    escapeString(str) {
        return str
            .replace(/\\/g, '\\\\')
            .replace(/"/g, '\\"')
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '\\r');
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
exports.EURLexClient = EURLexClient;
let clientInstance = null;
function getEURLexClient() {
    if (!clientInstance) {
        clientInstance = new EURLexClient();
    }
    return clientInstance;
}
async function searchEURLex(query, filters) {
    const client = getEURLexClient();
    const result = await client.searchLegislation(query, filters);
    return result.documents;
}
async function fetchEURLexDocument(celex, language) {
    const client = getEURLexClient();
    return client.getDocument(celex, language);
}
exports.KEY_EU_LEGISLATION = {
    GDPR: '32016R0679',
    DMA: '32022R1925',
    DSA: '32022R2065',
    AI_ACT: '32024R1689',
    DATA_ACT: '32023R2854',
    DATA_GOVERNANCE: '32022R0868',
    P2B_REGULATION: '32019R1150',
    EIDAS: '32014R0910',
    NIS2: '32022L2555',
    CYBER_RESILIENCE: '32024R2847',
};
//# sourceMappingURL=eurlex.js.map