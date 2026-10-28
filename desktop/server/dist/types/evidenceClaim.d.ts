export interface Claim {
    id: string;
    description: string;
    category: 'factual' | 'legal' | 'procedural' | 'damages' | 'liability' | 'defense';
    importance: 'critical' | 'important' | 'supporting';
    detectedFrom?: string[];
}
export interface Evidence {
    id: string;
    documentId: string;
    documentTitle: string;
    excerpt: string;
    pageNumber?: number;
    section?: string;
    type: 'contract' | 'correspondence' | 'testimony' | 'expert_opinion' | 'physical' | 'other';
}
export interface ClaimEvidenceMapping {
    claimId: string;
    evidenceId: string;
    strength: 'strong' | 'medium' | 'weak';
    relationship: 'supports' | 'contradicts' | 'unclear';
    confidence: number;
    reasoning?: string;
}
export interface EvidenceGap {
    claimId: string;
    description: string;
    severity: 'critical' | 'moderate' | 'minor';
    suggestedEvidence: string[];
    impact: string;
}
export interface EvidenceClaimMatrix {
    caseId: string;
    generatedAt: Date;
    claims: Claim[];
    evidence: Evidence[];
    mappings: ClaimEvidenceMapping[];
    gaps: EvidenceGap[];
    summary: {
        totalClaims: number;
        claimsWithStrongEvidence: number;
        claimsWithWeakEvidence: number;
        claimsWithNoEvidence: number;
        totalEvidencePieces: number;
        averageEvidencePerClaim: number;
        criticalGaps: number;
    };
    matrixView: {
        [claimId: string]: {
            claim: Claim;
            supportingEvidence: Array<{
                evidence: Evidence;
                strength: 'strong' | 'medium' | 'weak';
            }>;
            contradictingEvidence: Array<{
                evidence: Evidence;
                strength: 'strong' | 'medium' | 'weak';
            }>;
            overallStrength: 'strong' | 'medium' | 'weak' | 'none';
            gapSeverity?: 'critical' | 'moderate' | 'minor';
        };
    };
}
//# sourceMappingURL=evidenceClaim.d.ts.map