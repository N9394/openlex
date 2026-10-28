export declare const DOCUMENT_TYPES: {
    nda: {
        name: string;
        description: string;
        keywords: string[];
    };
    service_agreement: {
        name: string;
        description: string;
        keywords: string[];
    };
    employment_contract: {
        name: string;
        description: string;
        keywords: string[];
    };
    lease_agreement: {
        name: string;
        description: string;
        keywords: string[];
    };
    sales_agreement: {
        name: string;
        description: string;
        keywords: string[];
    };
    partnership_agreement: {
        name: string;
        description: string;
        keywords: string[];
    };
    loan_agreement: {
        name: string;
        description: string;
        keywords: string[];
    };
    release_waiver: {
        name: string;
        description: string;
        keywords: string[];
    };
    cease_desist: {
        name: string;
        description: string;
        keywords: string[];
    };
    power_of_attorney: {
        name: string;
        description: string;
        keywords: string[];
    };
};
interface DetectedParty {
    jurisdiction: string;
    name: string;
}
export interface DocumentTypeDetection {
    documentType: keyof typeof DOCUMENT_TYPES | 'unknown';
    confidence: 'high' | 'medium' | 'low';
    name: string;
    description: string;
    reasoning: string;
    detectedParties?: DetectedParty[];
    detectedJurisdiction?: {
        code: string;
        name: string;
        confidence: 'explicit' | 'high' | 'medium' | 'low' | 'none';
        reason: string;
        needsConfirmation: boolean;
    };
}
export interface NavigatorQuestion {
    id: string;
    question: string;
    type: 'select' | 'text' | 'multiselect';
    options?: {
        value: string;
        label: string;
    }[];
    required: boolean;
}
export interface DraftedDocument {
    title: string;
    sections: {
        title: string;
        content: string;
    }[];
}
export declare function detectDocumentType(situation: string): Promise<DocumentTypeDetection>;
export declare function generateQuestions(documentType: keyof typeof DOCUMENT_TYPES | 'unknown', situation: string, options?: {
    language?: string;
    jurisdiction?: string;
}): Promise<NavigatorQuestion[]>;
export declare function draftDocumentStream(documentType: keyof typeof DOCUMENT_TYPES | 'unknown', situation: string, answers: Record<string, string>, jurisdiction?: string, language?: string, organizationId?: string, onChunk?: (chunk: string) => void): Promise<DraftedDocument>;
export declare function draftDocument(documentType: keyof typeof DOCUMENT_TYPES | 'unknown', situation: string, answers: Record<string, string>, jurisdiction?: string, language?: string, organizationId?: string): Promise<DraftedDocument>;
export {};
//# sourceMappingURL=navigatorService.d.ts.map