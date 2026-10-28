export interface BenchmarkResult {
    name: string;
    iterations: number;
    avgMs: number;
    minMs: number;
    maxMs: number;
    p50Ms: number;
    p95Ms: number;
    p99Ms: number;
    errors: number;
    throughput: number;
}
export interface BenchmarkSummary {
    timestamp: Date;
    benchmarks: BenchmarkResult[];
    overallHealthy: boolean;
    warnings: string[];
    recommendations: string[];
}
export declare const THRESHOLDS: {
    ragSearchP95: number;
    ragSearchP99: number;
    hybridSearchP95: number;
    hybridSearchP99: number;
    fullExecutionP95: number;
    fullExecutionP99: number;
};
export declare function runPerformanceBenchmarks(): Promise<BenchmarkSummary>;
export declare function runQuickHealthCheck(): Promise<{
    healthy: boolean;
    searchLatencyMs: number;
    issues: string[];
}>;
export declare function getPerformanceMetrics(): Promise<{
    lastBenchmark?: Date;
    searchHealth: 'good' | 'degraded' | 'critical';
    avgSearchLatency: number;
    recommendations: string[];
}>;
declare const _default: {
    runPerformanceBenchmarks: typeof runPerformanceBenchmarks;
    runQuickHealthCheck: typeof runQuickHealthCheck;
    getPerformanceMetrics: typeof getPerformanceMetrics;
    THRESHOLDS: {
        ragSearchP95: number;
        ragSearchP99: number;
        hybridSearchP95: number;
        hybridSearchP99: number;
        fullExecutionP95: number;
        fullExecutionP99: number;
    };
};
export default _default;
//# sourceMappingURL=performance.test.d.ts.map