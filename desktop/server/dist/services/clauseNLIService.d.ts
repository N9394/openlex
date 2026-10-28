import type { AIAuditContext } from './aiAuditService';
export interface NLIResult {
    label: 'entailment' | 'neutral' | 'contradiction';
    supported: boolean;
    confidence: number;
    premise?: string;
    hypothesis?: string;
}
export interface ClauseVerificationResult {
    clauseId?: string;
    clauseType: string;
    clauseText: string;
    isVerified: boolean;
    entailmentScore: number;
    verifiedAgainst: Array<{
        statuteRef: string;
        excerpt: string;
        entailment: NLIResult;
    }>;
    overallConfidence: 'high' | 'medium' | 'low' | 'unverified';
}
export interface ClauseVerificationReport {
    totalClauses: number;
    verifiedClauses: number;
    unverifiedClauses: number;
    contradictedClauses: number;
    verificationRatio: number;
    results: ClauseVerificationResult[];
    summary: string;
}
export interface BatchVerificationOptions {
    concurrency?: number;
    minConfidence?: number;
    requireAllVerified?: boolean;
}
export declare function verifyEntailment(premise: string, hypothesis: string, options?: {
    timeout?: number;
    auditContext?: AIAuditContext;
}): Promise<NLIResult>;
export declare function isNLIAvailable(): Promise<boolean>;
export declare function verifyClauseAgainstStatutes(clauseText: string, clauseType: string, statuteExcerpts: Array<{
    statuteRef: string;
    excerpt: string;
}>, options?: {
    minConfidence?: number;
}): Promise<ClauseVerificationResult>;
export declare function batchVerifyClauses(clauses: Array<{
    clauseId?: string;
    clauseText: string;
    clauseType: string;
    statuteExcerpts: Array<{
        statuteRef: string;
        excerpt: string;
    }>;
}>, options?: BatchVerificationOptions): Promise<ClauseVerificationReport>;
export declare function verifyLegalClaim(claim: string, sourceText: string, options?: {
    auditContext?: AIAuditContext;
    sourceRef?: string;
}): Promise<{
    isSupported: boolean;
    confidence: number;
    label: string;
    explanation: string;
}>;
export declare function verifyLegalClaims(claims: Array<{
    claim: string;
    sourceText: string;
    sourceRef?: string;
}>, options?: {
    concurrency?: number;
    auditContext?: AIAuditContext;
}): Promise<Array<{
    claim: string;
    isSupported: boolean;
    confidence: number;
    label: string;
}>>;
declare const _default: {
    verifyEntailment: typeof verifyEntailment;
    isNLIAvailable: typeof isNLIAvailable;
    verifyClauseAgainstStatutes: typeof verifyClauseAgainstStatutes;
    batchVerifyClauses: typeof batchVerifyClauses;
    verifyLegalClaim: typeof verifyLegalClaim;
    verifyLegalClaims: typeof verifyLegalClaims;
};
export default _default;
//# sourceMappingURL=clauseNLIService.d.ts.map