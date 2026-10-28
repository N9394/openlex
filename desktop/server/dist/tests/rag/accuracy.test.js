"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GOLDEN_DATASET = void 0;
exports.runAccuracyTests = runAccuracyTests;
exports.runRetrievalTests = runRetrievalTests;
const modelRouter_1 = require("../../services/modelRouter");
const retrieval_1 = require("../../services/rag/retrieval");
exports.GOLDEN_DATASET = [
    {
        id: 'uk-limitation-contract',
        question: 'What is the limitation period for contract claims in England?',
        jurisdiction: 'UK',
        expectedPatterns: [
            /6\s*years?/i,
            /limitation\s+act/i,
        ],
        sourceTypes: ['jurisdiction_kb'],
        minConfidence: 'medium',
        category: 'limitation',
    },
    {
        id: 'uk-gdpr-breach',
        question: 'What are the maximum fines for GDPR violations in the UK?',
        jurisdiction: 'UK',
        expectedPatterns: [
            /17\.5\s*million|£17,500,000/i,
            /4%|four\s*percent/i,
            /global\s*(annual\s*)?(turnover|revenue)/i,
        ],
        sourceTypes: ['jurisdiction_kb'],
        minConfidence: 'medium',
        category: 'data_protection',
    },
    {
        id: 'eu-gdpr-consent',
        question: 'What are the requirements for valid consent under GDPR?',
        jurisdiction: 'EU',
        expectedPatterns: [
            /freely\s*given/i,
            /specific/i,
            /informed/i,
            /unambiguous/i,
        ],
        sourceTypes: ['jurisdiction_kb'],
        minConfidence: 'medium',
        category: 'data_protection',
    },
    {
        id: 'eu-directive-effect',
        question: 'What is the difference between EU regulations and directives?',
        jurisdiction: 'EU',
        expectedPatterns: [
            /directly\s*applicable/i,
            /transpos(e|ition)/i,
            /member\s*state/i,
        ],
        sourceTypes: ['jurisdiction_kb'],
        minConfidence: 'medium',
        category: 'eu_law',
    },
    {
        id: 'de-bgb-limitation',
        question: 'What is the standard limitation period under German BGB?',
        jurisdiction: 'DE',
        expectedPatterns: [
            /3\s*(Jahre|years?)/i,
            /§?\s*195/i,
            /BGB|Bürgerliches?\s*Gesetzbuch/i,
        ],
        sourceTypes: ['jurisdiction_kb'],
        minConfidence: 'medium',
        category: 'limitation',
    },
    {
        id: 'ca-charter-rights',
        question: 'What fundamental freedoms are protected under the Canadian Charter?',
        jurisdiction: 'CA',
        expectedPatterns: [
            /freedom\s*of\s*(conscience|religion)/i,
            /freedom\s*of\s*(thought|expression)/i,
            /freedom\s*of\s*(assembly|association)/i,
            /section\s*2/i,
        ],
        sourceTypes: ['jurisdiction_kb', 'case_law'],
        minConfidence: 'medium',
        category: 'constitutional',
    },
    {
        id: 'us-first-amendment',
        question: 'What rights are protected by the First Amendment?',
        jurisdiction: 'US',
        expectedPatterns: [
            /freedom\s*of\s*speech/i,
            /freedom\s*of\s*(the\s*)?press/i,
            /freedom\s*of\s*religion/i,
            /right\s*to\s*(peaceably\s*)?assemble/i,
        ],
        sourceTypes: ['jurisdiction_kb', 'case_law'],
        minConfidence: 'medium',
        category: 'constitutional',
    },
    {
        id: 'us-statute-limitations-federal',
        question: 'What is the statute of limitations for federal crimes?',
        jurisdiction: 'US',
        expectedPatterns: [
            /5\s*years?/i,
            /18\s*U\.?S\.?C/i,
        ],
        forbiddenPatterns: [
            /no\s*statute\s*of\s*limitations/i,
        ],
        sourceTypes: ['jurisdiction_kb'],
        minConfidence: 'low',
        category: 'criminal',
    },
    {
        id: 'intl-force-majeure',
        question: 'What is force majeure in contract law?',
        jurisdiction: 'US',
        expectedPatterns: [
            /unforeseeable/i,
            /beyond\s*(the\s*)?(party|control)/i,
            /performance/i,
            /extraordinary|exceptional|unforeseen/i,
        ],
        sourceTypes: ['legislation', 'jurisdiction_kb'],
        minConfidence: 'medium',
        category: 'contracts',
    },
];
async function runTest(testCase) {
    const startTime = Date.now();
    const errors = [];
    let response = '';
    let confidence = 'insufficient';
    let sourcesUsed = 0;
    try {
        const result = await (0, modelRouter_1.executeWithRouter)(testCase.question, {
            taskType: 'legal_research',
            userTier: 'pro',
            rag: {
                enabled: true,
                sourceTypes: testCase.sourceTypes,
                jurisdiction: testCase.jurisdiction,
                limit: 5,
            },
        });
        response = result.response;
        confidence = result.confidence;
        sourcesUsed = result.ragSources?.length || 0;
    }
    catch (error) {
        errors.push(`Execution error: ${error instanceof Error ? error.message : String(error)}`);
    }
    const executionTimeMs = Date.now() - startTime;
    const matchedPatterns = [];
    const missedPatterns = [];
    for (const pattern of testCase.expectedPatterns) {
        if (pattern.test(response)) {
            matchedPatterns.push(pattern.source);
        }
        else {
            missedPatterns.push(pattern.source);
        }
    }
    const forbiddenMatches = [];
    if (testCase.forbiddenPatterns) {
        for (const pattern of testCase.forbiddenPatterns) {
            if (pattern.test(response)) {
                forbiddenMatches.push(pattern.source);
            }
        }
    }
    const confidenceLevels = ['high', 'medium', 'low', 'insufficient'];
    const minConfidenceIndex = confidenceLevels.indexOf(testCase.minConfidence);
    const actualConfidenceIndex = confidenceLevels.indexOf(confidence);
    const confidencePass = actualConfidenceIndex <= minConfidenceIndex;
    const patternPass = matchedPatterns.length >= Math.ceil(testCase.expectedPatterns.length / 2);
    const forbiddenPass = forbiddenMatches.length === 0;
    const passed = confidencePass && patternPass && forbiddenPass && errors.length === 0;
    return {
        testId: testCase.id,
        passed,
        question: testCase.question,
        response: response.substring(0, 500) + (response.length > 500 ? '...' : ''),
        matchedPatterns,
        missedPatterns,
        forbiddenMatches,
        confidence,
        sourcesUsed,
        executionTimeMs,
        errors,
    };
}
async function runAccuracyTests(filter) {
    let testCases = exports.GOLDEN_DATASET;
    if (filter?.jurisdiction) {
        testCases = testCases.filter(t => t.jurisdiction === filter.jurisdiction);
    }
    if (filter?.category) {
        testCases = testCases.filter(t => t.category === filter.category);
    }
    console.log(`[AccuracyTest] Running ${testCases.length} tests...`);
    const results = [];
    for (const testCase of testCases) {
        console.log(`[AccuracyTest] Running test: ${testCase.id}`);
        const result = await runTest(testCase);
        results.push(result);
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    const passed = results.filter(r => r.passed).length;
    const totalTime = results.reduce((sum, r) => sum + r.executionTimeMs, 0);
    const summary = {
        totalTests: results.length,
        passed,
        failed: results.length - passed,
        passRate: results.length > 0 ? (passed / results.length) * 100 : 0,
        avgExecutionTimeMs: results.length > 0 ? totalTime / results.length : 0,
        results,
    };
    console.log(`[AccuracyTest] Completed:`, {
        total: summary.totalTests,
        passed: summary.passed,
        failed: summary.failed,
        passRate: `${summary.passRate.toFixed(1)}%`,
    });
    return summary;
}
async function runRetrievalTests() {
    const retrievalTests = [
        { id: 'ret-gdpr', query: 'GDPR consent requirements', expectedMinSources: 1 },
        { id: 'ret-contract', query: 'breach of contract remedies', expectedMinSources: 1 },
        { id: 'ret-limitation', query: 'limitation period claims', expectedMinSources: 1 },
        { id: 'ret-employment', query: 'unfair dismissal employment law', expectedMinSources: 1 },
    ];
    const results = [];
    for (const test of retrievalTests) {
        try {
            const searchResults = await (0, retrieval_1.smartSearch)(test.query, { limit: 5 });
            const sourcesFound = searchResults.length;
            const topScore = searchResults[0]?.rank || 0;
            const passed = sourcesFound >= test.expectedMinSources;
            results.push({
                testId: test.id,
                query: test.query,
                sourcesFound,
                topScore,
                passed,
            });
        }
        catch (error) {
            results.push({
                testId: test.id,
                query: test.query,
                sourcesFound: 0,
                topScore: 0,
                passed: false,
            });
        }
    }
    const passed = results.filter(r => r.passed).length;
    const avgScore = results.reduce((sum, r) => sum + r.topScore, 0) / results.length;
    return {
        totalTests: results.length,
        passed,
        avgRelevanceScore: avgScore,
        results,
    };
}
exports.default = {
    runAccuracyTests,
    runRetrievalTests,
    GOLDEN_DATASET: exports.GOLDEN_DATASET,
};
//# sourceMappingURL=accuracy.test.js.map