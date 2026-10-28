export interface TierLimits {
    documentsPerMonth: number;
    analysisDepth: 'basic' | 'full';
    saveDocuments: boolean;
    history: boolean;
}
export interface TierFeatures {
    documentAnalysis: boolean;
    fullClauses: boolean;
    glossary: boolean;
    dates: boolean;
    cases: boolean;
    clients: boolean;
    vault: boolean;
    research: boolean;
    navigator: boolean;
    study: boolean;
    flashcards?: boolean;
    quizzes?: boolean;
    teamCollaboration?: boolean;
    sharedCases?: boolean;
    roleBasedAccess?: boolean;
    prioritySupport?: boolean;
    advancedAnalytics?: boolean;
    firmMemory?: boolean;
}
export interface TierConfig {
    name: string;
    displayName: string;
    description: string;
    price: number;
    priceAnnual?: number;
    stripePriceId?: string;
    stripePriceIdAnnual?: string;
    requiresAuth: boolean;
    isPerSeat?: boolean;
    minSeats?: number;
    limits: TierLimits;
    features: TierFeatures;
}
export declare const TIERS: Record<string, TierConfig>;
export type TierName = keyof typeof TIERS;
export declare function getTier(tierName: string): TierConfig | null;
export declare function tierHasFeature(tierName: string, feature: keyof TierFeatures): boolean;
export declare function getTierDocumentLimit(tierName: string): number;
export declare function tierRequiresAuth(tierName: string): boolean;
export declare function getTiersWithFeature(feature: keyof TierFeatures): TierName[];
export declare function compareTiers(tier1: string, tier2: string): number;
export declare function getNextTier(currentTier: string): TierName | null;
export declare function getTierPriceDisplay(tierName: string, annual?: boolean): string;
//# sourceMappingURL=tiers.d.ts.map