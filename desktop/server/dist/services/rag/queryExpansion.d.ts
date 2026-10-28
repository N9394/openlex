export interface ExpandedQuery {
    original: string;
    expanded: string;
    terms: string[];
    synonymsUsed: Record<string, string[]>;
}
export declare function expandQuery(query: string, options?: {
    language?: 'en' | 'de' | 'sk' | 'auto';
    jurisdiction?: string;
    maxSynonymsPerTerm?: number;
    includeAbbreviations?: boolean;
}): ExpandedQuery;
export declare function buildExpandedFTSQuery(query: string): string;
export declare function getRelatedConcepts(query: string): string[];
//# sourceMappingURL=queryExpansion.d.ts.map