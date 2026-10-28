export type CrawlSource = 'ris_austria' | 'bailii_uk' | 'eur_lex' | 'canlii' | 'courtlistener' | 'custom';
export type LegalDocumentType = 'case_law' | 'legislation' | 'directive' | 'regulation' | 'treaty' | 'commentary' | 'other';
export interface CrawlSourceConfig {
    id: string;
    source: CrawlSource;
    baseUrl: string;
    rateLimit: number;
    maxConcurrent: number;
    userAgent: string;
    respectRobotsTxt: boolean;
    jurisdictions: string[];
    languages: ('en' | 'de' | 'fr' | 'it')[];
    requiresAuth: boolean;
    apiKey?: string;
    useHeadless: boolean;
}
export interface CrawlJob {
    id: string;
    source: CrawlSourceConfig;
    urls: string[];
    priority: number;
    createdAt: Date;
    scheduledFor?: Date;
    maxDocuments?: number;
    documentTypes?: LegalDocumentType[];
    dateRange?: {
        from?: Date;
        to?: Date;
    };
}
export interface FetchResult {
    url: string;
    statusCode: number;
    headers: Record<string, string>;
    html?: string;
    contentType: string;
    size: number;
    fetchTime: number;
    success: boolean;
    error?: string;
    fromCache: boolean;
}
export interface ParsedLegalDocument {
    sourceId: string;
    source: CrawlSource;
    documentType: LegalDocumentType;
    title: string;
    content: string;
    url: string;
    jurisdiction: string;
    language: 'en' | 'de' | 'fr' | 'it';
    date?: Date;
    citation?: string;
    court?: string;
    number?: string;
    topics?: string[];
    relatedDocuments?: Array<{
        title: string;
        url: string;
        relationship: 'cites' | 'cited_by' | 'amends' | 'amended_by' | 'related';
    }>;
    sections?: Array<{
        title: string;
        number?: string;
        content: string;
    }>;
    amendments?: Array<{
        date: Date;
        description: string;
        reference?: string;
    }>;
    contentHash: string;
    crawledAt: Date;
    metadata?: Record<string, unknown>;
}
export type RISDocumentType = 'bundesrecht' | 'landesrecht' | 'judikatur' | 'erlaesse' | 'staatsvertraege';
export interface RISDocument extends ParsedLegalDocument {
    source: 'ris_austria';
    risType: RISDocumentType;
    lawNumber?: string;
    paragraphs?: Array<{
        number: string;
        title?: string;
        content: string;
    }>;
    consolidatedDate?: Date;
    isCurrent: boolean;
}
export type BAILIICourt = 'UKSC' | 'EWCA' | 'EWHC' | 'UKUT' | 'UKFTT' | 'NICA' | 'CSIH' | 'CSOH' | 'other';
export interface BAILIIDocument extends ParsedLegalDocument {
    source: 'bailii_uk';
    court: BAILIICourt;
    neutralCitation?: string;
    parties?: {
        claimant?: string;
        defendant?: string;
        appellant?: string;
        respondent?: string;
    };
    judges?: string[];
    keywords?: string[];
}
export interface ScheduledCrawl {
    id: string;
    source: CrawlSource;
    cronExpression: string;
    enabled: boolean;
    lastRun?: Date;
    nextRun?: Date;
    config?: Partial<CrawlSourceConfig>;
}
export interface CrawlQueueItem {
    id: string;
    url: string;
    sourceId: string;
    priority: number;
    retries: number;
    maxRetries: number;
    addedAt: Date;
    nextAttempt: Date;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    error?: string;
    contentHash?: string;
}
export interface RobotsTxtRules {
    rules: Map<string, {
        allow: string[];
        disallow: string[];
        crawlDelay?: number;
    }>;
    sitemaps: string[];
    fetchedAt: Date;
    ttl: number;
}
export interface CrawlStats {
    totalUrls: number;
    successfulFetches: number;
    failedFetches: number;
    documentsParsed: number;
    documentsIngested: number;
    duplicatesSkipped: number;
    bytesTotal: number;
    avgFetchTime: number;
    startedAt: Date;
    endedAt?: Date;
    errors: Array<{
        url: string;
        error: string;
        timestamp: Date;
    }>;
}
export declare const DEFAULT_SOURCE_CONFIGS: Record<string, Partial<CrawlSourceConfig>>;
//# sourceMappingURL=types.d.ts.map