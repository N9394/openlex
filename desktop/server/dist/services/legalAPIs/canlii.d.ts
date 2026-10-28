import { CanLIIConfig, CanLIICase, CanLIICaseMetadata, CanLIIDatabase, CanLIILegislation, CanLIISearchFilters, CanLIISearchResult } from './types';
export declare class CanLIIClient {
    private baseUrl;
    private apiKey?;
    private timeout;
    private userAgent;
    private limiter;
    private language;
    constructor(config?: Partial<CanLIIConfig>);
    setLanguage(lang: 'en' | 'fr'): void;
    private request;
    listDatabases(type?: 'case_law' | 'legislation'): Promise<CanLIIDatabase[]>;
    getDatabasesByJurisdiction(jurisdiction: string): Promise<CanLIIDatabase[]>;
    searchCases(query: string, filters?: CanLIISearchFilters, options?: {
        offset?: number;
        resultCount?: number;
    }): Promise<CanLIISearchResult>;
    searchAll(query: string, filters?: CanLIISearchFilters, options?: {
        maxResults?: number;
        onProgress?: (fetched: number, total: number) => void;
    }): Promise<CanLIICaseMetadata[]>;
    getCaseMetadata(databaseId: string, caseId: string): Promise<CanLIICaseMetadata | null>;
    getCase(databaseId: string, caseId: string): Promise<CanLIICase | null>;
    listLegislation(databaseId: string, options?: {
        offset?: number;
        resultCount?: number;
    }): Promise<Array<{
        legislationId: string;
        title: string;
        citation: string;
    }>>;
    getLegislation(databaseId: string, legislationId: string): Promise<CanLIILegislation | null>;
    fetchCasesFromCourt(databaseId: string, options?: {
        limit?: number;
        startDate?: string;
        endDate?: string;
        onProgress?: (fetched: number, total: number) => void;
    }): Promise<CanLIICase[]>;
    fetchSCCCases(options?: {
        daysBack?: number;
        limit?: number;
        onProgress?: (fetched: number, total: number) => void;
    }): Promise<CanLIICase[]>;
    fetchFCACases(options?: {
        daysBack?: number;
        limit?: number;
        onProgress?: (fetched: number, total: number) => void;
    }): Promise<CanLIICase[]>;
    private getJurisdictionPath;
    private extractJurisdiction;
    private parseLegislationType;
    private stripHtml;
}
export declare function getCanLIIClient(): CanLIIClient;
export declare function searchCanLII(query: string, filters?: CanLIISearchFilters): Promise<CanLIICaseMetadata[]>;
export declare function fetchCanLIICase(databaseId: string, caseId: string): Promise<CanLIICase | null>;
export declare const IMPORTANT_CANADIAN_COURTS: string[];
export declare const IMPORTANT_CANADIAN_LEGISLATION: string[];
//# sourceMappingURL=canlii.d.ts.map