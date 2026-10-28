"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CONFIDENCE_THRESHOLDS = exports.TIER_MODEL_LIMITS = exports.MODEL_NAMES = void 0;
exports.getModelConfig = getModelConfig;
exports.routeChatMessage = routeChatMessage;
exports.enforceTemperatureLimit = enforceTemperatureLimit;
exports.requiresValidation = requiresValidation;
exports.getDefaultTemperature = getDefaultTemperature;
exports.getRecommendedMaxTokens = getRecommendedMaxTokens;
exports.canUseFastModel = canUseFastModel;
exports.logRoutingDecision = logRoutingDecision;
exports.getModelName = getModelName;
exports.getModelForTier = getModelForTier;
exports.getOllamaModel = getOllamaModel;
exports.canAccessModel = canAccessModel;
exports.upgradeModelForCriticalTask = upgradeModelForCriticalTask;
exports.getOllamaModelWithPreference = getOllamaModelWithPreference;
exports.getAvailableModelOptions = getAvailableModelOptions;
exports.calculateConfidence = calculateConfidence;
exports.validateGrounding = validateGrounding;
exports.shouldUseRAG = shouldUseRAG;
exports.getRAGSources = getRAGSources;
exports.executeWithRouter = executeWithRouter;
exports.executeResearch = executeResearch;
exports.executeDocumentAnalysis = executeDocumentAnalysis;
exports.executeClauseDrafting = executeClauseDrafting;
exports.getRoutingStats = getRoutingStats;
const rag_1 = require("./rag");
const llmAdapter_1 = require("./llmAdapter");
exports.MODEL_NAMES = {
    fast: process.env.OLLAMA_MODEL_FAST || 'qwen3:8b',
    full: process.env.OLLAMA_MODEL || 'qwen3:8b',
    thorough: process.env.OLLAMA_MODEL_THOROUGH || 'gemma3:12b',
    premium: process.env.OLLAMA_MODEL_PREMIUM || 'gemma3:27b',
};
exports.TIER_MODEL_LIMITS = {
    free: 'full',
    pro: 'thorough',
    enterprise: 'premium',
    admin: 'premium',
};
const TASK_ROUTING = {
    chat_greeting: {
        model: 'fast',
        temperature: 0.3,
        maxTemperature: 0.5,
        maxTokens: 256,
        requiresValidation: false,
    },
    simple_explanation: {
        model: 'fast',
        temperature: 0.3,
        maxTemperature: 0.4,
        maxTokens: 512,
        requiresValidation: false,
    },
    format_text: {
        model: 'fast',
        temperature: 0.1,
        maxTemperature: 0.2,
        maxTokens: 1024,
        requiresValidation: false,
    },
    translate_simple: {
        model: 'fast',
        temperature: 0.2,
        maxTemperature: 0.3,
        maxTokens: 1024,
        requiresValidation: false,
    },
    summarize_short: {
        model: 'fast',
        temperature: 0.2,
        maxTemperature: 0.3,
        maxTokens: 512,
        requiresValidation: false,
    },
    document_analysis: {
        model: 'full',
        temperature: 0.1,
        maxTemperature: 0.2,
        maxTokens: 4096,
        requiresValidation: true,
    },
    clause_extraction: {
        model: 'full',
        temperature: 0.1,
        maxTemperature: 0.15,
        maxTokens: 4096,
        requiresValidation: true,
    },
    risk_assessment: {
        model: 'full',
        temperature: 0.1,
        maxTemperature: 0.2,
        maxTokens: 2048,
        requiresValidation: true,
    },
    legal_research: {
        model: 'full',
        temperature: 0.2,
        maxTemperature: 0.3,
        maxTokens: 4096,
        requiresValidation: true,
    },
    contract_drafting: {
        model: 'full',
        temperature: 0.2,
        maxTemperature: 0.25,
        maxTokens: 8192,
        requiresValidation: true,
    },
    rights_extraction: {
        model: 'full',
        temperature: 0.1,
        maxTemperature: 0.15,
        maxTokens: 2048,
        requiresValidation: true,
    },
    deadline_extraction: {
        model: 'full',
        temperature: 0.05,
        maxTemperature: 0.1,
        maxTokens: 1024,
        requiresValidation: true,
    },
    entity_extraction: {
        model: 'full',
        temperature: 0.1,
        maxTemperature: 0.15,
        maxTokens: 2048,
        requiresValidation: true,
    },
    document_comparison: {
        model: 'full',
        temperature: 0.1,
        maxTemperature: 0.2,
        maxTokens: 4096,
        requiresValidation: true,
    },
    research_synthesis: {
        model: 'full',
        temperature: 0.3,
        maxTemperature: 0.4,
        maxTokens: 4096,
        requiresValidation: true,
    },
    chat_complex: {
        model: 'full',
        temperature: 0.3,
        maxTemperature: 0.4,
        maxTokens: 2048,
        requiresValidation: false,
    },
    archivist_action: {
        model: 'full',
        temperature: 0.2,
        maxTemperature: 0.3,
        maxTokens: 2048,
        requiresValidation: true,
    },
    legal_explanation: {
        model: 'full',
        temperature: 0.3,
        maxTemperature: 0.4,
        maxTokens: 2048,
        requiresValidation: false,
    },
};
const SIMPLE_CHAT_PATTERNS = [
    /^(hi|hello|hey|good\s*(morning|afternoon|evening)|greetings)/i,
    /^(thanks|thank\s*you|thx)/i,
    /^(bye|goodbye|see\s*you)/i,
    /^(yes|no|ok|okay|sure|alright)/i,
    /^(what|who)\s*(are|is)\s*(you|this)/i,
];
const COMPLEX_LEGAL_PATTERNS = [
    /\b(analyze|analysis|review)\b.*\b(contract|agreement|document|clause)/i,
    /\b(legal|law|statute|regulation|compliance)\b/i,
    /\b(liability|indemnif|warrant|terminat|breach)/i,
    /\b(rights?|obligations?|duties|responsibilities)\b/i,
    /\b(risk|exposure|penalty|damages)\b/i,
    /\b(precedent|case\s*law|jurisdiction)/i,
    /\b(compare|contrast|difference|similar)/i,
    /\b(draft|write|create)\s*(a|an|the)?\s*(contract|agreement|document)/i,
];
function analyzeChatComplexity(message) {
    for (const pattern of SIMPLE_CHAT_PATTERNS) {
        if (pattern.test(message.trim())) {
            return 'simple';
        }
    }
    for (const pattern of COMPLEX_LEGAL_PATTERNS) {
        if (pattern.test(message)) {
            return 'complex';
        }
    }
    if (message.length > 200) {
        return 'complex';
    }
    return 'simple';
}
function hasArchivistAction(message) {
    const actionPatterns = [
        /\b(save|store|add)\s*(to|in)\s*(vault|case|folder)/i,
        /\b(create|draft|write)\s*(a|an|the)?\s*(document|contract|template)/i,
        /\b(search|find|look\s*for)\s*(in)?\s*(vault|documents?|cases?)/i,
        /\b(compare|analyze|review)\s*(these?|the|my)?\s*(documents?|contracts?)/i,
        /\b(extract|identify|find)\s*(the)?\s*(clauses?|risks?|dates?|deadlines?)/i,
        /\b(research|look\s*up)\s*(case\s*law|precedent|statute)/i,
    ];
    return actionPatterns.some(pattern => pattern.test(message));
}
function getModelConfig(taskType, context) {
    const baseConfig = TASK_ROUTING[taskType];
    if (!baseConfig) {
        return {
            model: 'full',
            temperature: 0.2,
            maxTemperature: 0.3,
            maxTokens: 2048,
            requiresValidation: true,
        };
    }
    let adjustedConfig = { ...baseConfig };
    if (context?.hasSourceDocument && context?.requiresAccuracy) {
        adjustedConfig.temperature = Math.min(adjustedConfig.temperature, 0.1);
    }
    const ragAcceleratedTasks = [
        // 'clause_extraction', // Disabled - RAG not useful for doc analysis
        // 'risk_assessment', // Disabled - RAG not useful for doc analysis
        'deadline_extraction',
        'entity_extraction',
        'rights_extraction',
    ];
    if (context?.hasRAGContext && ragAcceleratedTasks.includes(taskType)) {
        adjustedConfig.model = 'fast';
        console.log(`[MODEL_ROUTER] RAG-accelerated: using fast model for ${taskType}`);
    }
    else if (context?.isLegalContent && adjustedConfig.model === 'fast') {
        adjustedConfig.model = 'full';
    }
    if (context?.inputLength && context.inputLength > 10000) {
        adjustedConfig.maxTokens = Math.max(adjustedConfig.maxTokens, 4096);
    }
    return adjustedConfig;
}
function routeChatMessage(message, context) {
    const complexity = analyzeChatComplexity(message);
    const hasAction = hasArchivistAction(message);
    if (hasAction) {
        return getModelConfig('archivist_action', context);
    }
    if (complexity === 'simple') {
        return getModelConfig('chat_greeting', context);
    }
    return getModelConfig('chat_complex', context);
}
function enforceTemperatureLimit(taskType, requestedTemp) {
    const config = TASK_ROUTING[taskType] || {
        temperature: 0.2,
        maxTemperature: 0.3,
    };
    if (requestedTemp === undefined) {
        return config.temperature;
    }
    return Math.min(requestedTemp, config.maxTemperature);
}
function requiresValidation(taskType) {
    return TASK_ROUTING[taskType]?.requiresValidation ?? true;
}
function getDefaultTemperature(taskType) {
    return TASK_ROUTING[taskType]?.temperature ?? 0.2;
}
function getRecommendedMaxTokens(taskType) {
    return TASK_ROUTING[taskType]?.maxTokens ?? 2048;
}
function canUseFastModel(taskType, context) {
    const config = getModelConfig(taskType, context);
    return config.model === 'fast';
}
function logRoutingDecision(taskType, config, context) {
    console.log(`[MODEL_ROUTER] Task: ${taskType}, Model: ${config.model}, Temp: ${config.temperature}, Validation: ${config.requiresValidation}`);
    if (context) {
        console.log(`[MODEL_ROUTER] Context: inputLen=${context.inputLength}, accuracy=${context.requiresAccuracy}, legal=${context.isLegalContent}`);
    }
}
function getModelName(modelType) {
    return exports.MODEL_NAMES[modelType];
}
function getModelForTier(preferredModel, userTier = 'free') {
    const tierLimit = exports.TIER_MODEL_LIMITS[userTier];
    const modelHierarchy = ['fast', 'full', 'thorough', 'premium'];
    const preferredIndex = modelHierarchy.indexOf(preferredModel);
    const limitIndex = modelHierarchy.indexOf(tierLimit);
    if (preferredIndex <= limitIndex) {
        return preferredModel;
    }
    return tierLimit;
}
function getOllamaModel(taskType, userTier = 'free', context) {
    const config = getModelConfig(taskType, context);
    const allowedModel = getModelForTier(config.model, userTier);
    return exports.MODEL_NAMES[allowedModel];
}
function canAccessModel(modelType, userTier) {
    const modelHierarchy = ['fast', 'full', 'thorough', 'premium'];
    const tierLimit = exports.TIER_MODEL_LIMITS[userTier];
    const requestedIndex = modelHierarchy.indexOf(modelType);
    const limitIndex = modelHierarchy.indexOf(tierLimit);
    return requestedIndex <= limitIndex;
}
function upgradeModelForCriticalTask(baseModel, userTier) {
    if (userTier === 'enterprise' || userTier === 'admin') {
        return 'thorough';
    }
    if (userTier === 'pro') {
        return 'thorough';
    }
    return baseModel;
}
function preferenceToModelType(preference) {
    switch (preference) {
        case 'standard':
            return 'full';
        case 'enhanced':
            return 'thorough';
        case 'premium':
            return 'premium';
        case 'auto':
        default:
            return null;
    }
}
function getOllamaModelWithPreference(taskType, userTier = 'free', userPreference = 'auto', context) {
    if (userPreference !== 'auto') {
        const preferredModel = preferenceToModelType(userPreference);
        if (preferredModel) {
            const allowedModel = getModelForTier(preferredModel, userTier);
            return exports.MODEL_NAMES[allowedModel];
        }
    }
    return getOllamaModel(taskType, userTier, context);
}
function getAvailableModelOptions(userTier) {
    const options = [
        {
            value: 'auto',
            label: 'Auto',
            description: 'System chooses the best model for each task (max 12B)',
        },
        {
            value: 'standard',
            label: 'Standard',
            description: 'Faster responses, good for most tasks (4B)',
        },
    ];
    if (userTier === 'pro' || userTier === 'enterprise' || userTier === 'admin') {
        options.push({
            value: 'enhanced',
            label: 'Enhanced',
            description: 'Better quality responses, recommended for complex analysis (12B)',
        });
    }
    if (userTier === 'enterprise' || userTier === 'admin') {
        options.push({
            value: 'premium',
            label: 'Premium (Slow)',
            description: 'Maximum quality but very slow on CPU. Only for critical analysis (27B)',
        });
    }
    return options;
}
const RAG_ENABLED_TASKS = [
    'legal_research',
    'contract_drafting',
    // 'clause_extraction', // Disabled - RAG not useful for doc analysis
    // 'risk_assessment', // Disabled - RAG not useful for doc analysis
    'document_comparison',
    'research_synthesis',
    'legal_explanation',
];
const TASK_RAG_SOURCES = {
    legal_research: ['case_law', 'jurisdiction_kb', 'legislation'],
    contract_drafting: ['legislation', 'jurisdiction_kb', 'user_documents'],
    clause_extraction: ['legislation', 'jurisdiction_kb'],
    risk_assessment: ['legislation', 'jurisdiction_kb'],
    document_comparison: ['user_documents', 'legislation'],
    research_synthesis: ['case_law', 'jurisdiction_kb', 'legislation'],
    legal_explanation: ['jurisdiction_kb', 'legislation'],
};
exports.CONFIDENCE_THRESHOLDS = {
    HIGH: 0.8,
    MEDIUM: 0.6,
    LOW: 0.4,
    MINIMUM: 0.5,
};
const GROUNDING_RULES = `
CRITICAL GROUNDING RULES - YOU MUST FOLLOW THESE:
1. You may ONLY cite information that appears in the [Source N] references provided above
2. If information is not in the provided sources, explicitly state: "I don't have verified information on this specific point"
3. NEVER invent or hallucinate case names, statute numbers, section references, or legal citations
4. When citing, use format: "According to [Source N]: ..." or reference the source number
5. If sources are insufficient or contradictory, acknowledge this limitation
6. Prefer direct quotes over paraphrasing when accuracy is critical
7. Rate your confidence based on source quality: high (direct match), medium (related), low (tangential)
`;
const TASK_GROUNDING_NOTES = {
    legal_research: 'Only cite case law and statutes that appear in provided sources. If asked about cases not in sources, say "I don\'t have this case in my current knowledge base."',
    contract_drafting: 'Use clause patterns from sources as templates. Do not invent novel legal terms not grounded in the templates.',
    clause_extraction: 'Extract clauses ONLY from the provided document. Do not add inferred clauses.',
    risk_assessment: 'Base risk assessments on actual document content. Use benchmarks from sources but do not invent risks.',
    legal_explanation: 'Explain based on provided sources. If a concept is not in sources, acknowledge the limitation.',
};
function calculateConfidence(ragSources) {
    if (!ragSources || ragSources.length === 0) {
        return 'insufficient';
    }
    const bestScore = Math.max(...ragSources.map(s => s.score));
    const avgScore = ragSources.reduce((sum, s) => sum + s.score, 0) / ragSources.length;
    if (bestScore >= exports.CONFIDENCE_THRESHOLDS.HIGH && avgScore >= exports.CONFIDENCE_THRESHOLDS.MEDIUM) {
        return 'high';
    }
    if (bestScore >= exports.CONFIDENCE_THRESHOLDS.MEDIUM) {
        return 'medium';
    }
    if (bestScore >= exports.CONFIDENCE_THRESHOLDS.LOW) {
        return 'low';
    }
    return 'insufficient';
}
function buildGroundedSystemPrompt(basePrompt, taskType, ragSourceCount) {
    const taskNote = TASK_GROUNDING_NOTES[taskType] || '';
    return `${basePrompt}

${GROUNDING_RULES}
${taskNote ? `\nTask-specific note: ${taskNote}` : ''}

You have been provided with ${ragSourceCount} source(s) from the knowledge base. Base your response primarily on these sources.`;
}
function buildUncertaintyNotice(confidence) {
    switch (confidence) {
        case 'insufficient':
            return `[NOTICE: No verified sources found for this query. You MUST acknowledge this limitation in your response. State clearly that you cannot provide verified information and suggest the user consult authoritative sources or a legal professional.]`;
        case 'low':
            return `[NOTICE: Limited source coverage for this query. The provided sources may not fully address the question. Acknowledge any gaps in your response and indicate where additional research may be needed.]`;
        case 'medium':
            return `[NOTICE: Moderate source coverage. Base your response on the provided sources and indicate if any points require additional verification.]`;
        case 'high':
            return '';
        default:
            return '';
    }
}
function validateGrounding(response, ragSources) {
    const result = {
        isGrounded: true,
        confidence: calculateConfidence(ragSources?.map(s => ({ score: s.score ?? 0.5 })) || []),
        citationCount: 0,
        potentialHallucinations: [],
        warnings: [],
    };
    const citationPattern = /\[Source \d+\]|\[Source [A-Za-z]+\]|According to \[|Based on \[/gi;
    const citations = response.match(citationPattern) || [];
    result.citationCount = citations.length;
    const legalCitationPatterns = [
        /\b\d{1,4}\s+[A-Z][a-z]*\.?\s*(?:\d+[a-z]{0,2})?\s+\d+\b/g,
        /\b\d+\s+[A-Z]\.?[A-Z]\.?[A-Z]?\.?\s*§+\s*\d+/gi,
        /\b[A-Z][a-z]+\s+v\.?\s+[A-Z][a-z]+/g,
    ];
    const sourceContent = ragSources && ragSources.length > 0
        ? ragSources.map(s => s.content.toLowerCase()).join(' ')
        : '';
    for (const pattern of legalCitationPatterns) {
        const matches = response.match(pattern) || [];
        for (const match of matches) {
            if (!sourceContent || !sourceContent.includes(match.toLowerCase())) {
                result.potentialHallucinations.push(match);
            }
        }
    }
    if (result.potentialHallucinations.length > 0) {
        result.isGrounded = false;
        if (ragSources && ragSources.length > 0) {
            result.warnings.push(`Found ${result.potentialHallucinations.length} citation(s) not present in sources`);
        }
        else {
            result.warnings.push(`Found ${result.potentialHallucinations.length} citation(s) that cannot be verified (no RAG sources available)`);
        }
    }
    if (ragSources && ragSources.length > 0 && result.citationCount === 0) {
        result.warnings.push('Response contains no citations despite available sources');
    }
    if (!ragSources || ragSources.length === 0) {
        result.warnings.push('No knowledge base sources available - response may not be grounded');
        result.isGrounded = false;
    }
    if (response.includes("I don't have verified") || response.includes("not in my current knowledge")) {
        result.warnings.push('Response appropriately acknowledges knowledge limitations');
        result.isGrounded = true;
    }
    return result;
}
function calculateCurrencyMetadata(ragSources) {
    if (!ragSources || ragSources.length === 0) {
        return undefined;
    }
    const sourceDates = [];
    const verificationDates = [];
    let hasExpiredSources = false;
    for (const source of ragSources) {
        if (source.sourceDate) {
            sourceDates.push(new Date(source.sourceDate));
        }
        if (source.lastVerified) {
            verificationDates.push(new Date(source.lastVerified));
        }
        if (source.isExpired) {
            hasExpiredSources = true;
        }
    }
    sourceDates.sort((a, b) => a.getTime() - b.getTime());
    verificationDates.sort((a, b) => a.getTime() - b.getTime());
    const currency = {
        hasExpiredSources,
    };
    if (sourceDates.length > 0) {
        currency.oldestSourceDate = sourceDates[0].toISOString().split('T')[0];
        currency.newestSourceDate = sourceDates[sourceDates.length - 1].toISOString().split('T')[0];
    }
    if (verificationDates.length > 0) {
        currency.oldestVerification = verificationDates[0].toISOString().split('T')[0];
        currency.newestVerification = verificationDates[verificationDates.length - 1].toISOString().split('T')[0];
        const daysSinceOldest = Math.floor((Date.now() - verificationDates[0].getTime()) / (1000 * 60 * 60 * 24));
        if (hasExpiredSources) {
            currency.freshnessWarning = 'Some sources have expired. Content may be outdated.';
        }
        else if (daysSinceOldest > 180) {
            currency.freshnessWarning = `Oldest source was verified ${daysSinceOldest} days ago. Consider verifying currency.`;
        }
        else if (daysSinceOldest > 90) {
            currency.freshnessWarning = 'Some sources are over 90 days old. May require verification.';
        }
    }
    else {
        currency.freshnessWarning = 'Source verification dates unavailable.';
    }
    return currency;
}
function shouldUseRAG(taskType, ragOptions) {
    if (ragOptions?.enabled === false)
        return false;
    if (ragOptions?.enabled === true)
        return true;
    return RAG_ENABLED_TASKS.includes(taskType);
}
function getRAGSources(taskType) {
    return TASK_RAG_SOURCES[taskType] || ['legislation', 'jurisdiction_kb'];
}
async function executeWithRouter(prompt, options) {
    const startTime = Date.now();
    const { taskType, userTier = 'free', userPreference = 'auto', context, rag, systemPrompt, temperature, } = options;
    const config = getModelConfig(taskType, context);
    const modelName = getOllamaModelWithPreference(taskType, userTier, userPreference, context);
    const modelType = getModelForTier(config.model, userTier);
    const useRAG = shouldUseRAG(taskType, rag);
    let finalPrompt = prompt;
    let ragSources;
    let ragSearchMs;
    let confidence = 'insufficient';
    if (useRAG) {
        const ragStart = Date.now();
        try {
            const sourceTypes = rag?.sourceTypes || getRAGSources(taskType);
            const searchResults = await (0, rag_1.enhancedSearch)(prompt, {
                sourceTypes,
                jurisdiction: rag?.jurisdiction,
                userId: rag?.userId,
                limit: rag?.limit || 5,
                rerank: true,
                expandQuery: true,
            });
            if (searchResults && searchResults.length > 0) {
                const filteredResults = searchResults.filter(r => r.rank >= exports.CONFIDENCE_THRESHOLDS.MINIMUM);
                ragSources = filteredResults.map(r => ({
                    content: r.content,
                    sourceType: r.sourceName,
                    score: r.rank,
                    sourceDate: r.sourceDate?.toISOString(),
                    lastVerified: r.lastVerified?.toISOString(),
                    isExpired: r.isExpired,
                }));
                confidence = calculateConfidence(ragSources);
                if (ragSources.length > 0) {
                    const contextText = ragSources
                        .map((s, i) => `[Source ${i + 1} - ${s.sourceType}] (relevance: ${Math.round(s.score * 100)}%):\n${s.content}`)
                        .join('\n\n');
                    finalPrompt = `Relevant context from knowledge base:\n\n${contextText}\n\n---\n\nUser query: ${prompt}`;
                }
            }
        }
        catch (error) {
            console.error('[ModelRouter] RAG retrieval error:', error);
        }
        ragSearchMs = Date.now() - ragStart;
    }
    let finalSystemPrompt = systemPrompt || getDefaultSystemPrompt(taskType);
    if (useRAG) {
        const sourceCount = ragSources?.length || 0;
        if (sourceCount > 0) {
            finalSystemPrompt = buildGroundedSystemPrompt(finalSystemPrompt, taskType, sourceCount);
        }
        const uncertaintyNotice = buildUncertaintyNotice(confidence);
        if (uncertaintyNotice) {
            finalPrompt = `${uncertaintyNotice}\n\n${finalPrompt}`;
        }
    }
    const messages = [
        { role: 'system', content: finalSystemPrompt },
        { role: 'user', content: finalPrompt },
    ];
    const llmStart = Date.now();
    const response = await (0, llmAdapter_1.callLLM)(messages, {
        taskType,
        useFastModel: modelType === 'fast',
        temperature: temperature ?? enforceTemperatureLimit(taskType),
    });
    const llmMs = Date.now() - llmStart;
    const grounding = validateGrounding(response, ragSources);
    if (process.env.NODE_ENV !== 'production') {
        logRoutingDecision(taskType, config, context);
        if (useRAG) {
            console.log(`[ModelRouter] Grounding: confidence=${confidence}, ` +
                `citations=${grounding.citationCount}, ` +
                `grounded=${grounding.isGrounded}, ` +
                `warnings=${grounding.warnings.length}`);
            if (grounding.potentialHallucinations.length > 0) {
                console.warn(`[ModelRouter] Potential hallucinations detected:`, grounding.potentialHallucinations.slice(0, 3));
            }
        }
    }
    const currency = calculateCurrencyMetadata(ragSources);
    if (process.env.NODE_ENV !== 'production' && currency?.freshnessWarning) {
        console.warn(`[ModelRouter] Currency warning: ${currency.freshnessWarning}`);
    }
    return {
        response,
        model: modelName,
        modelType,
        ragUsed: useRAG && !!ragSources?.length,
        ragSources,
        confidence,
        grounding,
        currency,
        metrics: {
            totalMs: Date.now() - startTime,
            ragSearchMs,
            llmMs,
            inputTokensEstimate: Math.ceil(finalPrompt.length / 4),
            outputTokensEstimate: Math.ceil(response.length / 4),
        },
    };
}
function getDefaultSystemPrompt(taskType) {
    const prompts = {
        legal_research: `You are a legal research assistant. Provide well-researched answers with citations when available. Always note if information may vary by jurisdiction or require professional legal advice.`,
        contract_drafting: `You are a legal drafting specialist. Generate professional, legally sound clauses with standard protections and clear language. Include relevant boilerplate where appropriate.`,
        clause_extraction: `You are a legal document analyzer. Extract and identify key clauses, their implications, and any concerning elements. Be thorough and precise.`,
        risk_assessment: `You are a legal risk analyst. Identify potential risks, liabilities, and concerns in legal documents. Rate severity and provide actionable recommendations.`,
        document_comparison: `You are a legal document comparison expert. Identify differences between documents, highlight significant changes, and explain their implications.`,
        document_analysis: `You are a legal document analyzer. Provide comprehensive analysis including summary, key clauses, risks, important dates, and actionable insights.`,
        research_synthesis: `You are a legal research synthesizer. Compile and summarize research findings, identify patterns, and provide clear conclusions with proper citations.`,
        legal_explanation: `You are a legal educator. Explain legal concepts in clear, accessible language while maintaining accuracy. Use examples where helpful.`,
        chat_greeting: `You are a friendly legal assistant. Respond naturally to greetings and casual conversation.`,
        chat_complex: `You are a knowledgeable legal assistant. Provide helpful, accurate responses to legal questions while noting when professional advice is needed.`,
    };
    return prompts[taskType] || 'You are a helpful legal assistant.';
}
async function executeResearch(question, jurisdiction = 'US', options = {}) {
    return executeWithRouter(question, {
        taskType: 'legal_research',
        rag: {
            enabled: true,
            jurisdiction,
            sourceTypes: ['case_law', 'jurisdiction_kb', 'legislation'],
            limit: 8,
        },
        ...options,
    });
}
async function executeDocumentAnalysis(documentText, options = {}) {
    return executeWithRouter(documentText, {
        taskType: 'document_analysis',
        context: {
            inputLength: documentText.length,
            requiresAccuracy: true,
            isLegalContent: true,
            hasSourceDocument: true,
        },
        rag: {
            enabled: true,
            sourceTypes: ['legislation', 'jurisdiction_kb'],
            limit: 5,
        },
        ...options,
    });
}
async function executeClauseDrafting(clauseType, context, jurisdiction = 'US', options = {}) {
    const prompt = `Draft a ${clauseType} clause for the following context:\n\n${context}`;
    return executeWithRouter(prompt, {
        taskType: 'contract_drafting',
        rag: {
            enabled: true,
            jurisdiction,
            sourceTypes: ['legislation', 'jurisdiction_kb'],
            limit: 5,
        },
        ...options,
    });
}
function getRoutingStats() {
    return {
        availableModels: exports.MODEL_NAMES,
        ragEnabledTasks: RAG_ENABLED_TASKS,
        tierLimits: exports.TIER_MODEL_LIMITS,
    };
}
exports.default = {
    getModelConfig,
    routeChatMessage,
    enforceTemperatureLimit,
    requiresValidation,
    getDefaultTemperature,
    getRecommendedMaxTokens,
    canUseFastModel,
    logRoutingDecision,
    getModelName,
    getModelForTier,
    getOllamaModel,
    getOllamaModelWithPreference,
    canAccessModel,
    upgradeModelForCriticalTask,
    getAvailableModelOptions,
    shouldUseRAG,
    getRAGSources,
    executeWithRouter,
    executeResearch,
    executeDocumentAnalysis,
    executeClauseDrafting,
    getRoutingStats,
    MODEL_NAMES: exports.MODEL_NAMES,
    TIER_MODEL_LIMITS: exports.TIER_MODEL_LIMITS,
};
//# sourceMappingURL=modelRouter.js.map