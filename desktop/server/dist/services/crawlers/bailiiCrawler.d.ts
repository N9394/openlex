import { Crawler, CrawlerConfig, CrawlResult, ParsedContent } from './types';
declare class BAILIICrawler implements Crawler {
    readonly name = "bailii";
    readonly config: CrawlerConfig;
    private rateLimiter;
    constructor(config?: Partial<CrawlerConfig>);
    crawl(options?: Partial<CrawlerConfig>): Promise<CrawlResult>;
    private crawlJurisdiction;
    private extractCaseLinks;
    private urlToExternalId;
    parse(html: string, url: string): Promise<ParsedContent[]>;
    private extractCitation;
    private extractMainContent;
    private extractKeyPassages;
    private extractDate;
    private extractCourtCode;
    private cleanTitle;
    ingest(content: ParsedContent[]): Promise<number>;
    isIngested(externalId: string): Promise<boolean>;
}
export declare function createBAILIICrawler(config?: Partial<CrawlerConfig>): Crawler;
export default BAILIICrawler;
//# sourceMappingURL=bailiiCrawler.d.ts.map