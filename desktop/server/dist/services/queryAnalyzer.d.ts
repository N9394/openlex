import { QueryAnalysis } from './rag/types';
export declare function analyzeQuery(query: string): Promise<QueryAnalysis>;
export declare function hasJurisdictionMention(query: string): boolean;
export declare function isCrossBorderQuery(query: string): boolean;
export declare function extractJurisdictions(query: string): string[];
//# sourceMappingURL=queryAnalyzer.d.ts.map