export interface JurisdictionInfo {
    code: string;
    name: string;
    nameLocal?: string;
    legalSystem: 'civil' | 'common' | 'mixed';
    languages: string[];
    isEUMember: boolean;
    euJoinDate?: string;
    related: string[];
    relationship: JurisdictionRelationship;
    notes: string;
    keyLaws: string[];
    courts: CourtInfo[];
}
export interface JurisdictionRelationship {
    type: 'supremacy' | 'bilateral' | 'harmonized' | 'influence' | 'none';
    description: string;
}
export interface CourtInfo {
    name: string;
    nameLocal?: string;
    type: 'supreme' | 'constitutional' | 'administrative' | 'specialized';
    abbreviation: string;
}
export interface JurisdictionSuggestion {
    code: string;
    name: string;
    reason: string;
    relevance: 'high' | 'medium' | 'low';
}
export declare const JURISDICTIONS: Record<string, JurisdictionInfo>;
export declare const EU_MEMBERS: string[];
export declare function getJurisdiction(code: string): JurisdictionInfo | undefined;
export declare function getAllJurisdictions(): JurisdictionInfo[];
export declare function getRelatedJurisdictions(code: string): string[];
export declare function isEUMember(code: string): boolean;
export declare function shouldIncludeEU(jurisdictions: string[]): boolean;
export declare function suggestJurisdictions(selected: string[]): JurisdictionSuggestion[];
export declare function explainRelationship(code1: string, code2: string): string;
export declare function expandJurisdictions(codes: string[], options?: {
    includeEU?: boolean;
    includeRelated?: boolean;
}): string[];
export declare function getPotentialConflictAreas(jurisdictions: string[]): string[];
//# sourceMappingURL=jurisdictionIntelligence.d.ts.map