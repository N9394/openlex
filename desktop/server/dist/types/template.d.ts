export type SectionType = 'fixed' | 'customizable' | 'optional';
export type PlaceholderType = 'text' | 'date' | 'number' | 'select' | 'address' | 'currency' | 'email' | 'phone';
export interface TemplatePlaceholder {
    id: string;
    displayName: string;
    description: string;
    type: PlaceholderType;
    required: boolean;
    defaultValue?: string;
    options?: Array<{
        value: string;
        label: string;
    }>;
    validation?: {
        pattern?: string;
        minLength?: number;
        maxLength?: number;
        min?: number;
        max?: number;
    };
    group?: string;
}
export interface TemplateSection {
    id: string;
    title: string;
    type: SectionType;
    order: number;
    baseContent: string;
    customizationPrompt?: string;
    includeByDefault: boolean;
    legalNotes?: string[];
    requiredPlaceholders?: string[];
}
export interface DocumentTemplateData {
    id: string;
    documentType: string;
    name: string;
    description: string | null;
    version: number;
    jurisdiction: string;
    sections: TemplateSection[];
    placeholders: TemplatePlaceholder[];
    isActive: boolean;
    isOfficial: boolean;
    organizationId: string | null;
    createdBy: string | null;
    createdAt: Date;
    updatedAt: Date;
}
export interface TemplateVariantData {
    id: string;
    templateId: string;
    jurisdiction: string;
    sectionOverrides: Record<string, Partial<TemplateSection>>;
    notes: string | null;
}
export type DraftSessionStatus = 'in_progress' | 'completed' | 'abandoned';
export interface GeneratedSection {
    sectionId: string;
    content: string;
    status: 'pending' | 'generated' | 'approved' | 'rejected';
    generatedAt?: Date;
    approvedAt?: Date;
    rejectionReason?: string;
}
export interface DraftSessionData {
    id: string;
    userId: string;
    templateId: string;
    situation: string;
    jurisdiction: string;
    language: string;
    status: DraftSessionStatus;
    currentSectionIndex: number;
    answers: Record<string, string>;
    placeholderValues: Record<string, string>;
    generatedSections: GeneratedSection[];
    finalDocument: string | null;
    disclaimerAccepted: boolean;
    disclaimerAcceptedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    completedAt: Date | null;
}
export interface TemplateListItem {
    id: string;
    documentType: string;
    name: string;
    description: string | null;
    jurisdiction: string;
    isOfficial: boolean;
    sectionCount: number;
    placeholderCount: number;
}
export interface UnfilledPlaceholder {
    placeholder: TemplatePlaceholder;
    currentValue?: string;
    sectionIds: string[];
}
export interface PlaceholderValidationResult {
    isValid: boolean;
    errors: Array<{
        placeholderId: string;
        message: string;
    }>;
    warnings: Array<{
        placeholderId: string;
        message: string;
    }>;
}
//# sourceMappingURL=template.d.ts.map