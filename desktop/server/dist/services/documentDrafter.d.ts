import { UserTier } from './modelRouter';
export interface DraftRequest {
    situation: string;
    category: string;
    documentType: string;
    suggestedClauses?: string[];
    jurisdiction?: string;
    complexity?: 'simple' | 'standard' | 'detailed';
    followUpAnswers?: {
        [key: string]: string;
    };
}
export interface DraftedDocument {
    title: string;
    sections: Array<{
        title: string;
        content: string;
    }>;
    sources?: Array<{
        content: string;
        sourceType: string;
        score: number;
    }>;
    grounded?: boolean;
    nliVerification?: {
        verified: boolean;
        verificationRatio: number;
        summary: string;
    };
}
export interface DraftOptions {
    userTier?: UserTier;
    userId?: string;
}
export declare function draftDocument(request: DraftRequest, options?: DraftOptions): Promise<DraftedDocument>;
//# sourceMappingURL=documentDrafter.d.ts.map