import { GroundingResult } from '../../services/modelRouter';
export declare const CITATION_PATTERNS: Record<string, RegExp[]>;
export interface HallucinationReport {
    response: string;
    totalCitations: number;
    verifiedCitations: number;
    unverifiedCitations: string[];
    potentialFakes: string[];
    suspiciousPatterns: string[];
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    details: string[];
}
export declare function detectHallucinations(response: string, ragSources: Array<{
    content: string;
    sourceType: string;
}> | undefined, jurisdiction?: string): HallucinationReport;
export declare function runHallucinationTests(): Promise<{
    totalTests: number;
    passed: number;
    failed: number;
    results: Array<{
        testId: string;
        passed: boolean;
        expectedRisk: string;
        actualRisk: string;
        report: HallucinationReport;
    }>;
}>;
export declare function validateResponse(response: string, ragSources: Array<{
    content: string;
    sourceType: string;
}> | undefined, jurisdiction?: string): {
    isValid: boolean;
    grounding: GroundingResult;
    hallucination: HallucinationReport;
    warnings: string[];
};
declare const _default: {
    detectHallucinations: typeof detectHallucinations;
    runHallucinationTests: typeof runHallucinationTests;
    validateResponse: typeof validateResponse;
    CITATION_PATTERNS: Record<string, RegExp[]>;
};
export default _default;
//# sourceMappingURL=hallucination.test.d.ts.map