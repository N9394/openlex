import { FetchResult, CrawlSourceConfig } from './types';
export declare class Fetcher {
    private limiter;
    private robotsParser;
    private config;
    private cache;
    private cacheTTL;
    constructor(config: Partial<CrawlSourceConfig> & {
        id: string;
        source: CrawlSourceConfig['source'];
    });
    fetch(url: string, options?: {
        timeout?: number;
        retries?: number;
        skipCache?: boolean;
        skipRobots?: boolean;
    }): Promise<FetchResult>;
    private fetchWithRetry;
    private checkRobotsTxt;
    private isRetryableError;
    private getCached;
    private setCache;
    private sleep;
    fetchMany(urls: string[], options?: {
        timeout?: number;
        onProgress?: (completed: number, total: number) => void;
    }): Promise<FetchResult[]>;
    static getContentHash(content: string): string;
    getStats(): {
        queued: number;
        running: number;
        done: number;
        cacheSize: number;
    };
    clearCache(): void;
    stop(): Promise<void>;
}
export declare function createFetcher(source: CrawlSourceConfig['source'], overrides?: Partial<CrawlSourceConfig>): Fetcher;
export declare function fetchWithRateLimit(url: string, options?: {
    rateLimit?: number;
    userAgent?: string;
    timeout?: number;
}): Promise<FetchResult>;
//# sourceMappingURL=fetcher.d.ts.map