export interface CrawlerConfig {
    baseUrl: string;
    jurisdiction: string;
    rateLimit: number;
    respectRobotsTxt: boolean;
    userAgent: string;
    maxPages?: number;
    timeoutMs?: number;
}
export declare const DEFAULT_CRAWLER_CONFIG: Partial<CrawlerConfig>;
export type CrawlContentType = 'case_law' | 'statute' | 'regulation' | 'directive' | 'treaty';
export interface ParsedContent {
    externalId: string;
    title: string;
    content: string;
    contentType: CrawlContentType;
    jurisdiction: string;
    subJurisdiction?: string;
    sourceUrl: string;
    citation?: string;
    court?: string;
    documentDate?: Date;
    language: string;
    topics?: string[];
    keyPassages?: Array<{
        heading: string;
        text: string;
    }>;
    metadata?: Record<string, unknown>;
}
export interface CrawlResult {
    crawler: string;
    startedAt: Date;
    completedAt: Date;
    pagesCrawled: number;
    documentsParsed: number;
    documentsIngested: number;
    errors: number;
    errorMessages: string[];
    amendmentsDetected: number;
}
export interface Crawler {
    readonly name: string;
    readonly config: CrawlerConfig;
    crawl(options?: Partial<CrawlerConfig>): Promise<CrawlResult>;
    parse(html: string, url: string): Promise<ParsedContent[]>;
    ingest(content: ParsedContent[]): Promise<number>;
    isIngested(externalId: string): Promise<boolean>;
}
export interface CrawlSchedule {
    crawler: string;
    frequency: 'daily' | 'weekly' | 'monthly';
    lastRun?: Date;
    nextRun: Date;
    enabled: boolean;
}
export declare class RateLimiter {
    private lastRequest;
    private minInterval;
    constructor(requestsPerSecond: number);
    wait(): Promise<void>;
}
export declare function fetchWithRetry(url: string, options?: {
    rateLimiter?: RateLimiter;
    userAgent?: string;
    timeoutMs?: number;
    maxRetries?: number;
}): Promise<{
    html: string;
    status: number;
}>;
export declare function htmlToText(html: string): string;
//# sourceMappingURL=types.d.ts.map