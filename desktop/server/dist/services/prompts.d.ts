export declare const ARCHIVIST_PROMPTS: {
    system: (contextData: {
        documentsCount: number;
        vaultItemsCount: number;
        userTier: string;
        currentPage: string;
    }) => string;
    suggestions: (page: string, hasDocuments: boolean, hasVaultItems: boolean) => string[];
};
export declare const ANALYSIS_PROMPTS: {
    fullAnalysis: (documentText: string, documentType: string, jurisdiction: string) => string;
    quickSummary: (documentText: string) => string;
    clauseExtraction: (documentText: string, language: string) => string;
    rightsExtraction: (documentText: string) => string;
    deadlineExtraction: (documentText: string) => string;
    healthCheck: (documentText: string, documentType: string) => string;
};
export declare const EXPLAINER_PROMPTS: {
    explainTerm: (term: string, context?: string) => string;
    explainClause: (clauseText: string, documentType: string) => string;
};
export declare const COMPARISON_PROMPTS: {
    compareDocuments: (doc1: string, doc2: string, doc1Name: string, doc2Name: string) => string;
};
export declare const STUDY_PROMPTS: {
    generateFlashcards: (documentText: string, topic: string) => string;
    generateStudyGuide: (documentText: string, documentType: string) => string;
    generateQuiz: (documentText: string, difficulty: "beginner" | "intermediate" | "advanced") => string;
};
export declare const TIMELINE_PROMPTS: {
    generateTimeline: (documentText: string) => string;
    riskTimeline: (documentText: string) => string;
};
export declare const ENTITY_PROMPTS: {
    extractEntities: (documentText: string) => string;
};
export declare function getJurisdictionContext(jurisdiction: string): string;
export declare function getLanguageInstructions(language: string): string;
//# sourceMappingURL=prompts.d.ts.map