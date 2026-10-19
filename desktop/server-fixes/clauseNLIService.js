"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyEntailment = verifyEntailment;
exports.isNLIAvailable = isNLIAvailable;
exports.verifyClauseAgainstStatutes = verifyClauseAgainstStatutes;
exports.batchVerifyClauses = batchVerifyClauses;
exports.verifyLegalClaim = verifyLegalClaim;
exports.verifyLegalClaims = verifyLegalClaims;
const NLI_URL = process.env.NLI_URL || 'http://nli:11436';
const DEFAULT_TIMEOUT = 15000;
async function verifyEntailment(premise, hypothesis, options = {}) {
    const { timeout = DEFAULT_TIMEOUT, auditContext } = options;
    const startTime = Date.now();
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        const response = await fetch(`${NLI_URL}/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ premise, hypothesis }),
            signal: controller.signal,
        });
        clearTimeout(timeoutId);
        if (!response.ok) {
            console.warn('[NLI] Service error:', response.status);
            const errorResult = {
                label: 'neutral',
                supported: false,
                confidence: 0,
                premise,
                hypothesis,
            };
            if (auditContext) {
                auditContext.logNLIVerification({
                    claim: hypothesis,
                    sourceText: premise.substring(0, 500),
                    sourceRef: `NLI service error (${response.status})`,
                    result: 'neutral',
                    confidence: 0,
                    verificationDurationMs: Date.now() - startTime,
                });
            }
            return errorResult;
        }
        const result = await response.json();
        const nliResult = {
            label: result.label || 'neutral',
            supported: result.supported || result.label === 'entailment',
            confidence: result.confidence || 0,
            premise,
            hypothesis,
        };
        if (auditContext) {
            auditContext.logNLIVerification({
                claim: hypothesis,
                sourceText: premise.substring(0, 500),
                sourceRef: 'NLI verification',
                result: nliResult.label,
                confidence: nliResult.confidence,
                verificationDurationMs: Date.now() - startTime,
            });
        }
        return nliResult;
    }
    catch (error) {
        const isTimeout = error?.name === 'AbortError';
        if (isTimeout) {
            console.warn('[NLI] Request timeout');
        }
        else {
            console.warn('[NLI] Service unavailable:', error);
        }
        const failedResult = {
            label: 'neutral',
            supported: false,
            confidence: 0,
            premise,
            hypothesis,
        };
        if (auditContext) {
            auditContext.logNLIVerification({
                claim: hypothesis,
                sourceText: premise.substring(0, 500),
                sourceRef: 'NLI verification (failed)',
                result: 'neutral',
                confidence: 0,
                verificationDurationMs: Date.now() - startTime,
            });
        }
        return failedResult;
    }
}
async function isNLIAvailable() {
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const response = await fetch(`${NLI_URL}/health`, {
                method: 'GET',
                signal: AbortSignal.timeout(5000),
            });
            if (response.ok) return true;
        }
        catch {
            if (attempt === 0) await new Promise(r => setTimeout(r, 500));
        }
    }
    console.warn('[NLI] Service unavailable after 2 health check attempts');
    return false;
}
async function verifyClauseAgainstStatutes(clauseText, clauseType, statuteExcerpts, options = {}) {
    const { minConfidence = 0.6 } = options;
    const verifiedAgainst = [];
    let highestConfidence = 0;
    let hasEntailment = false;
    let hasContradiction = false;
    for (const statute of statuteExcerpts) {
        const hypothesis = generateComplianceHypothesis(clauseText, clauseType, statute.statuteRef);
        const result = await verifyEntailment(statute.excerpt, hypothesis);
        verifiedAgainst.push({
            statuteRef: statute.statuteRef,
            excerpt: statute.excerpt,
            entailment: result,
        });
        if (result.confidence > highestConfidence) {
            highestConfidence = result.confidence;
        }
        if (result.label === 'entailment' && result.confidence >= minConfidence) {
            hasEntailment = true;
        }
        if (result.label === 'contradiction' && result.confidence >= minConfidence) {
            hasContradiction = true;
        }
    }
    let overallConfidence;
    if (hasContradiction) {
        overallConfidence = 'low';
    }
    else if (hasEntailment && highestConfidence >= 0.8) {
        overallConfidence = 'high';
    }
    else if (hasEntailment) {
        overallConfidence = 'medium';
    }
    else {
        overallConfidence = 'unverified';
    }
    return {
        clauseType,
        clauseText: clauseText.substring(0, 200) + (clauseText.length > 200 ? '...' : ''),
        isVerified: hasEntailment && !hasContradiction,
        entailmentScore: highestConfidence,
        verifiedAgainst,
        overallConfidence,
    };
}
function generateComplianceHypothesis(clauseText, clauseType, statuteRef) {
    const numbers = clauseText.match(/[\d.,]+\s*(?:EUR|eur|€|days?|months?|weeks?|years?|%)/gi) || [];
    switch (clauseType) {
        case 'termination':
            if (numbers.length > 0) {
                return `The termination notice period of ${numbers[0]} complies with ${statuteRef}.`;
            }
            return `The termination clause complies with the requirements of ${statuteRef}.`;
        case 'share_capital':
            if (numbers.length > 0) {
                return `The share capital of ${numbers[0]} meets the minimum requirement of ${statuteRef}.`;
            }
            return `The share capital clause complies with ${statuteRef}.`;
        case 'confidentiality':
            return `The confidentiality obligations comply with ${statuteRef}.`;
        case 'payment':
            if (numbers.length > 0) {
                return `The payment terms of ${numbers[0]} comply with ${statuteRef}.`;
            }
            return `The payment terms comply with ${statuteRef}.`;
        case 'governing_law':
            return `The choice of law clause is valid under ${statuteRef}.`;
        default:
            return `The ${clauseType} clause complies with the requirements of ${statuteRef}.`;
    }
}
async function batchVerifyClauses(clauses, options = {}) {
    const { concurrency = 3, minConfidence = 0.6 } = options;
    const results = [];
    for (let i = 0; i < clauses.length; i += concurrency) {
        const batch = clauses.slice(i, i + concurrency);
        const batchResults = await Promise.all(batch.map(clause => verifyClauseAgainstStatutes(clause.clauseText, clause.clauseType, clause.statuteExcerpts, { minConfidence }).then(result => ({
            ...result,
            clauseId: clause.clauseId,
        }))));
        results.push(...batchResults);
    }
    const verifiedClauses = results.filter(r => r.isVerified).length;
    const unverifiedClauses = results.filter(r => r.overallConfidence === 'unverified').length;
    const contradictedClauses = results.filter(r => r.verifiedAgainst.some(v => v.entailment.label === 'contradiction')).length;
    const verificationRatio = clauses.length > 0 ? verifiedClauses / clauses.length : 0;
    const summary = generateVerificationSummary(clauses.length, verifiedClauses, unverifiedClauses, contradictedClauses);
    return {
        totalClauses: clauses.length,
        verifiedClauses,
        unverifiedClauses,
        contradictedClauses,
        verificationRatio,
        results,
        summary,
    };
}
function generateVerificationSummary(total, verified, unverified, contradicted) {
    if (total === 0) {
        return 'No clauses to verify.';
    }
    const parts = [];
    parts.push(`${total} clause(s) analyzed with NLI verification:`);
    if (verified > 0) {
        parts.push(`- ${verified} clause(s) verified as compliant`);
    }
    if (unverified > 0) {
        parts.push(`- ${unverified} clause(s) could not be verified (insufficient evidence)`);
    }
    if (contradicted > 0) {
        parts.push(`- ${contradicted} clause(s) may contain compliance issues (contradictions detected)`);
    }
    const ratio = Math.round((verified / total) * 100);
    parts.push(`\nOverall verification rate: ${ratio}%`);
    return parts.join('\n');
}
async function verifyLegalClaim(claim, sourceText, options = {}) {
    const { auditContext, sourceRef } = options;
    const result = await verifyEntailment(sourceText, claim, { auditContext });
    let explanation;
    switch (result.label) {
        case 'entailment':
            explanation = `The claim is supported by the source text with ${Math.round(result.confidence * 100)}% confidence.`;
            break;
        case 'contradiction':
            explanation = `The claim contradicts the source text with ${Math.round(result.confidence * 100)}% confidence.`;
            break;
        default:
            explanation = 'The claim is neither supported nor contradicted by the source text.';
    }
    return {
        isSupported: result.supported,
        confidence: result.confidence,
        label: result.label,
        explanation,
    };
}
async function verifyLegalClaims(claims, options = {}) {
    const { concurrency = 5, auditContext } = options;
    const results = [];
    for (let i = 0; i < claims.length; i += concurrency) {
        const batch = claims.slice(i, i + concurrency);
        const batchResults = await Promise.all(batch.map(async ({ claim, sourceText, sourceRef }) => {
            const result = await verifyEntailment(sourceText, claim, { auditContext });
            return {
                claim,
                isSupported: result.supported,
                confidence: result.confidence,
                label: result.label,
            };
        }));
        results.push(...batchResults);
    }
    return results;
}
exports.default = {
    verifyEntailment,
    isNLIAvailable,
    verifyClauseAgainstStatutes,
    batchVerifyClauses,
    verifyLegalClaim,
    verifyLegalClaims,
};
//# sourceMappingURL=clauseNLIService.js.map