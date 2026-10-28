"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createJustiaCrawler = createJustiaCrawler;
const types_1 = require("./types");
const ingestion_1 = require("../rag/ingestion");
const grounding_1 = require("../rag/grounding");
const JUSTIA_CONFIG = {
    ...types_1.DEFAULT_CRAWLER_CONFIG,
    baseUrl: 'https://law.justia.com',
    jurisdiction: 'US',
    rateLimit: 0.5,
    maxPages: 40,
};
const US_COURTS = {
    'supreme': { name: 'Supreme Court of the United States', level: 1, path: 'us' },
    '1st': { name: 'First Circuit Court of Appeals', level: 2, path: 'f2d' },
    '2nd': { name: 'Second Circuit Court of Appeals', level: 2, path: 'f2d' },
    '3rd': { name: 'Third Circuit Court of Appeals', level: 2, path: 'f2d' },
    '4th': { name: 'Fourth Circuit Court of Appeals', level: 2, path: 'f2d' },
    '5th': { name: 'Fifth Circuit Court of Appeals', level: 2, path: 'f2d' },
    '6th': { name: 'Sixth Circuit Court of Appeals', level: 2, path: 'f2d' },
    '7th': { name: 'Seventh Circuit Court of Appeals', level: 2, path: 'f2d' },
    '8th': { name: 'Eighth Circuit Court of Appeals', level: 2, path: 'f2d' },
    '9th': { name: 'Ninth Circuit Court of Appeals', level: 2, path: 'f2d' },
    '10th': { name: 'Tenth Circuit Court of Appeals', level: 2, path: 'f2d' },
    '11th': { name: 'Eleventh Circuit Court of Appeals', level: 2, path: 'f2d' },
    'dc': { name: 'D.C. Circuit Court of Appeals', level: 2, path: 'f2d' },
    'fed': { name: 'Federal Circuit Court of Appeals', level: 2, path: 'f2d' },
};
class JustiaCrawler {
    name = 'justia';
    config;
    rateLimiter;
    constructor(config = {}) {
        this.config = { ...JUSTIA_CONFIG, ...config };
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
        console.log(`[Justia] Starting crawl...`);
        try {
            await this.crawlSupremeCourt(config, result);
            if (result.pagesCrawled < (config.maxPages || 40)) {
                await this.crawlRecentCases(config, result);
            }
        }
        catch (error) {
            result.errors++;
            result.errorMessages.push(`Fatal error: ${error instanceof Error ? error.message : String(error)}`);
        }
        result.completedAt = new Date();
        console.log(`[Justia] Crawl completed:`, {
            pagesCrawled: result.pagesCrawled,
            documentsParsed: result.documentsParsed,
            documentsIngested: result.documentsIngested,
            errors: result.errors,
        });
        return result;
    }
    async crawlSupremeCourt(config, result) {
        const currentYear = new Date().getFullYear();
        const years = [currentYear, currentYear - 1, currentYear - 2];
        for (const year of years) {
            if (result.pagesCrawled >= (config.maxPages || 40)) {
                break;
            }
            try {
                const indexUrl = `${config.baseUrl}/cases/federal/us/${year}/`;
                console.log(`[Justia] Fetching Supreme Court ${year} term...`);
                const { html, status } = await (0, types_1.fetchWithRetry)(indexUrl, {
                    rateLimiter: this.rateLimiter,
                    userAgent: config.userAgent,
                    timeoutMs: config.timeoutMs,
                });
                result.pagesCrawled++;
                if (status === 404) {
                    continue;
                }
                const caseLinks = this.extractCaseLinks(html, config.baseUrl, 'us');
                console.log(`[Justia] Found ${caseLinks.length} Supreme Court cases in ${year}`);
                const remainingPages = (config.maxPages || 40) - result.pagesCrawled;
                const casesToProcess = caseLinks.slice(0, Math.min(5, remainingPages));
                for (const caseUrl of casesToProcess) {
                    if (result.pagesCrawled >= (config.maxPages || 40)) {
                        break;
                    }
                    await this.processCase(caseUrl, 'supreme', config, result);
                }
            }
            catch (error) {
                result.errors++;
                result.errorMessages.push(`Error crawling SCOTUS ${year}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
    }
    async crawlRecentCases(config, result) {
        try {
            const indexUrl = `${config.baseUrl}/cases/federal/appellate/`;
            console.log(`[Justia] Fetching recent federal cases...`);
            const { html, status } = await (0, types_1.fetchWithRetry)(indexUrl, {
                rateLimiter: this.rateLimiter,
                userAgent: config.userAgent,
                timeoutMs: config.timeoutMs,
            });
            result.pagesCrawled++;
            if (status === 404) {
                return;
            }
            const caseLinks = this.extractRecentCaseLinks(html, config.baseUrl);
            console.log(`[Justia] Found ${caseLinks.length} recent federal cases`);
            const remainingPages = (config.maxPages || 40) - result.pagesCrawled;
            const casesToProcess = caseLinks.slice(0, Math.min(10, remainingPages));
            for (const { url, court } of casesToProcess) {
                if (result.pagesCrawled >= (config.maxPages || 40)) {
                    break;
                }
                await this.processCase(url, court, config, result);
            }
        }
        catch (error) {
            result.errors++;
            result.errorMessages.push(`Error crawling recent cases: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    async processCase(caseUrl, courtCode, config, result) {
        try {
            const externalId = this.urlToExternalId(caseUrl);
            if (await this.isIngested(externalId)) {
                console.log(`[Justia] Already ingested: ${externalId}`);
                return;
            }
            const { html } = await (0, types_1.fetchWithRetry)(caseUrl, {
                rateLimiter: this.rateLimiter,
                userAgent: config.userAgent,
                timeoutMs: config.timeoutMs,
            });
            result.pagesCrawled++;
            const parsed = await this.parse(html, caseUrl);
            result.documentsParsed += parsed.length;
            const courtInfo = US_COURTS[courtCode];
            for (const doc of parsed) {
                doc.court = courtInfo?.name || 'US Federal Court';
            }
            const ingested = await this.ingest(parsed);
            result.documentsIngested += ingested;
        }
        catch (error) {
            result.errors++;
            result.errorMessages.push(`Error processing case: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    extractCaseLinks(html, baseUrl, reporter) {
        const links = [];
        const linkRegex = new RegExp(`href="([^"]*/${reporter}/\\d+/[^"]+)"`, 'gi');
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
    extractRecentCaseLinks(html, baseUrl) {
        const links = [];
        const reporters = ['f3d', 'f2d', 'fsupp', 'fsupp2d', 'fsupp3d'];
        for (const reporter of reporters) {
            const linkRegex = new RegExp(`href="([^"]*/${reporter}/\\d+/[^"]+)"`, 'gi');
            let match;
            while ((match = linkRegex.exec(html)) !== null && links.length < 20) {
                let url = match[1];
                if (!url.startsWith('http')) {
                    url = url.startsWith('/') ? `${baseUrl}${url}` : `${baseUrl}/${url}`;
                }
                let court = 'federal';
                if (reporter.startsWith('fsupp')) {
                    court = 'district';
                }
                if (!links.some(l => l.url === url)) {
                    links.push({ url, court });
                }
            }
        }
        return links;
    }
    urlToExternalId(url) {
        const path = url.replace(JUSTIA_CONFIG.baseUrl, '').replace(/^\/cases\//, '');
        return `justia:${path}`;
    }
    async parse(html, url) {
        const results = [];
        try {
            const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
            const rawTitle = titleMatch ? (0, types_1.htmlToText)(titleMatch[1]) : 'Unknown Case';
            const citation = this.extractCitation(html, rawTitle);
            const content = this.extractOpinionText(html);
            const documentDate = this.extractDate(html);
            const keyPassages = this.extractKeyPassages(html);
            results.push({
                externalId: this.urlToExternalId(url),
                title: this.cleanTitle(rawTitle),
                content,
                contentType: 'case_law',
                jurisdiction: 'US',
                sourceUrl: url,
                citation,
                documentDate,
                language: 'en',
                keyPassages,
                metadata: {
                    reporter: this.extractReporter(url),
                },
            });
        }
        catch (error) {
            console.error(`[Justia] Parse error for ${url}:`, error);
        }
        return results;
    }
    extractCitation(html, title) {
        const patterns = [
            /\d+\s+U\.S\.\s+\d+/,
            /\d+\s+S\.\s*Ct\.\s+\d+/,
            /\d+\s+F\.\d+[d]?\s+\d+/,
            /\d+\s+F\.\s*Supp\.\s*\d*[d]?\s+\d+/,
        ];
        for (const pattern of patterns) {
            const match = html.match(pattern) || title.match(pattern);
            if (match) {
                return match[0];
            }
        }
        return undefined;
    }
    extractOpinionText(html) {
        const opinionMatch = html.match(/<div[^>]*id="[^"]*opinion[^"]*"[^>]*>([\s\S]*?)<\/div>/i)
            || html.match(/<div[^>]*class="[^"]*opinion[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
        if (opinionMatch) {
            return (0, types_1.htmlToText)(opinionMatch[1]).substring(0, 50000);
        }
        const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
        return bodyMatch ? (0, types_1.htmlToText)(bodyMatch[1]).substring(0, 50000) : '';
    }
    extractKeyPassages(html) {
        const passages = [];
        const syllabusMatch = html.match(/SYLLABUS[:\s]*([\s\S]*?)(?=OPINION|<h|$)/i);
        if (syllabusMatch) {
            passages.push({
                heading: 'Syllabus',
                text: (0, types_1.htmlToText)(syllabusMatch[1]).substring(0, 2000),
            });
        }
        const holdingMatch = html.match(/(?:HELD|HOLDING)[:\s]*([\s\S]*?)(?=<h|<p|$)/i);
        if (holdingMatch) {
            passages.push({
                heading: 'Holding',
                text: (0, types_1.htmlToText)(holdingMatch[1]).substring(0, 2000),
            });
        }
        return passages;
    }
    extractDate(html) {
        const datePatterns = [
            /Decided[:\s]*(\w+\s+\d{1,2},\s+\d{4})/i,
            /(\w+\s+\d{1,2},\s+\d{4})/,
        ];
        for (const pattern of datePatterns) {
            const match = html.match(pattern);
            if (match) {
                try {
                    return new Date(match[1]);
                }
                catch {
                    continue;
                }
            }
        }
        return undefined;
    }
    extractReporter(url) {
        const match = url.match(/\/(us|f\d+d?|fsupp\d*d?)\/\d+/);
        return match ? match[1] : 'unknown';
    }
    cleanTitle(title) {
        return title
            .replace(/\s*[-|]\s*Justia/gi, '')
            .replace(/\s*[-|]\s*US Law/gi, '')
            .replace(/\s+/g, ' ')
            .trim();
    }
    async ingest(content) {
        let ingested = 0;
        for (const doc of content) {
            try {
                const amendments = await (0, grounding_1.detectAmendments)(doc.externalId, doc.content, doc.title);
                if (amendments.length > 0) {
                    console.log(`[Justia] Detected ${amendments.length} amendments for ${doc.title}`);
                }
                await (0, ingestion_1.ingestContent)(doc.content, {
                    sourceType: 'case_law',
                    sourceName: doc.title,
                    sourceUrl: doc.sourceUrl,
                    sourceId: doc.externalId,
                    jurisdiction: 'US',
                    language: 'en',
                    sourceDate: doc.documentDate,
                });
                ingested++;
                console.log(`[Justia] Ingested: ${doc.title}`);
            }
            catch (error) {
                console.error(`[Justia] Ingest error for ${doc.title}:`, error);
            }
        }
        return ingested;
    }
    async isIngested(externalId) {
        return (0, ingestion_1.isDocumentIngested)(externalId);
    }
}
function createJustiaCrawler(config) {
    return new JustiaCrawler(config);
}
exports.default = JustiaCrawler;
//# sourceMappingURL=justiaCrawler.js.map