export * from './types';
export { CourtListenerClient, getCourtListenerClient, searchCourtListener, fetchCase as fetchCourtListenerCase, IMPORTANT_US_COURTS, } from './courtlistener';
export { EURLexClient, getEURLexClient, searchEURLex, fetchEURLexDocument, parseCELEX, getDocumentTypeFromCELEX, KEY_EU_LEGISLATION, } from './eurlex';
export { CanLIIClient, getCanLIIClient, searchCanLII, fetchCanLIICase, IMPORTANT_CANADIAN_COURTS, IMPORTANT_CANADIAN_LEGISLATION, } from './canlii';
export { SAFLIIClient, getSAFLIIClient, searchSAFLII, fetchSAFLIICase, SOUTH_AFRICAN_COURTS, IMPORTANT_SA_COURTS, } from './saflii';
export { SlovLexClient, getSlovLexClient, OtvoreneSudyClient, getOtvoreneSudyClient, fetchSlovakLegislation, fetchSlovakDecree, } from './slovlex';
import { LegalAPIDocument } from './types';
export type LegalJurisdiction = 'US' | 'EU' | 'CA' | 'ZA' | 'SK' | 'ALL';
export interface UnifiedSearchFilters {
    jurisdiction?: LegalJurisdiction;
    dateAfter?: string;
    dateBefore?: string;
    documentType?: 'case_law' | 'legislation' | 'regulation' | 'all';
}
export interface UnifiedSearchResult {
    source: 'courtlistener' | 'eurlex' | 'canlii' | 'saflii' | 'slovlex';
    document: LegalAPIDocument;
}
export interface UnifiedSearchOptions {
    maxResultsPerSource?: number;
    fetchContent?: boolean;
}
export declare function searchLegalAPIs(query: string, filters?: UnifiedSearchFilters, options?: UnifiedSearchOptions): Promise<UnifiedSearchResult[]>;
export type IngestionProgressCallback = (progress: {
    source: string;
    fetched: number;
    total: number;
    currentDocument?: string;
}) => void;
export interface BulkIngestionOptions {
    sources?: Array<'courtlistener' | 'eurlex' | 'canlii'>;
    maxPerSource?: number;
    daysBack?: number;
    onProgress?: IngestionProgressCallback;
}
export interface BulkIngestionResult {
    totalFetched: number;
    bySource: {
        courtlistener: number;
        eurlex: number;
        canlii: number;
    };
    documents: LegalAPIDocument[];
    errors: string[];
}
export declare function fetchLegalDocuments(options?: BulkIngestionOptions): Promise<BulkIngestionResult>;
export interface APIStatus {
    source: string;
    available: boolean;
    hasApiKey: boolean;
    error?: string;
}
export declare function checkAPIStatus(): Promise<APIStatus[]>;
//# sourceMappingURL=index.d.ts.map