export interface RAGSearchAudit {
    query: string;
    expandedQueries?: string[];
    jurisdiction: string;
    sourceTypes?: string[];
    resultsCount: number;
    results: Array<{
        id: string;
        sourceName: string;
        relevanceScore: number;
        rerankerScore?: number;
        wasUsed: boolean;
    }>;
    searchDurationMs: number;
}
export interface NLIVerificationAudit {
    claim: string;
    sourceText: string;
    sourceRef: string;
    result: 'entailment' | 'contradiction' | 'neutral';
    confidence: number;
    verificationDurationMs: number;
}
export interface QuoteVerificationAudit {
    quote: string;
    sourceRef: string;
    sourceText: string;
    matchScore: number;
    isVerified: boolean;
    matchType: 'exact' | 'fuzzy' | 'not_found';
}
export interface LLMCallAudit {
    model: string;
    provider: string;
    taskType: string;
    inputTokens?: number;
    outputTokens?: number;
    temperature: number;
    durationMs: number;
    usedFallback: boolean;
}
export interface AIAuditEntry {
    userId: string;
    organizationId?: string;
    conversationId?: string;
    caseId?: string;
    requestType: 'research_chat' | 'document_analysis' | 'document_draft' | 'clause_validation' | 'navigator';
    userQuery: string;
    ragSearches: RAGSearchAudit[];
    nliVerifications: NLIVerificationAudit[];
    quoteVerifications: QuoteVerificationAudit[];
    llmCalls: LLMCallAudit[];
    response: string;
    sourcesUsed: Array<{
        id: string;
        sourceName: string;
        citation?: string;
        excerpt?: string;
    }>;
    overallConfidence: 'high' | 'medium' | 'low' | 'unverified';
    nliVerifiedClaims: number;
    totalClaims: number;
    quotesVerified: number;
    totalQuotes: number;
    jurisdiction: string;
    jurisdictionSource: 'user_selected' | 'auto_detected' | 'conversation_default';
    totalDurationMs: number;
    ipAddress?: string;
    userAgent?: string;
}
export declare class AIAuditContext {
    private entry;
    private startTime;
    constructor(userId: string, requestType: AIAuditEntry['requestType'], userQuery: string);
    setOrganization(orgId: string): void;
    setConversation(conversationId: string): void;
    setCase(caseId: string): void;
    setJurisdiction(jurisdiction: string, source: AIAuditEntry['jurisdictionSource']): void;
    setRequestMetadata(ipAddress?: string, userAgent?: string): void;
    logRAGSearch(search: RAGSearchAudit): void;
    logNLIVerification(verification: NLIVerificationAudit): void;
    logQuoteVerification(verification: QuoteVerificationAudit): void;
    logLLMCall(call: LLMCallAudit): void;
    setResponse(response: string, sourcesUsed: AIAuditEntry['sourcesUsed']): void;
    calculateConfidence(): 'high' | 'medium' | 'low' | 'unverified';
    finalize(): AIAuditEntry;
}
export declare function saveAIAudit(entry: AIAuditEntry): Promise<string>;
export declare function isAuditEnabled(organizationId: string | null): Promise<boolean>;
export interface AIAuditFilter {
    userId?: string;
    organizationId?: string;
    conversationId?: string;
    caseId?: string;
    requestType?: string;
    confidence?: string;
    jurisdiction?: string;
    startDate?: Date;
    endDate?: Date;
    hasNLIFailures?: boolean;
    hasQuoteFailures?: boolean;
}
export declare function getAIAuditLogs(organizationId: string | null, filter?: AIAuditFilter, pagination?: {
    page: number;
    limit: number;
}): Promise<{
    logs: any[];
    total: number;
    pages: number;
}>;
export declare function getConversationAuditTrail(conversationId: string): Promise<any[]>;
export declare function getAIAuditStats(organizationId: string, days?: number): Promise<{
    totalQueries: number;
    byConfidence: Record<string, number>;
    byRequestType: Record<string, number>;
    averageNLIVerification: number;
    averageQuoteVerification: number;
    averageDurationMs: number;
}>;
export declare function exportAIAuditLogs(organizationId: string, startDate: Date, endDate: Date, format?: 'json' | 'csv'): Promise<string>;
declare const _default: {
    AIAuditContext: typeof AIAuditContext;
    saveAIAudit: typeof saveAIAudit;
    isAuditEnabled: typeof isAuditEnabled;
    getAIAuditLogs: typeof getAIAuditLogs;
    getConversationAuditTrail: typeof getConversationAuditTrail;
    getAIAuditStats: typeof getAIAuditStats;
    exportAIAuditLogs: typeof exportAIAuditLogs;
};
export default _default;
//# sourceMappingURL=aiAuditService.d.ts.map