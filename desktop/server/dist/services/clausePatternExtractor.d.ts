import { ClauseValidationResult, MissingClause, DocumentComplianceReport } from './clauseStatuteValidator';
export interface ExtractedClause {
    type: string;
    subtype?: string;
    text: string;
    startIndex: number;
    endIndex: number;
    confidence: number;
    indicators: string[];
}
export interface ClauseExtractionResult {
    documentId: string;
    clauses: ExtractedClause[];
    documentType: string | null;
    extractedAt: Date;
}
interface ClausePattern {
    type: string;
    subtypes?: string[];
    indicators: RegExp[];
    headerPatterns: RegExp[];
    minLength: number;
    maxLength: number;
}
export declare function extractClauses(text: string): ExtractedClause[];
export declare function extractAndStoreFromDocument(organizationId: string, documentId: string): Promise<ClauseExtractionResult>;
export declare function batchExtractFromDocuments(organizationId: string, documentIds: string[]): Promise<ClauseExtractionResult[]>;
export declare function getSupportedClauseTypes(): string[];
export declare function getClauseTypeInfo(type: string): ClausePattern | null;
export interface ValidatedClause extends ExtractedClause {
    validation?: ClauseValidationResult;
    detectedJurisdiction?: string;
}
export interface EnhancedExtractionResult {
    clauses: ValidatedClause[];
    missingClauses: MissingClause[];
    detectedJurisdiction: {
        code: string | null;
        confidence: number;
        isExplicit: boolean;
        governingLawClause?: string;
    };
    documentType: string | null;
    complianceScore: number;
    extractedAt: Date;
}
export declare function extractAndValidateClauses(text: string, documentType?: string, overrideJurisdiction?: string): Promise<EnhancedExtractionResult>;
export declare function analyzeDocumentCompliance(text: string, documentType: string, jurisdiction?: string): Promise<DocumentComplianceReport>;
export {};
//# sourceMappingURL=clausePatternExtractor.d.ts.map