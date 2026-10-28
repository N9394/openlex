import { SearchOptions, SearchResult } from './types';
export declare function search(query: string, options?: SearchOptions): Promise<SearchResult[]>;
export declare function searchClauses(query: string, options?: {
    jurisdiction?: string;
    documentType?: string;
    clauseType?: string;
    limit?: number;
}): Promise<SearchResult[]>;
export declare function searchUserDocuments(userId: string, query: string, orgId?: string): Promise<SearchResult[]>;
export declare function searchJurisdiction(query: string, jurisdiction: string): Promise<SearchResult[]>;
export declare function getSimilarChunks(chunkId: string, limit?: number): Promise<SearchResult[]>;
export interface HybridSearchOptions extends SearchOptions {
    keywordWeight?: number;
    semanticWeight?: number;
    minSimilarity?: number;
    rrfK?: number;
}
export interface HybridSearchResult extends SearchResult {
    score: number;
    keywordRank?: number;
    semanticSimilarity?: number;
}
export declare function hybridSearch(query: string, options?: HybridSearchOptions): Promise<HybridSearchResult[]>;
export declare function smartSearch(query: string, options?: HybridSearchOptions): Promise<SearchResult[]>;
export interface EnhancedSearchOptions extends HybridSearchOptions {
    expandQuery?: boolean;
    rerank?: boolean;
    minRerankScore?: number;
    rerankContext?: string;
}
export interface EnhancedSearchResult extends SearchResult {
    relevanceScore?: number;
    originalRank?: number;
    expandedTerms?: string[];
}
export declare function enhancedSearch(query: string, options?: EnhancedSearchOptions): Promise<EnhancedSearchResult[]>;
export declare function searchWithExpansion(query: string, options?: SearchOptions): Promise<SearchResult[]>;
import { MultiJurisdictionResult } from './types';
export declare function searchMultiJurisdiction(query: string, jurisdictions: string[], options?: SearchOptions): Promise<MultiJurisdictionResult[]>;
export declare function getJurisdictionName(code: string): string;
//# sourceMappingURL=retrieval.d.ts.map