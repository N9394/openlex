"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.warmupModels = warmupModels;
exports.checkModelHealth = checkModelHealth;
const llmAdapter_1 = require("./llmAdapter");
async function warmupModel(useFastModel, taskType) {
    const modelName = useFastModel ? 'fast' : 'full';
    const startTime = Date.now();
    try {
        await (0, llmAdapter_1.callLLM)([
            { role: 'system', content: 'You are a helpful assistant.' },
            { role: 'user', content: 'Respond with just "OK" to confirm you are ready.' }
        ], {
            taskType,
            useFastModel,
            maxTokens: 10
        });
        const latency = Date.now() - startTime;
        console.log(`[WARMUP] ${modelName} model warmed up in ${latency}ms`);
        return {
            model: modelName,
            success: true,
            latency
        };
    }
    catch (error) {
        const latency = Date.now() - startTime;
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[WARMUP] ${modelName} model warmup failed:`, errorMessage);
        return {
            model: modelName,
            success: false,
            latency,
            error: errorMessage
        };
    }
}
async function warmupModels() {
    const provider = process.env.LLM_PROVIDER || 'mock';
    if (provider === 'mock') {
        console.log('[WARMUP] Skipping warmup for mock provider');
        return {
            startedAt: new Date(),
            completedAt: new Date(),
            totalDuration: 0,
            results: [],
            allSuccess: true
        };
    }
    console.log('[WARMUP] Starting model warmup...');
    const startedAt = new Date();
    const results = [];
    const fastResult = await warmupModel(true, 'chat_greeting');
    results.push(fastResult);
    const fullResult = await warmupModel(false, 'document_analysis');
    results.push(fullResult);
    const completedAt = new Date();
    const totalDuration = completedAt.getTime() - startedAt.getTime();
    const report = {
        startedAt,
        completedAt,
        totalDuration,
        results,
        allSuccess: results.every(r => r.success)
    };
    if (report.allSuccess) {
        console.log(`[WARMUP] All models ready in ${totalDuration}ms`);
    }
    else {
        console.warn(`[WARMUP] Some models failed to warm up`);
    }
    return report;
}
async function checkModelHealth() {
    const provider = process.env.LLM_PROVIDER || 'mock';
    if (provider === 'mock') {
        return { healthy: true, details: { provider: 'mock', status: 'ready' } };
    }
    try {
        const ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
        const response = await fetch(`${ollamaUrl}/api/tags`, {
            signal: AbortSignal.timeout(5000)
        });
        if (response.ok) {
            const data = await response.json();
            const models = data.models || [];
            const fastModel = process.env.OLLAMA_MODEL_FAST || 'qwen3:8b';
            const fullModel = process.env.OLLAMA_MODEL || 'qwen3:8b';
            const fastAvailable = models.some((m) => m.name?.includes(fastModel.split(':')[0]));
            const fullAvailable = models.some((m) => m.name?.includes(fullModel.split(':')[0]));
            return {
                healthy: fastAvailable && fullAvailable,
                details: {
                    provider: 'ollama',
                    fastModel: fastAvailable ? 'available' : 'missing',
                    fullModel: fullAvailable ? 'available' : 'missing',
                    modelsLoaded: models.map((m) => m.name)
                }
            };
        }
        return {
            healthy: false,
            details: { provider: 'ollama', status: 'unreachable', statusCode: response.status }
        };
    }
    catch (error) {
        return {
            healthy: false,
            details: {
                provider: 'ollama',
                status: 'error',
                error: error instanceof Error ? error.message : 'Unknown error'
            }
        };
    }
}
exports.default = {
    warmupModels,
    checkModelHealth,
};
//# sourceMappingURL=modelWarmup.js.map