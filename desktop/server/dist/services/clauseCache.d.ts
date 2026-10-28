export interface ClauseAnalysis {
    type: string;
    risk: 'high' | 'medium' | 'low';
    issues: string[];
    recommendation?: string;
    [key: string]: any;
}
export interface CacheEntry {
    id: string;
    clauseHash: string;
    clauseText: string;
    embedding: number[];
    analysis: ClauseAnalysis;
    jurisdiction: string | null;
    hitCount: number;
    createdAt: Date;
    lastUsedAt: Date;
}
export interface CacheResult {
    hit: boolean;
    analysis?: ClauseAnalysis;
    similarity?: number;
    cacheId?: string;
    source?: 'cache' | 'llm';
}
export interface CacheStats {
    totalEntries: number;
    totalHits: number;
    hitRate: string;
    avgSimilarity: number;
    oldestEntry: Date | null;
    newestEntry: Date | null;
}
export declare function setupClauseCacheTable(): Promise<void>;
export declare function checkCache(clauseText: string, jurisdiction?: string): Promise<CacheResult>;
export declare function storeInCache(clauseText: string, analysis: ClauseAnalysis, jurisdiction?: string): Promise<string | null>;
export declare function analyzeClauseWithCache(clauseText: string, jurisdiction: string | undefined, analyzerFn: (text: string) => Promise<ClauseAnalysis>): Promise<{
    analysis: ClauseAnalysis;
    cached: boolean;
    similarity?: number;
}>;
export declare function getCacheStats(): Promise<CacheStats>;
export declare function cleanupCache(maxAgeDays?: number): Promise<number>;
export declare function clearCache(): Promise<void>;
//# sourceMappingURL=clauseCache.d.ts.map