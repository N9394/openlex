import { UserTier } from './modelRouter';
interface ParallelAnalysisResult {
    summary: string;
    clauses: any[];
    riskFlags: any[];
    importantDates: any[];
    duration: number;
    chunksProcessed: number;
    ragUsed?: boolean;
    sourcesCount?: number;
    partial?: boolean;
    chunksSucceeded?: number;
    chunksFailed?: number;
    errors?: string[];
}
export interface ProcessorOptions {
    userTier?: UserTier;
    userId?: string;
    jurisdiction?: string;
}
declare function splitIntoChunks(text: string, chunkSize?: number, overlap?: number): string[];
export declare function analyzeDocumentParallel(text: string, options?: ProcessorOptions): Promise<ParallelAnalysisResult>;
export declare function analyzeDocumentFast(text: string, options?: ProcessorOptions): Promise<ParallelAnalysisResult>;
export declare function analyzeDocument(text: string, options?: ProcessorOptions): Promise<ParallelAnalysisResult>;
declare const _default: {
    analyzeDocument: typeof analyzeDocument;
    analyzeDocumentParallel: typeof analyzeDocumentParallel;
    analyzeDocumentFast: typeof analyzeDocumentFast;
    splitIntoChunks: typeof splitIntoChunks;
};
export default _default;
//# sourceMappingURL=parallelProcessor.d.ts.map