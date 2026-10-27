interface CacheStats {
    hits: number;
    misses: number;
    entries: number;
    hitRate: number;
}
export declare function getCachedResponse(messages: Array<{
    role: string;
    content: string;
}>, options?: {
    taskType?: string;
    model?: string;
    temperature?: number;
}): string | null;
export declare function setCachedResponse(messages: Array<{
    role: string;
    content: string;
}>, output: string, options?: {
    taskType?: string;
    model?: string;
    temperature?: number;
}): void;
export declare function clearExpiredEntries(): number;
export declare function clearCache(): void;
export declare function getCacheStats(): CacheStats;
export declare function invalidateByTaskType(taskType: string): number;
export declare function invalidateByContent(searchText: string): number;
declare const _default: {
    getCachedResponse: typeof getCachedResponse;
    setCachedResponse: typeof setCachedResponse;
    clearExpiredEntries: typeof clearExpiredEntries;
    clearCache: typeof clearCache;
    getCacheStats: typeof getCacheStats;
    invalidateByTaskType: typeof invalidateByTaskType;
    invalidateByContent: typeof invalidateByContent;
};
export default _default;
//# sourceMappingURL=llmCache.d.ts.map