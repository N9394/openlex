export interface EmbeddingResult {
    embedding: number[];
    model: string;
}
export interface SimilarityResult {
    chunkId: string;
    content: string;
    sourceName: string;
    similarity: number;
}
export declare function generateEmbedding(text: string): Promise<number[] | null>;
export declare function generateEmbeddings(texts: string[]): Promise<(number[] | null)[]>;
export declare function storeEmbedding(chunkId: string, embedding: number[]): Promise<void>;
export declare function getEmbedding(chunkId: string): Promise<number[] | null>;
export declare function deleteEmbedding(chunkId: string): Promise<void>;
export declare function deleteEmbeddingsForDocument(userId: string, documentId: string): Promise<void>;
export declare function cosineSimilarity(a: number[], b: number[]): number;
export declare function findSimilarChunks(queryEmbedding: number[], options?: {
    sourceTypes?: string[];
    jurisdiction?: string;
    userId?: string;
    orgId?: string;
    limit?: number;
    minSimilarity?: number;
}): Promise<SimilarityResult[]>;
export declare function semanticSearch(query: string, options?: {
    sourceTypes?: string[];
    jurisdiction?: string;
    userId?: string;
    orgId?: string;
    limit?: number;
    minSimilarity?: number;
}): Promise<SimilarityResult[]>;
export declare function checkEmbeddingsHealth(): Promise<{
    available: boolean;
    model: string;
    error?: string;
}>;
export declare function getEmbeddingStats(): Promise<{
    totalEmbeddings: number;
    model: string;
    dimension: number;
}>;
//# sourceMappingURL=embeddings.d.ts.map