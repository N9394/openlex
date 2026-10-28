export interface OrientationFactor {
    id: string;
    description: string;
    impact: 'high' | 'medium' | 'low';
    category: 'evidence' | 'timeline' | 'relationships' | 'procedural' | 'documentation';
    details: string;
    affectedAreas: string[];
}
export interface PrioritizedGap {
    id: string;
    description: string;
    severity: 'critical' | 'recommended' | 'optional';
    impact: string;
    suggestedAction: string;
    category: 'evidence' | 'documentation' | 'timeline' | 'analysis';
}
export interface TimeSensitiveItem {
    id: string;
    description: string;
    date: Date;
    daysUntil: number;
    riskWindow?: {
        start: Date;
        end: Date;
        description: string;
    };
    consequenceCascade?: {
        mayTrigger: string[];
        mayAffect: string[];
    };
    urgency: 'immediate' | 'soon' | 'upcoming';
}
export interface HealthScoreComponents {
    evidenceCompleteness: number;
    riskBalance: number;
    timelineClarity: number;
    missingElementSeverity: number;
    relationshipDependency: number;
}
export interface HealthScore {
    value: number;
    components: HealthScoreComponents;
    trend: 'improving' | 'stable' | 'declining';
    trendReason?: string;
}
export interface CaseOrientation {
    caseId: string;
    generatedAt: Date;
    healthScore: HealthScore;
    limitingFactors: OrientationFactor[];
    strengthFactors: OrientationFactor[];
    gaps: PrioritizedGap[];
    timeSensitive: TimeSensitiveItem[];
    summary: {
        strengths: string;
        concerns: string;
        nextSteps: string;
    };
}
export interface EnhancedTimelineEvent {
    id: string;
    date: Date;
    description: string;
    category: 'filing' | 'hearing' | 'agreement' | 'evidence' | 'correspondence';
    criticality: 'critical' | 'important' | 'informational';
    riskWindow?: {
        start: Date;
        end: Date;
        description: string;
    };
    consequenceCascade?: {
        mayTrigger: string[];
        mayAffect: string[];
    };
}
export interface Claim {
    id: string;
    description: string;
    supportingEvidence: {
        documentId: string;
        documentTitle: string;
        strength: 'strong' | 'medium' | 'weak';
        reason: string;
        excerpt?: string;
    }[];
    gaps: {
        description: string;
        impact: 'high' | 'medium' | 'low';
    }[];
    overallStrength: 'strong' | 'medium-high' | 'medium' | 'medium-low' | 'weak';
}
export interface EvidenceClaimMatrix {
    caseId: string;
    generatedAt: Date;
    claims: Claim[];
    evidenceGaps: {
        description: string;
        affectedClaims: string[];
        priority: 'high' | 'medium' | 'low';
    }[];
}
//# sourceMappingURL=orientation.d.ts.map