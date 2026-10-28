export interface MandatoryTerm {
    id: string;
    jurisdiction: string;
    documentTypes: string[];
    clauseType: string;
    termType: string;
    statuteRef: string;
    description: string;
    requirement: 'mandatory' | 'strongly_recommended';
    searchTerms: string[];
    validationRules: ValidationRule[];
    defaultText?: string;
}
export interface ValidationRule {
    type: 'minimum' | 'maximum' | 'required' | 'prohibited' | 'contains' | 'pattern';
    field: string;
    value?: string | number;
    unit?: string;
    errorMessage: string;
}
export interface StatutoryRequirement {
    id: string;
    documentType: string;
    jurisdiction: string;
    clauseType: string;
    statuteReference: string;
    statuteText?: string;
    isMandatory: boolean;
    defaultText?: string;
    validationRules: ValidationRule[];
}
export declare const ALL_MANDATORY_TERMS: MandatoryTerm[];
export declare function getMandatoryTermsFor(jurisdiction: string, documentType?: string): MandatoryTerm[];
export declare function getMandatoryTermsByClauseType(clauseType: string, jurisdiction: string): MandatoryTerm[];
export declare function getStrictlyMandatoryTerms(jurisdiction: string, documentType?: string): MandatoryTerm[];
export declare function buildSearchQuery(term: MandatoryTerm): string;
interface JurisdictionMatch {
    jurisdiction: string;
    confidence: number;
    matches: string[];
    reason: string;
}
interface JurisdictionDetectionResult {
    detected: string | null;
    confidence: number;
    allMatches: JurisdictionMatch[];
    isAmbiguous: boolean;
    isExplicit?: boolean;
}
export declare function detectJurisdiction(text: string): JurisdictionDetectionResult;
export declare function detectJurisdictionQuick(text: string): string | null;
export declare function validateJurisdictionMatch(text: string, expectedJurisdiction: string): {
    isMatch: boolean;
    warning?: string;
    detected?: string;
};
export declare function getJurisdictionName(code: string): string;
export declare function extractGoverningLawClause(text: string): {
    found: boolean;
    jurisdiction?: string;
    clause?: string;
    startIndex?: number;
    endIndex?: number;
};
export declare function autoDetectJurisdictionForCreation(situationText: string, userLocale?: string, referencedDocText?: string): {
    jurisdiction: string | null;
    confidence: 'explicit' | 'high' | 'medium' | 'low' | 'none';
    reason: string;
    needsConfirmation: boolean;
};
export {};
//# sourceMappingURL=mandatoryTerms.d.ts.map