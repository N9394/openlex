"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.encryptText = encryptText;
exports.decryptText = decryptText;
exports.createContentHash = createContentHash;
exports.verifyContentHash = verifyContentHash;
exports.encryptDetections = encryptDetections;
exports.decryptDetections = decryptDetections;
exports.generateMasterSecret = generateMasterSecret;
exports.deriveDocumentKey = deriveDocumentKey;
exports.isValidMasterSecret = isValidMasterSecret;
exports.createDeletionToken = createDeletionToken;
exports.secureWipe = secureWipe;
exports.encryptForTransmission = encryptForTransmission;
exports.decryptFromTransmission = decryptFromTransmission;
exports.getMasterSecretFromEnv = getMasterSecretFromEnv;
exports.isEncryptionConfigured = isEncryptionConfigured;
const crypto = __importStar(require("crypto"));
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;
const PBKDF2_ITERATIONS = 100000;
function deriveKey(masterSecret, salt) {
    return crypto.pbkdf2Sync(masterSecret, salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha256');
}
function generateSalt() {
    return crypto.randomBytes(SALT_LENGTH);
}
function generateIV() {
    return crypto.randomBytes(IV_LENGTH);
}
function encryptText(plaintext, masterSecret) {
    const salt = generateSalt();
    const iv = generateIV();
    const key = deriveKey(masterSecret, salt);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
        authTagLength: AUTH_TAG_LENGTH,
    });
    let encrypted = cipher.update(plaintext, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    const authTag = cipher.getAuthTag();
    return {
        encryptedText: encrypted,
        iv: iv.toString('base64'),
        authTag: authTag.toString('base64'),
        salt: salt.toString('base64'),
        algorithm: ALGORITHM,
    };
}
function decryptText(encryptedDoc, masterSecret) {
    const salt = Buffer.from(encryptedDoc.salt, 'base64');
    const iv = Buffer.from(encryptedDoc.iv, 'base64');
    const authTag = Buffer.from(encryptedDoc.authTag, 'base64');
    const key = deriveKey(masterSecret, salt);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
        authTagLength: AUTH_TAG_LENGTH,
    });
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encryptedDoc.encryptedText, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}
function createContentHash(text) {
    return crypto.createHash('sha256').update(text).digest('hex');
}
function verifyContentHash(text, hash) {
    return createContentHash(text) === hash;
}
function encryptDetections(detections, masterSecret) {
    const json = JSON.stringify(detections);
    return encryptText(json, masterSecret);
}
function decryptDetections(encryptedDetections, masterSecret) {
    const json = decryptText(encryptedDetections, masterSecret);
    return JSON.parse(json);
}
function generateMasterSecret() {
    return crypto.randomBytes(32).toString('base64');
}
function deriveDocumentKey(masterSecret, documentId) {
    const hmac = crypto.createHmac('sha256', masterSecret);
    hmac.update(documentId);
    return hmac.digest('base64');
}
function isValidMasterSecret(secret) {
    try {
        const buffer = Buffer.from(secret, 'base64');
        return buffer.length >= 32;
    }
    catch {
        return false;
    }
}
function createDeletionToken(documentId, userId, timestamp) {
    const data = `${documentId}:${userId}:${timestamp.toISOString()}`;
    return crypto.createHash('sha256').update(data).digest('hex');
}
function secureWipe(str) {
    const buffer = Buffer.from(str);
    buffer.fill(0);
    if (global.gc) {
        global.gc();
    }
}
function encryptForTransmission(data, sharedSecret) {
    const iv = generateIV();
    const key = crypto.createHash('sha256').update(sharedSecret).digest();
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
        authTagLength: AUTH_TAG_LENGTH,
    });
    const json = JSON.stringify(data);
    let encrypted = cipher.update(json, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    return {
        payload: encrypted,
        iv: iv.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
    };
}
function decryptFromTransmission(encryptedData, sharedSecret) {
    const iv = Buffer.from(encryptedData.iv, 'base64');
    const tag = Buffer.from(encryptedData.tag, 'base64');
    const key = crypto.createHash('sha256').update(sharedSecret).digest();
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
        authTagLength: AUTH_TAG_LENGTH,
    });
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(encryptedData.payload, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    return JSON.parse(decrypted);
}
function getMasterSecretFromEnv() {
    const secret = process.env.DOCUMENT_ENCRYPTION_SECRET;
    if (!secret) {
        console.warn('[Encryption] DOCUMENT_ENCRYPTION_SECRET not set. Generating temporary secret.');
        console.warn('[Encryption] WARNING: Documents encrypted with temporary secret will be unrecoverable after restart!');
        return generateMasterSecret();
    }
    if (!isValidMasterSecret(secret)) {
        throw new Error('DOCUMENT_ENCRYPTION_SECRET is invalid. Must be at least 32 bytes base64 encoded.');
    }
    return secret;
}
function isEncryptionConfigured() {
    return !!process.env.DOCUMENT_ENCRYPTION_SECRET;
}
//# sourceMappingURL=encryption.js.map