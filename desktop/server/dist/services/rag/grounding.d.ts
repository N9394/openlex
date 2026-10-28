export interface Amendment {
    id: string;
    chunkId: string;
    sourceName: string;
    previousContent: string;
    newContent: string;
    detectedAt: Date;
    changeType: 'modified' | 'added' | 'removed';
    acknowledged: boolean;
    acknowledgedBy?: string;
    acknowledgedAt?: Date;
}
export interface ContentFreshness {
    chunkId: string;
    sourceName: string;
    sourceDate?: Date;
    lastVerified?: Date;
    expiresAt?: Date;
    daysSinceVerification: number;
    isExpired: boolean;
    freshnessLevel: 'fresh' | 'stale' | 'expired' | 'unknown';
}
export interface VerificationResult {
    chunksVerified: number;
    amendmentsDetected: number;
    amendments: Amendment[];
}
export declare function generateContentHash(content: string): string;
export declare function contentHasChanged(oldContent: string, newContent: string): {
    changed: boolean;
    similarity: number;
};
export declare function detectAmendments(sourceId: string, newContent: string, sourceName: string): Promise<Amendment[]>;
export declare function getUnacknowledgedAmendments(limit?: number): Promise<Amendment[]>;
export declare function acknowledgeAmendment(amendmentId: string, userId: string): Promise<boolean>;
export declare function markAsVerified(chunkId: string): Promise<boolean>;
export declare function verifySource(sourceId: string): Promise<number>;
export declare function getContentFreshness(chunkIds: string[]): Promise<ContentFreshness[]>;
export declare function findStaleContent(daysThreshold?: number, limit?: number): Promise<ContentFreshness[]>;
export declare function getGroundingStats(): Promise<{
    totalChunks: number;
    freshChunks: number;
    staleChunks: number;
    expiredChunks: number;
    unknownChunks: number;
    pendingAmendments: number;
    averageDaysSinceVerification: number;
}>;
declare const _default: {
    generateContentHash: typeof generateContentHash;
    contentHasChanged: typeof contentHasChanged;
    detectAmendments: typeof detectAmendments;
    getUnacknowledgedAmendments: typeof getUnacknowledgedAmendments;
    acknowledgeAmendment: typeof acknowledgeAmendment;
    markAsVerified: typeof markAsVerified;
    verifySource: typeof verifySource;
    getContentFreshness: typeof getContentFreshness;
    findStaleContent: typeof findStaleContent;
    getGroundingStats: typeof getGroundingStats;
};
export default _default;
//# sourceMappingURL=grounding.d.ts.map