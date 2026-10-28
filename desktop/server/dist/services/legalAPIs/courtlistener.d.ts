import { CourtListenerConfig, CourtListenerCourt, CourtListenerCluster, CourtListenerOpinion, CourtListenerSearchFilters, CourtListenerSearchResult, CourtListenerCase } from './types';
export declare class CourtListenerClient {
    private baseUrl;
    private apiKey?;
    private timeout;
    private userAgent;
    private limiter;
    constructor(config?: Partial<CourtListenerConfig>);
    private request;
    listCourts(): Promise<CourtListenerCourt[]>;
    getCourt(courtId: string): Promise<CourtListenerCourt>;
    searchOpinions(query: string, filters?: CourtListenerSearchFilters, options?: {
        page?: number;
        pageSize?: number;
    }): Promise<CourtListenerSearchResult>;
    searchAll(query: string, filters?: CourtListenerSearchFilters, options?: {
        maxResults?: number;
        onProgress?: (fetched: number, total: number) => void;
    }): Promise<CourtListenerCluster[]>;
    getCluster(clusterId: number): Promise<CourtListenerCluster>;
    listClusters(filters?: {
        court?: string;
        filed_after?: string;
        filed_before?: string;
    }, options?: {
        page?: number;
        pageSize?: number;
    }): Promise<CourtListenerSearchResult>;
    getOpinion(opinionId: number): Promise<CourtListenerOpinion>;
    getOpinionsForCluster(clusterId: number): Promise<CourtListenerOpinion[]>;
    getOpinionText(opinionId: number): Promise<string | null>;
    fetchCasesFromCourt(courtId: string, options?: {
        limit?: number;
        startDate?: string;
        endDate?: string;
        onProgress?: (fetched: number, total: number) => void;
    }): Promise<CourtListenerCase[]>;
    fetchRecentCases(courtIds: string[], options?: {
        daysBack?: number;
        limitPerCourt?: number;
        onProgress?: (court: string, fetched: number) => void;
    }): Promise<CourtListenerCase[]>;
    private normalizeCase;
    private stripHtml;
}
export declare function getCourtListenerClient(): CourtListenerClient;
export declare function searchCourtListener(query: string, filters?: CourtListenerSearchFilters): Promise<CourtListenerCluster[]>;
export declare function fetchCase(clusterId: number): Promise<CourtListenerCase | null>;
export declare const IMPORTANT_US_COURTS: string[];
//# sourceMappingURL=courtlistener.d.ts.map