"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.draftDocument = draftDocument;
const modelRouter_1 = require("./modelRouter");
const clauseNLIService_1 = require("./clauseNLIService");
const clauseStatuteValidator_1 = require("./clauseStatuteValidator");
const clausePatternExtractor_1 = require("./clausePatternExtractor");
const mandatoryTerms_1 = require("../data/mandatoryTerms");
async function draftDocument(request, options = {}) {
    const { userTier = 'free', userId } = options;
    const provider = process.env.LLM_PROVIDER || 'mock';
    console.log(`[DRAFTER] Using provider: ${provider}`);
    console.log(`[DRAFTER] Document type: ${request.documentType}`);
    console.log(`[DRAFTER] Category: ${request.category}`);
    console.log(`[DRAFTER] User tier: ${userTier}`);
    try {
        switch (provider) {
            case 'ollama':
                return await draftWithRouter(request, { userTier, userId });
            case 'openai':
                return await draftWithOpenAI(request);
            case 'mock':
            default:
                return await draftWithMockData(request);
        }
    }
    catch (error) {
        console.error(`[DRAFTER] Drafting failed with ${provider}:`, error);
        console.log('[DRAFTER] Falling back to mock data');
        return await draftWithMockData(request);
    }
}
async function draftWithRouter(request, options) {
    const { userTier = 'free', userId } = options;
    const detectedJurisdiction = detectJurisdictionFromText(request.situation);
    const jurisdiction = detectedJurisdiction || request.jurisdiction || 'US';
    console.log(`[DRAFTER] Using model router with RAG (tier: ${userTier}, jurisdiction: ${jurisdiction})`);
    const prompt = createDraftingPrompt(request);
    const systemPrompt = `You are a professional legal document drafter using The Archivist persona.

CRITICAL GROUNDING RULES:
- Use clause templates from the provided knowledge base as reference
- Incorporate jurisdiction-specific requirements from retrieved sources
- Standard clauses should match patterns from the clause library
- Reference specific legal requirements when citing jurisdiction law
- If a standard clause template is available, follow its structure
- Only add custom clauses that are clearly needed for the user's situation

Generate a complete, professional legal document that follows best practices for ${jurisdiction} jurisdiction.`;
    try {
        const result = await (0, modelRouter_1.executeWithRouter)(prompt, {
            taskType: 'contract_drafting',
            userTier,
            context: {
                inputLength: request.situation.length,
                requiresAccuracy: true,
                isLegalContent: true,
                hasSourceDocument: false,
            },
            rag: {
                enabled: true,
                sourceTypes: ['legislation', 'jurisdiction_kb'],
                jurisdiction,
                userId,
                limit: 10,
            },
            systemPrompt,
            temperature: 0.2,
        });
        console.log(`[DRAFTER] Received response length: ${result.response.length} characters`, `(RAG: ${result.ragUsed}, sources: ${result.ragSources?.length || 0})`);
        const parsed = await parseDraftResponse(result.response, request);
        parsed.sources = result.ragSources;
        parsed.grounded = result.ragUsed && (result.ragSources?.length || 0) > 0;
        try {
            const nliResult = await verifyGeneratedDocument(parsed, jurisdiction, request.documentType);
            if (nliResult) {
                parsed.nliVerification = nliResult;
                console.log(`[DRAFTER] NLI verification: ${nliResult.verified ? 'PASSED' : 'NEEDS REVIEW'} ` +
                    `(${Math.round(nliResult.verificationRatio * 100)}% verified)`);
            }
        }
        catch (error) {
            console.warn('[DRAFTER] NLI verification failed:', error);
        }
        return parsed;
    }
    catch (error) {
        console.error('[DRAFTER] Model router failed, using fallback:', error);
        throw error;
    }
}
async function draftWithOpenAI(request) {
    throw new Error('OpenAI integration not yet implemented. Use LLM_PROVIDER=ollama or LLM_PROVIDER=mock');
}
function getJurisdictionContext(jurisdiction) {
    const j = jurisdiction || 'US';
    const jurisdictions = {
        'US': { name: 'United States', law: 'U.S. federal and state law', courts: 'U.S. federal and state courts', language: 'English' },
        'UK': { name: 'United Kingdom', law: 'English law', courts: 'courts of England and Wales', language: 'English' },
        'DE': { name: 'Germany', law: 'German law (BGB, HGB)', courts: 'German courts', language: 'German' },
        'FR': { name: 'France', law: 'French law (Code Civil)', courts: 'French courts', language: 'French' },
        'EU': { name: 'European Union', law: 'EU law and applicable member state law', courts: 'competent EU member state courts', language: 'English' },
        'CA': { name: 'Canada', law: 'Canadian law', courts: 'Canadian courts', language: 'English' },
        'AU': { name: 'Australia', law: 'Australian law', courts: 'Australian courts', language: 'English' },
        'CH': { name: 'Switzerland', law: 'Swiss law (Swiss Code of Obligations)', courts: 'Swiss courts', language: 'German/French/Italian' },
        'AT': { name: 'Austria', law: 'Austrian law (ABGB)', courts: 'Austrian courts', language: 'German' },
        'SK': { name: 'Slovakia', law: 'Slovak law (Obchodný zákonník, Občiansky zákonník)', courts: 'Slovak courts', language: 'Slovak' },
    };
    return jurisdictions[j] || jurisdictions['US'];
}
function detectJurisdictionFromText(text) {
    const result = (0, mandatoryTerms_1.detectJurisdiction)(text);
    if (result.detected && result.confidence >= 0.5) {
        return result.detected;
    }
    return null;
}
function createDraftingPrompt(request) {
    const clauseList = request.suggestedClauses?.join('\n- ') || '';
    const detectedJurisdiction = detectJurisdictionFromText(request.situation);
    const jurisdiction = detectedJurisdiction || request.jurisdiction || 'US';
    const jurisdictionInfo = getJurisdictionContext(jurisdiction);
    console.log(`[DRAFTER] Using jurisdiction: ${jurisdiction} (detected: ${detectedJurisdiction}, user default: ${request.jurisdiction})`);
    console.log(`[DRAFTER] Complexity level: ${request.complexity || 'standard'}`);
    const followUpContext = request.followUpAnswers && Object.keys(request.followUpAnswers).length > 0
        ? `\n\nAdditional Context from Follow-up Questions:\n${Object.entries(request.followUpAnswers)
            .filter(([_, value]) => value && value.trim())
            .map(([key, value]) => `- ${key}: ${value}`)
            .join('\n')}`
        : '';
    const complexityInstructions = {
        simple: `
COMPLEXITY LEVEL: SIMPLE
- Use plain, easy-to-understand language
- Focus on essential terms only
- Avoid legal jargon where possible
- Keep clauses concise and straightforward
- Suitable for low-risk, straightforward agreements`,
        standard: `
COMPLEXITY LEVEL: STANDARD (BALANCED)
- Balance legal precision with clarity
- Include all standard protective clauses
- Use professional but accessible language
- Suitable for most common business situations`,
        detailed: `
COMPLEXITY LEVEL: DETAILED (COMPREHENSIVE)
- Include comprehensive legal protections
- Use precise legal terminology
- Add detailed definitions and specifications
- Include enhanced liability, indemnification, and dispute resolution clauses
- Suitable for complex, high-value, or high-risk agreements`
    };
    const complexityGuide = complexityInstructions[request.complexity || 'standard'];
    return `You are a professional legal document drafter. Create a COMPLETE, READY-TO-USE legal document.

=== DOCUMENT DETAILS ===

Type: ${request.documentType}
Category: ${request.category}
Jurisdiction: ${jurisdictionInfo.name}
${complexityGuide}

User's Situation:
"""
${request.situation}
"""${followUpContext}

Required Clauses:
${clauseList ? `- ${clauseList}` : 'All standard clauses for this document type'}

=== JURISDICTION-SPECIFIC REQUIREMENTS ===

This document MUST be drafted for: ${jurisdictionInfo.name}
- Apply ${jurisdictionInfo.law} throughout
- Reference ${jurisdictionInfo.courts} for dispute resolution
- Use legal terminology and standards from ${jurisdictionInfo.name}
- Include "Governing Law" clause specifying ${jurisdictionInfo.law}
${jurisdictionInfo.language !== 'English' ? `- Primary language: ${jurisdictionInfo.language} (but generate in English with appropriate legal term translations)` : ''}

=== CRITICAL REQUIREMENTS ===

1. COMPLETENESS: Generate a FULL, ready-to-use document with ALL necessary sections
2. PROFESSIONALISM: Use proper legal language and formatting
3. CUSTOMIZATION: Incorporate details from the user's situation into relevant sections
4. PLACEHOLDERS: Use [SQUARE BRACKETS] for information that needs to be filled in (names, dates, amounts, addresses)
5. CLARITY: Make the document understandable while maintaining legal precision
6. STANDARD CLAUSES: Include all essential clauses for this document type

=== DOCUMENT STRUCTURE ===

Create a complete legal document with these sections (adjust based on document type):

1. **TITLE AND PARTIES**
   - Clear document title
   - Identification of all parties with [PLACEHOLDER] for names and addresses
   - Effective date

2. **RECITALS/BACKGROUND** (WHEREAS clauses)
   - Context and purpose of the agreement
   - Incorporate user's situation details here

3. **SCOPE OF WORK/SERVICES**
   - Detailed description of what will be provided
   - Use specific details from user's situation
   - Clear deliverables and timelines

4. **PAYMENT TERMS**
   - Fee structure with [AMOUNT] placeholders
   - Payment schedule
   - Late payment provisions

5. **TERM AND DURATION**
   - Start date and end date
   - Renewal provisions if applicable

6. **TERMINATION**
   - Termination for convenience (notice period)
   - Termination for cause (breach)
   - Effects of termination

7. **INTELLECTUAL PROPERTY RIGHTS**
   - Ownership of work product
   - License grants if applicable
   - Pre-existing IP protection

8. **CONFIDENTIALITY**
   - Definition of confidential information
   - Non-disclosure obligations
   - Duration of confidentiality

9. **REPRESENTATIONS AND WARRANTIES**
   - What each party promises/guarantees
   - Disclaimers

10. **LIMITATION OF LIABILITY**
    - Caps on damages
    - Excluded damages (consequential, indirect)
    - Indemnification

11. **DISPUTE RESOLUTION**
    - Negotiation and mediation requirements
    - Arbitration or litigation venue
    - Governing law

12. **GENERAL PROVISIONS**
    - Entire agreement clause
    - Amendment procedure (written changes only)
    - Severability
    - Force majeure
    - Assignment restrictions
    - Notices (how to communicate officially)
    - Counterparts

13. **SIGNATURES**
    - Signature blocks for all parties
    - Date lines

=== OUTPUT FORMAT ===

Respond with ONLY a valid JSON object in this exact structure:

{
  "title": "[Document Type] Agreement",
  "sections": [
    {
      "title": "PARTIES AND EFFECTIVE DATE",
      "content": "This [Document Type] Agreement (the \\"Agreement\\") is entered into as of [DATE] (the \\"Effective Date\\") by and between:\\n\\n[PARTY A NAME], located at [PARTY A ADDRESS] (\\"[Party A Role]\\")\\n\\nand\\n\\n[PARTY B NAME], located at [PARTY B ADDRESS] (\\"[Party B Role]\\")\\n\\nCollectively referred to as the \\"Parties\\" and individually as a \\"Party.\\"\\n\\nThe Parties agree as follows:"
    },
    {
      "title": "1. RECITALS",
      "content": "WHEREAS, [Party A Role] requires [specific services/products based on user situation];\\n\\nWHEREAS, [Party B Role] has the expertise and capability to provide such [services/products];\\n\\nWHEREAS, the Parties wish to enter into this Agreement to set forth the terms and conditions of their business relationship;\\n\\nNOW, THEREFORE, in consideration of the mutual covenants and agreements herein contained, the Parties agree as follows:"
    },
    {
      "title": "2. SCOPE OF WORK",
      "content": "[Detailed description based on user's situation - be specific and comprehensive]\\n\\nThe [Party B Role] shall provide the following:\\n\\na) [Deliverable 1 based on situation]\\nb) [Deliverable 2]\\nc) [Deliverable 3]\\n\\nAll work shall be performed in a professional and workmanlike manner in accordance with industry standards."
    }
    // Continue with all remaining sections...
  ]
}

=== QUALITY STANDARDS ===

✓ Each section should be 3-10 sentences (substantial content)
✓ Use proper legal terminology and clause structure
✓ Include specific provisions, not just vague statements
✓ Incorporate user's situation details where relevant
✓ Use [PLACEHOLDERS] for information to be filled in
✓ Maintain consistent formatting and style
✓ Create a document that could actually be used (with filled-in placeholders)

=== EXAMPLES OF GOOD CONTENT ===

GOOD Section:
"The Service Provider agrees to deliver completed designs by [DATE]. All deliverables shall include source files in industry-standard formats (PSD, AI, or equivalent). The Client shall have [X] business days to review and request revisions. The Service Provider shall provide up to [NUMBER] rounds of revisions at no additional cost. Any revisions beyond this scope shall be billed at $[HOURLY_RATE] per hour."

BAD Section:
"The service provider will do the work. The client will review it. Changes can be made if needed."

RESPOND WITH ONLY THE JSON OBJECT - NO OTHER TEXT.

Now draft the complete document:`;
}
async function parseDraftResponse(aiResponse, request) {
    try {
        const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            console.warn('[DRAFTER] No JSON found in response, using fallback');
            return await draftWithMockData(request);
        }
        const parsed = JSON.parse(jsonMatch[0]);
        if (!parsed.title || !Array.isArray(parsed.sections)) {
            console.warn('[DRAFTER] Invalid structure in response, using fallback');
            return await draftWithMockData(request);
        }
        const validSections = parsed.sections.filter((s) => s.title && s.content && typeof s.content === 'string');
        if (validSections.length < 5) {
            console.warn('[DRAFTER] Too few valid sections, using fallback');
            return await draftWithMockData(request);
        }
        return {
            title: parsed.title || request.documentType,
            sections: validSections,
        };
    }
    catch (error) {
        console.error('[DRAFTER] Failed to parse AI response:', error);
        console.log('[DRAFTER] AI Response preview:', aiResponse.substring(0, 500));
        return await draftWithMockData(request);
    }
}
async function draftWithMockData(request) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    const situationSnippet = request.situation.substring(0, 150);
    return {
        title: request.documentType || 'Service Agreement',
        sections: [
            {
                title: 'PARTIES AND EFFECTIVE DATE',
                content: `This ${request.documentType} (the "Agreement") is entered into as of [DATE] (the "Effective Date") by and between:\n\n[PARTY A NAME], located at [PARTY A ADDRESS] ("Client")\n\nand\n\n[PARTY B NAME], located at [PARTY B ADDRESS] ("Service Provider")\n\nCollectively referred to as the "Parties" and individually as a "Party."\n\nThe Parties agree as follows:`,
            },
            {
                title: '1. RECITALS',
                content: `WHEREAS, the Client requires services related to: ${situationSnippet};\n\nWHEREAS, the Service Provider has the expertise and capability to provide such services;\n\nWHEREAS, the Parties wish to enter into this Agreement to set forth the terms and conditions of their business relationship;\n\nNOW, THEREFORE, in consideration of the mutual covenants and agreements herein contained, and for other good and valuable consideration, the receipt and sufficiency of which are hereby acknowledged, the Parties agree as follows:`,
            },
            {
                title: '2. SCOPE OF WORK AND SERVICES',
                content: `The Service Provider agrees to provide the following services to the Client:\n\nA. Primary Services:\n${situationSnippet}...\n\nB. Deliverables:\nAll work product, deliverables, and services shall be provided in accordance with the specifications agreed upon by the Parties and shall meet professional industry standards.\n\nC. Performance Standards:\nThe Service Provider shall perform all services in a professional, timely, and workmanlike manner consistent with industry standards and best practices.`,
            },
            {
                title: '3. COMPENSATION AND PAYMENT TERMS',
                content: `A. Fees:\nThe Client agrees to pay the Service Provider a total fee of $[AMOUNT] for the services described in Section 2.\n\nB. Payment Schedule:\nPayment shall be made as follows:\n- [PERCENTAGE]% upon execution of this Agreement\n- [PERCENTAGE]% upon [MILESTONE]\n- [PERCENTAGE]% upon final delivery and acceptance\n\nC. Payment Method:\nAll payments shall be made via [PAYMENT METHOD] within [NUMBER] days of invoice date.\n\nD. Late Payments:\nLate payments shall accrue interest at the rate of [RATE]% per month or the maximum rate permitted by law, whichever is less.`,
            },
            {
                title: '4. TERM AND TERMINATION',
                content: `A. Term:\nThis Agreement shall commence on the Effective Date and continue until [END DATE] or until terminated as provided herein.\n\nB. Termination for Convenience:\nEither Party may terminate this Agreement upon [NUMBER] days' written notice to the other Party.\n\nC. Termination for Cause:\nEither Party may terminate this Agreement immediately upon written notice if the other Party:\n(i) materially breaches this Agreement and fails to cure such breach within [NUMBER] days of written notice;\n(ii) becomes insolvent or files for bankruptcy;\n(iii) ceases business operations.\n\nD. Effects of Termination:\nUpon termination, the Client shall pay for all services performed through the date of termination. All obligations that by their nature should survive termination shall survive, including confidentiality, indemnification, and limitation of liability provisions.`,
            },
            {
                title: '5. INTELLECTUAL PROPERTY RIGHTS',
                content: `A. Work Product Ownership:\nUpon full payment of all fees, the Client shall own all right, title, and interest in and to the work product created specifically for the Client under this Agreement (the "Work Product").\n\nB. Service Provider Retained Rights:\nThe Service Provider retains all rights to its pre-existing intellectual property, tools, templates, and methodologies used in providing the services.\n\nC. License Grant:\nThe Service Provider grants the Client a perpetual, non-exclusive, worldwide license to use any Service Provider intellectual property incorporated into the Work Product.\n\nD. Third-Party Rights:\nThe Service Provider warrants that the Work Product will not infringe upon any third-party intellectual property rights.`,
            },
            {
                title: '6. CONFIDENTIALITY',
                content: `A. Definition:\n"Confidential Information" means any non-public information disclosed by one Party to the other, including but not limited to business plans, technical data, customer lists, financial information, and trade secrets.\n\nB. Obligations:\nThe receiving Party agrees to:\n(i) maintain the confidentiality of all Confidential Information;\n(ii) not disclose Confidential Information to third parties without prior written consent;\n(iii) use Confidential Information solely for the purpose of performing under this Agreement.\n\nC. Exceptions:\nConfidential Information does not include information that: (i) is publicly available through no fault of the receiving Party; (ii) was rightfully possessed prior to disclosure; (iii) is independently developed; or (iv) is required to be disclosed by law.\n\nD. Duration:\nConfidentiality obligations shall survive termination of this Agreement for a period of [NUMBER] years.`,
            },
            {
                title: '7. REPRESENTATIONS AND WARRANTIES',
                content: `A. Service Provider Warranties:\nThe Service Provider represents and warrants that:\n(i) it has the right and authority to enter into this Agreement;\n(ii) the services will be performed in a professional manner consistent with industry standards;\n(iii) the Work Product will be original and will not infringe third-party rights;\n(iv) it will comply with all applicable laws and regulations.\n\nB. Client Warranties:\nThe Client represents and warrants that:\n(i) it has the right and authority to enter into this Agreement;\n(ii) any materials provided to Service Provider will not infringe third-party rights;\n(iii) it will provide timely information and approvals necessary for performance.\n\nC. DISCLAIMER:\nEXCEPT AS EXPRESSLY PROVIDED HEREIN, NEITHER PARTY MAKES ANY WARRANTIES, EXPRESS OR IMPLIED, INCLUDING WITHOUT LIMITATION THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE.`,
            },
            {
                title: '8. LIMITATION OF LIABILITY AND INDEMNIFICATION',
                content: `A. Liability Cap:\nEXCEPT FOR BREACHES OF CONFIDENTIALITY OR INTELLECTUAL PROPERTY PROVISIONS, NEITHER PARTY'S TOTAL LIABILITY ARISING OUT OF OR RELATED TO THIS AGREEMENT SHALL EXCEED THE TOTAL FEES PAID OR PAYABLE UNDER THIS AGREEMENT IN THE TWELVE (12) MONTHS PRECEDING THE CLAIM.\n\nB. Excluded Damages:\nIN NO EVENT SHALL EITHER PARTY BE LIABLE FOR ANY INDIRECT, INCIDENTAL, CONSEQUENTIAL, SPECIAL, OR EXEMPLARY DAMAGES, INCLUDING LOST PROFITS, LOSS OF DATA, OR BUSINESS INTERRUPTION, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.\n\nC. Indemnification:\nEach Party agrees to indemnify, defend, and hold harmless the other Party from any claims, damages, or expenses (including reasonable attorneys' fees) arising from: (i) breach of this Agreement; (ii) negligence or willful misconduct; or (iii) infringement of third-party intellectual property rights.`,
            },
            {
                title: '9. DISPUTE RESOLUTION',
                content: `A. Negotiation:\nThe Parties agree to attempt to resolve any disputes arising under this Agreement through good faith negotiations. Either Party may initiate negotiations by providing written notice to the other Party.\n\nB. Mediation:\nIf the dispute cannot be resolved through negotiation within [NUMBER] days, the Parties agree to submit the dispute to non-binding mediation before a mutually agreed-upon mediator.\n\nC. Arbitration:\nIf mediation is unsuccessful, any remaining disputes shall be resolved through binding arbitration in accordance with the rules of the American Arbitration Association. The arbitration shall be conducted in [LOCATION].\n\nD. Governing Law:\nThis Agreement shall be governed by and construed in accordance with the laws of [STATE/COUNTRY], without regard to conflicts of law principles.\n\nE. Venue:\nAny legal action not subject to arbitration shall be brought exclusively in the courts of [JURISDICTION].`,
            },
            {
                title: '10. GENERAL PROVISIONS',
                content: `A. Entire Agreement:\nThis Agreement constitutes the entire agreement between the Parties and supersedes all prior negotiations, representations, and agreements, whether written or oral.\n\nB. Amendments:\nThis Agreement may not be amended except by a written document signed by both Parties.\n\nC. Severability:\nIf any provision of this Agreement is held to be invalid or unenforceable, the remaining provisions shall continue in full force and effect.\n\nD. Force Majeure:\nNeither Party shall be liable for failure to perform due to causes beyond its reasonable control, including acts of God, war, terrorism, strikes, epidemics, or government restrictions.\n\nE. Assignment:\nNeither Party may assign this Agreement without the prior written consent of the other Party, except that either Party may assign to a successor in connection with a merger or sale of substantially all assets.\n\nF. Notices:\nAll notices under this Agreement shall be in writing and delivered to the addresses set forth above or as otherwise specified in writing.\n\nG. Waiver:\nThe failure of either Party to enforce any provision shall not constitute a waiver of that or any other provision.\n\nH. Counterparts:\nThis Agreement may be executed in counterparts, each of which shall be deemed an original and all of which together shall constitute one instrument.\n\nI. Relationship:\nThe Parties are independent contractors. Nothing in this Agreement creates a partnership, joint venture, agency, or employment relationship.`,
            },
            {
                title: 'SIGNATURE PAGE',
                content: `IN WITNESS WHEREOF, the Parties have executed this Agreement as of the Effective Date.\n\n\n[PARTY A NAME]\n\nBy: _________________________________\nName: [PRINTED NAME]\nTitle: [TITLE]\nDate: _____________\n\n\n[PARTY B NAME]\n\nBy: _________________________________\nName: [PRINTED NAME]\nTitle: [TITLE]\nDate: _____________\n\n\n---\n\nDISCLAIMER: This document is provided for informational purposes only and does not constitute legal advice. Please consult with a qualified attorney before using this agreement.`,
            },
        ],
        sources: [],
        grounded: false,
    };
}
async function verifyGeneratedDocument(document, jurisdiction, documentType) {
    const nliReady = await (0, clauseNLIService_1.isNLIAvailable)();
    if (!nliReady) {
        console.log('[DRAFTER] NLI service not available, skipping verification');
        return null;
    }
    const fullText = document.sections.map(s => s.content).join('\n\n');
    const extractedClauses = (0, clausePatternExtractor_1.extractClauses)(fullText);
    if (extractedClauses.length === 0) {
        console.log('[DRAFTER] No clauses extracted for verification');
        return { verified: true, verificationRatio: 1, summary: 'No verifiable clauses detected.' };
    }
    const clausesForVerification = await Promise.all(extractedClauses.slice(0, 5).map(async (clause) => {
        const statutes = await (0, clauseStatuteValidator_1.findApplicableStatutes)(clause.type, jurisdiction, documentType);
        return {
            clauseId: clause.type,
            clauseText: clause.text,
            clauseType: clause.type,
            statuteExcerpts: statutes.slice(0, 2).map(s => ({
                statuteRef: s.reference,
                excerpt: s.excerpt,
            })),
        };
    }));
    const verifiableClauses = clausesForVerification.filter(c => c.statuteExcerpts.length > 0);
    if (verifiableClauses.length === 0) {
        return { verified: true, verificationRatio: 1, summary: 'No statutory requirements found for verification.' };
    }
    const report = await (0, clauseNLIService_1.batchVerifyClauses)(verifiableClauses, { concurrency: 2 });
    return {
        verified: report.verificationRatio >= 0.5 && report.contradictedClauses === 0,
        verificationRatio: report.verificationRatio,
        summary: report.summary,
    };
}
//# sourceMappingURL=documentDrafter.js.map