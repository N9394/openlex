export interface GoldenTestCase {
    id: string;
    question: string;
    jurisdiction: string;
    expectedPatterns: RegExp[];
    forbiddenPatterns?: RegExp[];
    sourceTypes: string[];
    minConfidence: 'high' | 'medium' | 'low';
    category: string;
}
interface TestResult {
    testId: string;
    passed: boolean;
    question: string;
    response: string;
    matchedPatterns: string[];
    missedPatterns: string[];
    forbiddenMatches: string[];
    confidence: string;
    sourcesUsed: number;
    executionTimeMs: number;
    errors: string[];
}
export declare const GOLDEN_DATASET: GoldenTestCase[];
export declare function runAccuracyTests(filter?: {
    jurisdiction?: string;
    category?: string;
}): Promise<{
    totalTests: number;
    passed: number;
    failed: number;
    passRate: number;
    avgExecutionTimeMs: number;
    results: TestResult[];
}>;
export declare function runRetrievalTests(): Promise<{
    totalTests: number;
    passed: number;
    avgRelevanceScore: number;
    results: Array<{
        testId: string;
        query: string;
        sourcesFound: number;
        topScore: number;
        passed: boolean;
    }>;
}>;
declare const _default: {
    runAccuracyTests: typeof runAccuracyTests;
    runRetrievalTests: typeof runRetrievalTests;
    GOLDEN_DATASET: GoldenTestCase[];
};
export default _default;
//# sourceMappingURL=accuracy.test.d.ts.map