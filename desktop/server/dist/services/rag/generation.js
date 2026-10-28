"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateWithRAG = generateWithRAG;
exports.draftClauseWithRAG = draftClauseWithRAG;
exports.answerResearchQuestion = answerResearchQuestion;
exports.analyzeWithRAG = analyzeWithRAG;
exports.generateStructured = generateStructured;
const retrieval_1 = require("./retrieval");
const modelRouter_1 = require("../modelRouter");
const OLLAMA_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
async function generateWithRAG(query, systemPrompt, searchOptions = {}, userTier = 'free') {
    const searchStart = Date.now();
    const chunks = await (0, retrieval_1.search)(query, {
        ...searchOptions,
        limit: searchOptions.limit || 5,
    });
    const searchTimeMs = Date.now() - searchStart;
    const context = buildContext(chunks);
    const genStart = Date.now();
    const answer = await generate(query, systemPrompt, context, 'legal_research', userTier);
    const generationTimeMs = Date.now() - genStart;
    return {
        answer,
        sources: chunks,
        queryTimeMs: searchTimeMs,
        generationTimeMs,
    };
}
function buildContext(chunks) {
    if (chunks.length === 0) {
        return 'No relevant sources found in the knowledge base.';
    }
    const parts = chunks.map((chunk, idx) => {
        const header = chunk.jurisdiction
            ? `[${idx + 1}] ${chunk.sourceName} (${chunk.jurisdiction})`
            : `[${idx + 1}] ${chunk.sourceName}`;
        return `${header}\n${chunk.content}`;
    });
    return parts.join('\n\n---\n\n');
}
async function generate(query, systemPrompt, context, taskType = 'legal_research', userTier = 'free') {
    const model = (0, modelRouter_1.getOllamaModel)(taskType, userTier, {
        isLegalContent: true,
        requiresAccuracy: true,
        inputLength: context.length,
    });
    const modelConfig = (0, modelRouter_1.getModelConfig)(taskType, {
        isLegalContent: true,
        requiresAccuracy: true,
    });
    console.log(`[RAG] Using model ${model} for ${taskType} (tier: ${userTier})`);
    const fullSystemPrompt = `${systemPrompt}

INSTRUCTIONS FOR CITING SOURCES:
- Base your answer on the provided sources below
- CITE SOURCES BY THEIR FULL NAME, not by number. Example: "According to § 57 Obchodný zákonník..." or "As stated in 40 CFR § 63.5..."
- Use the exact source name from the headers (e.g., "Mietrechtsgesetz - § 12", "Commercial Code - § 105")
- If sources don't contain relevant information, say so
- Do not invent information not present in sources

SOURCES:
${context}`;
    try {
        const response = await fetch(`${OLLAMA_URL}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model,
                messages: [
                    { role: 'system', content: fullSystemPrompt },
                    { role: 'user', content: query },
                ],
                stream: false,
                options: {
                    temperature: modelConfig.temperature,
                    num_predict: modelConfig.maxTokens,
                },
            }),
        });
        if (!response.ok) {
            throw new Error(`Ollama error: ${response.statusText}`);
        }
        const data = (await response.json());
        return data.message?.content || '';
    }
    catch (error) {
        console.error('[RAG] Generation error:', error);
        return generateFallbackResponse(context, query);
    }
}
function generateFallbackResponse(context, _query) {
    if (context.includes('No relevant sources')) {
        return 'I could not find relevant information in the knowledge base to answer your question.';
    }
    return `Based on the available sources, here is relevant information:\n\n${context}\n\nNote: This is a direct excerpt from the knowledge base. For a more detailed analysis, please ensure the AI service is running.`;
}
async function draftClauseWithRAG(clauseType, documentType, jurisdiction, context, userAnswers = {}, userTier = 'free') {
    const systemPrompt = `You are a legal document drafting assistant.
Draft a ${clauseType} clause for a ${documentType}.
Jurisdiction: ${jurisdiction}

Use the provided template clauses as a foundation.
Customize based on the user's context.
Use [PLACEHOLDER] for any values that need to be filled in.

IMPORTANT: This is for educational purposes only. The user should review with a qualified attorney.`;
    const userQuery = `Context: ${context}
${Object.keys(userAnswers).length > 0 ? `Details: ${JSON.stringify(userAnswers)}` : ''}

Please draft the clause.`;
    const result = await generateWithRAG(userQuery, systemPrompt, {
        sourceTypes: ['legislation', 'jurisdiction_kb'],
        jurisdiction,
        clauseType,
        limit: 3,
    }, userTier);
    return {
        clause: result.answer,
        sources: result.sources,
    };
}
async function answerResearchQuestion(question, jurisdiction, options = {}) {
    const sourceTypes = ['jurisdiction_kb', 'legislation'];
    if (options.includeUserDocs && options.userId) {
        sourceTypes.push('user_doc');
    }
    const systemPrompt = `You are a legal research assistant.
Jurisdiction: ${jurisdiction}

IMPORTANT:
- Provide educational information, not legal advice
- CITE SOURCES BY THEIR FULL NAME (e.g., "§ 57 Obchodný zákonník", "Mietrechtsgesetz - § 12")
- Do NOT cite by number like [1], [2] - use the actual law name and section
- If you cannot find relevant information, say so
- Note jurisdictional limitations
- Always recommend consulting a qualified attorney for specific legal matters`;
    const result = await generateWithRAG(question, systemPrompt, {
        sourceTypes,
        jurisdiction,
        userId: options.userId,
        orgId: options.orgId,
        limit: 7,
    }, options.userTier || 'free');
    return {
        ...result,
        disclaimer: `This information is for educational purposes only and does not constitute legal advice. Laws vary by jurisdiction and change over time. Consult a qualified attorney for specific legal matters.`,
    };
}
async function analyzeWithRAG(documentContent, documentType, jurisdiction, userTier = 'free') {
    const relevantClauses = await (0, retrieval_1.searchClauses)(`${documentType} ${jurisdiction}`, {
        jurisdiction,
        documentType,
        limit: 5,
    });
    const systemPrompt = `You are a legal document analyst.
Analyze the provided document against standard clause templates.
Document type: ${documentType}
Jurisdiction: ${jurisdiction}

IMPORTANT: Respond with a JSON object in the following format:
{
  "keyClauses": [
    { "name": "clause name", "present": true/false, "notes": "optional notes" }
  ],
  "risks": [
    { "issue": "description", "severity": "low|medium|high", "explanation": "details" }
  ],
  "missingClauses": [
    { "clause": "clause name", "importance": "critical|recommended|optional" }
  ],
  "suggestions": [
    { "suggestion": "what to do", "priority": "high|medium|low" }
  ],
  "summary": "Overall assessment in 2-3 sentences"
}

Be specific and cite the relevant template clauses using [1], [2], etc.`;
    const result = await generateWithRAG(documentContent, systemPrompt, {
        sourceTypes: ['legislation', 'jurisdiction_kb'],
        jurisdiction,
        documentType,
        limit: 5,
    }, userTier);
    let structured;
    let suggestions = [];
    try {
        const jsonMatch = result.answer.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            structured = JSON.parse(jsonMatch[0]);
            suggestions = structured.suggestions?.map((s) => s.suggestion) || [];
        }
    }
    catch {
        console.warn('[RAG] Failed to parse structured output, using fallback');
        suggestions = result.answer
            .split('\n')
            .filter((line) => {
            const lower = line.toLowerCase();
            return (lower.includes('suggest') ||
                lower.includes('recommend') ||
                lower.includes('should') ||
                lower.includes('consider'));
        })
            .map((line) => line.replace(/^[\s\-\*\d.]+/, '').trim())
            .filter((line) => line.length > 10)
            .slice(0, 5);
    }
    return {
        analysis: result.answer,
        relevantClauses,
        suggestions,
        structured,
    };
}
async function generateStructured(query, schema, searchOptions = {}, userTier = 'free') {
    const systemPrompt = `You are a helpful legal assistant.
Respond ONLY with a valid JSON object matching this schema:
${schema}

Do not include any text before or after the JSON. The response must be valid JSON.`;
    const response = await generateWithRAG(query, systemPrompt, searchOptions, userTier);
    try {
        const jsonMatch = response.answer.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            return { result: parsed, raw: response.answer, sources: response.sources };
        }
    }
    catch (error) {
        console.error('[RAG] Failed to parse structured response:', error);
    }
    return { result: null, raw: response.answer, sources: response.sources };
}
//# sourceMappingURL=generation.js.map