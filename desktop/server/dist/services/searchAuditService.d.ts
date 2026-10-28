export type SearchType = 'dense' | 'hybrid' | 'smart' | 'rag';
export interface SearchAuditData {
    userId?: string;
    organizationId?: string;
    searchType: SearchType;
    query: string;
    jurisdiction?: string;
    resultCount: number;
    caseId?: string;
    matterId?: string;
    pageUrl?: string;
    searchDuration?: number;
    ipAddress?: string;
    userAgent?: string;
    sessionId?: string;
}
export declare function logSearch(data: SearchAuditData): Promise<void>;
//# sourceMappingURL=searchAuditService.d.ts.map