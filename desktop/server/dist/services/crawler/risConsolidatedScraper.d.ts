export interface ConsolidatedLawSection {
    sectionNumber: string;
    title: string;
    content: string;
    lawName: string;
    jurisdiction: string;
}
export interface ScrapedLaw {
    lawCode: string;
    fullTitle: string;
    shortTitle: string;
    gesetzesnummer: string;
    sections: ConsolidatedLawSection[];
    scrapedAt: Date;
    sourceUrl: string;
}
export declare const AUSTRIAN_LAWS: Record<string, {
    gesetzesnummer: string;
    fullName: string;
}>;
export declare function scrapeConsolidatedLaw(lawCode: string): Promise<ScrapedLaw | null>;
export declare function scrapeAndIngestLaw(lawCode: string): Promise<{
    success: boolean;
    sectionsFound: number;
    chunksCreated: number;
    error?: string;
}>;
export declare function scrapeAndIngestMultipleLaws(lawCodes: string[]): Promise<{
    totalSections: number;
    totalChunks: number;
    results: Record<string, {
        success: boolean;
        sections: number;
        chunks: number;
        error?: string;
    }>;
}>;
//# sourceMappingURL=risConsolidatedScraper.d.ts.map