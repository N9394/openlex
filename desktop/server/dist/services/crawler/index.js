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
Object.defineProperty(exports, "__esModule", { value: true });
exports.SLOVAK_LAWS = exports.ingestAllSlovakLaws = exports.scrapeSlovakCourtDecisions = exports.scrapeAndIngestMultipleSlovakLaws = exports.scrapeAndIngestSlovakLaw = exports.scrapeSlovakLaw = exports.AUSTRIAN_LAWS = exports.scrapeAndIngestMultipleLaws = exports.scrapeAndIngestLaw = exports.scrapeConsolidatedLaw = exports.fetchAndIngestAustrianLaws = exports.fetchKeyAustrianLaws = exports.risDocumentToParsed = exports.fetchDocumentHtml = exports.searchJudikatur = exports.searchBundesrecht = exports.BAILII_URL_PATTERNS = exports.extractBAILIISearchResults = exports.buildBAILIISearchUrl = exports.parseBAILIIDocument = exports.BAILIIParser = exports.RIS_URL_PATTERNS = exports.extractRISSearchResults = exports.buildRISSearchUrl = exports.parseRISDocument = exports.RISParser = exports.extractLinks = exports.extractText = exports.parseHtml = exports.GenericParser = exports.createScheduler = exports.getScheduler = exports.CrawlScheduler = exports.getSitemapUrls = exports.isUrlAllowed = exports.RobotsTxtParser = exports.fetchWithRateLimit = exports.createFetcher = exports.Fetcher = exports.DEFAULT_SOURCE_CONFIGS = void 0;
exports.parseDocument = parseDocument;
exports.createCrawler = createCrawler;
exports.crawlAndParse = crawlAndParse;
exports.crawlAndParseBatch = crawlAndParseBatch;
exports.crawlAndIngest = crawlAndIngest;
exports.scheduledRISCrawl = scheduledRISCrawl;
exports.scheduledBAILIICrawl = scheduledBAILIICrawl;
var types_1 = require("./types");
Object.defineProperty(exports, "DEFAULT_SOURCE_CONFIGS", { enumerable: true, get: function () { return types_1.DEFAULT_SOURCE_CONFIGS; } });
var fetcher_1 = require("./fetcher");
Object.defineProperty(exports, "Fetcher", { enumerable: true, get: function () { return fetcher_1.Fetcher; } });
Object.defineProperty(exports, "createFetcher", { enumerable: true, get: function () { return fetcher_1.createFetcher; } });
Object.defineProperty(exports, "fetchWithRateLimit", { enumerable: true, get: function () { return fetcher_1.fetchWithRateLimit; } });
var robotsParser_1 = require("./robotsParser");
Object.defineProperty(exports, "RobotsTxtParser", { enumerable: true, get: function () { return robotsParser_1.RobotsTxtParser; } });
Object.defineProperty(exports, "isUrlAllowed", { enumerable: true, get: function () { return robotsParser_1.isUrlAllowed; } });
Object.defineProperty(exports, "getSitemapUrls", { enumerable: true, get: function () { return robotsParser_1.getSitemapUrls; } });
var scheduler_1 = require("./scheduler");
Object.defineProperty(exports, "CrawlScheduler", { enumerable: true, get: function () { return scheduler_1.CrawlScheduler; } });
Object.defineProperty(exports, "getScheduler", { enumerable: true, get: function () { return scheduler_1.getScheduler; } });
Object.defineProperty(exports, "createScheduler", { enumerable: true, get: function () { return scheduler_1.createScheduler; } });
var generic_1 = require("./parsers/generic");
Object.defineProperty(exports, "GenericParser", { enumerable: true, get: function () { return generic_1.GenericParser; } });
Object.defineProperty(exports, "parseHtml", { enumerable: true, get: function () { return generic_1.parseHtml; } });
Object.defineProperty(exports, "extractText", { enumerable: true, get: function () { return generic_1.extractText; } });
Object.defineProperty(exports, "extractLinks", { enumerable: true, get: function () { return generic_1.extractLinks; } });
var ris_1 = require("./parsers/ris");
Object.defineProperty(exports, "RISParser", { enumerable: true, get: function () { return ris_1.RISParser; } });
Object.defineProperty(exports, "parseRISDocument", { enumerable: true, get: function () { return ris_1.parseRISDocument; } });
Object.defineProperty(exports, "buildRISSearchUrl", { enumerable: true, get: function () { return ris_1.buildRISSearchUrl; } });
Object.defineProperty(exports, "extractRISSearchResults", { enumerable: true, get: function () { return ris_1.extractSearchResultUrls; } });
Object.defineProperty(exports, "RIS_URL_PATTERNS", { enumerable: true, get: function () { return ris_1.RIS_URL_PATTERNS; } });
var bailii_1 = require("./parsers/bailii");
Object.defineProperty(exports, "BAILIIParser", { enumerable: true, get: function () { return bailii_1.BAILIIParser; } });
Object.defineProperty(exports, "parseBAILIIDocument", { enumerable: true, get: function () { return bailii_1.parseBAILIIDocument; } });
Object.defineProperty(exports, "buildBAILIISearchUrl", { enumerable: true, get: function () { return bailii_1.buildBAILIISearchUrl; } });
Object.defineProperty(exports, "extractBAILIISearchResults", { enumerable: true, get: function () { return bailii_1.extractBAILIISearchResults; } });
Object.defineProperty(exports, "BAILII_URL_PATTERNS", { enumerable: true, get: function () { return bailii_1.BAILII_URL_PATTERNS; } });
var risApiClient_1 = require("./risApiClient");
Object.defineProperty(exports, "searchBundesrecht", { enumerable: true, get: function () { return risApiClient_1.searchBundesrecht; } });
Object.defineProperty(exports, "searchJudikatur", { enumerable: true, get: function () { return risApiClient_1.searchJudikatur; } });
Object.defineProperty(exports, "fetchDocumentHtml", { enumerable: true, get: function () { return risApiClient_1.fetchDocumentHtml; } });
Object.defineProperty(exports, "risDocumentToParsed", { enumerable: true, get: function () { return risApiClient_1.risDocumentToParsed; } });
Object.defineProperty(exports, "fetchKeyAustrianLaws", { enumerable: true, get: function () { return risApiClient_1.fetchKeyAustrianLaws; } });
Object.defineProperty(exports, "fetchAndIngestAustrianLaws", { enumerable: true, get: function () { return risApiClient_1.fetchAndIngestAustrianLaws; } });
var risConsolidatedScraper_1 = require("./risConsolidatedScraper");
Object.defineProperty(exports, "scrapeConsolidatedLaw", { enumerable: true, get: function () { return risConsolidatedScraper_1.scrapeConsolidatedLaw; } });
Object.defineProperty(exports, "scrapeAndIngestLaw", { enumerable: true, get: function () { return risConsolidatedScraper_1.scrapeAndIngestLaw; } });
Object.defineProperty(exports, "scrapeAndIngestMultipleLaws", { enumerable: true, get: function () { return risConsolidatedScraper_1.scrapeAndIngestMultipleLaws; } });
Object.defineProperty(exports, "AUSTRIAN_LAWS", { enumerable: true, get: function () { return risConsolidatedScraper_1.AUSTRIAN_LAWS; } });
var slovakLegalScraper_1 = require("./slovakLegalScraper");
Object.defineProperty(exports, "scrapeSlovakLaw", { enumerable: true, get: function () { return slovakLegalScraper_1.scrapeSlovakLaw; } });
Object.defineProperty(exports, "scrapeAndIngestSlovakLaw", { enumerable: true, get: function () { return slovakLegalScraper_1.scrapeAndIngestSlovakLaw; } });
Object.defineProperty(exports, "scrapeAndIngestMultipleSlovakLaws", { enumerable: true, get: function () { return slovakLegalScraper_1.scrapeAndIngestMultipleSlovakLaws; } });
Object.defineProperty(exports, "scrapeSlovakCourtDecisions", { enumerable: true, get: function () { return slovakLegalScraper_1.scrapeSlovakCourtDecisions; } });
Object.defineProperty(exports, "ingestAllSlovakLaws", { enumerable: true, get: function () { return slovakLegalScraper_1.ingestAllSlovakLaws; } });
Object.defineProperty(exports, "SLOVAK_LAWS", { enumerable: true, get: function () { return slovakLegalScraper_1.SLOVAK_LAWS; } });
const fetcher_2 = require("./fetcher");
const scheduler_2 = require("./scheduler");
const ris_2 = require("./parsers/ris");
const bailii_2 = require("./parsers/bailii");
const generic_2 = require("./parsers/generic");
function parseDocument(html, url, source) {
    switch (source) {
        case 'ris_austria':
            return new ris_2.RISParser().parse(html, url);
        case 'bailii_uk':
            return new bailii_2.BAILIIParser().parse(html, url);
        default:
            return new generic_2.GenericParser().parse(html, url, source);
    }
}
async function createCrawler(source, options = {}) {
    const { onDocument, onProgress } = options;
    const fetcher = (0, fetcher_2.createFetcher)(source);
    const scheduler = new scheduler_2.CrawlScheduler();
    scheduler.registerFetcher(source, { source });
    if (onDocument) {
        scheduler.onDocument(onDocument);
    }
    const crawl = async (urls) => {
        scheduler.addManyToQueue(urls, source);
        const stats = await scheduler.run({
            onProgress,
        });
        return stats;
    };
    return { fetcher, scheduler, crawl };
}
async function crawlAndParse(url, source = 'custom') {
    const fetcher = (0, fetcher_2.createFetcher)(source);
    const result = await fetcher.fetch(url);
    if (!result.success || !result.html) {
        console.error(`[Crawler] Failed to fetch ${url}: ${result.error}`);
        return null;
    }
    return parseDocument(result.html, url, source);
}
async function crawlAndParseBatch(urls, source = 'custom', options = {}) {
    const { onProgress } = options;
    const fetcher = (0, fetcher_2.createFetcher)(source);
    const documents = [];
    const results = await fetcher.fetchMany(urls, {
        onProgress,
    });
    for (const result of results) {
        if (result.success && result.html) {
            const doc = parseDocument(result.html, result.url, source);
            if (doc) {
                documents.push(doc);
            }
        }
    }
    return documents;
}
const ingestion_1 = require("../rag/ingestion");
async function crawlAndIngest(urls, source, options = {}) {
    const { generateEmbeddings = true, onProgress } = options;
    const documents = await crawlAndParseBatch(urls, source, {
        onProgress: (completed, total) => {
            onProgress?.({ crawled: completed, ingested: 0, total });
        },
    });
    let chunksCreated = 0;
    let embeddingsCreated = 0;
    const errors = [];
    for (let i = 0; i < documents.length; i++) {
        const doc = documents[i];
        try {
            const result = await (0, ingestion_1.ingestContent)(doc.content, {
                sourceType: 'case_law',
                sourceName: doc.title,
                sourceId: doc.sourceId,
                jurisdiction: doc.jurisdiction,
                documentType: doc.documentType,
            }, generateEmbeddings);
            chunksCreated += result.chunksCreated;
            embeddingsCreated += result.embeddingsCreated;
            console.log(`[Crawler] Ingested ${doc.title}: ${result.chunksCreated} chunks`);
        }
        catch (error) {
            const errorMsg = `Failed to ingest ${doc.url}: ${error instanceof Error ? error.message : 'Unknown error'}`;
            errors.push(errorMsg);
            console.error(`[Crawler] ${errorMsg}`);
        }
        onProgress?.({
            crawled: urls.length,
            ingested: i + 1,
            total: urls.length,
        });
    }
    return {
        documentsFound: documents.length,
        chunksCreated,
        embeddingsCreated,
        errors,
    };
}
async function scheduledRISCrawl(options = {}) {
    const { maxDocuments = 100, types = ['bundesrecht', 'judikatur'] } = options;
    console.log(`[Crawler] Starting scheduled RIS crawl (max ${maxDocuments} documents)`);
    const scheduler = (0, scheduler_2.getScheduler)();
    const fetcher = scheduler.registerFetcher('ris_austria', { source: 'ris_austria' });
    const searchUrls = [];
    for (const type of types) {
        const { buildRISSearchUrl } = await Promise.resolve().then(() => __importStar(require('./parsers/ris')));
        const searchUrl = buildRISSearchUrl({
            type,
            pageSize: Math.min(50, maxDocuments),
        });
        searchUrls.push(searchUrl);
    }
    for (const searchUrl of searchUrls) {
        const result = await fetcher.fetch(searchUrl);
        if (result.success && result.html) {
            const { extractSearchResultUrls } = await Promise.resolve().then(() => __importStar(require('./parsers/ris')));
            const docUrls = extractSearchResultUrls(result.html, searchUrl);
            scheduler.addManyToQueue(docUrls.slice(0, maxDocuments), 'ris_austria', {
                priority: 1,
            });
        }
    }
    const stats = await scheduler.run({
        maxIterations: maxDocuments,
    });
    console.log(`[Crawler] RIS crawl complete: ${stats.successfulFetches} fetched, ` +
        `${stats.documentsParsed} parsed, ${stats.failedFetches} failed`);
    return stats;
}
async function scheduledBAILIICrawl(options = {}) {
    const { maxDocuments = 100, courts = ['UKSC', 'EWCA'] } = options;
    console.log(`[Crawler] Starting scheduled BAILII crawl (max ${maxDocuments} documents)`);
    const scheduler = (0, scheduler_2.getScheduler)();
    const fetcher = scheduler.registerFetcher('bailii_uk', { source: 'bailii_uk' });
    for (const court of courts) {
        const { buildBAILIISearchUrl, extractBAILIISearchResults } = await Promise.resolve().then(() => __importStar(require('./parsers/bailii')));
        const searchUrl = buildBAILIISearchUrl({
            court,
            maxResults: Math.min(100, maxDocuments),
        });
        const result = await fetcher.fetch(searchUrl);
        if (result.success && result.html) {
            const docUrls = extractBAILIISearchResults(result.html, searchUrl);
            scheduler.addManyToQueue(docUrls.slice(0, maxDocuments), 'bailii_uk', {
                priority: 1,
            });
        }
    }
    const stats = await scheduler.run({
        maxIterations: maxDocuments,
    });
    console.log(`[Crawler] BAILII crawl complete: ${stats.successfulFetches} fetched, ` +
        `${stats.documentsParsed} parsed, ${stats.failedFetches} failed`);
    return stats;
}
//# sourceMappingURL=index.js.map