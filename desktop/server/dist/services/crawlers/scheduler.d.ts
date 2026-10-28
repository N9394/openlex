import { CrawlResult, CrawlSchedule, CrawlerConfig } from './types';
export declare function getSchedules(): Promise<CrawlSchedule[]>;
export declare function updateSchedule(crawler: string, updates: Partial<Pick<CrawlSchedule, 'frequency' | 'enabled' | 'nextRun'>>): Promise<boolean>;
export declare function runCrawler(crawlerName: string, options?: Partial<CrawlerConfig>): Promise<CrawlResult | null>;
export declare function runScheduledCrawls(): Promise<Map<string, CrawlResult>>;
export declare function runAllCrawlers(options?: Partial<CrawlerConfig>): Promise<Map<string, CrawlResult>>;
export declare function getCrawlHistory(crawler?: string, limit?: number): Promise<CrawlResult[]>;
export declare function getCrawlerStats(): Promise<{
    crawlers: string[];
    totalDocuments: number;
    lastRunDate?: Date;
    nextScheduledRun?: Date;
    byJurisdiction: Record<string, number>;
}>;
export declare function initializeScheduler(): Promise<void>;
declare const _default: {
    getSchedules: typeof getSchedules;
    updateSchedule: typeof updateSchedule;
    runCrawler: typeof runCrawler;
    runScheduledCrawls: typeof runScheduledCrawls;
    runAllCrawlers: typeof runAllCrawlers;
    getCrawlHistory: typeof getCrawlHistory;
    getCrawlerStats: typeof getCrawlerStats;
    initializeScheduler: typeof initializeScheduler;
    CRAWLERS: string[];
};
export default _default;
//# sourceMappingURL=scheduler.d.ts.map