import { ParsedLegalDocument } from './types';
export interface RISApiSearchOptions {
    query?: string;
    pageSize?: 'Ten' | 'Twenty' | 'Fifty' | 'OneHundred';
    page?: number;
    lawType?: 'Bundesgesetz' | 'Verordnung' | 'Erlass' | 'Kundmachung';
}
export interface RISApiDocument {
    id: string;
    title: string;
    shortTitle?: string;
    lawNumber?: string;
    publicationDate?: string;
    eli?: string;
    documentUrl: string;
    xmlUrl?: string;
    htmlUrl?: string;
    pdfUrl?: string;
}
export interface RISApiSearchResult {
    totalHits: number;
    pageNumber: number;
    pageSize: number;
    documents: RISApiDocument[];
}
export declare function searchBundesrecht(options?: RISApiSearchOptions): Promise<RISApiSearchResult>;
export declare function searchJudikatur(options?: RISApiSearchOptions & {
    court?: 'Justiz' | 'Vfgh' | 'Vwgh' | 'Bvwg' | 'Lvwg';
    caseNumber?: string;
    dateFrom?: string;
    dateTo?: string;
}): Promise<RISApiSearchResult>;
export declare function fetchDocumentHtml(htmlUrl: string): Promise<string | null>;
export declare function risDocumentToParsed(doc: RISApiDocument, content: string): ParsedLegalDocument;
export declare function fetchKeyAustrianLaws(): Promise<ParsedLegalDocument[]>;
export declare function fetchAndIngestAustrianLaws(options?: {
    laws?: string[];
    maxDocuments?: number;
    generateEmbeddings?: boolean;
}): Promise<{
    documentsFound: number;
    chunksCreated: number;
    errors: string[];
}>;
export declare function fetchAndIngestAustrianCaseLaw(options?: {
    courts?: Array<'Justiz' | 'Vfgh' | 'Vwgh' | 'Bvwg' | 'Lvwg'>;
    searchTerms?: string[];
    maxPerCourt?: number;
    generateEmbeddings?: boolean;
}): Promise<{
    documentsFound: number;
    chunksCreated: number;
    byCourt: Record<string, {
        found: number;
        ingested: number;
    }>;
    errors: string[];
}>;
//# sourceMappingURL=risApiClient.d.ts.map