import { Crawler, CrawlerConfig, CrawlResult, ParsedContent } from './types';
declare class CanLIICrawler implements Crawler {
    readonly name = "canlii";
    readonly config: CrawlerConfig;
    private rateLimiter;
    constructor(config?: Partial<CrawlerConfig>);
    crawl(options?: Partial<CrawlerConfig>): Promise<CrawlResult>;
    private crawlCourt;
    private crawlLegislation;
    private extractCaseLinks;
    private extractLegislationLinks;
    private urlToExternalId;
    parse(html: string, url: string): Promise<ParsedContent[]>;
    private parseLegislation;
    private extractCitation;
    private extractCaseContent;
    private extractLegislationContent;
    private extractDate;
    private cleanTitle;
    ingest(content: ParsedContent[]): Promise<number>;
    isIngested(externalId: string): Promise<boolean>;
}
export declare function createCanLIICrawler(config?: Partial<CrawlerConfig>): Crawler;
export default CanLIICrawler;
//# sourceMappingURL=canliiCrawler.d.ts.map