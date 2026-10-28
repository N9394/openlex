import { ClauseTemplate, JurisdictionEntry, CaseLawEntry, IngestOptions } from './types';
import { LegalAPIDocument, CourtListenerCase, EURLexDocument, CanLIICase, BulkIngestionOptions } from '../legalAPIs';
export declare function ingestContent(content: string, options: IngestOptions, generateEmbeddings?: boolean): Promise<{
    chunksCreated: number;
    embeddingsCreated: number;
    skipped: number;
    reasons: Record<string, number>;
}>;
export declare function ingestClauseTemplate(_clause: ClauseTemplate): Promise<void>;
export declare function ingestJurisdictionEntry(entry: JurisdictionEntry): Promise<void>;
export declare function ingestCaseLawEntry(caseLaw: CaseLawEntry, generateEmbeddings?: boolean): Promise<{
    chunksCreated: number;
    embeddingsCreated: number;
}>;
export declare function bulkIngestCaseLaw(cases: CaseLawEntry[], generateEmbeddings?: boolean): Promise<{
    success: number;
    failed: number;
    chunks: number;
    embeddings: number;
}>;
export declare function ingestUserDocument(userId: string, documentId: string, documentName: string, content: string, metadata?: {
    jurisdiction?: string;
    documentType?: string;
    isAnonymized?: boolean;
}, orgId?: string): Promise<{
    chunksCreated: number;
}>;
export declare function ingestUserDocumentSafe(documentId: string, generateEmbeddings?: boolean): Promise<{
    chunksCreated: number;
    embeddingsCreated: number;
    usedAnonymized: boolean;
}>;
export declare function deleteUserDocumentChunks(userId: string, documentId: string): Promise<void>;
export declare function deleteAllUserChunks(userId: string): Promise<void>;
export declare function bulkIngestClauses(clauses: ClauseTemplate[]): Promise<{
    success: number;
    failed: number;
}>;
export declare function bulkIngestJurisdiction(entries: JurisdictionEntry[]): Promise<{
    success: number;
    failed: number;
}>;
export declare function ingestLegalAPIDocument(document: LegalAPIDocument, generateEmbeddings?: boolean): Promise<{
    chunksCreated: number;
    embeddingsCreated: number;
}>;
export declare function ingestCourtListenerCase(caseLaw: CourtListenerCase, generateEmbeddings?: boolean): Promise<{
    chunksCreated: number;
    embeddingsCreated: number;
}>;
export declare function ingestEURLexDocument(document: EURLexDocument, generateEmbeddings?: boolean): Promise<{
    chunksCreated: number;
    embeddingsCreated: number;
}>;
export declare function ingestCanLIICase(caseLaw: CanLIICase, generateEmbeddings?: boolean): Promise<{
    chunksCreated: number;
    embeddingsCreated: number;
}>;
export declare function bulkIngestLegalAPIDocuments(documents: LegalAPIDocument[], generateEmbeddings?: boolean): Promise<{
    success: number;
    failed: number;
    chunks: number;
    embeddings: number;
}>;
export declare function fetchAndIngestLegalContent(options?: BulkIngestionOptions & {
    generateEmbeddings?: boolean;
}): Promise<{
    fetched: number;
    ingested: number;
    chunks: number;
    embeddings: number;
    errors: string[];
}>;
export declare function isDocumentIngested(sourceId: string): Promise<boolean>;
export declare function getIngestionStats(): Promise<{
    totalChunks: number;
    bySourceType: Record<string, number>;
    byJurisdiction: Record<string, number>;
}>;
//# sourceMappingURL=ingestion.d.ts.map