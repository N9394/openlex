import { ExtractedCitation } from './chunking';
export interface VerifiedCitation extends ExtractedCitation {
    verified: boolean;
    confidence: number;
    foundIn?: string;
    snippet?: string;
}
export interface VerificationResult {
    citations: VerifiedCitation[];
    verifiedCount: number;
    unverifiedCount: number;
    verificationRatio: number;
    confidence: 'high' | 'medium' | 'low' | 'insufficient';
}
export declare function verifyCitations(text: string, options?: {
    jurisdiction?: string;
    strictMode?: boolean;
}): Promise<VerificationResult>;
export interface ExtractedClaim {
    text: string;
    type: 'legal_principle' | 'statute_reference' | 'case_citation' | 'factual';
    citation?: ExtractedCitation;
    startIndex: number;
    endIndex: number;
}
export declare function extractClaims(text: string): ExtractedClaim[];
export declare function verifyResponse(text: string, options?: {
    jurisdiction?: string;
    ragSources?: Array<{
        content: string;
        sourceName: string;
    }>;
}): Promise<{
    claims: ExtractedClaim[];
    citationVerification: VerificationResult;
    potentialHallucinations: string[];
    confidence: 'high' | 'medium' | 'low' | 'insufficient';
}>;
//# sourceMappingURL=citationVerifier.d.ts.map