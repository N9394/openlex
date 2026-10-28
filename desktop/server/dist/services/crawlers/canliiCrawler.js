"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCanLIICrawler = createCanLIICrawler;
const types_1 = require("./types");
const ingestion_1 = require("../rag/ingestion");
const grounding_1 = require("../rag/grounding");
const CANLII_CONFIG = {
    ...types_1.DEFAULT_CRAWLER_CONFIG,
    baseUrl: 'https://www.canlii.org',
    jurisdiction: 'CA',
    rateLimit: 1,
    maxPages: 50,
};
const CANADIAN_JURISDICTIONS = {
    'ca': { code: 'CA-FED', name: 'Canada (Federal)' },
    'on': { code: 'CA-ON', name: 'Ontario' },
    'bc': { code: 'CA-BC', name: 'British Columbia' },
    'ab': { code: 'CA-AB', name: 'Alberta' },
    'qc': { code: 'CA-QC', name: 'Quebec' },
    'mb': { code: 'CA-MB', name: 'Manitoba' },
    'sk': { code: 'CA-SK', name: 'Saskatchewan' },
    'ns': { code: 'CA-NS', name: 'Nova Scotia' },
    'nb': { code: 'CA-NB', name: 'New Brunswick' },
    'nl': { code: 'CA-NL', name: 'Newfoundland and Labrador' },
    'pe': { code: 'CA-PE', name: 'Prince Edward Island' },
    'nt': { code: 'CA-NT', name: 'Northwest Territories' },
    'yt': { code: 'CA-YT', name: 'Yukon' },
    'nu': { code: 'CA-NU', name: 'Nunavut' },
};
const CANADIAN_COURTS = {
    'scc-csc': { name: 'Supreme Court of Canada', level: 1 },
    'fca-caf': { name: 'Federal Court of Appeal', level: 2 },
    'fc-cf': { name: 'Federal Court', level: 3 },
    'onca': { name: 'Court of Appeal for Ontario', level: 2 },
    'onsc': { name: 'Ontario Superior Court', level: 3 },
    'bcca': { name: 'Court of Appeal for British Columbia', level: 2 },
    'bcsc': { name: 'Supreme Court of British Columbia', level: 3 },
    'abca': { name: 'Court of Appeal of Alberta', level: 2 },
    'abqb': { name: 'Alberta Court of Queen\'s Bench', level: 3 },
    'qcca': { name: 'Quebec Court of Appeal', level: 2 },
};
class CanLIICrawler {
    name = 'canlii';
    config;
    rateLimiter;
    constructor(config = {}) {
        this.config = { ...CANLII_CONFIG, ...config };
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
        console.log(`[CanLII] Starting crawl...`);
        try {
            await this.crawlCourt('scc-csc', 'ca', config, result);
            await this.crawlCourt('fca-caf', 'ca', config, result);
            await this.crawlCourt('onca', 'on', config, result);
            await this.crawlCourt('bcca', 'bc', config, result);
            await this.crawlLegislation('ca', config, result);
        }
        catch (error) {
            result.errors++;
            result.errorMessages.push(`Fatal error: ${error instanceof Error ? error.message : String(error)}`);
        }
        result.completedAt = new Date();
        console.log(`[CanLII] Crawl completed:`, {
            pagesCrawled: result.pagesCrawled,
            documentsParsed: result.documentsParsed,
            documentsIngested: result.documentsIngested,
            errors: result.errors,
        });
        return result;
    }
    async crawlCourt(courtCode, jurisdiction, config, result) {
        if (result.pagesCrawled >= (config.maxPages || 50)) {
            return;
        }
        const courtInfo = CANADIAN_COURTS[courtCode];
        if (!courtInfo) {
            console.log(`[CanLII] Unknown court: ${courtCode}`);
            return;
        }
        try {
            const indexUrl = `${config.baseUrl}/en/${jurisdiction}/${courtCode}/`;
            console.log(`[CanLII] Fetching court index: ${indexUrl}`);
            const { html, status } = await (0, types_1.fetchWithRetry)(indexUrl, {
                rateLimiter: this.rateLimiter,
                userAgent: config.userAgent,
                timeoutMs: config.timeoutMs,
            });
            result.pagesCrawled++;
            if (status === 404) {
                console.log(`[CanLII] Court not found: ${courtCode}`);
                return;
            }
            const caseLinks = this.extractCaseLinks(html, config.baseUrl);
            console.log(`[CanLII] Found ${caseLinks.length} cases in ${courtInfo.name}`);
            const remainingPages = (config.maxPages || 50) - result.pagesCrawled;
            const casesToProcess = caseLinks.slice(0, Math.min(5, remainingPages));
            for (const caseUrl of casesToProcess) {
                if (result.pagesCrawled >= (config.maxPages || 50)) {
                    break;
                }
                try {
                    const externalId = this.urlToExternalId(caseUrl);
                    if (await this.isIngested(externalId)) {
                        console.log(`[CanLII] Already ingested: ${externalId}`);
                        continue;
                    }
                    const { html: caseHtml } = await (0, types_1.fetchWithRetry)(caseUrl, {
                        rateLimiter: this.rateLimiter,
                        userAgent: config.userAgent,
                        timeoutMs: config.timeoutMs,
                    });
                    result.pagesCrawled++;
                    const parsed = await this.parse(caseHtml, caseUrl);
                    result.documentsParsed += parsed.length;
                    for (const doc of parsed) {
                        doc.court = courtInfo.name;
                        doc.subJurisdiction = CANADIAN_JURISDICTIONS[jurisdiction]?.code;
                    }
                    const ingested = await this.ingest(parsed);
                    result.documentsIngested += ingested;
                }
                catch (error) {
                    result.errors++;
                    result.errorMessages.push(`Error processing case: ${error instanceof Error ? error.message : String(error)}`);
                }
            }
        }
        catch (error) {
            result.errors++;
            result.errorMessages.push(`Error crawling ${courtInfo.name}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    async crawlLegislation(jurisdiction, config, result) {
        if (result.pagesCrawled >= (config.maxPages || 50)) {
            return;
        }
        try {
            const indexUrl = `${config.baseUrl}/en/${jurisdiction}/laws/`;
            console.log(`[CanLII] Fetching legislation index: ${indexUrl}`);
            const { html, status } = await (0, types_1.fetchWithRetry)(indexUrl, {
                rateLimiter: this.rateLimiter,
                userAgent: config.userAgent,
                timeoutMs: config.timeoutMs,
            });
            result.pagesCrawled++;
            if (status === 404) {
                return;
            }
            const lawLinks = this.extractLegislationLinks(html, config.baseUrl);
            console.log(`[CanLII] Found ${lawLinks.length} statutes`);
            const remainingPages = (config.maxPages || 50) - result.pagesCrawled;
            const lawsToProcess = lawLinks.slice(0, Math.min(3, remainingPages));
            for (const lawUrl of lawsToProcess) {
                if (result.pagesCrawled >= (config.maxPages || 50)) {
                    break;
                }
                try {
                    const externalId = this.urlToExternalId(lawUrl);
                    if (await this.isIngested(externalId)) {
                        continue;
                    }
                    const { html: lawHtml } = await (0, types_1.fetchWithRetry)(lawUrl, {
                        rateLimiter: this.rateLimiter,
                        userAgent: config.userAgent,
                        timeoutMs: config.timeoutMs,
                    });
                    result.pagesCrawled++;
                    const parsed = await this.parseLegislation(lawHtml, lawUrl);
                    result.documentsParsed += parsed.length;
                    const ingested = await this.ingest(parsed);
                    result.documentsIngested += ingested;
                }
                catch (error) {
                    result.errors++;
                    result.errorMessages.push(`Error processing legislation: ${error instanceof Error ? error.message : String(error)}`);
                }
            }
        }
        catch (error) {
            result.errors++;
            result.errorMessages.push(`Error crawling legislation: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    extractCaseLinks(html, baseUrl) {
        const links = [];
        const linkRegex = /href="([^"]*\/\d{4}\/[^"]*)"[^>]*>/gi;
        let match;
        while ((match = linkRegex.exec(html)) !== null) {
            let url = match[1];
            if (!url.startsWith('http')) {
                url = url.startsWith('/') ? `${baseUrl}${url}` : `${baseUrl}/${url}`;
            }
            if (!links.includes(url) && url.includes('/en/')) {
                links.push(url);
            }
        }
        return links;
    }
    extractLegislationLinks(html, baseUrl) {
        const links = [];
        const linkRegex = /href="([^"]*\/stat\/[^"]+)"/gi;
        let match;
        while ((match = linkRegex.exec(html)) !== null) {
            let url = match[1];
            if (!url.startsWith('http')) {
                url = url.startsWith('/') ? `${baseUrl}${url}` : `${baseUrl}/${url}`;
            }
            if (!links.includes(url)) {
                links.push(url);
            }
        }
        return links;
    }
    urlToExternalId(url) {
        const path = url.replace(CANLII_CONFIG.baseUrl, '').replace(/^\/en\//, '');
        return `canlii:${path}`;
    }
    async parse(html, url) {
        const results = [];
        try {
            const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
            const rawTitle = titleMatch ? (0, types_1.htmlToText)(titleMatch[1]) : 'Unknown Case';
            const citation = this.extractCitation(html, rawTitle);
            const content = this.extractCaseContent(html);
            const documentDate = this.extractDate(html);
            const language = url.includes('/fr/') ? 'fr' : 'en';
            const jurisdictionMatch = url.match(/\/en\/(\w+)\//);
            const jurisdictionCode = jurisdictionMatch ? jurisdictionMatch[1] : 'ca';
            const jurisdictionInfo = CANADIAN_JURISDICTIONS[jurisdictionCode];
            results.push({
                externalId: this.urlToExternalId(url),
                title: this.cleanTitle(rawTitle),
                content,
                contentType: 'case_law',
                jurisdiction: 'CA',
                subJurisdiction: jurisdictionInfo?.code,
                sourceUrl: url,
                citation,
                documentDate,
                language,
                metadata: {
                    province: jurisdictionInfo?.name,
                },
            });
        }
        catch (error) {
            console.error(`[CanLII] Parse error for ${url}:`, error);
        }
        return results;
    }
    async parseLegislation(html, url) {
        const results = [];
        try {
            const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
            const rawTitle = titleMatch ? (0, types_1.htmlToText)(titleMatch[1]) : 'Canadian Statute';
            const content = this.extractLegislationContent(html);
            const language = url.includes('/fr/') ? 'fr' : 'en';
            results.push({
                externalId: this.urlToExternalId(url),
                title: this.cleanTitle(rawTitle),
                content,
                contentType: 'statute',
                jurisdiction: 'CA',
                sourceUrl: url,
                language,
            });
        }
        catch (error) {
            console.error(`[CanLII] Legislation parse error for ${url}:`, error);
        }
        return results;
    }
    extractCitation(html, title) {
        const patterns = [
            /\d{4}\s+(?:SCC|FCA|FC|ONCA|ONSC|BCCA|BCSC|ABCA|ABQB)\s+\d+/,
            /\[\d{4}\]\s+\d+\s+(?:SCR|FCR|OR|BCLR)/,
        ];
        for (const pattern of patterns) {
            const match = html.match(pattern) || title.match(pattern);
            if (match) {
                return match[0];
            }
        }
        return undefined;
    }
    extractCaseContent(html) {
        const contentMatch = html.match(/<div[^>]*class="[^"]*documentContent[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
        if (contentMatch) {
            return (0, types_1.htmlToText)(contentMatch[1]);
        }
        const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
        return bodyMatch ? (0, types_1.htmlToText)(bodyMatch[1]).substring(0, 50000) : '';
    }
    extractLegislationContent(html) {
        const contentMatch = html.match(/<div[^>]*class="[^"]*lawContent[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
        if (contentMatch) {
            return (0, types_1.htmlToText)(contentMatch[1]);
        }
        const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
        return bodyMatch ? (0, types_1.htmlToText)(bodyMatch[1]).substring(0, 50000) : '';
    }
    extractDate(html) {
        const datePatterns = [
            /Date:\s*(\d{4}-\d{2}-\d{2})/,
            /(\d{4})-(\d{2})-(\d{2})/,
            /(\w+)\s+(\d{1,2}),\s+(\d{4})/,
        ];
        for (const pattern of datePatterns) {
            const match = html.match(pattern);
            if (match) {
                try {
                    return new Date(match[0]);
                }
                catch {
                    continue;
                }
            }
        }
        return undefined;
    }
    cleanTitle(title) {
        return title
            .replace(/\s*[-|]\s*CanLII/gi, '')
            .replace(/\s+/g, ' ')
            .trim();
    }
    async ingest(content) {
        let ingested = 0;
        for (const doc of content) {
            try {
                const amendments = await (0, grounding_1.detectAmendments)(doc.externalId, doc.content, doc.title);
                if (amendments.length > 0) {
                    console.log(`[CanLII] Detected ${amendments.length} amendments for ${doc.title}`);
                }
                await (0, ingestion_1.ingestContent)(doc.content, {
                    sourceType: doc.contentType === 'case_law' ? 'case_law' : 'jurisdiction_kb',
                    sourceName: doc.title,
                    sourceUrl: doc.sourceUrl,
                    sourceId: doc.externalId,
                    jurisdiction: 'CA',
                    language: doc.language,
                    sourceDate: doc.documentDate,
                });
                ingested++;
                console.log(`[CanLII] Ingested: ${doc.title}`);
            }
            catch (error) {
                console.error(`[CanLII] Ingest error for ${doc.title}:`, error);
            }
        }
        return ingested;
    }
    async isIngested(externalId) {
        return (0, ingestion_1.isDocumentIngested)(externalId);
    }
}
function createCanLIICrawler(config) {
    return new CanLIICrawler(config);
}
exports.default = CanLIICrawler;
//# sourceMappingURL=canliiCrawler.js.map