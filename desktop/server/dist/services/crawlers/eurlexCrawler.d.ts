import { Crawler, CrawlerConfig, CrawlResult, ParsedContent } from './types';
declare class EURLexCrawler implements Crawler {
    readonly name = "eurlex";
    readonly config: CrawlerConfig;
    private rateLimiter;
    constructor(config?: Partial<CrawlerConfig>);
    crawl(options?: Partial<CrawlerConfig>): Promise<CrawlResult>;
    private crawlDocumentType;
    private searchDocuments;
    private extractSearchResults;
    private getFallbackDocuments;
    private fetchDocument;
    parse(json: string, url: string): Promise<ParsedContent[]>;
    ingest(content: ParsedContent[]): Promise<number>;
    isIngested(externalId: string): Promise<boolean>;
    private htmlToText;
    private extractBodyText;
}
export declare function createEURLexCrawler(config?: Partial<CrawlerConfig>): Crawler;
export default EURLexCrawler;
//# sourceMappingURL=eurlexCrawler.d.ts.map