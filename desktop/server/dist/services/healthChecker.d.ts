export interface HealthIssue {
    type: 'missing' | 'contradiction' | 'unusual' | 'dangerous';
    severity: 'critical' | 'high' | 'medium' | 'low';
    title: string;
    description: string;
    location?: string;
    suggestion?: string;
}
export interface DocumentHealthScore {
    overall: number;
    grade: 'A' | 'B' | 'C' | 'D' | 'F';
    issues: HealthIssue[];
    strengths: string[];
    summary: string;
}
export declare function checkDocumentHealth(documentText: string, documentType: string): Promise<DocumentHealthScore>;
//# sourceMappingURL=healthChecker.d.ts.map