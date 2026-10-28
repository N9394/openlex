import { EncryptedDocument } from './types';
export declare function encryptText(plaintext: string, masterSecret: string): EncryptedDocument;
export declare function decryptText(encryptedDoc: EncryptedDocument, masterSecret: string): string;
export interface SecureDocumentStorage {
    encrypted: EncryptedDocument;
    anonymized: string;
    detections: string;
    contentHash: string;
}
export declare function createContentHash(text: string): string;
export declare function verifyContentHash(text: string, hash: string): boolean;
export declare function encryptDetections(detections: any[], masterSecret: string): EncryptedDocument;
export declare function decryptDetections(encryptedDetections: EncryptedDocument, masterSecret: string): any[];
export declare function generateMasterSecret(): string;
export declare function deriveDocumentKey(masterSecret: string, documentId: string): string;
export declare function isValidMasterSecret(secret: string): boolean;
export declare function createDeletionToken(documentId: string, userId: string, timestamp: Date): string;
export declare function secureWipe(str: string): void;
export declare function encryptForTransmission(data: any, sharedSecret: string): {
    payload: string;
    iv: string;
    tag: string;
};
export declare function decryptFromTransmission(encryptedData: {
    payload: string;
    iv: string;
    tag: string;
}, sharedSecret: string): any;
export declare function getMasterSecretFromEnv(): string;
export declare function isEncryptionConfigured(): boolean;
//# sourceMappingURL=encryption.d.ts.map