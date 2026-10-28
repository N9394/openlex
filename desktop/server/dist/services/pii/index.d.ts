export type { PIICategory, DetectionMethod, ConfidenceLevel, PIIDetection, AnonymizationResult, DetectOptions, RegexPattern, NERServiceResponse, LegalContextDetection, ValidationResult, EncryptedDocument, PlaceholderConfig, } from './types';
export { NER_LABEL_MAP, DEFAULT_PLACEHOLDERS, CONFIDENCE_THRESHOLDS, } from './types';
export { detectPII, detectPIISync, getDetectionStats, likelyContainsPII, extractUniqueEntities, } from './detector';
export { ALL_PATTERNS, getPatternsByJurisdiction, getPatternsByCategory, detectWithPatterns, validateSSN, validateCreditCard, validateIBAN, } from './patterns';
export { checkNERHealth, detectWithNER, batchDetectWithNER, detectWithNERSafe, } from './spacyService';
export { detectLegalContexts, legalContextToPIIDetections, } from './legalContext';
export { replaceWithPlaceholders, anonymizeText, createReverseMap, deanonymizeText, validateAnonymization, batchAnonymize, } from './replacer';
export { encryptText, decryptText, createContentHash, verifyContentHash, encryptDetections, decryptDetections, generateMasterSecret, deriveDocumentKey, isValidMasterSecret, createDeletionToken, secureWipe, encryptForTransmission, decryptFromTransmission, getMasterSecretFromEnv, isEncryptionConfigured, } from './encryption';
import type { AnonymizationResult, EncryptedDocument } from './types';
export declare function processDocumentForStorage(text: string, options?: {
    language?: 'en' | 'de';
    minConfidence?: number;
}): Promise<{
    anonymized: AnonymizationResult;
    encrypted: EncryptedDocument;
    ready: boolean;
}>;
export declare function needsPIIProcessing(text: string, options?: {
    minConfidence?: number;
}): Promise<{
    needsProcessing: boolean;
    detectionCount: number;
}>;
export declare function getPIISummary(text: string, options?: {
    language?: 'en' | 'de';
}): Promise<{
    hasPII: boolean;
    categories: string[];
    count: number;
    highConfidenceCount: number;
}>;
//# sourceMappingURL=index.d.ts.map