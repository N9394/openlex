export interface RAGChunk {
    id: string;
    content: string;
    sourceType: 'user_doc' | 'jurisdiction_kb' | 'case_law' | 'legislation';
    sourceName: string;
    sourceUrl?: string;
    sourceId?: string;
    jurisdiction?: string;
    language: string;
    documentType?: string;
    clauseType?: string;
    userId?: string;
    orgId?: string;
    isGlobal: boolean;
    sourceDate?: Date;
    lastVerified?: Date;
    expiresAt?: Date;
    contentHash?: string;
}
export interface SearchOptions {
    sourceTypes?: string[];
    jurisdiction?: string;
    jurisdictions?: string[];
    includeRelated?: boolean;
    strictJurisdiction?: boolean;
    language?: string;
    documentType?: string;
    clauseType?: string;
    userId?: string;
    orgId?: string;
    limit?: number;
    auditContext?: SearchAuditContext;
}
export interface SearchAuditContext {
    userId: string;
    organizationId?: string;
    searchType?: 'case_law' | 'statute' | 'document' | 'rag' | 'research' | 'bulk' | 'vault' | 'jarvis';
    caseId?: string;
    matterId?: string;
    pageUrl?: string;
    ipAddress?: string;
    userAgent?: string;
    sessionId?: string;
}
export interface MultiJurisdictionResult {
    jurisdiction: string;
    jurisdictionName: string;
    results: SearchResult[];
    totalCount: number;
}
export interface JurisdictionConflict {
    issue: string;
    jurisdictions: string[];
    description: string;
    resolution?: string;
    severity: 'low' | 'medium' | 'high';
    sources?: SearchResult[];
}
export interface QueryAnalysis {
    originalQuery: string;
    detectedJurisdictions: string[];
    suggestedJurisdictions: string[];
    isCrossBorder: boolean;
    legalTopics: string[];
    queryType: 'research' | 'comparison' | 'conflict_check' | 'transaction' | 'general';
    confidence: number;
}
export interface CrossJurisdictionalResponse {
    query: string;
    analysis: QueryAnalysis;
    resultsByJurisdiction: MultiJurisdictionResult[];
    conflicts: JurisdictionConflict[];
    synthesis: string;
    suggestions: string[];
    processingTimeMs: number;
}
export interface SearchResult {
    id: string;
    chunkId?: string;
    content: string;
    sourceName: string;
    sourceUrl?: string;
    jurisdiction?: string;
    clauseType?: string;
    rank: number;
    score?: number;
    sourceDate?: Date;
    lastVerified?: Date;
    expiresAt?: Date;
    isExpired?: boolean;
    daysUntilExpiry?: number;
}
export interface RAGResponse {
    answer: string;
    sources: SearchResult[];
    queryTimeMs: number;
    generationTimeMs: number;
}
export interface ClauseTemplate {
    id: string;
    name: string;
    category: string;
    subcategory?: string;
    content: string;
    jurisdiction: string[];
    language: string;
    documentTypes: string[];
    riskLevel?: 'low' | 'medium' | 'high';
    variations?: Array<{
        name: string;
        content: string;
    }>;
}
export interface JurisdictionEntry {
    id: string;
    topic: string;
    jurisdiction: string;
    language: string;
    content: string;
    sources?: string[];
}
export interface CaseLawEntry {
    id: string;
    caseName: string;
    citation: string;
    court: string;
    dateDecided: string;
    jurisdiction: string;
    language: string;
    topics: string[];
    holding: string;
    keyPassages: Array<{
        heading: string;
        text: string;
    }>;
    outcome: 'plaintiff' | 'defendant' | 'mixed' | 'remanded';
    significance: 'landmark' | 'important' | 'routine';
}
export interface ChunkOptions {
    maxSize: number;
    minSize: number;
    preserveSections: boolean;
    overlapPercent?: number;
}
export interface IngestOptions {
    sourceType: 'user_doc' | 'jurisdiction_kb' | 'case_law' | 'legislation';
    sourceName: string;
    sourceUrl?: string;
    sourceId?: string;
    jurisdiction?: string;
    language?: string;
    documentType?: string;
    clauseType?: string;
    userId?: string;
    orgId?: string;
    sourceDate?: Date;
    expiresAt?: Date;
}
export interface RAGStats {
    totalChunks: number;
    bySourceType: Record<string, number>;
    byJurisdiction: Record<string, number>;
}
//# sourceMappingURL=types.d.ts.map