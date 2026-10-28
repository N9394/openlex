"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractRightsAndObligations = extractRightsAndObligations;
const modelRouter_1 = require("./modelRouter");
async function extractRightsAndObligations(documentText, documentType, options = {}) {
    const { userTier = 'free', jurisdiction, userId } = options;
    const prompt = `Analyze this ${documentType} document and extract all rights and obligations for BOTH parties.

Document:
${documentText}

Extract information in this EXACT JSON format:
{
  "yourRights": [
    {
      "party": "you",
      "description": "Clear, actionable right (e.g., 'You can terminate with 30 days notice')",
      "importance": "high|medium|low",
      "reference": "Section/clause reference if available"
    }
  ],
  "yourObligations": [
    {
      "party": "you",
      "description": "Clear, actionable obligation (e.g., 'Must deliver project by March 15th')",
      "deadline": "Specific date or timeframe if mentioned",
      "importance": "high|medium|low",
      "consequence": "What happens if not fulfilled",
      "reference": "Section/clause reference if available"
    }
  ],
  "theirRights": [
    {
      "party": "them",
      "description": "Clear, actionable right",
      "importance": "high|medium|low",
      "reference": "Section/clause reference if available"
    }
  ],
  "theirObligations": [
    {
      "party": "them",
      "description": "Clear, actionable obligation",
      "deadline": "Specific date or timeframe if mentioned",
      "importance": "high|medium|low",
      "consequence": "What happens if not fulfilled",
      "reference": "Section/clause reference if available"
    }
  ]
}

Important guidelines:
- Use "you" for the party who will sign/use this document (first party)
- Use "them" for the other party
- Be extremely clear and specific
- Use simple, non-legal language
- Focus on actionable items
- Mark importance: "high" for critical items, "medium" for important, "low" for minor
- Include deadlines whenever time-sensitive
- Only include actual rights/obligations, not explanatory text
- Compare against standard templates from the provided sources
- ONLY cite rights/obligations that are actually in the document

Return ONLY the JSON object, nothing else.`;
    const systemPrompt = `You are The Archivist, a precise legal analysis assistant.

CRITICAL GROUNDING RULES:
- Extract rights and obligations ONLY from the provided document
- Use the retrieved sources as reference templates for standard rights/obligations
- If a standard right/obligation from sources is MISSING from the document, note it
- NEVER invent rights or obligations not present in the document
- Reference specific sections/clauses when available`;
    try {
        const result = await (0, modelRouter_1.executeWithRouter)(prompt, {
            taskType: 'rights_extraction',
            userTier,
            context: {
                inputLength: documentText.length,
                requiresAccuracy: true,
                isLegalContent: true,
                hasSourceDocument: true,
            },
            rag: {
                enabled: true,
                sourceTypes: ['legislation', 'jurisdiction_kb'],
                jurisdiction,
                userId,
                limit: 5,
            },
            systemPrompt,
            temperature: 0.1,
        });
        const parsed = parseRightsObligationsResponse(result.response);
        parsed.sources = result.ragSources;
        parsed.grounded = result.ragUsed && (result.ragSources?.length || 0) > 0;
        console.log('[RIGHTS_EXTRACTOR] Successfully extracted rights and obligations', `(RAG: ${result.ragUsed}, sources: ${result.ragSources?.length || 0})`);
        return parsed;
    }
    catch (error) {
        console.error('[RIGHTS_EXTRACTOR] Error with Ollama, using fallback:', error);
        return generateFallbackRightsObligations(documentType);
    }
}
function parseRightsObligationsResponse(response) {
    try {
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error('No JSON found in response');
        }
        const parsed = JSON.parse(jsonMatch[0]);
        if (!parsed.yourRights || !parsed.yourObligations || !parsed.theirRights || !parsed.theirObligations) {
            throw new Error('Invalid structure');
        }
        return parsed;
    }
    catch (error) {
        console.error('[RIGHTS_EXTRACTOR] Failed to parse response:', error);
        throw error;
    }
}
function generateFallbackRightsObligations(documentType) {
    const baseFallbacks = {
        'Service Agreement': {
            yourRights: [
                {
                    party: 'you',
                    description: 'You can review and approve deliverables before final payment',
                    importance: 'high',
                },
                {
                    party: 'you',
                    description: 'You can terminate for cause with written notice',
                    importance: 'medium',
                },
            ],
            yourObligations: [
                {
                    party: 'you',
                    description: 'Must provide clear project specifications and requirements',
                    importance: 'high',
                    consequence: 'Delays in delivery may occur',
                },
                {
                    party: 'you',
                    description: 'Must pay within agreed payment terms',
                    deadline: 'As specified in agreement',
                    importance: 'high',
                    consequence: 'Late payment fees may apply',
                },
            ],
            theirRights: [
                {
                    party: 'them',
                    description: 'They can request reasonable deadline extensions for valid reasons',
                    importance: 'medium',
                },
                {
                    party: 'them',
                    description: 'They retain intellectual property rights until full payment',
                    importance: 'high',
                },
            ],
            theirObligations: [
                {
                    party: 'them',
                    description: 'Must deliver services according to agreed specifications',
                    importance: 'high',
                    consequence: 'You may withhold payment or terminate',
                },
                {
                    party: 'them',
                    description: 'Must maintain confidentiality of your information',
                    importance: 'high',
                    consequence: 'Breach may result in damages',
                },
            ],
        },
        'default': {
            yourRights: [
                {
                    party: 'you',
                    description: 'Review document carefully for specific rights granted to you',
                    importance: 'high',
                },
            ],
            yourObligations: [
                {
                    party: 'you',
                    description: 'Review document carefully for specific obligations you must fulfill',
                    importance: 'high',
                },
            ],
            theirRights: [
                {
                    party: 'them',
                    description: 'Review document carefully for rights granted to the other party',
                    importance: 'high',
                },
            ],
            theirObligations: [
                {
                    party: 'them',
                    description: 'Review document carefully for obligations of the other party',
                    importance: 'high',
                },
            ],
        },
    };
    const base = baseFallbacks[documentType] || baseFallbacks['default'];
    return {
        ...base,
        sources: [],
        grounded: false,
    };
}
//# sourceMappingURL=rightsExtractor.js.map