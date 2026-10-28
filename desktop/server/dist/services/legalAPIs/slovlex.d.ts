import { LegalAPIDocument, RateLimitConfig } from './types';
export interface SlovLexConfig {
    baseUrl: string;
    timeout: number;
    userAgent: string;
    rateLimit: RateLimitConfig;
}
declare const DEFAULT_OTVORENESUDY_CONFIG: {
    baseUrl: string;
    apiUrl: string;
    timeout: number;
    userAgent: string;
    rateLimit: {
        maxRequests: number;
        windowMs: number;
        minDelay: number;
    };
};
export interface SlovakLegislation extends LegalAPIDocument {
    source: 'slovlex';
    collectionNumber: string;
    year: number;
    actType?: string;
    inForce?: boolean;
    effectiveDate?: Date;
}
export interface SlovakCase extends LegalAPIDocument {
    source: 'slovlex';
    court: string;
    courtId: string;
    caseNumber?: string;
    judges?: string;
    decisionType?: string;
}
export interface SlovLexSearchResult {
    number: string;
    year: number;
    title: string;
    url: string;
    effectiveDate?: string;
    inForce?: boolean;
}
export declare class SlovLexClient {
    private baseUrl;
    private timeout;
    private userAgent;
    private limiter;
    constructor(config?: Partial<SlovLexConfig>);
    private fetchPage;
    getLegislation(year: number, number: number | string): Promise<SlovakLegislation | null>;
    private parseLegislation;
    private extractContent;
    listLegislationForYear(year: number): Promise<SlovLexSearchResult[]>;
    private parseLegislationList;
    fetchLegislationBulk(options?: {
        year?: number;
        limit?: number;
        onProgress?: (fetched: number, total: number) => void;
    }): Promise<SlovakLegislation[]>;
    private determineActType;
    private parseSkDate;
    private cleanText;
    private stripHtml;
}
export interface OtvoreneSudyCase {
    id: number;
    court: string;
    caseNumber: string;
    date: string;
    judges?: string[];
    summary?: string;
    fullText?: string;
}
export declare class OtvoreneSudyClient {
    private baseUrl;
    private apiUrl;
    private timeout;
    private userAgent;
    private limiter;
    constructor(config?: Partial<typeof DEFAULT_OTVORENESUDY_CONFIG>);
    private fetchPage;
    getRecentDecrees(limit?: number): Promise<SlovakCase[]>;
    private parseDecreeList;
    getDecree(id: number | string): Promise<SlovakCase | null>;
    private parseDecree;
    private extractDecreeContent;
    private parseSkDate;
    private cleanText;
    private stripHtml;
}
export declare function getSlovLexClient(): SlovLexClient;
export declare function getOtvoreneSudyClient(): OtvoreneSudyClient;
export declare function fetchSlovakLegislation(year: number, number: number | string): Promise<SlovakLegislation | null>;
export declare function fetchSlovakDecree(id: number | string): Promise<SlovakCase | null>;
export {};
//# sourceMappingURL=slovlex.d.ts.map