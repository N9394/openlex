export type TaskType = 'chat_greeting' | 'simple_explanation' | 'format_text' | 'translate_simple' | 'summarize_short' | 'document_analysis' | 'clause_extraction' | 'risk_assessment' | 'legal_research' | 'contract_drafting' | 'rights_extraction' | 'deadline_extraction' | 'entity_extraction' | 'document_comparison' | 'research_synthesis' | 'chat_complex' | 'archivist_action' | 'legal_explanation';
export type ModelType = 'fast' | 'full' | 'thorough' | 'premium';
export type UserTier = 'free' | 'pro' | 'enterprise' | 'admin';
export declare const MODEL_NAMES: Record<ModelType, string>;
export declare const TIER_MODEL_LIMITS: Record<UserTier, ModelType>;
export interface ModelConfig {
    model: ModelType;
    temperature: number;
    maxTemperature: number;
    maxTokens: number;
    requiresValidation: boolean;
}
export interface TaskContext {
    inputLength?: number;
    requiresAccuracy?: boolean;
    requiresReasoning?: boolean;
    isLegalContent?: boolean;
    hasSourceDocument?: boolean;
    userTier?: UserTier;
    hasRAGContext?: boolean;
}
export declare function getModelConfig(taskType: TaskType, context?: TaskContext): ModelConfig;
export declare function routeChatMessage(message: string, context?: TaskContext): ModelConfig;
export declare function enforceTemperatureLimit(taskType: TaskType, requestedTemp?: number): number;
export declare function requiresValidation(taskType: TaskType): boolean;
export declare function getDefaultTemperature(taskType: TaskType): number;
export declare function getRecommendedMaxTokens(taskType: TaskType): number;
export declare function canUseFastModel(taskType: TaskType, context?: TaskContext): boolean;
export declare function logRoutingDecision(taskType: TaskType, config: ModelConfig, context?: TaskContext): void;
export declare function getModelName(modelType: ModelType): string;
export declare function getModelForTier(preferredModel: ModelType, userTier?: UserTier): ModelType;
export declare function getOllamaModel(taskType: TaskType, userTier?: UserTier, context?: TaskContext): string;
export declare function canAccessModel(modelType: ModelType, userTier: UserTier): boolean;
export declare function upgradeModelForCriticalTask(baseModel: ModelType, userTier: UserTier): ModelType;
export type UserModelPreference = 'auto' | 'standard' | 'enhanced' | 'premium';
export declare function getOllamaModelWithPreference(taskType: TaskType, userTier?: UserTier, userPreference?: UserModelPreference, context?: TaskContext): string;
export declare function getAvailableModelOptions(userTier: UserTier): Array<{
    value: UserModelPreference;
    label: string;
    description: string;
}>;
export interface RAGOptions {
    enabled?: boolean;
    sourceTypes?: string[];
    jurisdiction?: string;
    userId?: string;
    orgId?: string;
    limit?: number;
}
export declare const CONFIDENCE_THRESHOLDS: {
    HIGH: number;
    MEDIUM: number;
    LOW: number;
    MINIMUM: number;
};
export type ConfidenceLevel = 'high' | 'medium' | 'low' | 'insufficient';
export declare function calculateConfidence(ragSources: Array<{
    score: number;
}> | undefined): ConfidenceLevel;
export interface GroundingResult {
    isGrounded: boolean;
    confidence: ConfidenceLevel;
    citationCount: number;
    potentialHallucinations: string[];
    warnings: string[];
}
export declare function validateGrounding(response: string, ragSources: Array<{
    content: string;
    sourceType: string;
    score?: number;
}> | undefined): GroundingResult;
export interface ExecutionOptions {
    taskType: TaskType;
    userTier?: UserTier;
    userPreference?: UserModelPreference;
    context?: TaskContext;
    rag?: RAGOptions;
    systemPrompt?: string;
    temperature?: number;
}
export interface CurrencyMetadata {
    oldestSourceDate?: string;
    newestSourceDate?: string;
    oldestVerification?: string;
    newestVerification?: string;
    hasExpiredSources: boolean;
    freshnessWarning?: string;
}
export interface ExecutionResult {
    response: string;
    model: string;
    modelType: ModelType;
    ragUsed: boolean;
    ragSources?: Array<{
        content: string;
        sourceType: string;
        score: number;
        sourceDate?: string;
        lastVerified?: string;
        isExpired?: boolean;
    }>;
    confidence: ConfidenceLevel;
    grounding: GroundingResult;
    currency?: CurrencyMetadata;
    metrics: {
        totalMs: number;
        ragSearchMs?: number;
        llmMs: number;
        inputTokensEstimate: number;
        outputTokensEstimate: number;
    };
}
export declare function shouldUseRAG(taskType: TaskType, ragOptions?: RAGOptions): boolean;
export declare function getRAGSources(taskType: TaskType): string[];
export declare function executeWithRouter(prompt: string, options: ExecutionOptions): Promise<ExecutionResult>;
export declare function executeResearch(question: string, jurisdiction?: string, options?: Partial<ExecutionOptions>): Promise<ExecutionResult>;
export declare function executeDocumentAnalysis(documentText: string, options?: Partial<ExecutionOptions>): Promise<ExecutionResult>;
export declare function executeClauseDrafting(clauseType: string, context: string, jurisdiction?: string, options?: Partial<ExecutionOptions>): Promise<ExecutionResult>;
export declare function getRoutingStats(): {
    availableModels: Record<ModelType, string>;
    ragEnabledTasks: TaskType[];
    tierLimits: Record<UserTier, ModelType>;
};
declare const _default: {
    getModelConfig: typeof getModelConfig;
    routeChatMessage: typeof routeChatMessage;
    enforceTemperatureLimit: typeof enforceTemperatureLimit;
    requiresValidation: typeof requiresValidation;
    getDefaultTemperature: typeof getDefaultTemperature;
    getRecommendedMaxTokens: typeof getRecommendedMaxTokens;
    canUseFastModel: typeof canUseFastModel;
    logRoutingDecision: typeof logRoutingDecision;
    getModelName: typeof getModelName;
    getModelForTier: typeof getModelForTier;
    getOllamaModel: typeof getOllamaModel;
    getOllamaModelWithPreference: typeof getOllamaModelWithPreference;
    canAccessModel: typeof canAccessModel;
    upgradeModelForCriticalTask: typeof upgradeModelForCriticalTask;
    getAvailableModelOptions: typeof getAvailableModelOptions;
    shouldUseRAG: typeof shouldUseRAG;
    getRAGSources: typeof getRAGSources;
    executeWithRouter: typeof executeWithRouter;
    executeResearch: typeof executeResearch;
    executeDocumentAnalysis: typeof executeDocumentAnalysis;
    executeClauseDrafting: typeof executeClauseDrafting;
    getRoutingStats: typeof getRoutingStats;
    MODEL_NAMES: Record<ModelType, string>;
    TIER_MODEL_LIMITS: Record<UserTier, ModelType>;
};
export default _default;
//# sourceMappingURL=modelRouter.d.ts.map