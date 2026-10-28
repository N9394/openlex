import { ParsedLegalDocument, LegalDocumentType, CrawlSource } from '../types';
export interface GenericParserOptions {
    contentSelectors?: string[];
    removeSelectors?: string[];
    titleSelector?: string;
    dateSelector?: string;
    defaultJurisdiction?: string;
    defaultLanguage?: 'en' | 'de' | 'fr' | 'it';
    defaultDocumentType?: LegalDocumentType;
}
export declare class GenericParser {
    private options;
    constructor(options?: GenericParserOptions);
    parse(html: string, url: string, source?: CrawlSource): ParsedLegalDocument | null;
    private extractTitle;
    private extractDate;
    private parseDate;
    private extractSections;
    private detectLanguage;
    private cleanText;
    private generateSourceId;
}
export declare function parseHtml(html: string, url: string, options?: GenericParserOptions): ParsedLegalDocument | null;
export declare function extractText(html: string): string;
export declare function extractLinks(html: string, baseUrl: string): string[];
//# sourceMappingURL=generic.d.ts.map