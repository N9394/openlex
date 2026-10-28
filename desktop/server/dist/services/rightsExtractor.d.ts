import { UserTier } from './modelRouter';
interface Right {
    party: 'you' | 'them';
    description: string;
    importance: 'high' | 'medium' | 'low';
    reference?: string;
}
interface Obligation {
    party: 'you' | 'them';
    description: string;
    deadline?: string;
    importance: 'high' | 'medium' | 'low';
    consequence?: string;
    reference?: string;
}
export interface RightsObligationsSummary {
    yourRights: Right[];
    yourObligations: Obligation[];
    theirRights: Right[];
    theirObligations: Obligation[];
    sources?: Array<{
        content: string;
        sourceType: string;
        score: number;
    }>;
    grounded?: boolean;
}
export interface ExtractionOptions {
    userTier?: UserTier;
    jurisdiction?: string;
    userId?: string;
}
export declare function extractRightsAndObligations(documentText: string, documentType: string, options?: ExtractionOptions): Promise<RightsObligationsSummary>;
export {};
//# sourceMappingURL=rightsExtractor.d.ts.map