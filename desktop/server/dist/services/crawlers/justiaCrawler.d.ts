import { Crawler, CrawlerConfig, CrawlResult, ParsedContent } from './types';
declare class JustiaCrawler implements Crawler {
    readonly name = "justia";
    readonly config: CrawlerConfig;
    private rateLimiter;
    constructor(config?: Partial<CrawlerConfig>);
    crawl(options?: Partial<CrawlerConfig>): Promise<CrawlResult>;
    private crawlSupremeCourt;
    private crawlRecentCases;
    private processCase;
    private extractCaseLinks;
    private extractRecentCaseLinks;
    private urlToExternalId;
    parse(html: string, url: string): Promise<ParsedContent[]>;
    private extractCitation;
    private extractOpinionText;
    private extractKeyPassages;
    private extractDate;
    private extractReporter;
    private cleanTitle;
    ingest(content: ParsedContent[]): Promise<number>;
    isIngested(externalId: string): Promise<boolean>;
}
export declare function createJustiaCrawler(config?: Partial<CrawlerConfig>): Crawler;
export default JustiaCrawler;
//# sourceMappingURL=justiaCrawler.d.ts.map