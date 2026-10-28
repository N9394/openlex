import { BAILIIDocument, BAILIICourt } from '../types';
export declare const BAILII_URL_PATTERNS: {
    base: string;
    ukCourts: string;
    search: string;
};
export declare class BAILIIParser {
    constructor();
    parse(html: string, url: string): BAILIIDocument | null;
    private detectCourt;
    private getJurisdiction;
    private extractTitle;
    private extractNeutralCitation;
    private extractJudgmentContent;
    private extractDate;
    private extractParties;
    private extractJudges;
    private extractKeywords;
    private extractSections;
    private extractCitations;
    private cleanText;
}
export declare function buildBAILIISearchUrl(options: {
    query?: string;
    court?: BAILIICourt;
    dateFrom?: Date;
    dateTo?: Date;
    maxResults?: number;
}): string;
export declare function extractBAILIISearchResults(html: string, baseUrl: string): string[];
export declare function parseBAILIIDocument(html: string, url: string): BAILIIDocument | null;
//# sourceMappingURL=bailii.d.ts.map