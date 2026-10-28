export type { CrawlSource, LegalDocumentType, CrawlSourceConfig, CrawlJob, FetchResult, ParsedLegalDocument, RISDocumentType, RISDocument, BAILIICourt, BAILIIDocument, ScheduledCrawl, CrawlQueueItem, RobotsTxtRules, CrawlStats, } from './types';
export { DEFAULT_SOURCE_CONFIGS } from './types';
export { Fetcher, createFetcher, fetchWithRateLimit, } from './fetcher';
export { RobotsTxtParser, isUrlAllowed, getSitemapUrls, } from './robotsParser';
export { CrawlScheduler, getScheduler, createScheduler, } from './scheduler';
export { GenericParser, parseHtml, extractText, extractLinks, } from './parsers/generic';
export { RISParser, parseRISDocument, buildRISSearchUrl, extractSearchResultUrls as extractRISSearchResults, RIS_URL_PATTERNS, } from './parsers/ris';
export { BAILIIParser, parseBAILIIDocument, buildBAILIISearchUrl, extractBAILIISearchResults, BAILII_URL_PATTERNS, } from './parsers/bailii';
export { searchBundesrecht, searchJudikatur, fetchDocumentHtml, risDocumentToParsed, fetchKeyAustrianLaws, fetchAndIngestAustrianLaws, } from './risApiClient';
export type { RISApiSearchOptions, RISApiDocument, RISApiSearchResult, } from './risApiClient';
export { scrapeConsolidatedLaw, scrapeAndIngestLaw, scrapeAndIngestMultipleLaws, AUSTRIAN_LAWS, } from './risConsolidatedScraper';
export type { ConsolidatedLawSection, ScrapedLaw, } from './risConsolidatedScraper';
export { scrapeSlovakLaw, scrapeAndIngestSlovakLaw, scrapeAndIngestMultipleSlovakLaws, scrapeSlovakCourtDecisions, ingestAllSlovakLaws, SLOVAK_LAWS, } from './slovakLegalScraper';
export type { SlovakLawSection, ScrapedSlovakLaw, SlovakCourtDecision, } from './slovakLegalScraper';
import { Fetcher } from './fetcher';
import { CrawlScheduler } from './scheduler';
import { CrawlSource, ParsedLegalDocument, CrawlStats } from './types';
export declare function parseDocument(html: string, url: string, source: CrawlSource): ParsedLegalDocument | null;
export declare function createCrawler(source: CrawlSource, options?: {
    onDocument?: (doc: ParsedLegalDocument) => Promise<void>;
    onProgress?: (stats: CrawlStats) => void;
}): Promise<{
    fetcher: Fetcher;
    scheduler: CrawlScheduler;
    crawl: (urls: string[]) => Promise<CrawlStats>;
}>;
export declare function crawlAndParse(url: string, source?: CrawlSource): Promise<ParsedLegalDocument | null>;
export declare function crawlAndParseBatch(urls: string[], source?: CrawlSource, options?: {
    onProgress?: (completed: number, total: number) => void;
}): Promise<ParsedLegalDocument[]>;
export declare function crawlAndIngest(urls: string[], source: CrawlSource, options?: {
    generateEmbeddings?: boolean;
    onProgress?: (stats: {
        crawled: number;
        ingested: number;
        total: number;
    }) => void;
}): Promise<{
    documentsFound: number;
    chunksCreated: number;
    embeddingsCreated: number;
    errors: string[];
}>;
export declare function scheduledRISCrawl(options?: {
    maxDocuments?: number;
    types?: Array<'bundesrecht' | 'judikatur'>;
}): Promise<CrawlStats>;
export declare function scheduledBAILIICrawl(options?: {
    maxDocuments?: number;
    courts?: Array<'UKSC' | 'EWCA' | 'EWHC'>;
}): Promise<CrawlStats>;
//# sourceMappingURL=index.d.ts.map