"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isEncryptionConfigured = exports.getMasterSecretFromEnv = exports.decryptFromTransmission = exports.encryptForTransmission = exports.secureWipe = exports.createDeletionToken = exports.isValidMasterSecret = exports.deriveDocumentKey = exports.generateMasterSecret = exports.decryptDetections = exports.encryptDetections = exports.verifyContentHash = exports.createContentHash = exports.decryptText = exports.encryptText = exports.batchAnonymize = exports.validateAnonymization = exports.deanonymizeText = exports.createReverseMap = exports.anonymizeText = exports.replaceWithPlaceholders = exports.legalContextToPIIDetections = exports.detectLegalContexts = exports.detectWithNERSafe = exports.batchDetectWithNER = exports.detectWithNER = exports.checkNERHealth = exports.validateIBAN = exports.validateCreditCard = exports.validateSSN = exports.detectWithPatterns = exports.getPatternsByCategory = exports.getPatternsByJurisdiction = exports.ALL_PATTERNS = exports.extractUniqueEntities = exports.likelyContainsPII = exports.getDetectionStats = exports.detectPIISync = exports.detectPII = exports.CONFIDENCE_THRESHOLDS = exports.DEFAULT_PLACEHOLDERS = exports.NER_LABEL_MAP = void 0;
exports.processDocumentForStorage = processDocumentForStorage;
exports.needsPIIProcessing = needsPIIProcessing;
exports.getPIISummary = getPIISummary;
var types_1 = require("./types");
Object.defineProperty(exports, "NER_LABEL_MAP", { enumerable: true, get: function () { return types_1.NER_LABEL_MAP; } });
Object.defineProperty(exports, "DEFAULT_PLACEHOLDERS", { enumerable: true, get: function () { return types_1.DEFAULT_PLACEHOLDERS; } });
Object.defineProperty(exports, "CONFIDENCE_THRESHOLDS", { enumerable: true, get: function () { return types_1.CONFIDENCE_THRESHOLDS; } });
var detector_1 = require("./detector");
Object.defineProperty(exports, "detectPII", { enumerable: true, get: function () { return detector_1.detectPII; } });
Object.defineProperty(exports, "detectPIISync", { enumerable: true, get: function () { return detector_1.detectPIISync; } });
Object.defineProperty(exports, "getDetectionStats", { enumerable: true, get: function () { return detector_1.getDetectionStats; } });
Object.defineProperty(exports, "likelyContainsPII", { enumerable: true, get: function () { return detector_1.likelyContainsPII; } });
Object.defineProperty(exports, "extractUniqueEntities", { enumerable: true, get: function () { return detector_1.extractUniqueEntities; } });
var patterns_1 = require("./patterns");
Object.defineProperty(exports, "ALL_PATTERNS", { enumerable: true, get: function () { return patterns_1.ALL_PATTERNS; } });
Object.defineProperty(exports, "getPatternsByJurisdiction", { enumerable: true, get: function () { return patterns_1.getPatternsByJurisdiction; } });
Object.defineProperty(exports, "getPatternsByCategory", { enumerable: true, get: function () { return patterns_1.getPatternsByCategory; } });
Object.defineProperty(exports, "detectWithPatterns", { enumerable: true, get: function () { return patterns_1.detectWithPatterns; } });
Object.defineProperty(exports, "validateSSN", { enumerable: true, get: function () { return patterns_1.validateSSN; } });
Object.defineProperty(exports, "validateCreditCard", { enumerable: true, get: function () { return patterns_1.validateCreditCard; } });
Object.defineProperty(exports, "validateIBAN", { enumerable: true, get: function () { return patterns_1.validateIBAN; } });
var spacyService_1 = require("./spacyService");
Object.defineProperty(exports, "checkNERHealth", { enumerable: true, get: function () { return spacyService_1.checkNERHealth; } });
Object.defineProperty(exports, "detectWithNER", { enumerable: true, get: function () { return spacyService_1.detectWithNER; } });
Object.defineProperty(exports, "batchDetectWithNER", { enumerable: true, get: function () { return spacyService_1.batchDetectWithNER; } });
Object.defineProperty(exports, "detectWithNERSafe", { enumerable: true, get: function () { return spacyService_1.detectWithNERSafe; } });
var legalContext_1 = require("./legalContext");
Object.defineProperty(exports, "detectLegalContexts", { enumerable: true, get: function () { return legalContext_1.detectLegalContexts; } });
Object.defineProperty(exports, "legalContextToPIIDetections", { enumerable: true, get: function () { return legalContext_1.legalContextToPIIDetections; } });
var replacer_1 = require("./replacer");
Object.defineProperty(exports, "replaceWithPlaceholders", { enumerable: true, get: function () { return replacer_1.replaceWithPlaceholders; } });
Object.defineProperty(exports, "anonymizeText", { enumerable: true, get: function () { return replacer_1.anonymizeText; } });
Object.defineProperty(exports, "createReverseMap", { enumerable: true, get: function () { return replacer_1.createReverseMap; } });
Object.defineProperty(exports, "deanonymizeText", { enumerable: true, get: function () { return replacer_1.deanonymizeText; } });
Object.defineProperty(exports, "validateAnonymization", { enumerable: true, get: function () { return replacer_1.validateAnonymization; } });
Object.defineProperty(exports, "batchAnonymize", { enumerable: true, get: function () { return replacer_1.batchAnonymize; } });
var encryption_1 = require("./encryption");
Object.defineProperty(exports, "encryptText", { enumerable: true, get: function () { return encryption_1.encryptText; } });
Object.defineProperty(exports, "decryptText", { enumerable: true, get: function () { return encryption_1.decryptText; } });
Object.defineProperty(exports, "createContentHash", { enumerable: true, get: function () { return encryption_1.createContentHash; } });
Object.defineProperty(exports, "verifyContentHash", { enumerable: true, get: function () { return encryption_1.verifyContentHash; } });
Object.defineProperty(exports, "encryptDetections", { enumerable: true, get: function () { return encryption_1.encryptDetections; } });
Object.defineProperty(exports, "decryptDetections", { enumerable: true, get: function () { return encryption_1.decryptDetections; } });
Object.defineProperty(exports, "generateMasterSecret", { enumerable: true, get: function () { return encryption_1.generateMasterSecret; } });
Object.defineProperty(exports, "deriveDocumentKey", { enumerable: true, get: function () { return encryption_1.deriveDocumentKey; } });
Object.defineProperty(exports, "isValidMasterSecret", { enumerable: true, get: function () { return encryption_1.isValidMasterSecret; } });
Object.defineProperty(exports, "createDeletionToken", { enumerable: true, get: function () { return encryption_1.createDeletionToken; } });
Object.defineProperty(exports, "secureWipe", { enumerable: true, get: function () { return encryption_1.secureWipe; } });
Object.defineProperty(exports, "encryptForTransmission", { enumerable: true, get: function () { return encryption_1.encryptForTransmission; } });
Object.defineProperty(exports, "decryptFromTransmission", { enumerable: true, get: function () { return encryption_1.decryptFromTransmission; } });
Object.defineProperty(exports, "getMasterSecretFromEnv", { enumerable: true, get: function () { return encryption_1.getMasterSecretFromEnv; } });
Object.defineProperty(exports, "isEncryptionConfigured", { enumerable: true, get: function () { return encryption_1.isEncryptionConfigured; } });
const detector_2 = require("./detector");
const replacer_2 = require("./replacer");
const encryption_2 = require("./encryption");
async function processDocumentForStorage(text, options = {}) {
    const { language = 'en', minConfidence = 0.5 } = options;
    const anonymized = await (0, replacer_2.anonymizeText)(text, { language, minConfidence });
    const masterSecret = (0, encryption_2.getMasterSecretFromEnv)();
    const encrypted = (0, encryption_2.encryptText)(text, masterSecret);
    return {
        anonymized,
        encrypted,
        ready: true,
    };
}
async function needsPIIProcessing(text, options = {}) {
    const { minConfidence = 0.5 } = options;
    const detections = await (0, detector_2.detectPII)(text, {
        minConfidence,
        useNER: false,
    });
    return {
        needsProcessing: detections.length > 0,
        detectionCount: detections.length,
    };
}
async function getPIISummary(text, options = {}) {
    const { language = 'en' } = options;
    const detections = await (0, detector_2.detectPII)(text, { language });
    const categories = [...new Set(detections.map(d => d.category))];
    const highConfidenceCount = detections.filter(d => d.confidence >= 0.9).length;
    return {
        hasPII: detections.length > 0,
        categories,
        count: detections.length,
        highConfidenceCount,
    };
}
//# sourceMappingURL=index.js.map