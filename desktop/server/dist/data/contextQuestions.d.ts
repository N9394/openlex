export interface ContextQuestion {
    id: string;
    question: string;
    type: 'single' | 'multiple';
    options: ContextOption[];
    affects: string[];
}
export interface ContextOption {
    id: string;
    label: string;
    description: string;
    impact: string;
}
export interface UserContext {
    relationship?: string;
    riskLevel?: string;
    priority?: string[];
    experience?: string;
    negotiationPower?: string;
}
export declare const contextQuestions: ContextQuestion[];
export declare function generateContextualInstructions(context: UserContext): string;
export declare function calculateFormalityLevel(context: UserContext): number;
//# sourceMappingURL=contextQuestions.d.ts.map