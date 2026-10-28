import { EURLexConfig, EURLexDocument, EURLexDocumentType, EURLexMetadata, EURLexSearchFilters, EURLexSearchResult, CELEXNumber } from './types';
export declare function parseCELEX(celex: string): CELEXNumber | null;
export declare function getDocumentTypeFromCELEX(celex: CELEXNumber): EURLexDocumentType;
export declare class EURLexClient {
    private baseUrl;
    private sparqlEndpoint;
    private timeout;
    private userAgent;
    private limiter;
    private preferredLanguage;
    constructor(config?: Partial<EURLexConfig>);
    setPreferredLanguage(lang: string): void;
    private sparqlQuery;
    searchLegislation(query: string, filters?: EURLexSearchFilters, options?: {
        limit?: number;
        offset?: number;
    }): Promise<EURLexSearchResult>;
    getDocumentMetadata(celex: string): Promise<EURLexMetadata | null>;
    getDocument(celex: string, language?: string): Promise<EURLexDocument | null>;
    private fetchDocumentContent;
    private extractHtmlContent;
    getDirective(year: number, number: number, language?: string): Promise<EURLexDocument | null>;
    getRegulation(year: number, number: number, language?: string): Promise<EURLexDocument | null>;
    getDecision(year: number, number: number, language?: string): Promise<EURLexDocument | null>;
    getCase(year: number, caseNumber: number, language?: string): Promise<EURLexDocument | null>;
    fetchRecentLegislation(options?: {
        types?: EURLexDocumentType[];
        daysBack?: number;
        limit?: number;
        language?: string;
        onProgress?: (fetched: number, total: number) => void;
    }): Promise<EURLexDocument[]>;
    fetchKeyRegulations(): Promise<EURLexDocument[]>;
    private mapDocumentType;
    private parseDocumentType;
    private escapeString;
    private stripHtml;
}
export declare function getEURLexClient(): EURLexClient;
export declare function searchEURLex(query: string, filters?: EURLexSearchFilters): Promise<EURLexMetadata[]>;
export declare function fetchEURLexDocument(celex: string, language?: string): Promise<EURLexDocument | null>;
export declare const KEY_EU_LEGISLATION: {
    GDPR: string;
    DMA: string;
    DSA: string;
    AI_ACT: string;
    DATA_ACT: string;
    DATA_GOVERNANCE: string;
    P2B_REGULATION: string;
    EIDAS: string;
    NIS2: string;
    CYBER_RESILIENCE: string;
};
//# sourceMappingURL=eurlex.d.ts.map