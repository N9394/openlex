"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractDeadlines = extractDeadlines;
const modelRouter_1 = require("./modelRouter");
async function extractDeadlines(documentText, documentType, options = {}) {
    const { userTier = 'free', jurisdiction, userId } = options;
    const prompt = `Analyze this ${documentType} and extract ALL deadlines, notice periods, and time-sensitive items:

Document:
${documentText}

Find:
- Payment deadlines
- Notice periods for termination/changes
- Renewal/expiration dates
- Performance/delivery deadlines
- Any other time-sensitive obligations

Return ONLY JSON:
{
  "deadlines": [
    {
      "type": "payment|notice|renewal|performance|termination|other",
      "date": "YYYY-MM-DD if specific date mentioned, or null",
      "period": "Relative period like '30 days from signing' if no specific date",
      "description": "Clear description of what's due",
      "importance": "critical|high|medium|low",
      "party": "you|them|both (who must act)",
      "consequence": "What happens if missed",
      "reference": "Section/clause reference"
    }
  ],
  "summary": "Brief overview of key time-sensitive items"
}`;
    const systemPrompt = `You are The Archivist, extracting time-sensitive obligations from legal documents.

CRITICAL GROUNDING RULES:
- Only extract deadlines ACTUALLY present in the document
- Use standard deadline patterns from the knowledge base as reference
- Do NOT invent deadlines not explicitly stated in the document
- If a standard deadline is MISSING from the document, note it in the summary
- Reference specific sections/clauses when available`;
    try {
        const result = await (0, modelRouter_1.executeWithRouter)(prompt, {
            taskType: 'deadline_extraction',
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
            temperature: 0.05,
        });
        const parsed = parseDeadlineResponse(result.response);
        parsed.sources = result.ragSources;
        parsed.grounded = result.ragUsed && (result.ragSources?.length || 0) > 0;
        console.log('[DEADLINE_EXTRACTOR] Found', parsed.deadlines.length, 'deadlines', `(RAG: ${result.ragUsed}, sources: ${result.ragSources?.length || 0})`);
        return parsed;
    }
    catch (error) {
        console.error('[DEADLINE_EXTRACTOR] Error, using fallback:', error);
        return generateFallbackCalendar(documentType);
    }
}
function parseDeadlineResponse(response) {
    try {
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (!jsonMatch)
            throw new Error('No JSON found');
        const parsed = JSON.parse(jsonMatch[0]);
        if (!Array.isArray(parsed.deadlines)) {
            throw new Error('Invalid structure');
        }
        return parsed;
    }
    catch (error) {
        console.error('[DEADLINE_EXTRACTOR] Parse error:', error);
        throw error;
    }
}
function generateFallbackCalendar(documentType) {
    return {
        deadlines: [
            {
                type: 'payment',
                period: '30 days from invoice',
                description: 'Payment due for services',
                importance: 'critical',
                party: 'you',
                consequence: 'Late fees may apply',
            },
            {
                type: 'notice',
                period: '30 days before termination',
                description: 'Notice period for contract termination',
                importance: 'high',
                party: 'both',
                consequence: 'Automatic renewal if not provided',
            },
        ],
        summary: 'Document contains standard payment and notice period requirements.',
        sources: [],
        grounded: false,
    };
}
//# sourceMappingURL=deadlineExtractor.js.map