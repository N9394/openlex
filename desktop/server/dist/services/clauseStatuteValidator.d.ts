import type { ExtractedClause } from './clausePatternExtractor';
import type { AIAuditContext } from './aiAuditService';
export interface ApplicableStatute {
    id: string;
    reference: string;
    title: string;
    jurisdiction: string;
    relevanceScore: number;
    excerpt: string;
    sourceUrl?: string;
    requirements?: StatuteRequirement[];
}
export interface StatuteRequirement {
    type: 'minimum' | 'maximum' | 'mandatory' | 'prohibited';
    subject: string;
    value?: string | number;
    unit?: string;
}
export interface ComplianceViolation {
    statuteRef: string;
    statuteTitle: string;
    violationType: 'missing_element' | 'invalid_term' | 'exceeds_limit' | 'below_minimum' | 'prohibited_clause';
    description: string;
    severity: 'critical' | 'major' | 'minor';
    excerpt: string;
    sourceUrl?: string;
}
export interface ClauseValidationResult {
    clause: ExtractedClause;
    isCompliant: boolean;
    violations: ComplianceViolation[];
    applicableStatutes: ApplicableStatute[];
    confidence: 'high' | 'medium' | 'low';
    nliVerified?: boolean;
}
export interface MissingClause {
    clauseType: string;
    requirement: 'mandatory' | 'strongly_recommended';
    statuteRef: string;
    explanation: string;
    suggestedContent?: string;
    jurisdiction: string;
    termId: string;
}
export interface DocumentComplianceReport {
    jurisdiction: string;
    documentType?: string;
    clauseValidations: ClauseValidationResult[];
    missingClauses: MissingClause[];
    overallCompliance: 'compliant' | 'minor_issues' | 'major_issues' | 'non_compliant';
    complianceScore: number;
    summary: string;
}
export declare function findApplicableStatutes(clauseType: string, jurisdiction: string, documentType?: string): Promise<ApplicableStatute[]>;
export declare function validateClauseAgainstStatutes(clause: ExtractedClause, jurisdiction: string, documentType?: string, auditContext?: AIAuditContext): Promise<ClauseValidationResult>;
export declare function findMissingMandatoryClauses(extractedClauses: ExtractedClause[], documentType: string, jurisdiction: string): Promise<MissingClause[]>;
export declare function generateComplianceReport(extractedClauses: ExtractedClause[], documentType: string, jurisdiction: string): Promise<DocumentComplianceReport>;
export declare function batchValidateClauses(clauses: ExtractedClause[], jurisdiction: string, documentType?: string, concurrency?: number): Promise<ClauseValidationResult[]>;
//# sourceMappingURL=clauseStatuteValidator.d.ts.map