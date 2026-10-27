declare function seedRAGKnowledge(options?: {
    clear?: boolean;
}): Promise<{
    success: boolean;
    stats: import("../services/rag").RAGStats;
    error?: undefined;
} | {
    success: boolean;
    error: unknown;
    stats?: undefined;
}>;
export { seedRAGKnowledge };
//# sourceMappingURL=seedRAGKnowledge.d.ts.map