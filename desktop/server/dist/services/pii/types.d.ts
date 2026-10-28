export type PIICategory = 'person' | 'organization' | 'location' | 'email' | 'phone' | 'ssn' | 'tax_id' | 'credit_card' | 'iban' | 'date' | 'money' | 'id_number' | 'signature' | 'party' | 'notice' | 'other';
export type DetectionMethod = 'regex' | 'ner' | 'legal_context' | 'heuristic';
export type ConfidenceLevel = 'low' | 'medium' | 'high';
export interface PIIDetection {
    text: string;
    category: PIICategory;
    start: number;
    end: number;
    method: DetectionMethod;
    confidence: number;
    confidenceLevel: ConfidenceLevel;
    placeholder?: string;
    context?: string;
}
export interface AnonymizationResult {
    originalText: string;
    anonymizedText: string;
    detections: PIIDetection[];
    placeholderMap: Map<string, string>;
    stats: {
        totalDetections: number;
        byCategory: Record<PIICategory, number>;
        byMethod: Record<DetectionMethod, number>;
        textReductionPercent: number;
    };
}
export interface DetectOptions {
    language?: 'en' | 'de';
    categories?: PIICategory[];
    minConfidence?: number;
    useNER?: boolean;
    useRegex?: boolean;
    useLegalContext?: boolean;
    customPatterns?: RegexPattern[];
}
export interface RegexPattern {
    id: string;
    name: string;
    pattern: RegExp;
    category: PIICategory;
    confidence: number;
    jurisdictions?: string[];
    description?: string;
}
export interface NERServiceResponse {
    entities: Array<{
        text: string;
        label: string;
        start: number;
        end: number;
        confidence: number;
    }>;
    language: string;
    text_length: number;
    entity_count: number;
}
export interface LegalContextDetection {
    type: 'signature_block' | 'party_definition' | 'recital' | 'notice_section' | 'schedule';
    start: number;
    end: number;
    text: string;
    entities: PIIDetection[];
}
export interface ValidationResult {
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
}
export interface EncryptedDocument {
    encryptedText: string;
    iv: string;
    authTag: string;
    salt: string;
    algorithm: 'aes-256-gcm';
}
export interface PlaceholderConfig {
    person: string;
    organization: string;
    location: string;
    default: string;
}
export declare const NER_LABEL_MAP: Record<string, PIICategory>;
export declare const DEFAULT_PLACEHOLDERS: PlaceholderConfig;
export declare const CONFIDENCE_THRESHOLDS: {
    low: number;
    medium: number;
    high: number;
};
//# sourceMappingURL=types.d.ts.map