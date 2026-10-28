"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createGermanLawCrawler = createGermanLawCrawler;
const types_1 = require("./types");
const ingestion_1 = require("../rag/ingestion");
const grounding_1 = require("../rag/grounding");
const GERMAN_LAW_CONFIG = {
    ...types_1.DEFAULT_CRAWLER_CONFIG,
    baseUrl: 'https://www.gesetze-im-internet.de',
    jurisdiction: 'DE',
    rateLimit: 1,
    maxPages: 50,
};
const GERMAN_LAW_NAMES = {
    'bgb': 'Bürgerliches Gesetzbuch',
    'stgb': 'Strafgesetzbuch',
    'hgb': 'Handelsgesetzbuch',
    'gg': 'Grundgesetz',
    'zpo': 'Zivilprozessordnung',
    'stpo': 'Strafprozessordnung',
    'vwgo': 'Verwaltungsgerichtsordnung',
    'arbgg': 'Arbeitsgerichtsgesetz',
    'betrvg': 'Betriebsverfassungsgesetz',
    'bdsg': 'Bundesdatenschutzgesetz',
    'gmbhg': 'GmbH-Gesetz',
    'aktg': 'Aktiengesetz',
    'inso': 'Insolvenzordnung',
    'uwg': 'Gesetz gegen unlauteren Wettbewerb',
};
class GermanLawCrawler {
    name = 'germanlaw';
    config;
    rateLimiter;
    constructor(config = {}) {
        this.config = { ...GERMAN_LAW_CONFIG, ...config };
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
        console.log(`[GermanLaw] Starting crawl...`);
        try {
            const indexUrl = `${config.baseUrl}/aktuell.html`;
            console.log(`[GermanLaw] Fetching index: ${indexUrl}`);
            const { html } = await (0, types_1.fetchWithRetry)(indexUrl, {
                rateLimiter: this.rateLimiter,
                userAgent: config.userAgent,
                timeoutMs: config.timeoutMs,
            });
            result.pagesCrawled++;
            const lawLinks = this.extractLawLinks(html, config.baseUrl);
            console.log(`[GermanLaw] Found ${lawLinks.length} laws in index`);
            const priorityLaws = this.getPriorityLaws(lawLinks);
            const remainingPages = (config.maxPages || 50) - result.pagesCrawled;
            const lawsToProcess = priorityLaws.slice(0, Math.min(15, remainingPages));
            for (const law of lawsToProcess) {
                if (result.pagesCrawled >= (config.maxPages || 50)) {
                    break;
                }
                try {
                    const externalId = `de:${law.abbreviation}`;
                    if (await this.isIngested(externalId)) {
                        console.log(`[GermanLaw] Already ingested: ${law.abbreviation}`);
                        continue;
                    }
                    const { html: lawHtml } = await (0, types_1.fetchWithRetry)(law.url, {
                        rateLimiter: this.rateLimiter,
                        userAgent: config.userAgent,
                        timeoutMs: config.timeoutMs,
                    });
                    result.pagesCrawled++;
                    const parsed = await this.parse(lawHtml, law.url);
                    result.documentsParsed += parsed.length;
                    for (const doc of parsed) {
                        doc.citation = law.abbreviation.toUpperCase();
                    }
                    const ingested = await this.ingest(parsed);
                    result.documentsIngested += ingested;
                }
                catch (error) {
                    result.errors++;
                    result.errorMessages.push(`Error processing ${law.abbreviation}: ${error instanceof Error ? error.message : String(error)}`);
                }
            }
        }
        catch (error) {
            result.errors++;
            result.errorMessages.push(`Fatal error: ${error instanceof Error ? error.message : String(error)}`);
        }
        result.completedAt = new Date();
        console.log(`[GermanLaw] Crawl completed:`, {
            pagesCrawled: result.pagesCrawled,
            documentsParsed: result.documentsParsed,
            documentsIngested: result.documentsIngested,
            errors: result.errors,
        });
        return result;
    }
    extractLawLinks(html, baseUrl) {
        const links = [];
        const linkRegex = /href="\/([a-z_0-9]+)\/(?:index\.html|BJNR[^"]+)"\s*[^>]*>([^<]+)</gi;
        let match;
        while ((match = linkRegex.exec(html)) !== null) {
            const abbreviation = match[1].toLowerCase();
            const name = match[2].trim();
            if (abbreviation === 'aktuell' || abbreviation === 'englisch_translations') {
                continue;
            }
            const url = `${baseUrl}/${abbreviation}/index.html`;
            if (!links.some(l => l.abbreviation === abbreviation)) {
                links.push({
                    abbreviation,
                    url,
                    name: GERMAN_LAW_NAMES[abbreviation] || name,
                });
            }
        }
        return links;
    }
    getPriorityLaws(allLaws) {
        const priorityAbbreviations = Object.keys(GERMAN_LAW_NAMES);
        const priority = priorityAbbreviations
            .map(abbr => allLaws.find(l => l.abbreviation === abbr))
            .filter((l) => l !== undefined);
        const others = allLaws.filter(l => !priorityAbbreviations.includes(l.abbreviation));
        return [...priority, ...others];
    }
    async parse(html, url) {
        const results = [];
        try {
            const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
            const rawTitle = titleMatch ? (0, types_1.htmlToText)(titleMatch[1]) : 'Deutsches Gesetz';
            const urlMatch = url.match(/\/([a-z_0-9]+)\//i);
            const abbreviation = urlMatch ? urlMatch[1] : 'unknown';
            const lawName = GERMAN_LAW_NAMES[abbreviation.toLowerCase()] || rawTitle;
            const content = this.extractContent(html);
            const sections = this.extractSections(html);
            let fullContent = content;
            if (sections.length > 0) {
                const sectionsText = sections
                    .map(s => `§ ${s.number}: ${s.title}\n${s.text}`)
                    .join('\n\n');
                fullContent = `${content}\n\nVollständiger Text:\n\n${sectionsText}`;
            }
            if (fullContent.length > 50000) {
                fullContent = fullContent.substring(0, 50000) + '\n\n[Text gekürzt]';
            }
            results.push({
                externalId: `de:${abbreviation}`,
                title: lawName,
                content: fullContent,
                contentType: 'statute',
                jurisdiction: 'DE',
                sourceUrl: url,
                citation: abbreviation.toUpperCase(),
                language: 'de',
                keyPassages: sections.slice(0, 10).map(s => ({
                    heading: `§ ${s.number} ${s.title}`,
                    text: s.text.substring(0, 500),
                })),
                metadata: {
                    abbreviation,
                    sectionCount: sections.length,
                },
            });
        }
        catch (error) {
            console.error(`[GermanLaw] Parse error for ${url}:`, error);
        }
        return results;
    }
    extractContent(html) {
        const contentMatch = html.match(/<div[^>]*class="[^"]*jnhtml[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
        if (contentMatch) {
            return (0, types_1.htmlToText)(contentMatch[1]).substring(0, 10000);
        }
        const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
        return bodyMatch ? (0, types_1.htmlToText)(bodyMatch[1]).substring(0, 10000) : '';
    }
    extractSections(html) {
        const sections = [];
        const sectionRegex = /<span[^>]*class="[^"]*jnenbez[^"]*"[^>]*>§\s*(\d+[a-z]?)<\/span>\s*<span[^>]*class="[^"]*jnentitel[^"]*"[^>]*>([^<]*)<\/span>[\s\S]*?(?=<span[^>]*class="[^"]*jnenbez|$)/gi;
        let match;
        while ((match = sectionRegex.exec(html)) !== null && sections.length < 50) {
            const number = match[1];
            const title = (0, types_1.htmlToText)(match[2]);
            const sectionHtml = match[0];
            const text = (0, types_1.htmlToText)(sectionHtml).substring(0, 1000);
            sections.push({ number, title, text });
        }
        return sections;
    }
    async ingest(content) {
        let ingested = 0;
        for (const doc of content) {
            try {
                const amendments = await (0, grounding_1.detectAmendments)(doc.externalId, doc.content, doc.title);
                if (amendments.length > 0) {
                    console.log(`[GermanLaw] Detected ${amendments.length} amendments for ${doc.title}`);
                }
                await (0, ingestion_1.ingestContent)(doc.content, {
                    sourceType: 'jurisdiction_kb',
                    sourceName: doc.title,
                    sourceUrl: doc.sourceUrl,
                    sourceId: doc.externalId,
                    jurisdiction: 'DE',
                    language: 'de',
                    sourceDate: doc.documentDate,
                });
                ingested++;
                console.log(`[GermanLaw] Ingested: ${doc.title}`);
            }
            catch (error) {
                console.error(`[GermanLaw] Ingest error for ${doc.title}:`, error);
            }
        }
        return ingested;
    }
    async isIngested(externalId) {
        return (0, ingestion_1.isDocumentIngested)(externalId);
    }
}
function createGermanLawCrawler(config) {
    return new GermanLawCrawler(config);
}
exports.default = GermanLawCrawler;
//# sourceMappingURL=germanLawCrawler.js.map