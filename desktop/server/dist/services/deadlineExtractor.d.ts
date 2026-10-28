import { UserTier } from './modelRouter';
export interface ExtractedDeadline {
    type: 'payment' | 'notice' | 'renewal' | 'performance' | 'termination' | 'other';
    date?: string;
    period?: string;
    description: string;
    importance: 'critical' | 'high' | 'medium' | 'low';
    party: 'you' | 'them' | 'both';
    consequence?: string;
    reference?: string;
}
export interface LegalCalendar {
    deadlines: ExtractedDeadline[];
    summary: string;
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
export declare function extractDeadlines(documentText: string, documentType: string, options?: ExtractionOptions): Promise<LegalCalendar>;
//# sourceMappingURL=deadlineExtractor.d.ts.map