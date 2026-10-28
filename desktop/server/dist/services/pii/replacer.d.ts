import { PIIDetection, AnonymizationResult, PlaceholderConfig } from './types';
export declare function replaceWithPlaceholders(text: string, detections: PIIDetection[], config?: PlaceholderConfig): {
    anonymizedText: string;
    placeholderMap: Map<string, string>;
};
export declare function anonymizeText(text: string, options?: {
    language?: 'en' | 'de';
    minConfidence?: number;
    config?: PlaceholderConfig;
}): Promise<AnonymizationResult>;
export declare function createReverseMap(detections: PIIDetection[]): Map<string, PIIDetection>;
export declare function deanonymizeText(anonymizedText: string, detections: PIIDetection[]): string;
export declare function validateAnonymization(_original: string, anonymized: string, detections: PIIDetection[]): {
    isValid: boolean;
    issues: Array<{
        type: 'pii_leak' | 'placeholder_mismatch' | 'incomplete_redaction';
        description: string;
        location?: {
            start: number;
            end: number;
        };
    }>;
    confidence: number;
};
export declare function batchAnonymize(documents: Array<{
    id: string;
    text: string;
}>, options?: {
    language?: 'en' | 'de';
    minConfidence?: number;
    config?: PlaceholderConfig;
    sharedEntityMap?: boolean;
}): Promise<Array<{
    id: string;
    result: AnonymizationResult;
}>>;
//# sourceMappingURL=replacer.d.ts.map