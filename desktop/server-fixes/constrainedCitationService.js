"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateCitationTool = generateCitationTool;
exports.generateResponseTool = generateResponseTool;
exports.generateConstrainedResponse = generateConstrainedResponse;
exports.validateCitations = validateCitations;
exports.isToolCallingSupported = isToolCallingSupported;
function generateCitationTool(sources) {
    const sourceIds = sources.map(s => s.id);
    const sourceDescriptions = sources
        .map(s => `- ${s.id}: ${s.title}`)
        .join('\n');
    return {
        type: 'function',
        function: {
            name: 'cite_source',
            description: `Cite a legal source to support your claim. You MUST use this tool for EVERY legal citation.

Available sources:
${sourceDescriptions}

Rules:
1. ONLY cite source IDs from this list
2. Include a direct quote from the source when possible
3. The claim must be directly supported by the quoted text`,
            parameters: {
                type: 'object',
                properties: {
                    source_id: {
                        type: 'string',
                        enum: sourceIds,
                        description: 'The ID of the source to cite (must be from the available list)',
                    },
                    claim: {
                        type: 'string',
                        description: 'The specific legal claim being supported by this source',
                    },
                    quote: {
                        type: 'string',
                        description: 'Direct quote from the source that supports the claim (recommended)',
                    },
                },
                required: ['source_id', 'claim'],
            },
        },
    };
}
function generateResponseTool() {
    return {
        type: 'function',
        function: {
            name: 'provide_response',
            description: 'Provide your response with citations. Use cite_source first, then call this to submit your answer.',
            parameters: {
                type: 'object',
                properties: {
                    summary: {
                        type: 'string',
                        description: 'Brief summary of the answer (1-2 sentences)',
                    },
                    detailed_answer: {
                        type: 'string',
                        description: 'Detailed answer with inline citation markers like [1], [2]',
                    },
                    confidence: {
                        type: 'string',
                        enum: ['high', 'medium', 'low'],
                        description: 'Confidence level based on source quality',
                    },
                },
                required: ['summary', 'detailed_answer', 'confidence'],
            },
        },
    };
}
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://172.17.0.1:11437';
const OLLAMA_FALLBACK_URL = process.env.OLLAMA_FALLBACK_URL || 'http://ollama:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen3:8b';
async function callOllamaWithTools(messages, tools, options = {}) {
    const { timeout = 120000 } = options;
    const urls = [OLLAMA_BASE_URL, OLLAMA_FALLBACK_URL];
    let lastError = null;
    for (const baseUrl of urls) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeout);
            const response = await fetch(`${baseUrl}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: OLLAMA_MODEL,
                    messages,
                    tools,
                    stream: false, think: false,
                    options: {
                        temperature: 0,
                        num_predict: 2000,
                    },
                }),
                signal: controller.signal,
            });
            clearTimeout(timeoutId);
            if (!response.ok) {
                throw new Error(`Ollama error: ${response.status}`);
            }
            const data = await response.json();
            return {
                content: data.message.content || '',
                toolCalls: data.message.tool_calls || [],
            };
        }
        catch (error) {
            lastError = error;
            console.warn(`[ConstrainedCitation] Failed with ${baseUrl}:`, error);
        }
    }
    throw lastError || new Error('All Ollama endpoints failed');
}
async function generateConstrainedResponse(query, sources, options = {}) {
    const { systemPrompt, conversationHistory = [], auditContext } = options;
    if (sources.length === 0) {
        return {
            content: 'I could not find verified sources in our database for this query. Please try rephrasing or check official legal databases.',
            citations: [],
            usedSourceIds: [],
        };
    }
    const sourceContext = sources
        .map((s, i) => `[${i + 1}] ${s.title}\nID: ${s.id}\n${s.excerpt}`)
        .join('\n\n---\n\n');
    const citationTool = generateCitationTool(sources);
    const responseTool = generateResponseTool();
    const constrainedSystemPrompt = `${systemPrompt || 'You are a legal research assistant.'}

## CITATION RULES (MANDATORY)
You have access to the cite_source tool. You MUST use it for EVERY legal claim.

The cite_source tool only accepts these source IDs: ${sources.map(s => s.id).join(', ')}

Any other source ID will be REJECTED. Do not invent sources.

## VERIFIED SOURCES
${sourceContext}

## RESPONSE FORMAT
1. First, call cite_source for each claim you want to make
2. Then, call provide_response with your complete answer
3. In your answer, reference citations as [1], [2], etc. matching the order you cited them`;
    const messages = [
        { role: 'system', content: constrainedSystemPrompt },
        ...conversationHistory,
        { role: 'user', content: query },
    ];
    console.log(`[ConstrainedCitation] Generating with ${sources.length} constrained sources`);
    try {
        const result = await callOllamaWithTools(messages, [citationTool, responseTool]);
        const citations = [];
        let responseContent = result.content;
        for (const call of result.toolCalls) {
            if (call.function.name === 'cite_source') {
                const args = call.function.arguments;
                const validSource = sources.find(s => s.id === args.source_id);
                if (validSource) {
                    citations.push({
                        source_id: args.source_id,
                        claim: args.claim,
                        quote: args.quote,
                    });
                }
                else {
                    console.warn(`[ConstrainedCitation] Rejected invalid source ID: ${args.source_id}`);
                }
            }
            else if (call.function.name === 'provide_response') {
                const args = call.function.arguments;
                responseContent = args.detailed_answer || args.summary || responseContent;
            }
        }
        const usedSourceIds = [...new Set(citations.map(c => c.source_id))];
        let finalContent = responseContent;
        usedSourceIds.forEach((id, index) => {
            const source = sources.find(s => s.id === id);
            if (source) {
                const marker = `[${index + 1}]`;
                const replacement = `(${source.title})`;
                finalContent = finalContent.replace(new RegExp(`\\[${index + 1}\\]`, 'g'), replacement);
            }
        });
        console.log(`[ConstrainedCitation] Generated with ${citations.length} valid citations`);
        return {
            content: finalContent,
            citations,
            usedSourceIds,
        };
    }
    catch (error) {
        console.error('[ConstrainedCitation] Generation failed:', error);
        return {
            content: `Based on the available sources, I found relevant information but could not generate a complete response. Please review the sources directly.`,
            citations: [],
            usedSourceIds: [],
        };
    }
}
function validateCitations(response, sources) {
    const sourceIds = new Set(sources.map(s => s.id));
    const invalidCitations = [];
    for (const citation of response.citations) {
        if (!sourceIds.has(citation.source_id)) {
            invalidCitations.push(citation.source_id);
        }
    }
    return {
        valid: invalidCitations.length === 0,
        invalidCitations,
    };
}
async function isToolCallingSupported() {
    try {
        const model = OLLAMA_MODEL.toLowerCase();
        const supportsTools = model.includes('qwen') ||
            model.includes('llama3') ||
            model.includes('mistral') ||
            model.includes('gemma');
        return supportsTools;
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=constrainedCitationService.js.map