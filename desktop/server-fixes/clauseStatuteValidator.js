"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.findApplicableStatutes = findApplicableStatutes;
exports.validateClauseAgainstStatutes = validateClauseAgainstStatutes;
exports.findMissingMandatoryClauses = findMissingMandatoryClauses;
exports.generateComplianceReport = generateComplianceReport;
exports.batchValidateClauses = batchValidateClauses;
const retrieval_1 = require("./rag/retrieval");
const mandatoryTerms_1 = require("../data/mandatoryTerms");
const clauseNLIService_1 = require("./clauseNLIService");
async function findApplicableStatutes(clauseType, jurisdiction, documentType) {
    const mandatoryTerms = (0, mandatoryTerms_1.getMandatoryTermsByClauseType)(clauseType, jurisdiction);
    const searchQueries = [];
    for (const term of mandatoryTerms) {
        searchQueries.push((0, mandatoryTerms_1.buildSearchQuery)(term));
    }
    const clauseTypeMap = {
        termination: ['termination clause', 'Kündigungsfrist', 'výpovedná lehota'],
        share_capital: ['share capital', 'Stammkapital', 'základné imanie'],
        confidentiality: ['confidentiality', 'Vertraulichkeit', 'dôvernosť'],
        indemnification: ['indemnification', 'Haftungsfreistellung', 'odškodnenie'],
        payment: ['payment terms', 'Zahlungsbedingungen', 'platobné podmienky'],
        governing_law: ['governing law', 'anwendbares Recht', 'rozhodné právo'],
    };
    const typeTerms = clauseTypeMap[clauseType];
    if (typeTerms) {
        searchQueries.push(...typeTerms);
    }
    const uniqueQueries = [...new Set(searchQueries)].slice(0, 5);
    const allResults = [];
    await Promise.all(uniqueQueries.map(async (query) => {
        try {
            const results = await (0, retrieval_1.enhancedSearch)(query, {
                jurisdiction,
                sourceTypes: ['legislation'],
                limit: 3,
                rerank: true,
            });
            for (const r of results) {
                if (!allResults.find(a => a.reference === r.sourceName)) {
                    allResults.push({
                        id: r.id || `${r.sourceName}-${r.rank}`,
                        reference: r.sourceName || 'Unknown',
                        title: r.sourceName || 'Unknown',
                        jurisdiction,
                        relevanceScore: r.relevanceScore || r.score || 0,
                        excerpt: (r.content || '').substring(0, 800),
                        sourceUrl: r.sourceUrl,
                    });
                }
            }
        }
        catch (error) {
            console.warn(`[ClauseValidator] Search failed for "${query}":`, error);
        }
    }));
    return allResults
        .sort((a, b) => b.relevanceScore - a.relevanceScore)
        .slice(0, 10);
}
async function validateClauseAgainstStatutes(clause, jurisdiction, documentType) {
    const statutes = await findApplicableStatutes(clause.type, jurisdiction, documentType);
    const mandatoryTerms = (0, mandatoryTerms_1.getMandatoryTermsByClauseType)(clause.type, jurisdiction);
    const violations = [];
    let nliVerified = false;
    for (const term of mandatoryTerms) {
        for (const rule of term.validationRules) {
            const violation = checkValidationRule(clause.text, rule, term);
            if (violation) {
                violations.push({
                    statuteRef: term.statuteRef,
                    statuteTitle: term.description,
                    violationType: mapRuleTypeToViolationType(rule.type),
                    description: rule.errorMessage,
                    severity: term.requirement === 'mandatory' ? 'major' : 'minor',
                    excerpt: statutes.find(s => s.reference.includes(term.statuteRef))?.excerpt || '',
                });
            }
        }
    }
    if (statutes.length > 0 && clause.text.length > 50) {
        const topStatute = statutes[0];
        const nliResult = await (0, clauseNLIService_1.verifyEntailment)(topStatute.excerpt, `The clause complies with ${topStatute.reference}`);
        nliVerified = nliResult.supported && nliResult.confidence > 0.7;
    }
    let confidence = 'low';
    if (statutes.length > 0 && nliVerified) {
        confidence = 'high';
    }
    else if (statutes.length > 0) {
        confidence = 'medium';
    }
    return {
        clause,
        isCompliant: violations.length === 0,
        violations,
        applicableStatutes: statutes,
        confidence,
        nliVerified,
    };
}
async function findMissingMandatoryClauses(extractedClauses, documentType, jurisdiction) {
    const mandatoryTerms = (0, mandatoryTerms_1.getMandatoryTermsFor)(jurisdiction, documentType);
    const missing = [];
    const presentClauseTypes = new Set(extractedClauses.map(c => c.type));
    for (const term of mandatoryTerms) {
        const isPresent = presentClauseTypes.has(term.clauseType);
        if (!isPresent && term.requirement === 'mandatory') {
            let suggestedContent;
            if (term.defaultText) {
                suggestedContent = term.defaultText;
            }
            else {
                try {
                    const results = await (0, retrieval_1.enhancedSearch)((0, mandatoryTerms_1.buildSearchQuery)(term), {
                        jurisdiction,
                        sourceTypes: ['legislation'],
                        limit: 1,
                    });
                    if (results.length > 0) {
                        suggestedContent = results[0].content?.substring(0, 500);
                    }
                }
                catch (e) {
                }
            }
            missing.push({
                clauseType: term.clauseType,
                requirement: term.requirement,
                statuteRef: term.statuteRef,
                explanation: term.description,
                suggestedContent,
                jurisdiction: term.jurisdiction,
                termId: term.id,
            });
        }
    }
    return missing;
}
async function generateComplianceReport(extractedClauses, documentType, jurisdiction) {
    const clauseValidations = [];
    for (const clause of extractedClauses) {
        const validation = await validateClauseAgainstStatutes(clause, jurisdiction, documentType);
        clauseValidations.push(validation);
    }
    const missingClauses = await findMissingMandatoryClauses(extractedClauses, documentType, jurisdiction);
    const totalChecks = clauseValidations.length + missingClauses.length;
    const violations = clauseValidations.reduce((sum, v) => sum + v.violations.length, 0);
    const missingMandatory = missingClauses.filter(m => m.requirement === 'mandatory').length;
    let complianceScore = 100;
    if (totalChecks > 0) {
        complianceScore = Math.max(0, 100 - (violations * 10) - (missingMandatory * 15));
    }
    let overallCompliance = 'compliant';
    if (missingMandatory > 0 || violations > 3) {
        overallCompliance = 'non_compliant';
    }
    else if (violations > 0 || missingClauses.length > 0) {
        overallCompliance = clauseValidations.some(v => v.violations.some(vv => vv.severity === 'major'))
            ? 'major_issues'
            : 'minor_issues';
    }
    const summary = generateComplianceSummary(clauseValidations, missingClauses, jurisdiction);
    return {
        jurisdiction,
        documentType,
        clauseValidations,
        missingClauses,
        overallCompliance,
        complianceScore,
        summary,
    };
}
function checkValidationRule(clauseText, rule, term) {
    const textLower = clauseText.toLowerCase();
    switch (rule.type) {
        case 'required':
            return !textLower.includes(rule.field.replace(/_/g, ' '));
        case 'minimum':
            const numbers = clauseText.match(/[\d.,]+/g);
            if (numbers && typeof rule.value === 'number') {
                const minValue = rule.value;
                const values = numbers.map(n => parseFloat(n.replace(/[.,]/g, '')));
                return !values.some(v => v >= minValue);
            }
            return false;
        case 'maximum':
            const maxNumbers = clauseText.match(/[\d.,]+/g);
            if (maxNumbers && typeof rule.value === 'number') {
                const maxValue = rule.value;
                const values = maxNumbers.map(n => parseFloat(n.replace(/[.,]/g, '')));
                return values.some(v => v > maxValue);
            }
            return false;
        case 'prohibited':
            return textLower.includes(rule.field.replace(/_/g, ' '));
        case 'contains':
            return !textLower.includes(String(rule.value).toLowerCase());
        case 'pattern':
            const pattern = new RegExp(String(rule.value), 'i');
            return !pattern.test(clauseText);
        default:
            return false;
    }
}
function mapRuleTypeToViolationType(ruleType) {
    switch (ruleType) {
        case 'required':
            return 'missing_element';
        case 'minimum':
            return 'below_minimum';
        case 'maximum':
            return 'exceeds_limit';
        case 'prohibited':
            return 'prohibited_clause';
        default:
            return 'invalid_term';
    }
}
function generateComplianceSummary(validations, missing, jurisdiction) {
    const totalClauses = validations.length;
    const compliantClauses = validations.filter(v => v.isCompliant).length;
    const violationCount = validations.reduce((sum, v) => sum + v.violations.length, 0);
    const missingMandatory = missing.filter(m => m.requirement === 'mandatory').length;
    let summary = `Document analysis for ${jurisdiction} jurisdiction:\n`;
    summary += `- ${totalClauses} clauses analyzed, ${compliantClauses} compliant\n`;
    if (violationCount > 0) {
        summary += `- ${violationCount} potential compliance issues found\n`;
    }
    if (missingMandatory > 0) {
        summary += `- ${missingMandatory} mandatory clauses missing:\n`;
        for (const m of missing.filter(m => m.requirement === 'mandatory')) {
            summary += `  - ${m.clauseType} (${m.statuteRef})\n`;
        }
    }
    if (violationCount === 0 && missingMandatory === 0) {
        summary += '- No compliance issues detected';
    }
    return summary;
}
async function batchValidateClauses(clauses, jurisdiction, documentType, concurrency = 3) {
    const results = [];
    for (let i = 0; i < clauses.length; i += concurrency) {
        const batch = clauses.slice(i, i + concurrency);
        const batchResults = await Promise.all(batch.map(clause => validateClauseAgainstStatutes(clause, jurisdiction, documentType)));
        results.push(...batchResults);
    }
    return results;
}
//# sourceMappingURL=clauseStatuteValidator.js.map