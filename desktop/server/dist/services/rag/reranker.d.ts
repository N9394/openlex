import { SearchResult } from './types';
export interface RerankedResult extends SearchResult {
    relevanceScore: number;
    originalRank: number;
}
export declare function rerankResults(query: string, results: SearchResult[], options?: {
    topK?: number;
    minScore?: number;
    context?: string;
}): Promise<RerankedResult[]>;
export declare function isResultRelevant(query: string, result: SearchResult): Promise<boolean>;
//# sourceMappingURL=reranker.d.ts.map