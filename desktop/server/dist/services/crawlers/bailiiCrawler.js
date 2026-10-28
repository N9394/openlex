"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createBAILIICrawler = createBAILIICrawler;
const types_1 = require("./types");
const ingestion_1 = require("../rag/ingestion");
const grounding_1 = require("../rag/grounding");
const BAILII_CONFIG = {
    ...types_1.DEFAULT_CRAWLER_CONFIG,
    baseUrl: 'https://www.bailii.org',
    jurisdiction: 'UK',
    rateLimit: 0.5,
    maxPages: 50,
};
const UK_COURTS = {
    'uksc': { name: 'UK Supreme Court', level: 1 },
    'ukhl': { name: 'House of Lords', level: 1 },
    'ewca': { name: 'Court of Appeal', level: 2 },
    'ewhc': { name: 'High Court', level: 3 },
    'ukut': { name: 'Upper Tribunal', level: 4 },
    'ukftt': { name: 'First-tier Tribunal', level: 5 },
};
const IRELAND_COURTS = {
    'iesc': { name: 'Supreme Court of Ireland', level: 1 },
    'ieca': { name: 'Court of Appeal of Ireland', level: 2 },
    'iehc': { name: 'High Court of Ireland', level: 3 },
};
class BAILIICrawler {
    name = 'bailii';
    config;
    rateLimiter;
    constructor(config = {}) {
        this.config = { ...BAILII_CONFIG, ...config };
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
        console.log(`[BAILII] Starting crawl with config:`, {
            baseUrl: config.baseUrl,
            maxPages: config.maxPages,
            rateLimit: config.rateLimit,
        });
        try {
            await this.crawlJurisdiction('UK', UK_COURTS, config, result);
            await this.crawlJurisdiction('IE', IRELAND_COURTS, config, result);
        }
        catch (error) {
            result.errors++;
            result.errorMessages.push(`Fatal error: ${error instanceof Error ? error.message : String(error)}`);
        }
        result.completedAt = new Date();
        console.log(`[BAILII] Crawl completed:`, {
            pagesCrawled: result.pagesCrawled,
            documentsParsed: result.documentsParsed,
            documentsIngested: result.documentsIngested,
            errors: result.errors,
            duration: `${(result.completedAt.getTime() - result.startedAt.getTime()) / 1000}s`,
        });
        return result;
    }
    async crawlJurisdiction(jurisdiction, courts, config, result) {
        const prefix = jurisdiction === 'UK' ? 'uk' : 'ie';
        for (const [courtCode, courtInfo] of Object.entries(courts)) {
            if (result.pagesCrawled >= (config.maxPages || 50)) {
                console.log(`[BAILII] Reached max pages limit`);
                break;
            }
            try {
                const indexUrl = `${config.baseUrl}/${prefix}/${courtCode}/`;
                console.log(`[BAILII] Fetching court index: ${indexUrl}`);
                const { html, status } = await (0, types_1.fetchWithRetry)(indexUrl, {
                    rateLimiter: this.rateLimiter,
                    userAgent: config.userAgent,
                    timeoutMs: config.timeoutMs,
                });
                result.pagesCrawled++;
                if (status === 404) {
                    console.log(`[BAILII] Court not found: ${courtCode}`);
                    continue;
                }
                const caseUrls = this.extractCaseLinks(html, config.baseUrl);
                console.log(`[BAILII] Found ${caseUrls.length} cases in ${courtInfo.name}`);
                const remainingPages = (config.maxPages || 50) - result.pagesCrawled;
                const casesToProcess = caseUrls.slice(0, Math.min(5, remainingPages));
                for (const caseUrl of casesToProcess) {
                    try {
                        const externalId = this.urlToExternalId(caseUrl);
                        if (await this.isIngested(externalId)) {
                            console.log(`[BAILII] Already ingested: ${externalId}`);
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
                            doc.jurisdiction = jurisdiction;
                            doc.court = courtInfo.name;
                        }
                        const ingested = await this.ingest(parsed);
                        result.documentsIngested += ingested;
                    }
                    catch (error) {
                        result.errors++;
                        result.errorMessages.push(`Error processing ${caseUrl}: ${error instanceof Error ? error.message : String(error)}`);
                    }
                }
            }
            catch (error) {
                result.errors++;
                result.errorMessages.push(`Error crawling ${courtInfo.name}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
    }
    extractCaseLinks(html, baseUrl) {
        const links = [];
        const linkRegex = /href="([^"]*\/\d{4}\/[^"]*\.html)"/gi;
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
        return `bailii:${url.replace('https://www.bailii.org/', '')}`;
    }
    async parse(html, url) {
        const results = [];
        try {
            const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
            const rawTitle = titleMatch ? (0, types_1.htmlToText)(titleMatch[1]) : 'Unknown Case';
            const citation = this.extractCitation(html, rawTitle);
            const mainContent = this.extractMainContent(html);
            const documentDate = this.extractDate(html, url);
            const keyPassages = this.extractKeyPassages(html);
            const language = 'en';
            const jurisdiction = url.includes('/ie/') ? 'IE' : 'UK';
            const courtCode = this.extractCourtCode(url);
            const courtInfo = jurisdiction === 'UK' ? UK_COURTS[courtCode] : IRELAND_COURTS[courtCode];
            results.push({
                externalId: this.urlToExternalId(url),
                title: this.cleanTitle(rawTitle),
                content: mainContent,
                contentType: 'case_law',
                jurisdiction,
                sourceUrl: url,
                citation,
                court: courtInfo?.name,
                documentDate,
                language,
                keyPassages,
                metadata: {
                    courtCode,
                    courtLevel: courtInfo?.level,
                },
            });
        }
        catch (error) {
            console.error(`[BAILII] Parse error for ${url}:`, error);
        }
        return results;
    }
    extractCitation(html, title) {
        const citationInTitle = title.match(/\[\d{4}\]\s+[A-Z]+\s+\w+\s*\d*/);
        if (citationInTitle) {
            return citationInTitle[0];
        }
        const neutralCitationMatch = html.match(/Neutral Citation[:\s]*(\[\d{4}\][^<\n]+)/i);
        if (neutralCitationMatch) {
            return (0, types_1.htmlToText)(neutralCitationMatch[1]).trim();
        }
        const citationPatterns = [
            /\[\d{4}\]\s+UKSC\s+\d+/,
            /\[\d{4}\]\s+UKHL\s+\d+/,
            /\[\d{4}\]\s+EWCA\s+(Civ|Crim)\s+\d+/,
            /\[\d{4}\]\s+EWHC\s+\d+\s*\([^)]+\)/,
            /\[\d{4}\]\s+IESC\s+\d+/,
            /\[\d{4}\]\s+IECA\s+\d+/,
            /\[\d{4}\]\s+IEHC\s+\d+/,
        ];
        for (const pattern of citationPatterns) {
            const match = html.match(pattern);
            if (match) {
                return match[0];
            }
        }
        return undefined;
    }
    extractMainContent(html) {
        const contentPatterns = [
            /<div[^>]*class="[^"]*bailii[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
            /(?:JUDGMENT|JUDGEMENT|DECISION)[:\s]*<\/[^>]+>([\s\S]*?)(?=<\/body|$)/i,
        ];
        for (const pattern of contentPatterns) {
            const match = html.match(pattern);
            if (match && match[1]) {
                const content = (0, types_1.htmlToText)(match[1]);
                if (content.length > 500) {
                    return content;
                }
            }
        }
        const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
        if (bodyMatch) {
            return (0, types_1.htmlToText)(bodyMatch[1]);
        }
        return (0, types_1.htmlToText)(html);
    }
    extractKeyPassages(html) {
        const passages = [];
        const headnoteMatch = html.match(/HEADNOTE[:\s]*([\s\S]*?)(?=<h|<HR|<p class="MsoNormal"|$)/i);
        if (headnoteMatch) {
            passages.push({
                heading: 'Headnote',
                text: (0, types_1.htmlToText)(headnoteMatch[1]).substring(0, 2000),
            });
        }
        const heldMatch = html.match(/(?:HELD|HOLDING)[:\s]*([\s\S]*?)(?=<h|<HR|$)/i);
        if (heldMatch) {
            passages.push({
                heading: 'Holding',
                text: (0, types_1.htmlToText)(heldMatch[1]).substring(0, 2000),
            });
        }
        return passages;
    }
    extractDate(html, url) {
        const urlDateMatch = url.match(/\/(\d{4})\/(\d{2})?/);
        if (urlDateMatch) {
            const year = parseInt(urlDateMatch[1]);
            const month = urlDateMatch[2] ? parseInt(urlDateMatch[2]) - 1 : 0;
            return new Date(year, month, 1);
        }
        const datePatterns = [
            /(?:Date|Dated)[:\s]*(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})/i,
            /(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})/i,
        ];
        const months = {
            january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
            july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
        };
        for (const pattern of datePatterns) {
            const match = html.match(pattern);
            if (match) {
                const day = parseInt(match[1]);
                const month = months[match[2].toLowerCase()];
                const year = parseInt(match[3]);
                if (!isNaN(day) && month !== undefined && !isNaN(year)) {
                    return new Date(year, month, day);
                }
            }
        }
        return undefined;
    }
    extractCourtCode(url) {
        const match = url.match(/\/(?:uk|ie)\/(\w+)\//);
        return match ? match[1].toLowerCase() : 'unknown';
    }
    cleanTitle(title) {
        return title
            .replace(/BAILII/gi, '')
            .replace(/Citation:/gi, '')
            .replace(/\s+/g, ' ')
            .trim();
    }
    async ingest(content) {
        let ingested = 0;
        for (const doc of content) {
            try {
                const amendments = await (0, grounding_1.detectAmendments)(doc.externalId, doc.content, doc.title);
                if (amendments.length > 0) {
                    console.log(`[BAILII] Detected ${amendments.length} amendments for ${doc.title}`);
                }
                await (0, ingestion_1.ingestContent)(doc.content, {
                    sourceType: 'case_law',
                    sourceName: doc.title,
                    sourceUrl: doc.sourceUrl,
                    sourceId: doc.externalId,
                    jurisdiction: doc.jurisdiction,
                    language: doc.language,
                    sourceDate: doc.documentDate,
                });
                ingested++;
                console.log(`[BAILII] Ingested: ${doc.title}`);
            }
            catch (error) {
                console.error(`[BAILII] Ingest error for ${doc.title}:`, error);
            }
        }
        return ingested;
    }
    async isIngested(externalId) {
        return (0, ingestion_1.isDocumentIngested)(externalId);
    }
}
function createBAILIICrawler(config) {
    return new BAILIICrawler(config);
}
exports.default = BAILIICrawler;
//# sourceMappingURL=bailiiCrawler.js.map