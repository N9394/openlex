export interface ClausePreference {
    clauseType: string;
    preferredText: string;
    avoidList: string[];
    confidence: number;
    exampleCount: number;
    clauseSubtype?: string;
    sourceDocumentIds?: string[];
}
export interface StyleProfile {
    formalityLevel: number;
    avgSentenceLength: number;
    numberingStyle: string;
    headingStyle: string;
    preferredTerms: Record<string, string>;
    avoidedTerms: string[];
    industryTerms: string[];
    tonePreference?: string;
}
export interface DraftingContext {
    clausePreferences: ClausePreference[];
    styleProfile: StyleProfile | null;
    style: StyleProfile | null;
    clauses: Map<string, ClausePreference>;
    hasFirmMemory: boolean;
}
export declare function getDraftingContext(orgId?: string, docType?: string | string[]): Promise<DraftingContext>;
export declare function upsertClausePreference(orgId: string, clauseType: string, text: string, options?: {
    clauseSubtype?: string;
    confidence?: number;
    sourceDocumentIds?: string[];
}): Promise<void>;
export declare function addClauseExample(orgId: string, docId: string, clauseType: string, text: string, accepted?: boolean, confidence?: number): Promise<void>;
export declare function getClausePreference(orgId: string, clauseType: string, subtype?: string): Promise<ClausePreference | null>;
//# sourceMappingURL=firmMemoryService.d.ts.map