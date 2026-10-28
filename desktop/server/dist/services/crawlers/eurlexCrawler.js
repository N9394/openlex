"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createEURLexCrawler = createEURLexCrawler;
const types_1 = require("./types");
const ingestion_1 = require("../rag/ingestion");
const grounding_1 = require("../rag/grounding");
const EURLEX_CONFIG = {
    ...types_1.DEFAULT_CRAWLER_CONFIG,
    baseUrl: 'https://eur-lex.europa.eu',
    jurisdiction: 'EU',
    rateLimit: 2,
    maxPages: 50,
};
const DOCUMENT_TYPES = {
    '3': { type: 'regulation', name: 'Regulation' },
    'L': { type: 'directive', name: 'Directive' },
    'C': { type: 'case_law', name: 'CJEU Case' },
    'E': { type: 'treaty', name: 'Treaty' },
};
class EURLexCrawler {
    name = 'eurlex';
    config;
    rateLimiter;
    constructor(config = {}) {
        this.config = { ...EURLEX_CONFIG, ...config };
        this.rateLimiter = new types_1.RateLimiter(this.config.rateLimit);
    }
    async crawl(options) {
        const config = { ...this.config, ...options };
        const result = {
            crawler: this.name,
            startedAt: new Date(),
            completedAt: new Date(),
            pagesCrawled: 0,
            documentsParsed: 0,
            documentsIngested: 0,
            errors: 0,
            errorMessages: [],
            amendmentsDetected: 0,
        };
        console.log(`[EUR-Lex] Starting crawl with config:`, {
            baseUrl: config.baseUrl,
            maxPages: config.maxPages,
        });
        try {
            await this.crawlDocumentType('regulation', config, result);
            await this.crawlDocumentType('directive', config, result);
            await this.crawlDocumentType('case_law', config, result);
        }
        catch (error) {
            result.errors++;
            result.errorMessages.push(`Fatal error: ${error instanceof Error ? error.message : String(error)}`);
        }
        result.completedAt = new Date();
        console.log(`[EUR-Lex] Crawl completed:`, {
            pagesCrawled: result.pagesCrawled,
            documentsParsed: result.documentsParsed,
            documentsIngested: result.documentsIngested,
            errors: result.errors,
            duration: `${(result.completedAt.getTime() - result.startedAt.getTime()) / 1000}s`,
        });
        return result;
    }
    async crawlDocumentType(docType, config, result) {
        if (result.pagesCrawled >= (config.maxPages || 50)) {
            return;
        }
        console.log(`[EUR-Lex] Fetching ${docType} documents...`);
        try {
            const searchResults = await this.searchDocuments(docType, config);
            result.pagesCrawled++;
            console.log(`[EUR-Lex] Found ${searchResults.length} ${docType} documents`);
            const remainingPages = (config.maxPages || 50) - result.pagesCrawled;
            const docsToProcess = searchResults.slice(0, Math.min(10, remainingPages));
            for (const doc of docsToProcess) {
                if (result.pagesCrawled >= (config.maxPages || 50)) {
                    break;
                }
                try {
                    const externalId = `eurlex:${doc.celex}`;
                    if (await this.isIngested(externalId)) {
                        console.log(`[EUR-Lex] Already ingested: ${doc.celex}`);
                        continue;
                    }
                    const fullDoc = await this.fetchDocument(doc.celex, config);
                    result.pagesCrawled++;
                    if (!fullDoc)
                        continue;
                    const parsed = await this.parse(JSON.stringify(fullDoc), doc.celex);
                    result.documentsParsed += parsed.length;
                    const ingested = await this.ingest(parsed);
                    result.documentsIngested += ingested;
                }
                catch (error) {
                    result.errors++;
                    result.errorMessages.push(`Error processing ${doc.celex}: ${error instanceof Error ? error.message : String(error)}`);
                }
            }
        }
        catch (error) {
            result.errors++;
            result.errorMessages.push(`Error searching ${docType}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    async searchDocuments(docType, config) {
        await this.rateLimiter.wait();
        const currentYear = new Date().getFullYear();
        let searchQuery = '';
        switch (docType) {
            case 'regulation':
                searchQuery = `DC_CODED:(REG) AND DD:(${currentYear - 1} OR ${currentYear})`;
                break;
            case 'directive':
                searchQuery = `DC_CODED:(DIR) AND DD:(${currentYear - 1} OR ${currentYear})`;
                break;
            case 'case_law':
                searchQuery = `DC_CODED:(J) AND DD:(${currentYear - 1} OR ${currentYear})`;
                break;
            default:
                return [];
        }
        const searchUrl = `${config.baseUrl}/search.html?scope=EURLEX&text=${encodeURIComponent(searchQuery)}&type=quick&page=1`;
        try {
            const response = await fetch(searchUrl, {
                headers: {
                    'User-Agent': config.userAgent || types_1.DEFAULT_CRAWLER_CONFIG.userAgent,
                    'Accept': 'application/json, text/html',
                },
            });
            if (!response.ok) {
                console.log(`[EUR-Lex] Search returned ${response.status}, using fallback`);
                return this.getFallbackDocuments(docType);
            }
            const html = await response.text();
            return this.extractSearchResults(html);
        }
        catch (error) {
            console.warn(`[EUR-Lex] Search error, using fallback:`, error);
            return this.getFallbackDocuments(docType);
        }
    }
    extractSearchResults(html) {
        const results = [];
        const celexPattern = /CELEX[^"]*:(\d[A-Z]\d+)/gi;
        const titlePattern = /<a[^>]*class="[^"]*title[^"]*"[^>]*>([^<]+)</gi;
        let celexMatch;
        const celexNumbers = [];
        while ((celexMatch = celexPattern.exec(html)) !== null) {
            if (!celexNumbers.includes(celexMatch[1])) {
                celexNumbers.push(celexMatch[1]);
            }
        }
        for (const celex of celexNumbers.slice(0, 20)) {
            results.push({
                celex,
                title: `EU Document ${celex}`,
            });
        }
        return results;
    }
    getFallbackDocuments(docType) {
        switch (docType) {
            case 'regulation':
                return [
                    { celex: '32016R0679', title: 'General Data Protection Regulation (GDPR)' },
                    { celex: '32024R1689', title: 'AI Act' },
                    { celex: '32022R2065', title: 'Digital Services Act' },
                ];
            case 'directive':
                return [
                    { celex: '32019L1937', title: 'Whistleblower Protection Directive' },
                    { celex: '32022L2464', title: 'Corporate Sustainability Reporting Directive' },
                ];
            case 'case_law':
                return [
                    { celex: '62014CJ0131', title: 'Schrems II' },
                    { celex: '62019CJ0311', title: 'Fashion ID Case' },
                ];
            default:
                return [];
        }
    }
    async fetchDocument(celex, config) {
        await this.rateLimiter.wait();
        const docUrl = `${config.baseUrl}/legal-content/EN/TXT/HTML/?uri=CELEX:${celex}`;
        try {
            const response = await fetch(docUrl, {
                headers: {
                    'User-Agent': config.userAgent || types_1.DEFAULT_CRAWLER_CONFIG.userAgent,
                    'Accept': 'text/html',
                },
            });
            if (!response.ok) {
                console.warn(`[EUR-Lex] Could not fetch ${celex}: ${response.status}`);
                return null;
            }
            const html = await response.text();
            const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
            const title = titleMatch
                ? titleMatch[1].replace(' - EUR-Lex', '').trim()
                : `EU Document ${celex}`;
            const textMatch = html.match(/<div[^>]*id="document\d*"[^>]*>([\s\S]*?)<\/div>/i)
                || html.match(/<div[^>]*class="[^"]*eli-main-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
            const text = textMatch
                ? this.htmlToText(textMatch[1])
                : this.extractBodyText(html);
            const docTypeCode = celex.charAt(0);
            const documentType = DOCUMENT_TYPES[docTypeCode]?.name || 'Legal Act';
            const dateMatch = html.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
            const dateDocument = dateMatch
                ? `${dateMatch[3]}-${dateMatch[2].padStart(2, '0')}-${dateMatch[1].padStart(2, '0')}`
                : undefined;
            return {
                celex,
                title,
                text,
                documentType,
                dateDocument,
                languages: ['en'],
            };
        }
        catch (error) {
            console.error(`[EUR-Lex] Error fetching ${celex}:`, error);
            return null;
        }
    }
    async parse(json, url) {
        try {
            const doc = JSON.parse(json);
            const docTypeCode = doc.celex.charAt(0);
            const contentType = DOCUMENT_TYPES[docTypeCode]?.type || 'regulation';
            const result = {
                externalId: `eurlex:${doc.celex}`,
                title: doc.title,
                content: doc.text,
                contentType,
                jurisdiction: 'EU',
                sourceUrl: `https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:${doc.celex}`,
                citation: doc.celex,
                documentDate: doc.dateDocument ? new Date(doc.dateDocument) : undefined,
                language: 'en',
                metadata: {
                    documentType: doc.documentType,
                    languages: doc.languages,
                },
            };
            return [result];
        }
        catch (error) {
            console.error(`[EUR-Lex] Parse error:`, error);
            return [];
        }
    }
    async ingest(content) {
        let ingested = 0;
        for (const doc of content) {
            try {
                const amendments = await (0, grounding_1.detectAmendments)(doc.externalId, doc.content, doc.title);
                if (amendments.length > 0) {
                    console.log(`[EUR-Lex] Detected ${amendments.length} amendments for ${doc.title}`);
                }
                await (0, ingestion_1.ingestContent)(doc.content, {
                    sourceType: doc.contentType === 'case_law' ? 'case_law' : 'jurisdiction_kb',
                    sourceName: doc.title,
                    sourceUrl: doc.sourceUrl,
                    sourceId: doc.externalId,
                    jurisdiction: 'EU',
                    language: doc.language,
                    sourceDate: doc.documentDate,
                });
                ingested++;
                console.log(`[EUR-Lex] Ingested: ${doc.title}`);
            }
            catch (error) {
                console.error(`[EUR-Lex] Ingest error for ${doc.title}:`, error);
            }
        }
        return ingested;
    }
    async isIngested(externalId) {
        return (0, ingestion_1.isDocumentIngested)(externalId);
    }
    htmlToText(html) {
        return html
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
            .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/\s+/g, ' ')
            .trim();
    }
    extractBodyText(html) {
        const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
        return bodyMatch ? this.htmlToText(bodyMatch[1]) : '';
    }
}
function createEURLexCrawler(config) {
    return new EURLexCrawler(config);
}
exports.default = EURLexCrawler;
//# sourceMappingURL=eurlexCrawler.js.map