import { LegalAPIDocument, RateLimitConfig } from './types';
export interface SAFLIIConfig {
    baseUrl: string;
    timeout: number;
    userAgent: string;
    rateLimit: RateLimitConfig;
}
export declare const SOUTH_AFRICAN_COURTS: Record<string, {
    name: string;
    level: number;
    path: string;
}>;
export declare const IMPORTANT_SA_COURTS: string[];
export interface SAFLIICase extends LegalAPIDocument {
    source: 'saflii';
    court: string;
    courtCode: string;
    neutralCitation?: string;
    judges?: string;
    parties?: string;
}
export interface SAFLIICaseListEntry {
    title: string;
    url: string;
    date?: string;
    citation?: string;
}
export declare class SAFLIIClient {
    private baseUrl;
    private timeout;
    private userAgent;
    private limiter;
    constructor(config?: Partial<SAFLIIConfig>);
    private fetchPage;
    getCaseList(courtCode: string, year?: number): Promise<SAFLIICaseListEntry[]>;
    private parseCaseList;
    private getCourtCode;
    getCase(url: string): Promise<SAFLIICase | null>;
    private parseCase;
    private extractContent;
    fetchCasesFromCourt(courtCode: string, options?: {
        limit?: number;
        year?: number;
        onProgress?: (fetched: number, total: number) => void;
    }): Promise<SAFLIICase[]>;
    searchCases(query: string, options?: {
        courtCode?: string;
        limit?: number;
    }): Promise<SAFLIICaseListEntry[]>;
    private cleanText;
    private stripHtml;
    private generateSourceId;
    private parseDate;
}
export declare function getSAFLIIClient(): SAFLIIClient;
export declare function searchSAFLII(query: string, options?: {
    courtCode?: string;
    limit?: number;
}): Promise<SAFLIICaseListEntry[]>;
export declare function fetchSAFLIICase(url: string): Promise<SAFLIICase | null>;
//# sourceMappingURL=saflii.d.ts.map