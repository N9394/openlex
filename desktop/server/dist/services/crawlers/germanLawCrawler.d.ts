import { Crawler, CrawlerConfig, CrawlResult, ParsedContent } from './types';
declare class GermanLawCrawler implements Crawler {
    readonly name = "germanlaw";
    readonly config: CrawlerConfig;
    private rateLimiter;
    constructor(config?: Partial<CrawlerConfig>);
    crawl(options?: Partial<CrawlerConfig>): Promise<CrawlResult>;
    private extractLawLinks;
    private getPriorityLaws;
    parse(html: string, url: string): Promise<ParsedContent[]>;
    private extractContent;
    private extractSections;
    ingest(content: ParsedContent[]): Promise<number>;
    isIngested(externalId: string): Promise<boolean>;
}
export declare function createGermanLawCrawler(config?: Partial<CrawlerConfig>): Crawler;
export default GermanLawCrawler;
//# sourceMappingURL=germanLawCrawler.d.ts.map