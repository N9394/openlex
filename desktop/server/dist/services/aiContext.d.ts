export interface AIContextOptions {
    userId?: string;
    organizationId?: string;
    documentType?: string;
    language?: string;
    jurisdiction?: string;
    userType?: string;
}
export declare function getJurisdictionContext(jurisdiction: string): string;
export declare function getToneInstruction(tier: string): string;
export declare function getLanguageInstruction(language: string): string;
export declare function getEnhancedContext(options: AIContextOptions): Promise<string>;
export declare function buildChatContext(options: AIContextOptions): {
    systemPrompt: string;
};
//# sourceMappingURL=aiContext.d.ts.map