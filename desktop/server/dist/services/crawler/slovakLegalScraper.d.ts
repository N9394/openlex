export interface SlovakLawSection {
    sectionNumber: string;
    title: string;
    content: string;
    lawName: string;
    jurisdiction: string;
}
export interface ScrapedSlovakLaw {
    lawCode: string;
    fullTitle: string;
    shortTitle: string;
    zbierkaNumber: string;
    sections: SlovakLawSection[];
    scrapedAt: Date;
    sourceUrl: string;
}
export interface SlovakCourtDecision {
    caseNumber: string;
    court: string;
    decisionDate: string;
    decisionType: string;
    summary: string;
    fullText: string;
    sourceUrl: string;
}
export declare const SLOVAK_LAWS: Record<string, {
    zbierkaNumber: string;
    fullName: string;
    fullNameEn: string;
}>;
export declare function scrapeSlovakLaw(lawCode: string): Promise<ScrapedSlovakLaw | null>;
export declare function scrapeAndIngestSlovakLaw(lawCode: string): Promise<{
    success: boolean;
    sectionsFound: number;
    chunksCreated: number;
    error?: string;
}>;
export declare function scrapeAndIngestMultipleSlovakLaws(lawCodes: string[]): Promise<{
    totalSections: number;
    totalChunks: number;
    results: Record<string, {
        success: boolean;
        sections: number;
        chunks: number;
        error?: string;
    }>;
}>;
export declare function scrapeSlovakCourtDecisions(options?: {
    searchTerms?: string[];
    maxDecisions?: number;
}): Promise<{
    decisionsFound: number;
    chunksCreated: number;
    errors: string[];
}>;
export declare function fetchSlovakSupremeCourtDecisions(options?: {
    startDate?: string;
    maxDecisions?: number;
    chambers?: number[];
}): Promise<{
    decisionsFound: number;
    chunksCreated: number;
    errors: string[];
}>;
export declare function ingestAllSlovakLaws(): Promise<{
    totalSections: number;
    totalChunks: number;
    results: Record<string, {
        success: boolean;
        sections: number;
        chunks: number;
        error?: string;
    }>;
}>;
//# sourceMappingURL=slovakLegalScraper.d.ts.map