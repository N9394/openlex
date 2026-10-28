import { ChunkOptions } from './types';
export declare function chunkText(text: string, options?: Partial<ChunkOptions>): string[];
export declare function extractKeyTerms(text: string): string[];
export declare function getRelatedTerms(term: string): string[];
export interface ExtractedCitation {
    text: string;
    type: 'statute' | 'case' | 'eu' | 'unknown';
    jurisdiction?: string;
    startIndex: number;
    endIndex: number;
}
export declare function extractCitations(text: string): ExtractedCitation[];
export declare function isWithinCitation(text: string, position: number, citations?: ExtractedCitation[]): boolean;
//# sourceMappingURL=chunking.d.ts.map