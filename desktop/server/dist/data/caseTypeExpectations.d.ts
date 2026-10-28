export type CaseType = 'mediation' | 'trial' | 'consulting' | 'negotiation' | 'subpoena' | 'contract-drafting' | 'research' | 'other';
export interface ExpectedDocument {
    name: string;
    importance: 'critical' | 'recommended' | 'optional';
    description: string;
    keywords: string[];
}
export interface CaseTypeExpectation {
    type: CaseType;
    label: string;
    description: string;
    expectedDocuments: ExpectedDocument[];
    typicalTimeline: string;
    riskFactors: string[];
}
export declare const CASE_TYPE_EXPECTATIONS: Record<CaseType, CaseTypeExpectation>;
export declare function getCaseTypeExpectation(caseType: string): CaseTypeExpectation;
export declare function getAllCaseTypes(): Array<{
    type: CaseType;
    label: string;
}>;
export declare function matchesExpectedDocument(documentTitle: string, documentContent: string | null, expectedDoc: ExpectedDocument): boolean;
//# sourceMappingURL=caseTypeExpectations.d.ts.map