"use strict";
/**
 * M&A Due Diligence — LLM Prompt Templates & JSON Parsers
 *
 * Each function takes input data, calls LLM with a focused prompt,
 * and returns parsed structured output. All calls fit in 32K context.
 */

const { callLLMBackground } = require('../services/maScheduler');

// M&A analyzers do NOT have a RAG search tool — they're pure-LLM passes over
// uploaded deal documents. Without retrieval, any specific statute citation
// would be from training-data memory, unreliable for jurisdiction-specific
// law. Forbid named citations in every prompt + append disclaimer to outputs.
// Lawyers wanting verified citations should run the M&A finding through
// Research mode where the RAG pipeline grounds claims in indexed law.
const MA_NO_CITATION_RULE = '\n\nCRITICAL: Do NOT cite specific statute sections, case names, or article numbers from memory. ' +
    'If you reference a legal concept, name it generically ("the local data-protection law", "applicable competition rules") ' +
    'without inventing a section number. Citations require verification via Research mode, which is NOT available here. ' +
    'A response containing fabricated "§ 12 ABC Act" or "Case Foo v. Bar (2019)" is WORSE than no citation — it misleads the lawyer. ' +
    'Discuss the contractual / factual issue; flag the legal angle for verification, do not attempt to verify it yourself.';

const MA_DISCLAIMER = '⚠ LexVault M&A analysis — generated from deal documents only, NOT verified against any legal database. ' +
    'Use Research mode to verify any legal claims before relying on them.';

function withMaRules(systemContent) {
    return systemContent + MA_NO_CITATION_RULE;
}

module.exports.MA_DISCLAIMER = MA_DISCLAIMER;

// ============================================================================
// INDUSTRY RISK PROFILES
// ============================================================================

/**
 * Autocomplete suggestions for the industry field.
 * These are NOT the source of truth for risk areas — the LLM generates
 * a custom industry profile at the PLAN stage for any industry (including
 * ones not in this list). This list just helps users pick common industries.
 */
const INDUSTRY_SUGGESTIONS = [
    'Brewing / Beverages',
    'Paper / Pulp Manufacturing',
    'Technology / Software',
    'Pharmaceuticals / Life Sciences',
    'Real Estate / Property',
    'Energy / Utilities',
    'Financial Services / Banking',
    'General Manufacturing',
    'Retail / Consumer',
    'Healthcare / Medical',
    'Construction / Infrastructure',
    'Agriculture / Food Production',
    'Logistics / Transport',
    'Hospitality / Tourism',
    'Mining / Extractive',
    'Telecommunications',
    'Automotive',
    'Aerospace / Defense',
    'Chemicals / Petrochemicals',
    'Media / Entertainment',
    'Education / EdTech',
    'Insurance',
    'Shipping / Maritime',
    'Textiles / Apparel',
    'Waste Management / Recycling',
    'Water / Wastewater',
    'Semiconductor / Electronics',
    'Food Processing / FMCG',
    'Forestry / Timber',
    'Gambling / Gaming',
    'Sports / Fitness',
    'Cannabis / CBD',
    'Crypto / Blockchain',
    'Biotech / Gene Therapy',
    'Private Security',
    'Railway / Transit',
    'Advertising / Marketing',
    'Legal Services',
    'Accounting / Audit',
    'Venture Capital / PE',
];

/**
 * Generate an industry risk profile via LLM. Called once at the PLAN stage.
 * The LLM produces 8-12 industry-specific risk areas tailored to the
 * exact industry + jurisdictions involved. Result is stored on Deal.industryProfile
 * and injected into all subsequent analysis prompts.
 */
async function generateIndustryProfile(industry, jurisdictions, dealType, perspective) {
    const prompt = `You are an M&A due diligence expert. A ${perspective} is conducting a ${dealType.replace('_', ' ')} transaction involving a target company in the **${industry}** sector.

Jurisdictions involved: ${jurisdictions.join(', ') || 'not yet determined'}

Generate 8-12 industry-specific risk areas that an M&A analyst must evaluate for this particular industry. Focus on:
- Licenses, permits, and regulatory approvals specific to this industry (and their transferability)
- Physical assets, equipment, and infrastructure risks specific to this industry
- Environmental and safety risks specific to this industry's operations
- Supply chain and raw material dependencies
- Industry-specific compliance (certifications, standards, inspections)
- Customer/revenue risks unique to this industry
- Workforce and labor risks specific to this industry

Be specific — not generic. For example, for a brewery: "Liquor/alcohol production licenses (transferability on change of control)" not just "regulatory licenses".

Respond with ONLY a JSON object:
{
  "riskAreas": ["risk area 1", "risk area 2", ...],
  "keyAssets": ["critical physical/intangible assets to assess"],
  "regulatoryBodies": ["relevant regulators by jurisdiction"],
  "industryLabel": "clean display name for this industry"
}`;

    const messages = [
        { role: 'system', content: withMaRules('You are an M&A due diligence specialist with deep industry knowledge. Respond only with valid JSON.') },
        { role: 'user', content: prompt }
    ];

    return callLLMForJSON(messages, { temperature: 0, maxTokens: 1500 }, {
        riskAreas: [],
        keyAssets: [],
        regulatoryBodies: [],
        industryLabel: industry
    });
}

/**
 * Build industry context string for LLM prompts.
 * Uses the stored industryProfile (LLM-generated) if available.
 * Returns empty string if no industry set.
 */
function getIndustryContext(dealConfig) {
    if (!dealConfig.industry) return '';

    // Use LLM-generated profile if available (stored as JSON on deal)
    if (dealConfig.industryProfile) {
        let profile = dealConfig.industryProfile;
        if (typeof profile === 'string') {
            try { profile = JSON.parse(profile); } catch { profile = null; }
        }
        if (profile && profile.riskAreas && profile.riskAreas.length > 0) {
            const label = profile.industryLabel || dealConfig.industry;
            let ctx = `\nIndustry: ${label}\nIndustry-specific risk areas to evaluate:\n`;
            ctx += profile.riskAreas.map(r => `• ${r}`).join('\n');
            if (profile.keyAssets && profile.keyAssets.length > 0) {
                ctx += `\nKey assets to assess: ${profile.keyAssets.join(', ')}`;
            }
            if (profile.regulatoryBodies && profile.regulatoryBodies.length > 0) {
                ctx += `\nRelevant regulators: ${profile.regulatoryBodies.join(', ')}`;
            }
            ctx += '\nPay special attention to these industry-specific risks alongside standard legal/financial risks.\n';
            return ctx;
        }
    }

    // Fallback: just mention the industry name (LLM still knows what to look for)
    return `\nIndustry: ${dealConfig.industry}\nPay special attention to industry-specific operational, regulatory, environmental, and asset risks typical for this sector.\n`;
}

// ============================================================================
// STAGE 1: CLASSIFY
// ============================================================================

const DOC_TYPES = [
    'spa', 'disclosure_letter', 'financial_statement', 'corporate_docs',
    'regulatory', 'ip_schedule', 'employment', 'real_estate', 'tax',
    'insurance', 'litigation', 'environmental', 'other'
];

/**
 * Classify a document's type, jurisdiction, and language.
 * Input: first 3K chars of extracted text + filename
 * Output: { docType, jurisdiction, language, confidence }
 */
async function classifyDocument(filename, textSnippet) {
    const prompt = `Classify this legal document for M&A due diligence.

Filename: ${filename}

Document excerpt:
${textSnippet.slice(0, 3000)}

Respond with ONLY a JSON object (no markdown, no explanation):
{
  "docType": one of [${DOC_TYPES.map(t => `"${t}"`).join(', ')}],
  "jurisdiction": "ISO country code (e.g. US, DE, AT, SK, RO, GB)",
  "language": "ISO language code (e.g. en, de, sk, ro)",
  "confidence": 0.0 to 1.0,
  "summary": "one sentence describing document content"
}`;

    const messages = [
        { role: 'system', content: withMaRules('You are a legal document classifier for M&A due diligence. Respond only with valid JSON.') },
        { role: 'user', content: prompt }
    ];

    return callLLMForJSON(messages, { temperature: 0, maxTokens: 300 }, {
        docType: 'other',
        jurisdiction: 'unknown',
        language: 'en',
        confidence: 0.5,
        summary: ''
    });
}

// ============================================================================
// STAGE 2: PLAN
// ============================================================================

/**
 * Generate analysis plan from classified document summaries.
 * Input: array of { filename, docType, jurisdiction, summary }
 * Output: { jurisdictions, docTypeCounts, estimatedLLMCalls, estimatedMinutes, keyObservations }
 */
async function generatePlan(classifiedDocs, dealConfig) {
    const docSummary = classifiedDocs.map(d =>
        `- ${d.filename} [${d.docType}] (${d.jurisdiction}) — ${d.summary || 'no summary'}`
    ).join('\n');

    const industryCtx = getIndustryContext(dealConfig);
    const prompt = `You are preparing an M&A due diligence analysis plan.

Deal: ${dealConfig.name}
Perspective: ${dealConfig.perspective}
Deal type: ${dealConfig.dealType}${industryCtx}
Documents (${classifiedDocs.length} total):
${docSummary}

Generate a plan summary. Respond with ONLY a JSON object:
{
  "jurisdictions": ["list of jurisdictions involved"],
  "docTypeCounts": { "spa": N, "disclosure_letter": N, ... },
  "totalChunks": estimated number of 5K-char text chunks across all documents,
  "estimatedLLMCalls": estimated total LLM calls for full analysis,
  "estimatedMinutes": estimated wall-clock time at 16 concurrent background slots,
  "keyObservations": ["list of 3-5 notable observations about the data room"],
  "missingDocTypes": ["document types expected but not found"],
  "riskAreas": ["preliminary risk areas based on document types"]
}`;

    const messages = [
        { role: 'system', content: withMaRules('You are an M&A due diligence expert. Respond only with valid JSON.') },
        { role: 'user', content: prompt }
    ];

    return callLLMForJSON(messages, { temperature: 0, maxTokens: 800 }, {
        jurisdictions: [],
        docTypeCounts: {},
        totalChunks: classifiedDocs.length * 5,
        estimatedLLMCalls: classifiedDocs.length * 8,
        estimatedMinutes: classifiedDocs.length * 2,
        keyObservations: [],
        missingDocTypes: [],
        riskAreas: []
    });
}

// ============================================================================
// STAGE 3: ANALYZE
// ============================================================================

/**
 * Analyze a single document chunk for M&A-relevant content.
 * Input: chunk text (~5K chars), document context
 * Output: { clauses: [], risks: [], warranties: [], dates: [], disclosures: [] }
 */
async function analyzeChunk(chunkText, docContext) {
    const industryCtx = docContext.industry ? getIndustryContext({ industry: docContext.industry, industryProfile: docContext.industryProfile }) : '';
    const prompt = `Analyze this section of a ${docContext.docType || 'legal'} document for M&A due diligence.

Document: ${docContext.filename}
Type: ${docContext.docType || 'unknown'}
Jurisdiction: ${docContext.jurisdiction || 'unknown'}
Section: ${docContext.sectionIndex + 1} of ${docContext.totalSections}
${docContext.heading ? `Heading: ${docContext.heading}` : ''}${industryCtx}

Text:
${chunkText}

Extract ALL of the following. Pay attention to both standard legal risks AND industry-specific operational, regulatory, environmental, and asset-related risks. Respond with ONLY a JSON object:
{
  "clauses": [
    {
      "type": "indemnity|limitation|termination|assignment|confidentiality|non_compete|representation|warranty|condition_precedent|other",
      "summary": "one sentence",
      "location": "section/page reference if visible",
      "importance": "high|medium|low"
    }
  ],
  "risks": [
    {
      "title": "short title",
      "description": "what is the risk and why",
      "severity": "deal_breaker|price_affecting|standard|informational",
      "category": "financial|legal|regulatory|operational|environmental|tax|employment|ip|litigation|compliance",
      "location": "section/page reference if visible",
      "clauseText": "exact quote of the concerning clause (max 200 chars)"
    }
  ],
  "warranties": [
    {
      "name": "warranty name",
      "clauseText": "exact text of the warranty (max 300 chars)",
      "location": "section/page reference if visible"
    }
  ],
  "dates": [
    {
      "date": "YYYY-MM-DD or description",
      "type": "completion|longstop|condition|notification|other",
      "description": "what this date means"
    }
  ],
  "disclosures": [
    {
      "warrantyName": "which warranty this discloses against",
      "content": "disclosure content summary",
      "location": "section/page reference"
    }
  ]
}

If a category has no items, use an empty array. Be precise and conservative — only flag genuine risks.`;

    const messages = [
        { role: 'system', content: withMaRules('You are an M&A due diligence analyst. Extract structured data from legal documents. Respond only with valid JSON.') },
        { role: 'user', content: prompt }
    ];

    return callLLMForJSON(messages, { temperature: 0, maxTokens: 3000 }, {
        clauses: [],
        risks: [],
        warranties: [],
        dates: [],
        disclosures: []
    });
}

/**
 * Consolidate per-chunk results for a single document.
 * Called when a document has >10 chunks with results to dedup.
 * Input: array of chunk analysis results
 * Output: consolidated { clauses, risks, warranties, dates, disclosures }
 */
async function consolidateDocumentResults(chunkResults, docContext) {
    // Flatten all results
    const allClauses = chunkResults.flatMap(r => r.clauses || []);
    const allRisks = chunkResults.flatMap(r => r.risks || []);
    const allWarranties = chunkResults.flatMap(r => r.warranties || []);
    const allDates = chunkResults.flatMap(r => r.dates || []);
    const allDisclosures = chunkResults.flatMap(r => r.disclosures || []);

    // If small enough, no LLM needed — just merge
    if (allRisks.length <= 15 && allWarranties.length <= 15) {
        return { clauses: allClauses, risks: allRisks, warranties: allWarranties, dates: allDates, disclosures: allDisclosures };
    }

    const prompt = `Deduplicate and consolidate these M&A extraction results from ${docContext.filename}.
Multiple chunks from the same document may have extracted overlapping items.

Risks (${allRisks.length}):
${JSON.stringify(allRisks, null, 1).slice(0, 6000)}

Warranties (${allWarranties.length}):
${JSON.stringify(allWarranties, null, 1).slice(0, 4000)}

Merge duplicates, keep the most detailed version. Respond with ONLY a JSON object:
{
  "risks": [deduplicated risks array],
  "warranties": [deduplicated warranties array]
}`;

    const messages = [
        { role: 'system', content: withMaRules('Deduplicate M&A extraction results. Keep the most detailed version of each item. Respond only with valid JSON.') },
        { role: 'user', content: prompt }
    ];

    const merged = await callLLMForJSON(messages, { temperature: 0, maxTokens: 2000 }, { risks: allRisks, warranties: allWarranties });
    return {
        clauses: allClauses,
        risks: merged.risks,
        warranties: merged.warranties,
        dates: allDates,
        disclosures: allDisclosures
    };
}

// ============================================================================
// STAGE 4: RAG_VERIFY
// ============================================================================

/**
 * Verify a risk against statutory sources from RAG search.
 * Input: risk details + RAG search results
 * Output: { verified, statutoryBasis, adjustedSeverity, explanation }
 */
async function verifyRisk(risk, ragSources, dealConfig) {
    const sourcesText = ragSources.map((s, i) =>
        `[${i + 1}] ${s.sourceName} (${s.jurisdiction || 'unknown'})\n${s.content?.slice(0, 1500) || 'No content'}`
    ).join('\n\n');

    const industryCtx = dealConfig?.industry ? getIndustryContext(dealConfig) : '';
    const prompt = `You are verifying an M&A due diligence risk against statutory sources.${industryCtx}

Risk: ${risk.title}
Description: ${risk.description}
Severity: ${risk.severity}
Category: ${risk.category}
Jurisdiction: ${risk.jurisdiction || 'unknown'}
${risk.clauseText ? `Clause: ${risk.clauseText.slice(0, 300)}` : ''}

Statutory sources found:
${sourcesText.slice(0, 8000)}

Assess whether this risk has a valid statutory or regulatory basis. Respond with ONLY a JSON object:
{
  "verified": true/false,
  "statutoryBasis": "cite the specific statute/section if verified, or null",
  "adjustedSeverity": "${risk.severity}" or a different severity if the sources suggest re-classification,
  "explanation": "1-2 sentence explanation of why the risk is or isn't verified"
}`;

    const messages = [
        { role: 'system', content: withMaRules('You are a legal analyst verifying M&A risks against statutory sources. Be precise about citations. Respond only with valid JSON.') },
        { role: 'user', content: prompt }
    ];

    return callLLMForJSON(messages, { temperature: 0, maxTokens: 500 }, {
        verified: false,
        statutoryBasis: null,
        adjustedSeverity: risk.severity,
        explanation: 'Verification failed'
    });
}

// ============================================================================
// STAGE 5: SYNTHESIZE
// ============================================================================

/**
 * Synthesize risk tiers across the deal.
 * Input: all risks with verification data
 * Output: { summary, dealBreakers, priceAffecting, tierCounts, jurisdictionBreakdown }
 */
async function synthesizeRisks(risks, dealConfig) {
    const riskSummary = risks.map(r =>
        `- [${r.severity}] ${r.title} (${r.category}, ${r.jurisdiction || '?'})${r.verified ? ' [VERIFIED: ' + (r.statutoryBasis || '') + ']' : ''}`
    ).join('\n');

    const industryCtx = getIndustryContext(dealConfig);
    const prompt = `Synthesize these M&A due diligence risks for a ${dealConfig.perspective} in a ${dealConfig.dealType} deal.${industryCtx}

Risks (${risks.length} total):
${riskSummary.slice(0, 10000)}

Consider which risks are specific to this industry and which party bears them. Produce a risk synthesis. Respond with ONLY a JSON object:
{
  "summary": "2-3 paragraph executive risk summary",
  "dealBreakers": ["list of deal-breaker risk titles with brief explanation"],
  "priceAffecting": ["list of price-affecting risk titles with estimated impact"],
  "tierCounts": { "deal_breaker": N, "price_affecting": N, "standard": N, "informational": N },
  "jurisdictionBreakdown": { "AT": { "total": N, "highSeverity": N }, ... },
  "topCategories": ["top 3 risk categories by count"],
  "mitigationPriorities": ["top 5 risks that should be addressed first, with suggested approach"]
}`;

    const messages = [
        { role: 'system', content: withMaRules('You are an M&A risk analyst. Synthesize risks into actionable intelligence. Respond only with valid JSON.') },
        { role: 'user', content: prompt }
    ];

    return callLLMForJSON(messages, { temperature: 0, maxTokens: 2000 }, {
        summary: '',
        dealBreakers: [],
        priceAffecting: [],
        tierCounts: {},
        jurisdictionBreakdown: {},
        topCategories: [],
        mitigationPriorities: []
    });
}

/**
 * Score warranties on 4 dimensions.
 * Input: warranties + deal context
 * Output: array of { warrantyId, breadthScore, disclosureScore, exposureScore, wniScore }
 */
async function scoreWarranties(warranties, disclosures, dealConfig) {
    const warrantySummary = warranties.map((w, i) =>
        `[${i}] "${w.name}": ${w.clauseText?.slice(0, 200) || 'no text'}`
    ).join('\n');

    const discSummary = disclosures.map(d =>
        `- Against "${d.warrantyName}": ${d.content?.slice(0, 150) || 'no content'}`
    ).join('\n');

    const industryCtx = getIndustryContext(dealConfig);
    const prompt = `Score these M&A warranties for a ${dealConfig.perspective} in a ${dealConfig.dealType} deal.${industryCtx}

Warranties (${warranties.length}):
${warrantySummary.slice(0, 8000)}

Disclosures (${disclosures.length}):
${discSummary.slice(0, 4000)}

Score each warranty on 4 dimensions (0-100). Consider industry-specific exposure — some warranties carry more weight in certain industries:
- breadthScore: How broadly drafted (100 = very broad, risky for seller)
- disclosureScore: Quality of disclosure against it (100 = well-disclosed, low risk)
- exposureScore: Potential financial exposure (100 = high exposure)
- wniScore: W&I insurability (100 = easily insurable)

Respond with ONLY a JSON object:
{
  "scores": [
    { "index": 0, "breadthScore": N, "disclosureScore": N, "exposureScore": N, "wniScore": N },
    ...
  ]
}`;

    const messages = [
        { role: 'system', content: withMaRules('You are an M&A warranty analyst. Score warranties precisely. Respond only with valid JSON.') },
        { role: 'user', content: prompt }
    ];

    return callLLMForJSON(messages, { temperature: 0, maxTokens: 2000 }, { scores: [] });
}

/**
 * Analyze disclosure gaps.
 * Input: warranties + disclosures
 * Output: array of { warrantyName, status, assessment }
 */
async function analyzeDisclosureGaps(warranties, disclosures) {
    const warrantySummary = warranties.map(w =>
        `- "${w.name}": ${w.clauseText?.slice(0, 150) || 'no text'}`
    ).join('\n');

    const discSummary = disclosures.map(d =>
        `- Against "${d.warrantyName}": ${d.content?.slice(0, 150) || 'no content'} [current status: ${d.status}]`
    ).join('\n');

    const prompt = `Analyze disclosure gaps for M&A due diligence.

Warranties (${warranties.length}):
${warrantySummary.slice(0, 6000)}

Existing disclosures (${disclosures.length}):
${discSummary.slice(0, 6000)}

For each warranty, assess whether disclosures are adequate. Respond with ONLY a JSON object:
{
  "gaps": [
    {
      "warrantyName": "exact warranty name",
      "status": "adequate|partial|missing|general",
      "assessment": "1-2 sentence explanation"
    }
  ],
  "overallCoverage": "percentage of warranties with adequate disclosure",
  "criticalGaps": ["warranty names with missing or inadequate disclosure that pose highest risk"]
}`;

    const messages = [
        { role: 'system', content: withMaRules('You are an M&A disclosure analyst. Identify gaps precisely. Respond only with valid JSON.') },
        { role: 'user', content: prompt }
    ];

    return callLLMForJSON(messages, { temperature: 0, maxTokens: 2000 }, { gaps: [], overallCoverage: '0%', criticalGaps: [] });
}

/**
 * Assess W&I insurance readiness.
 */
async function assessWniReadiness(warranties, risks, dealConfig) {
    const warrantySummary = warranties.slice(0, 20).map(w =>
        `- "${w.name}" (breadth: ${w.breadthScore || '?'}, exposure: ${w.exposureScore || '?'}, wni: ${w.wniScore || '?'})`
    ).join('\n');

    const riskSummary = risks.filter(r => r.severity === 'deal_breaker' || r.severity === 'price_affecting')
        .slice(0, 10).map(r => `- [${r.severity}] ${r.title}`).join('\n');

    const industryCtx = getIndustryContext(dealConfig);
    const prompt = `Assess W&I (Warranty & Indemnity) insurance readiness for this ${dealConfig.dealType} deal.${industryCtx}

Key warranties (${warranties.length} total):
${warrantySummary}

High-severity risks:
${riskSummary || 'None identified'}

Respond with ONLY a JSON object:
{
  "readinessScore": 0-100,
  "readinessLevel": "strong|moderate|weak|not_recommended",
  "insurable": ["warranties likely to be covered"],
  "excluded": ["warranties likely to be excluded or sub-limited"],
  "concerns": ["specific concerns an insurer would raise"],
  "estimatedPremiumRange": "X-Y% of policy limit",
  "recommendations": ["steps to improve insurability"]
}`;

    const messages = [
        { role: 'system', content: withMaRules('You are a W&I insurance specialist. Assess insurability precisely. Respond only with valid JSON.') },
        { role: 'user', content: prompt }
    ];

    return callLLMForJSON(messages, { temperature: 0, maxTokens: 1500 }, {
        readinessScore: 0,
        readinessLevel: 'not_recommended',
        insurable: [],
        excluded: [],
        concerns: [],
        estimatedPremiumRange: 'N/A',
        recommendations: []
    });
}

// ============================================================================
// STAGE 6: PLAYBOOK (on-demand per warranty)
// ============================================================================

/**
 * Generate 3 negotiation counter-positions for a warranty.
 */
async function generatePlaybook(warranty, dealConfig, relatedRisks) {
    const riskContext = relatedRisks.map(r =>
        `- [${r.severity}] ${r.title}: ${r.description?.slice(0, 150) || ''}`
    ).join('\n');

    const industryCtx = getIndustryContext(dealConfig);
    const prompt = `Generate negotiation counter-positions for this M&A warranty.

Perspective: ${dealConfig.perspective}
Deal type: ${dealConfig.dealType}${industryCtx}

Warranty: "${warranty.name}"
Clause text: ${warranty.clauseText?.slice(0, 500) || 'not available'}
${warranty.location ? `Location: ${warranty.location}` : ''}
Breadth score: ${warranty.breadthScore || 'N/A'}/100
Exposure score: ${warranty.exposureScore || 'N/A'}/100

Related risks:
${riskContext || 'None directly related'}

Generate exactly 3 counter-positions from the ${dealConfig.perspective}'s perspective. Each position should be progressively more aggressive. Respond with ONLY a JSON object:
{
  "positions": [
    {
      "level": "conservative",
      "position": "proposed change to the warranty clause",
      "rationale": "why this change is reasonable",
      "statutoryRef": "relevant statute if applicable, or null",
      "redlineText": "suggested redlined version of the clause (max 300 chars)"
    },
    {
      "level": "moderate",
      "position": "...",
      "rationale": "...",
      "statutoryRef": "...",
      "redlineText": "..."
    },
    {
      "level": "aggressive",
      "position": "...",
      "rationale": "...",
      "statutoryRef": "...",
      "redlineText": "..."
    }
  ]
}`;

    const messages = [
        { role: 'system', content: `You are an M&A negotiation strategist advising the ${dealConfig.perspective}. Generate practical, legally sound counter-positions. Respond only with valid JSON.` },
        { role: 'user', content: prompt }
    ];

    return callLLMForJSON(messages, { temperature: 0.3, maxTokens: 2000 }, { positions: [] });
}

// ============================================================================
// STAGE 7: REPORT
// ============================================================================

/**
 * Generate executive summary and deal report.
 */
async function generateReport(dealConfig, riskSynthesis, warranties, disclosureAnalysis, wniAssessment) {
    const industryCtx = getIndustryContext(dealConfig);
    const prompt = `Generate an executive summary for this M&A due diligence report.

Deal: ${dealConfig.name}
Type: ${dealConfig.dealType}
Perspective: ${dealConfig.perspective}${industryCtx}

Risk Summary:
${riskSynthesis.summary || 'No risk synthesis available'}

Deal Breakers: ${(riskSynthesis.dealBreakers || []).join('; ') || 'None'}
Price-Affecting: ${(riskSynthesis.priceAffecting || []).join('; ') || 'None'}

Warranties: ${warranties.length} identified
Disclosure Coverage: ${disclosureAnalysis.overallCoverage || 'unknown'}
Critical Gaps: ${(disclosureAnalysis.criticalGaps || []).join('; ') || 'None'}

W&I Readiness: ${wniAssessment.readinessLevel || 'not assessed'} (${wniAssessment.readinessScore || 0}/100)
Concerns: ${(wniAssessment.concerns || []).join('; ') || 'None'}

Generate a comprehensive executive summary. Respond with ONLY a JSON object:
{
  "executiveSummary": "3-5 paragraph executive summary covering key findings, risk assessment, warranty analysis, and recommendations",
  "jurisdictionConflicts": ["any conflicts between jurisdictions found"],
  "keyRecommendations": ["top 5 actionable recommendations for the ${dealConfig.perspective}"],
  "dealReadiness": "ready|conditional|not_ready",
  "conditionsPrecedent": ["conditions that should be met before closing, if any"]
}`;

    const messages = [
        { role: 'system', content: withMaRules('You are a senior M&A counsel drafting an executive summary. Be thorough but concise. Respond only with valid JSON.') },
        { role: 'user', content: prompt }
    ];

    return callLLMForJSON(messages, { temperature: 0, maxTokens: 2500 }, {
        executiveSummary: '',
        jurisdictionConflicts: [],
        keyRecommendations: [],
        dealReadiness: 'not_ready',
        conditionsPrecedent: []
    });
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Parse JSON from LLM response, with fallback default.
 * Returns { parsed, isFallback } so callers can detect failures for retry.
 */
function parseJSON(text, fallback) {
    try {
        if (!text || typeof text !== 'string') return fallback;
        let cleaned = text.trim();

        // Strip thinking tags (OpenRouter/Venice can include these)
        cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
        // Strip incomplete thinking block at start
        cleaned = cleaned.replace(/^<think>[\s\S]*$/, '').trim();

        // Detect garbled output: exclamation spam, repeated chars, etc.
        const exclamationRatio = (cleaned.match(/!/g) || []).length / Math.max(cleaned.length, 1);
        if (exclamationRatio > 0.3) {
            console.warn('[MA Analyzers] Garbled output detected (exclamation spam), length:', cleaned.length);
            return fallback;
        }

        // Strip markdown code fences if present
        if (cleaned.startsWith('```')) {
            cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
        }

        // Find first { and last }
        const start = cleaned.indexOf('{');
        const end = cleaned.lastIndexOf('}');
        if (start === -1 || end === -1) {
            console.warn('[MA Analyzers] No JSON object found in response, length:', cleaned.length,
                'preview:', cleaned.slice(0, 200));
            return fallback;
        }

        let jsonStr = cleaned.slice(start, end + 1);

        try {
            return JSON.parse(jsonStr);
        } catch (firstErr) {
            // Try to repair truncated JSON: close open arrays and braces
            let repaired = jsonStr;
            // Remove trailing commas before } or ]
            repaired = repaired.replace(/,\s*([}\]])/g, '$1');
            // Remove trailing partial values (e.g. "text trunca)
            repaired = repaired.replace(/,\s*"[^"]*$/, '');
            repaired = repaired.replace(/,\s*\{[^}]*$/, '');
            // Count and close open brackets
            const opens = (repaired.match(/\[/g) || []).length;
            const closes = (repaired.match(/\]/g) || []).length;
            for (let i = 0; i < opens - closes; i++) repaired += ']';
            const openBraces = (repaired.match(/\{/g) || []).length;
            const closeBraces = (repaired.match(/\}/g) || []).length;
            for (let i = 0; i < openBraces - closeBraces; i++) repaired += '}';

            try {
                const result = JSON.parse(repaired);
                console.log('[MA Analyzers] Repaired truncated JSON successfully');
                return result;
            } catch (repairErr) {
                console.warn('[MA Analyzers] JSON parse failed (repair also failed):',
                    firstErr.message, '| length:', jsonStr.length,
                    '| preview:', jsonStr.slice(0, 200));
                return fallback;
            }
        }
    } catch (err) {
        console.warn('[MA Analyzers] JSON parse unexpected error:', err.message);
        return fallback;
    }
}

/**
 * Call LLM expecting JSON response, with retry on parse failure.
 * Uses response_format: json_object for constrained decoding on OpenRouter.
 */
async function callLLMForJSON(messages, options, fallback, maxRetries = 1) {
    const opts = { ...options, responseFormat: 'json' };
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const response = await callLLMBackground(messages, opts);
            const parsed = parseJSON(response, null);
            if (parsed !== null) return parsed;

            if (attempt < maxRetries) {
                console.warn(`[MA Analyzers] JSON parse returned fallback, retrying (attempt ${attempt + 1}/${maxRetries + 1})`);
            }
        } catch (err) {
            if (attempt < maxRetries) {
                console.warn(`[MA Analyzers] LLM call failed (${err.message}), retrying`);
            } else {
                console.error(`[MA Analyzers] LLM call failed after ${maxRetries + 1} attempts:`, err.message);
            }
        }
    }
    return fallback;
}

/**
 * Split text into ~5K char chunks with 300 char overlap at paragraph boundaries.
 */
function splitIntoMaChunks(text, chunkSize = 5000, overlap = 300) {
    if (!text || text.length <= chunkSize) {
        return [{ content: text || '', heading: null, pageNumber: null }];
    }

    const chunks = [];
    let start = 0;

    while (start < text.length) {
        let end = Math.min(start + chunkSize, text.length);

        // Try to break at paragraph boundary
        if (end < text.length) {
            const lastPara = text.lastIndexOf('\n\n', end);
            if (lastPara > start + chunkSize * 0.5) {
                end = lastPara + 2;
            } else {
                const lastNewline = text.lastIndexOf('\n', end);
                if (lastNewline > start + chunkSize * 0.5) {
                    end = lastNewline + 1;
                }
            }
        }

        const content = text.slice(start, end);

        // Detect heading (first line if it looks like one)
        let heading = null;
        const firstLine = content.split('\n')[0].trim();
        if (firstLine.length < 120 && (firstLine.match(/^[A-Z0-9§]/) || firstLine.match(/^(Article|Section|Part|Schedule|Annex|Exhibit)/i))) {
            heading = firstLine;
        }

        // Detect page number from [Page N] markers
        let pageNumber = null;
        const pageMatch = content.match(/\[Page\s+(\d+)\]/);
        if (pageMatch) {
            pageNumber = parseInt(pageMatch[1], 10);
        }

        chunks.push({ content, heading, pageNumber });

        start = end - overlap;
        if (start >= text.length - overlap) break;
    }

    return chunks;
}

exports.classifyDocument = classifyDocument;
exports.generatePlan = generatePlan;
exports.analyzeChunk = analyzeChunk;
exports.consolidateDocumentResults = consolidateDocumentResults;
exports.verifyRisk = verifyRisk;
exports.synthesizeRisks = synthesizeRisks;
exports.scoreWarranties = scoreWarranties;
exports.analyzeDisclosureGaps = analyzeDisclosureGaps;
exports.assessWniReadiness = assessWniReadiness;
exports.generatePlaybook = generatePlaybook;
exports.generateReport = generateReport;
exports.splitIntoMaChunks = splitIntoMaChunks;
exports.parseJSON = parseJSON;
exports.DOC_TYPES = DOC_TYPES;
exports.INDUSTRY_SUGGESTIONS = INDUSTRY_SUGGESTIONS;
exports.generateIndustryProfile = generateIndustryProfile;
