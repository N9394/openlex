import { RISDocument, RISDocumentType } from '../types';
export declare const RIS_URL_PATTERNS: {
    bundesrecht: string;
    landesrecht: string;
    judikatur: string;
    search: string;
};
export declare class RISParser {
    private genericParser;
    constructor();
    parse(html: string, url: string): RISDocument | null;
    private detectDocumentType;
    private parseLegislation;
    private parseJudikatur;
    private extractParagraphs;
    private extractAmendments;
    private extractRelatedLaws;
    private parseGermanDate;
    private cleanText;
}
export declare function buildRISSearchUrl(options: {
    type: RISDocumentType;
    query?: string;
    dateFrom?: Date;
    dateTo?: Date;
    pageSize?: number;
    page?: number;
}): string;
export declare function extractSearchResultUrls(html: string, baseUrl: string): string[];
export declare function parseRISDocument(html: string, url: string): RISDocument | null;
//# sourceMappingURL=ris.d.ts.map