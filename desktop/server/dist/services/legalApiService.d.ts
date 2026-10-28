export interface LegalSearchResult {
    id: string;
    source: string;
    jurisdiction: string;
    title: string;
    citation: string;
    date: string;
    court?: string;
    excerpt: string;
    url: string;
    relevance: number;
    metadata?: Record<string, any>;
}
export interface LegalSearchResponse {
    success: boolean;
    results: LegalSearchResult[];
    error?: {
        code: 'AUTH_REQUIRED' | 'RATE_LIMITED' | 'NETWORK_ERROR' | 'PARSE_ERROR' | 'PROVIDER_ERROR';
        message: string;
        provider: string;
    };
    metadata?: {
        provider: string;
        responseTime: number;
        cached: boolean;
    };
}
export interface SearchOptions {
    limit?: number;
    offset?: number;
    dateFrom?: string;
    dateTo?: string;
    court?: string;
    documentType?: string;
}
export declare const JURISDICTIONS: {
    readonly US: "US";
    readonly UK: "UK";
    readonly DE: "DE";
    readonly AT: "AT";
    readonly CH: "CH";
    readonly EU: "EU";
    readonly FR: "FR";
    readonly CA: "CA";
    readonly AU: "AU";
};
export type Jurisdiction = keyof typeof JURISDICTIONS;
export declare const PROVIDERS: {
    readonly COURTLISTENER: "courtlistener";
    readonly FINDCASELAW: "findcaselaw";
    readonly OPENLEGALDATA: "openlegaldata";
    readonly EURLEX: "eurlex";
    readonly LEGIFRANCE: "legifrance";
    readonly CANLII: "canlii";
    readonly AUSTLII: "austlii";
};
export interface AggregatedSearchResponse {
    success: boolean;
    results: LegalSearchResult[];
    errors: Array<{
        jurisdiction: string;
        code: string;
        message: string;
        provider: string;
    }>;
    metadata: {
        totalResponseTime: number;
        successfulProviders: string[];
        failedProviders: string[];
    };
}
export declare function searchByJurisdiction(jurisdiction: string, query: string, options?: SearchOptions): Promise<LegalSearchResponse>;
export declare function searchMultiJurisdiction(jurisdictions: string[], query: string, options?: SearchOptions): Promise<AggregatedSearchResponse>;
export declare function searchCourtListener(query: string, options?: SearchOptions): Promise<LegalSearchResponse>;
export declare function searchFindCaseLaw(query: string, options?: SearchOptions): Promise<LegalSearchResponse>;
export declare function searchOpenLegalData(query: string, options?: SearchOptions): Promise<LegalSearchResponse>;
export declare function searchEurLex(query: string, options?: SearchOptions): Promise<LegalSearchResponse>;
export declare function searchLegifrance(query: string, options?: SearchOptions): Promise<LegalSearchResponse>;
export declare function searchCanLII(query: string, options?: SearchOptions): Promise<LegalSearchResponse>;
export declare function searchAustLII(query: string, options?: SearchOptions): Promise<LegalSearchResponse>;
export declare function getEndpointsForJurisdiction(jurisdiction: string): Promise<Array<{
    provider: string;
    name: string;
    isActive: boolean;
}>>;
export declare function getAvailableEndpoints(jurisdiction?: string): Promise<Array<{
    jurisdiction: string;
    provider: string;
    name: string;
    baseUrl: string;
    authType: string;
    isActive: boolean;
}>>;
export declare function seedLegalApiEndpoints(): Promise<void>;
export declare function formatCitation(result: LegalSearchResult, format?: 'bluebook' | 'oscola' | 'german' | 'default'): string;
//# sourceMappingURL=legalApiService.d.ts.map