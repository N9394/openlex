"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.THRESHOLDS = void 0;
exports.runPerformanceBenchmarks = runPerformanceBenchmarks;
exports.runQuickHealthCheck = runQuickHealthCheck;
exports.getPerformanceMetrics = getPerformanceMetrics;
const retrieval_1 = require("../../services/rag/retrieval");
const modelRouter_1 = require("../../services/modelRouter");
exports.THRESHOLDS = {
    ragSearchP95: 500,
    ragSearchP99: 1000,
    hybridSearchP95: 800,
    hybridSearchP99: 1500,
    fullExecutionP95: 5000,
    fullExecutionP99: 10000,
};
async function runBenchmark(name, fn, iterations = 10) {
    const times = [];
    let errors = 0;
    for (let i = 0; i < iterations; i++) {
        const start = Date.now();
        try {
            await fn();
            times.push(Date.now() - start);
        }
        catch (error) {
            errors++;
            times.push(Date.now() - start);
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    times.sort((a, b) => a - b);
    const sum = times.reduce((a, b) => a + b, 0);
    const avgMs = sum / times.length;
    const p50Index = Math.floor(times.length * 0.5);
    const p95Index = Math.floor(times.length * 0.95);
    const p99Index = Math.floor(times.length * 0.99);
    return {
        name,
        iterations,
        avgMs: Math.round(avgMs),
        minMs: times[0],
        maxMs: times[times.length - 1],
        p50Ms: times[p50Index],
        p95Ms: times[Math.min(p95Index, times.length - 1)],
        p99Ms: times[Math.min(p99Index, times.length - 1)],
        errors,
        throughput: Math.round((iterations / (sum / 1000)) * 100) / 100,
    };
}
async function benchmarkKeywordSearch() {
    const queries = [
        'contract breach damages',
        'limitation period claims',
        'GDPR consent requirements',
        'employment termination notice',
        'intellectual property rights',
    ];
    let queryIndex = 0;
    return runBenchmark('Keyword Search', async () => {
        await (0, retrieval_1.search)(queries[queryIndex % queries.length], { limit: 5 });
        queryIndex++;
    }, 20);
}
async function benchmarkHybridSearch() {
    const queries = [
        'what are the requirements for valid consent under gdpr',
        'how long is the limitation period for contract claims',
        'employee rights during termination',
        'data breach notification requirements',
    ];
    let queryIndex = 0;
    return runBenchmark('Hybrid Search', async () => {
        await (0, retrieval_1.hybridSearch)(queries[queryIndex % queries.length], { limit: 5 });
        queryIndex++;
    }, 10);
}
async function benchmarkSmartSearch() {
    const queries = [
        'force majeure clause requirements',
        'gdpr data subject rights',
        'breach of fiduciary duty',
        'non-compete clause enforceability',
    ];
    let queryIndex = 0;
    return runBenchmark('Smart Search', async () => {
        await (0, retrieval_1.smartSearch)(queries[queryIndex % queries.length], { limit: 5 });
        queryIndex++;
    }, 10);
}
async function benchmarkFullExecution() {
    const queries = [
        'What is the limitation period for contract claims in England?',
        'Explain the requirements for valid consent under GDPR.',
    ];
    let queryIndex = 0;
    return runBenchmark('Full Execution (RAG + LLM)', async () => {
        await (0, modelRouter_1.executeWithRouter)(queries[queryIndex % queries.length], {
            taskType: 'legal_research',
            userTier: 'free',
            rag: {
                enabled: true,
                sourceTypes: ['jurisdiction_kb'],
                limit: 3,
            },
        });
        queryIndex++;
    }, 5);
}
async function runPerformanceBenchmarks() {
    console.log('[Performance] Starting benchmarks...');
    const benchmarks = [];
    const warnings = [];
    const recommendations = [];
    try {
        benchmarks.push(await benchmarkKeywordSearch());
        console.log(`[Performance] Keyword Search: ${benchmarks[benchmarks.length - 1].avgMs}ms avg`);
    }
    catch (error) {
        warnings.push(`Keyword search benchmark failed: ${error}`);
    }
    try {
        benchmarks.push(await benchmarkHybridSearch());
        console.log(`[Performance] Hybrid Search: ${benchmarks[benchmarks.length - 1].avgMs}ms avg`);
    }
    catch (error) {
        warnings.push(`Hybrid search benchmark failed: ${error}`);
    }
    try {
        benchmarks.push(await benchmarkSmartSearch());
        console.log(`[Performance] Smart Search: ${benchmarks[benchmarks.length - 1].avgMs}ms avg`);
    }
    catch (error) {
        warnings.push(`Smart search benchmark failed: ${error}`);
    }
    try {
        benchmarks.push(await benchmarkFullExecution());
        console.log(`[Performance] Full Execution: ${benchmarks[benchmarks.length - 1].avgMs}ms avg`);
    }
    catch (error) {
        warnings.push(`Full execution benchmark failed: ${error}`);
    }
    let overallHealthy = true;
    for (const benchmark of benchmarks) {
        if (benchmark.name.includes('Keyword') || benchmark.name.includes('Smart')) {
            if (benchmark.p95Ms > exports.THRESHOLDS.ragSearchP95) {
                warnings.push(`${benchmark.name} P95 (${benchmark.p95Ms}ms) exceeds threshold (${exports.THRESHOLDS.ragSearchP95}ms)`);
                overallHealthy = false;
            }
        }
        if (benchmark.name.includes('Hybrid')) {
            if (benchmark.p95Ms > exports.THRESHOLDS.hybridSearchP95) {
                warnings.push(`${benchmark.name} P95 (${benchmark.p95Ms}ms) exceeds threshold (${exports.THRESHOLDS.hybridSearchP95}ms)`);
                overallHealthy = false;
            }
        }
        if (benchmark.name.includes('Full Execution')) {
            if (benchmark.p95Ms > exports.THRESHOLDS.fullExecutionP95) {
                warnings.push(`${benchmark.name} P95 (${benchmark.p95Ms}ms) exceeds threshold (${exports.THRESHOLDS.fullExecutionP95}ms)`);
                overallHealthy = false;
            }
        }
        if (benchmark.errors > 0) {
            warnings.push(`${benchmark.name} had ${benchmark.errors} errors`);
            overallHealthy = false;
        }
    }
    const keywordBench = benchmarks.find(b => b.name.includes('Keyword'));
    const hybridBench = benchmarks.find(b => b.name.includes('Hybrid'));
    if (keywordBench && keywordBench.avgMs > 200) {
        recommendations.push('Consider optimizing FTS5 indexes for faster keyword search');
    }
    if (hybridBench && hybridBench.avgMs > 500) {
        recommendations.push('Consider caching embeddings for frequently searched terms');
    }
    if (hybridBench && keywordBench && hybridBench.avgMs > keywordBench.avgMs * 3) {
        recommendations.push('Embedding generation is significantly slower - consider pre-computing embeddings');
    }
    const summary = {
        timestamp: new Date(),
        benchmarks,
        overallHealthy,
        warnings,
        recommendations,
    };
    console.log(`[Performance] Benchmarks complete. Healthy: ${overallHealthy}`);
    return summary;
}
async function runQuickHealthCheck() {
    const issues = [];
    let searchLatencyMs = 0;
    try {
        const start = Date.now();
        await (0, retrieval_1.search)('test query', { limit: 1 });
        searchLatencyMs = Date.now() - start;
        if (searchLatencyMs > 1000) {
            issues.push(`Search latency high: ${searchLatencyMs}ms`);
        }
    }
    catch (error) {
        issues.push(`Search error: ${error instanceof Error ? error.message : String(error)}`);
    }
    return {
        healthy: issues.length === 0,
        searchLatencyMs,
        issues,
    };
}
async function getPerformanceMetrics() {
    const healthCheck = await runQuickHealthCheck();
    let searchHealth = 'good';
    if (healthCheck.searchLatencyMs > 500) {
        searchHealth = 'degraded';
    }
    if (healthCheck.searchLatencyMs > 2000 || !healthCheck.healthy) {
        searchHealth = 'critical';
    }
    const recommendations = [];
    if (searchHealth !== 'good') {
        recommendations.push('Run full performance benchmarks to identify bottlenecks');
        recommendations.push('Check database connection and index health');
    }
    return {
        searchHealth,
        avgSearchLatency: healthCheck.searchLatencyMs,
        recommendations,
    };
}
exports.default = {
    runPerformanceBenchmarks,
    runQuickHealthCheck,
    getPerformanceMetrics,
    THRESHOLDS: exports.THRESHOLDS,
};
//# sourceMappingURL=performance.test.js.map