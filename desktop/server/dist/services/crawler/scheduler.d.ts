import { CrawlQueueItem, ScheduledCrawl, CrawlStats, CrawlSourceConfig, ParsedLegalDocument, CrawlSource } from './types';
import { Fetcher } from './fetcher';
export declare class CrawlScheduler {
    private queue;
    private scheduledTasks;
    private seenUrls;
    private contentHashes;
    private fetchers;
    private isRunning;
    private stats;
    private _onDocumentParsed?;
    constructor();
    addToQueue(url: string, sourceId: string, options?: {
        priority?: number;
        maxRetries?: number;
    }): boolean;
    addManyToQueue(urls: string[], sourceId: string, options?: {
        priority?: number;
        maxRetries?: number;
    }): number;
    isDuplicateContent(content: string): boolean;
    registerFetcher(sourceId: string, config: Partial<CrawlSourceConfig> & {
        source: CrawlSource;
    }): Fetcher;
    getFetcher(sourceId: string): Fetcher | undefined;
    onDocument(callback: (doc: ParsedLegalDocument) => Promise<void>): void;
    processNext(): Promise<CrawlQueueItem | null>;
    run(options?: {
        maxIterations?: number;
        onProgress?: (stats: CrawlStats) => void;
        delayBetweenItems?: number;
    }): Promise<CrawlStats>;
    stop(): void;
    getStats(): CrawlStats;
    getQueueSize(): number;
    clearQueue(): void;
    clearContentHashes(): void;
    resetStats(): void;
    scheduleTask(task: Omit<ScheduledCrawl, 'nextRun'>): void;
    getScheduledTasks(): ScheduledCrawl[];
    removeTask(taskId: string): boolean;
    checkScheduledTasks(): Promise<string[]>;
    private calculateNextRun;
    private createEmptyStats;
    private sleep;
}
export declare function getScheduler(): CrawlScheduler;
export declare function createScheduler(): CrawlScheduler;
//# sourceMappingURL=scheduler.d.ts.map