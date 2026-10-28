"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CITATION_PATTERNS = void 0;
exports.detectHallucinations = detectHallucinations;
exports.runHallucinationTests = runHallucinationTests;
exports.validateResponse = validateResponse;
const modelRouter_1 = require("../../services/modelRouter");
exports.CITATION_PATTERNS = {
    US: [
        /\b\d{1,3}\s+U\.?\s*S\.?\s+\d{1,4}\b/g,
        /\b\d{1,4}\s+F\.?\s*\d*d?\s+\d{1,4}\b/g,
        /\b\d{1,4}\s+F\.?\s*Supp\.?\s*\d*d?\s+\d{1,4}\b/g,
        /\b\d{1,2}\s+U\.?\s*S\.?\s*C\.?\s*§+\s*\d+/gi,
        /\b[A-Z][a-z]+\s+v\.?\s+[A-Z][a-z]+\b/g,
    ],
    UK: [
        /\[\d{4}\]\s+[A-Z]{2,5}\s+\d+/g,
        /\[\d{4}\]\s+\d+\s+[A-Z]{2,4}\s+\d+/g,
        /[A-Z][a-z]+\s+Act\s+\d{4}/g,
        /\bs\.?\s*\d+\s*\([a-z0-9]+\)/gi,
    ],
    EU: [
        /\b\d{5}[A-Z]\d{4}\b/g,
        /ECLI:[A-Z]{2}:[A-Z]:\d{4}:\d+/g,
        /Regulation\s*\(E[CU]\)\s*\d{4}\/\d+/gi,
        /Directive\s*\d{4}\/\d+/gi,
    ],
    DE: [
        /§+\s*\d+[a-z]?\s+[A-Z]{2,5}/g,
        /\b[A-Z]{2,4},\s*(Urteil|Beschluss)\s+vom\s+\d{1,2}\.\d{1,2}\.\d{4}/g,
        /Az\.?\s*[IVXL]+\s*[A-Z]{1,3}\s*\d+\/\d{2}/g,
    ],
    CA: [
        /\d{4}\s+[A-Z]{2,5}\s+\d+/g,
        /\[\d{4}\]\s+\d+\s+S\.?C\.?R\.?\s+\d+/g,
        /R\.?S\.?C\.?\s+\d{4},?\s+c\.?\s+[A-Z]-?\d+/gi,
    ],
};
const KNOWN_FAKE_PATTERNS = [
    /\b\d+\s+F\.?\s*4th\s+\d+\b/g,
    /\b\d+\s+U\.?\s*S\.?\s*App\.?\s+\d+\b/g,
    /\[\d{4}\]\s+UKCC\s+\d+/g,
    /\b\d{4}\s+CANLII\s+\d+\b/gi,
];
function detectHallucinations(response, ragSources, jurisdiction) {
    const report = {
        response: response.substring(0, 200) + '...',
        totalCitations: 0,
        verifiedCitations: 0,
        unverifiedCitations: [],
        potentialFakes: [],
        suspiciousPatterns: [],
        riskLevel: 'low',
        details: [],
    };
    const sourceContent = ragSources
        ? ragSources.map(s => s.content.toLowerCase()).join(' ')
        : '';
    const patterns = jurisdiction
        ? exports.CITATION_PATTERNS[jurisdiction] || []
        : Object.values(exports.CITATION_PATTERNS).flat();
    const allCitations = new Set();
    for (const pattern of patterns) {
        const matches = response.match(pattern) || [];
        for (const match of matches) {
            allCitations.add(match);
        }
    }
    report.totalCitations = allCitations.size;
    for (const citation of allCitations) {
        const citationLower = citation.toLowerCase();
        if (sourceContent.includes(citationLower)) {
            report.verifiedCitations++;
        }
        else {
            report.unverifiedCitations.push(citation);
        }
    }
    for (const fakePattern of KNOWN_FAKE_PATTERNS) {
        const fakeMatches = response.match(fakePattern) || [];
        report.potentialFakes.push(...fakeMatches);
    }
    const suspiciousChecks = [
        {
            pattern: /In the case of [A-Z][a-z]+ v\. [A-Z][a-z]+, the court held/gi,
            reason: 'Generic case citation pattern without specific details',
        },
        {
            pattern: /Section \d+ of the [A-Z][a-z]+ Act/gi,
            reason: 'Generic statute reference',
        },
        {
            pattern: /According to established precedent/gi,
            reason: 'Vague precedent reference without citation',
        },
        {
            pattern: /The leading case on this issue is/gi,
            reason: 'Claim of leading case without specific citation',
        },
    ];
    for (const check of suspiciousChecks) {
        if (check.pattern.test(response) && report.verifiedCitations === 0) {
            report.suspiciousPatterns.push(check.reason);
        }
    }
    if (report.potentialFakes.length > 0) {
        report.riskLevel = 'critical';
        report.details.push(`Found ${report.potentialFakes.length} potentially fake citation(s)`);
    }
    else if (report.unverifiedCitations.length > 2) {
        report.riskLevel = 'high';
        report.details.push(`${report.unverifiedCitations.length} citations not found in sources`);
    }
    else if (report.unverifiedCitations.length > 0) {
        report.riskLevel = 'medium';
        report.details.push(`${report.unverifiedCitations.length} unverified citation(s)`);
    }
    else if (report.suspiciousPatterns.length > 0) {
        report.riskLevel = 'medium';
        report.details.push(`Suspicious patterns: ${report.suspiciousPatterns.join(', ')}`);
    }
    else {
        report.riskLevel = 'low';
        report.details.push('No hallucination indicators detected');
    }
    return report;
}
const HALLUCINATION_TEST_CASES = [
    {
        id: 'real-scotus',
        response: 'In Brown v. Board of Education, 347 U.S. 483 (1954), the Supreme Court held...',
        sources: [{ content: 'Brown v. Board of Education, 347 U.S. 483', sourceType: 'case_law' }],
        expectedRisk: 'low',
    },
    {
        id: 'fake-citation',
        response: 'According to Smith v. Johnson, 999 F.4th 1234 (9th Cir. 2024), the court held...',
        sources: [],
        expectedRisk: 'critical',
    },
    {
        id: 'unverified-uk',
        response: 'In [2024] UKSC 999, the Supreme Court established that...',
        sources: [{ content: 'Different case entirely', sourceType: 'case_law' }],
        expectedRisk: 'medium',
    },
    {
        id: 'vague-reference',
        response: 'According to established precedent, the leading case on this issue supports...',
        sources: [],
        expectedRisk: 'medium',
    },
];
async function runHallucinationTests() {
    const results = [];
    for (const testCase of HALLUCINATION_TEST_CASES) {
        const report = detectHallucinations(testCase.response, testCase.sources);
        const passed = report.riskLevel === testCase.expectedRisk;
        results.push({
            testId: testCase.id,
            passed,
            expectedRisk: testCase.expectedRisk,
            actualRisk: report.riskLevel,
            report,
        });
    }
    const passed = results.filter(r => r.passed).length;
    return {
        totalTests: results.length,
        passed,
        failed: results.length - passed,
        results,
    };
}
function validateResponse(response, ragSources, jurisdiction) {
    const grounding = (0, modelRouter_1.validateGrounding)(response, ragSources);
    const hallucination = detectHallucinations(response, ragSources, jurisdiction);
    const warnings = [];
    if (!grounding.isGrounded) {
        warnings.push('Response may not be properly grounded in sources');
    }
    if (hallucination.riskLevel === 'high' || hallucination.riskLevel === 'critical') {
        warnings.push(`High hallucination risk: ${hallucination.details.join('; ')}`);
    }
    if (grounding.potentialHallucinations.length > 0) {
        warnings.push(`Potential hallucinations: ${grounding.potentialHallucinations.slice(0, 3).join(', ')}`);
    }
    const isValid = grounding.isGrounded &&
        hallucination.riskLevel !== 'critical' &&
        hallucination.riskLevel !== 'high';
    return {
        isValid,
        grounding,
        hallucination,
        warnings,
    };
}
exports.default = {
    detectHallucinations,
    runHallucinationTests,
    validateResponse,
    CITATION_PATTERNS: exports.CITATION_PATTERNS,
};
//# sourceMappingURL=hallucination.test.js.map