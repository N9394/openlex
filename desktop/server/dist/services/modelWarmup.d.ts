interface WarmupResult {
    model: string;
    success: boolean;
    latency: number;
    error?: string;
}
interface WarmupReport {
    startedAt: Date;
    completedAt: Date;
    totalDuration: number;
    results: WarmupResult[];
    allSuccess: boolean;
}
export declare function warmupModels(): Promise<WarmupReport>;
export declare function checkModelHealth(): Promise<{
    healthy: boolean;
    details: any;
}>;
declare const _default: {
    warmupModels: typeof warmupModels;
    checkModelHealth: typeof checkModelHealth;
};
export default _default;
//# sourceMappingURL=modelWarmup.d.ts.map