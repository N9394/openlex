import { RobotsTxtRules } from './types';
export declare class RobotsTxtParser {
    private cache;
    constructor();
    fetch(robotsUrl: string, userAgent: string): Promise<RobotsTxtRules>;
    parse(content: string): RobotsTxtRules;
    isAllowed(url: string, userAgent: string, rules: RobotsTxtRules): boolean;
    getCrawlDelay(userAgent: string, rules: RobotsTxtRules): number | undefined;
    private matchesPattern;
    private createEmptyRules;
    clearCache(): void;
    getCached(robotsUrl: string): RobotsTxtRules | undefined;
}
export declare function isUrlAllowed(url: string, userAgent?: string): Promise<boolean>;
export declare function getSitemapUrls(baseUrl: string, userAgent?: string): Promise<string[]>;
//# sourceMappingURL=robotsParser.d.ts.map