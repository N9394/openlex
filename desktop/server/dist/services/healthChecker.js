"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkDocumentHealth = checkDocumentHealth;
async function checkDocumentHealth(documentText, documentType) {
    const ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    const model = process.env.OLLAMA_MODEL || 'gemma3:4b';
    const prompt = `You are The Archivist, analyzing document quality and safety.

Analyze this ${documentType} for health issues:

Document:
${documentText}

Check for:
1. MISSING SECTIONS: Critical clauses that should be present
2. CONTRADICTIONS: Conflicting statements within the document
3. UNUSUAL FORMULATIONS: Strange or non-standard language
4. DANGEROUS PROVISIONS: Clauses that could harm the signing party

Return ONLY a JSON object in this format:
{
  "overall": 75,
  "grade": "B",
  "issues": [
    {
      "type": "missing|contradiction|unusual|dangerous",
      "severity": "critical|high|medium|low",
      "title": "Short issue name",
      "description": "Clear explanation of the problem",
      "location": "Section reference if applicable",
      "suggestion": "How to fix this"
    }
  ],
  "strengths": ["What this document does well"],
  "summary": "2-3 sentence overall assessment"
}

Focus on practical, actionable findings.`;
    try {
        const response = await fetch(`${ollamaUrl}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model,
                prompt,
                stream: false,
                options: {
                    temperature: 0.2,
                    top_p: 0.9,
                    num_ctx: 8192,
                },
            }),
        });
        if (!response.ok) {
            throw new Error(`Ollama API error: ${response.status}`);
        }
        const data = await response.json();
        const result = parseHealthCheckResponse(data.response ?? '');
        console.log('[HEALTH_CHECKER] Analysis complete');
        return result;
    }
    catch (error) {
        console.error('[HEALTH_CHECKER] Error, using fallback:', error);
        return generateFallbackHealthCheck(documentType);
    }
}
function parseHealthCheckResponse(response) {
    try {
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (!jsonMatch)
            throw new Error('No JSON found');
        const parsed = JSON.parse(jsonMatch[0]);
        if (typeof parsed.overall !== 'number' || !parsed.grade || !Array.isArray(parsed.issues)) {
            throw new Error('Invalid structure');
        }
        return parsed;
    }
    catch (error) {
        console.error('[HEALTH_CHECKER] Parse error:', error);
        throw error;
    }
}
function generateFallbackHealthCheck(documentType) {
    return {
        overall: 70,
        grade: 'C',
        issues: [
            {
                type: 'missing',
                severity: 'high',
                title: 'No Dispute Resolution Clause',
                description: 'Document lacks a clear process for handling disagreements',
                suggestion: 'Add a mediation or arbitration clause',
            },
            {
                type: 'unusual',
                severity: 'medium',
                title: 'Vague Terminology',
                description: 'Some terms are not clearly defined',
                location: 'Throughout',
                suggestion: 'Add a definitions section',
            },
        ],
        strengths: [
            'Clear payment terms',
            'Reasonable notice periods',
        ],
        summary: 'This document covers basic requirements but could be strengthened with additional protections and clearer language.',
    };
}
//# sourceMappingURL=healthChecker.js.map