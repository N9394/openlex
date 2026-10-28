import { SearchResult, SearchOptions, RAGResponse } from './types';
import { UserTier } from '../modelRouter';
export { UserTier } from '../modelRouter';
export declare function generateWithRAG(query: string, systemPrompt: string, searchOptions?: SearchOptions, userTier?: UserTier): Promise<RAGResponse>;
export declare function draftClauseWithRAG(clauseType: string, documentType: string, jurisdiction: string, context: string, userAnswers?: Record<string, string>, userTier?: UserTier): Promise<{
    clause: string;
    sources: SearchResult[];
}>;
export declare function answerResearchQuestion(question: string, jurisdiction: string, options?: {
    includeUserDocs?: boolean;
    userId?: string;
    orgId?: string;
    userTier?: UserTier;
}): Promise<RAGResponse & {
    disclaimer: string;
}>;
interface StructuredAnalysis {
    keyClauses: Array<{
        name: string;
        present: boolean;
        notes?: string;
    }>;
    risks: Array<{
        issue: string;
        severity: 'low' | 'medium' | 'high';
        explanation: string;
    }>;
    missingClauses: Array<{
        clause: string;
        importance: 'critical' | 'recommended' | 'optional';
    }>;
    suggestions: Array<{
        suggestion: string;
        priority: 'high' | 'medium' | 'low';
    }>;
    summary: string;
}
export declare function analyzeWithRAG(documentContent: string, documentType: string, jurisdiction: string, userTier?: UserTier): Promise<{
    analysis: string;
    relevantClauses: SearchResult[];
    suggestions: string[];
    structured?: StructuredAnalysis;
}>;
export declare function generateStructured<T>(query: string, schema: string, searchOptions?: SearchOptions, userTier?: UserTier): Promise<{
    result: T | null;
    raw: string;
    sources: SearchResult[];
}>;
//# sourceMappingURL=generation.d.ts.map