export interface AustrianStatuteChunk {
    id: string;
    content: string;
    sourceName: string;
    sourceUrl: string;
    sourceType: string;
    jurisdiction: string;
    clauseType: string | null;
    language: string;
    isGlobal: boolean;
}
export declare const AUSTRIAN_STATUTE_CHUNKS: AustrianStatuteChunk[];
export declare const AUSTRIAN_STATUTE_STATS: {
    totalChunks: number;
    statutes: number;
    categories: string[];
    generatedAt: string;
};
//# sourceMappingURL=index.d.ts.map