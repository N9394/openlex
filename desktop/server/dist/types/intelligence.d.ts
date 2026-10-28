export type LegalModeType = 'signing' | 'reviewing' | 'challenging' | 'learning';
export interface LegalModeConfig {
    type: LegalModeType;
    label: string;
    description: string;
    focusAreas: string[];
    excludeAreas: string[];
    urgencyBoost: number;
    tone: 'direct' | 'analytical' | 'critical' | 'educational';
    analysisDepth: 'quick' | 'standard' | 'thorough';
}
export type ActionType = 'risk_mitigation' | 'clause_addition' | 'deadline_action' | 'clarification' | 'document_request' | 'review_required' | 'negotiation_point';
export type UrgencyLevel = 'immediate' | 'high' | 'medium' | 'low';
export interface NextBestAction {
    id: string;
    type: ActionType;
    title: string;
    description: string;
    urgency: UrgencyLevel;
    confidence: number;
    reasoning: string;
    relatedDocumentId?: string;
    relatedClauseId?: string;
    relatedRiskId?: string;
    archivistAction?: string;
    archivistParams?: Record<string, unknown>;
}
export interface ActionContext {
    userId: string;
    organizationId?: string;
    mode: LegalModeType;
}
export interface RiskFlag {
    id: string;
    level: 'low' | 'medium' | 'high' | 'critical';
    category: string;
    explanation: string;
    recommendation?: string;
    citation?: string;
    statuteBasis?: {
        reference: string;
        title?: string;
        excerpt?: string;
        jurisdiction?: string;
    };
    nliConfidence?: number;
    isVerified?: boolean;
}
export interface MissingElement {
    id: string;
    element: string;
    importance: 'optional' | 'recommended' | 'critical';
    explanation: string;
}
export interface ImportantDate {
    id: string;
    date: string;
    description: string;
    type?: 'deadline' | 'renewal' | 'expiration' | 'milestone';
}
export interface ClarityScore {
    overall: number;
    grade: string;
    breakdown: {
        completeness: number;
        fairness: number;
        structure: number;
        precision: number;
    };
    strengths: string[];
    weaknesses: string[];
    recommendation: string;
}
export interface OverallRiskScore {
    score: number;
    level: 'low' | 'medium' | 'high';
    explanation: string;
}
export interface DocumentActionsResponse {
    documentId: string;
    mode: LegalModeType;
    actions: NextBestAction[];
    summary: {
        totalRisks: number;
        criticalRisks: number;
        upcomingDeadlines: number;
        missingElements: number;
    };
    generatedAt: string;
}
export interface CaseActionsResponse {
    caseId: string;
    mode: LegalModeType;
    actions: NextBestAction[];
    documentCount: number;
    summary: {
        totalRisks: number;
        criticalRisks: number;
        upcomingDeadlines: number;
    };
    generatedAt: string;
}
export interface LegalModesResponse {
    modes: LegalModeConfig[];
    currentMode: LegalModeType | null;
}
export type FeedbackType = 'helpful' | 'not_helpful' | 'executed' | 'dismissed';
export interface ActionFeedbackInput {
    actionId: string;
    actionType: ActionType;
    feedback: FeedbackType;
    documentId?: string;
    caseId?: string;
    outcome?: string;
    legalMode?: LegalModeType;
}
//# sourceMappingURL=intelligence.d.ts.map