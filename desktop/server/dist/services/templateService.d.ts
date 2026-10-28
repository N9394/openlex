import { DocumentTemplateData, TemplateSection, TemplatePlaceholder, TemplateListItem, UnfilledPlaceholder, PlaceholderValidationResult } from '../types/template';
export declare function getTemplates(jurisdiction: string, organizationId?: string): Promise<TemplateListItem[]>;
export declare function getTemplateByDocumentType(documentType: string, jurisdiction: string, organizationId?: string): Promise<DocumentTemplateData | null>;
export declare function getTemplateById(templateId: string): Promise<DocumentTemplateData | null>;
export declare function resolveTemplate(templateId: string, jurisdiction: string): Promise<DocumentTemplateData | null>;
export declare function getUnfilledPlaceholders(template: DocumentTemplateData, currentValues: Record<string, string>): UnfilledPlaceholder[];
export declare function validatePlaceholders(template: DocumentTemplateData, values: Record<string, string>): PlaceholderValidationResult;
export declare function applyPlaceholders(content: string, values: Record<string, string>): string;
export declare function extractPlaceholdersFromContent(content: string): string[];
export declare function createOrganizationTemplate(organizationId: string, data: {
    documentType: string;
    name: string;
    description?: string;
    jurisdiction: string;
    sections: TemplateSection[];
    placeholders: TemplatePlaceholder[];
    createdBy: string;
}): Promise<DocumentTemplateData>;
//# sourceMappingURL=templateService.d.ts.map