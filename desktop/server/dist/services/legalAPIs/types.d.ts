export interface LegalAPIDocument {
    sourceId: string;
    source: 'courtlistener' | 'eurlex' | 'canlii' | 'saflii' | 'slovlex';
    title: string;
    content: string;
    url: string;
    jurisdiction: string;
    date?: Date;
    citation?: string;
    contentHash: string;
    fetchedAt: Date;
}
export interface RateLimitConfig {
    maxRequests: number;
    windowMs: number;
    minDelay: number;
}
export interface APIClientConfig {
    baseUrl: string;
    apiKey?: string;
    timeout: number;
    rateLimit: RateLimitConfig;
    userAgent: string;
}
export interface CourtListenerConfig extends APIClientConfig {
    baseUrl: 'https://www.courtlistener.com/api/rest/v4';
}
export interface CourtListenerCourt {
    id: string;
    resource_uri: string;
    full_name: string;
    short_name: string;
    jurisdiction: string;
    in_use: boolean;
    position: number;
}
export interface CourtListenerDocket {
    id: number;
    resource_uri: string;
    court: string;
    case_name: string;
    case_name_short: string;
    case_name_full: string;
    docket_number: string;
    date_filed: string;
    date_terminated?: string;
    source: number;
    assigned_to?: string;
    referred_to?: string;
}
export interface CourtListenerCluster {
    id: number;
    resource_uri: string;
    docket: string;
    date_filed: string;
    case_name: string;
    case_name_short: string;
    case_name_full: string;
    judges: string;
    nature_of_suit: string;
    citation_count: number;
    precedential_status: string;
    scdb_id?: string;
    source: string;
    syllabus?: string;
}
export interface CourtListenerOpinion {
    id: number;
    resource_uri: string;
    cluster: string;
    author?: string;
    type: string;
    sha1: string;
    plain_text?: string;
    html?: string;
    html_with_citations?: string;
    html_lawbox?: string;
    html_columbia?: string;
    download_url?: string;
    local_path?: string;
    extracted_by_ocr: boolean;
}
export interface CourtListenerCitation {
    id: number;
    resource_uri: string;
    volume: number;
    reporter: string;
    page: string;
    type: number;
    cluster: string;
}
export interface CourtListenerSearchFilters {
    court?: string;
    filed_after?: string;
    filed_before?: string;
    precedential_status?: 'Published' | 'Unpublished' | 'Errata' | 'Separate' | 'In-chambers' | 'Relating-to';
    nature_of_suit?: string;
    case_name?: string;
    docket_number?: string;
    judge?: string;
    citation_count__gte?: number;
}
export interface CourtListenerSearchResult {
    count: number;
    next?: string;
    previous?: string;
    results: CourtListenerCluster[];
}
export interface CourtListenerCase extends LegalAPIDocument {
    source: 'courtlistener';
    court: string;
    courtId: string;
    docketNumber?: string;
    judges?: string;
    natureOfSuit?: string;
    precedentialStatus?: string;
    citationCount?: number;
    citations?: string[];
}
export interface EURLexConfig extends APIClientConfig {
    baseUrl: 'https://eur-lex.europa.eu';
    sparqlEndpoint: 'https://publications.europa.eu/webapi/rdf/sparql';
}
export type EURLexDocumentType = 'regulation' | 'directive' | 'decision' | 'recommendation' | 'opinion' | 'treaty' | 'agreement' | 'case_law' | 'other';
export interface CELEXNumber {
    full: string;
    sector: number;
    year: number;
    type: string;
    number: number;
}
export interface EURLexMetadata {
    celex: string;
    title: Record<string, string>;
    date?: string;
    ojDate?: string;
    ojRef?: string;
    type: EURLexDocumentType;
    subjects?: string[];
    directories?: string[];
    author?: string;
    inForce?: boolean;
    languages: string[];
}
export interface EURLexDocument extends LegalAPIDocument {
    source: 'eurlex';
    celex: string;
    documentType: EURLexDocumentType;
    ojReference?: string;
    subjects?: string[];
    inForce?: boolean;
    languages: string[];
    amendments?: Array<{
        celex: string;
        title: string;
        date: string;
        type: 'amends' | 'amended_by' | 'repeals' | 'repealed_by';
    }>;
}
export interface EURLexSearchFilters {
    type?: EURLexDocumentType | EURLexDocumentType[];
    year?: number | [number, number];
    subject?: string;
    directory?: string;
    author?: string;
    inForce?: boolean;
    language?: string;
}
export interface EURLexSearchResult {
    totalHits: number;
    documents: EURLexMetadata[];
    facets?: {
        types: Record<string, number>;
        years: Record<string, number>;
        subjects: Record<string, number>;
    };
}
export interface CanLIIConfig extends APIClientConfig {
    baseUrl: 'https://api.canlii.org/v1';
}
export interface CanLIIDatabase {
    databaseId: string;
    jurisdiction: string;
    name: string;
    type: 'case_law' | 'legislation';
}
export interface CanLIICaseMetadata {
    caseId: {
        en: string;
        fr?: string;
    };
    databaseId: string;
    title: string;
    citation: string;
    decisionDate: string;
    language: 'en' | 'fr' | 'bilingual';
    docketNumber?: string;
    keywords?: string[];
}
export interface CanLIICase extends LegalAPIDocument {
    source: 'canlii';
    caseId: string;
    databaseId: string;
    officialCitation: string;
    docketNumber?: string;
    keywords?: string[];
    citedCases?: Array<{
        caseId: string;
        citation: string;
        title: string;
    }>;
    citingCases?: Array<{
        caseId: string;
        citation: string;
        title: string;
    }>;
}
export interface CanLIILegislation extends LegalAPIDocument {
    source: 'canlii';
    legislationId: string;
    databaseId: string;
    legislationType: 'statute' | 'regulation' | 'rule' | 'order';
    inForce: boolean;
    sections?: Array<{
        number: string;
        title?: string;
        content: string;
    }>;
}
export interface CanLIISearchFilters {
    databaseId?: string;
    jurisdiction?: string;
    decisionDateRange?: {
        start?: string;
        end?: string;
    };
    language?: 'en' | 'fr';
    keywords?: string[];
}
export interface CanLIISearchResult {
    resultCount: number;
    results: CanLIICaseMetadata[];
}
export declare const DEFAULT_API_CONFIGS: {
    readonly courtlistener: {
        readonly baseUrl: "https://www.courtlistener.com/api/rest/v4";
        readonly timeout: 30000;
        readonly userAgent: "LexVault-Bot/1.0 (+https://lexvault.app)";
        readonly rateLimit: {
            readonly maxRequests: 5000;
            readonly windowMs: number;
            readonly minDelay: 750;
        };
    };
    readonly eurlex: {
        readonly baseUrl: "https://eur-lex.europa.eu";
        readonly sparqlEndpoint: "https://publications.europa.eu/webapi/rdf/sparql";
        readonly timeout: 30000;
        readonly userAgent: "LexVault-Bot/1.0 (+https://lexvault.app)";
        readonly rateLimit: {
            readonly maxRequests: 1000;
            readonly windowMs: number;
            readonly minDelay: 1000;
        };
    };
    readonly canlii: {
        readonly baseUrl: "https://api.canlii.org/v1";
        readonly timeout: 30000;
        readonly userAgent: "LexVault-Bot/1.0 (+https://lexvault.app)";
        readonly rateLimit: {
            readonly maxRequests: 1000;
            readonly windowMs: number;
            readonly minDelay: 1000;
        };
    };
};
//# sourceMappingURL=types.d.ts.map