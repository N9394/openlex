import { RegexPattern, PIICategory, PIIDetection } from './types';
export declare const ALL_PATTERNS: RegexPattern[];
export declare function getPatternsByJurisdiction(jurisdiction?: string): RegexPattern[];
export declare function getPatternsByCategory(categories: PIICategory[]): RegexPattern[];
export declare function detectWithPatterns(text: string, patterns?: RegexPattern[], minConfidence?: number): PIIDetection[];
export declare function validateSSN(ssn: string): boolean;
export declare function validateCreditCard(number: string): boolean;
export declare function validateIBAN(iban: string): boolean;
//# sourceMappingURL=patterns.d.ts.map