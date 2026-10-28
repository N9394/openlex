import { LegalSearchResult } from './legalApiService';
export interface ResearchAction {
    type: string;
    params: Record<string, any>;
}
export interface ActionResult {
    success: boolean;
    message: string;
    data?: any;
}
export interface ResearchContext {
    user: {
        id: string;
        jurisdiction: string;
        language: string;
        tier: string;
    };
    case?: {
        id: string;
        title: string;
        type: string;
        entities: Array<{
            name: string;
            type: string;
        }>;
        timeline: Array<{
            title: string;
            date: string;
        }>;
    };
    vault: Array<{
        id: string;
        title: string;
        type: string;
        tags: string[];
    }>;
    documents: Array<{
        id: string;
        filename: string;
        summary?: string;
    }>;
    recentSearches: Array<{
        query: string;
        sources: string[];
    }>;
}
export interface ChatResponse {
    message: string;
    sources: LegalSearchResult[];
    actions: ActionResult[];
    conversationId: string;
}
export interface StreamEvent {
    type: 'status' | 'sources' | 'thinking' | 'content' | 'token' | 'actions' | 'complete' | 'error';
    data: any;
}
export declare const RESEARCH_ACTIONS: {
    readonly SEARCH_LEGAL_DB: "search_legal_db";
    readonly SEARCH_WEB: "search_web";
    readonly SEARCH_VAULT: "search_vault";
    readonly SEARCH_DOCUMENTS: "search_documents";
    readonly SEARCH_CASE_DATA: "search_case_data";
    readonly SAVE_TO_CASE: "save_to_case";
    readonly SAVE_TO_VAULT: "save_to_vault";
    readonly CREATE_CITATION: "create_citation";
    readonly SUMMARIZE_SOURCE: "summarize_source";
    readonly COMPARE_CASES: "compare_cases";
    readonly ANALYZE_PRECEDENT: "analyze_precedent";
    readonly DRAFT_MEMO: "draft_memo";
};
export declare const JURISDICTION_INFO: Record<string, {
    name: string;
    citationFormat: string;
    legalSystem: string;
    primarySources: string[];
}>;
export declare const OFFICIAL_DATABASES: Record<string, Array<{
    name: string;
    url: string;
    description: string;
    type: 'cases' | 'legislation' | 'comprehensive';
}>>;
export declare function chat(userId: string, message: string, options?: {
    conversationId?: string;
    caseId?: string;
    jurisdictionOverride?: string;
    jurisdictions?: string[];
}): Promise<ChatResponse>;
export declare function chatStream(userId: string, message: string, options?: {
    conversationId?: string;
    caseId?: string;
    jurisdictionOverride?: string;
    jurisdictions?: string[];
}): AsyncGenerator<StreamEvent>;
export declare function getConversations(userId: string, options?: {
    caseId?: string;
    limit?: number;
}): Promise<Array<{
    id: string;
    title: string | null;
    caseId: string | null;
    jurisdiction: string | null;
    messageCount: number;
    updatedAt: Date;
}>>;
export declare function getConversation(conversationId: string, userId: string): Promise<{
    id: string;
    title: string | null;
    caseId: string | null;
    jurisdiction: string | null;
    messages: Array<{
        id: string;
        role: string;
        content: string;
        sources: LegalSearchResult[];
        createdAt: Date;
    }>;
} | null>;
export declare function deleteConversation(conversationId: string, userId: string): Promise<boolean>;
//# sourceMappingURL=researchChatService.d.ts.map