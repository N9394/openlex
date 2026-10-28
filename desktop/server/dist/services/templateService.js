"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTemplates = getTemplates;
exports.getTemplateByDocumentType = getTemplateByDocumentType;
exports.getTemplateById = getTemplateById;
exports.resolveTemplate = resolveTemplate;
exports.getUnfilledPlaceholders = getUnfilledPlaceholders;
exports.validatePlaceholders = validatePlaceholders;
exports.applyPlaceholders = applyPlaceholders;
exports.extractPlaceholdersFromContent = extractPlaceholdersFromContent;
exports.createOrganizationTemplate = createOrganizationTemplate;
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
async function getTemplates(jurisdiction, organizationId) {
    const templates = await prisma.documentTemplate.findMany({
        where: {
            isActive: true,
            AND: [
                {
                    OR: [
                        { jurisdiction },
                        { jurisdiction: 'ALL' },
                    ],
                },
                organizationId
                    ? { OR: [{ organizationId: null }, { organizationId }] }
                    : { organizationId: null },
            ],
        },
        orderBy: [{ isOfficial: 'desc' }, { name: 'asc' }],
    });
    return templates.map(t => {
        const sections = parseJsonArray(t.sections);
        const placeholders = parseJsonArray(t.placeholders);
        return {
            id: t.id,
            documentType: t.documentType,
            name: t.name,
            description: t.description,
            jurisdiction: t.jurisdiction,
            isOfficial: t.isOfficial,
            sectionCount: sections.length,
            placeholderCount: placeholders.length,
        };
    });
}
async function getTemplateByDocumentType(documentType, jurisdiction, organizationId) {
    let template = await prisma.documentTemplate.findFirst({
        where: {
            documentType,
            jurisdiction,
            isActive: true,
            ...(organizationId
                ? { OR: [{ organizationId: null }, { organizationId }] }
                : { organizationId: null }),
        },
        orderBy: [{ organizationId: 'desc' }, { version: 'desc' }],
    });
    if (!template) {
        template = await prisma.documentTemplate.findFirst({
            where: {
                documentType,
                jurisdiction: 'ALL',
                isActive: true,
                organizationId: null,
            },
            orderBy: { version: 'desc' },
        });
    }
    if (!template && jurisdiction !== 'US') {
        template = await prisma.documentTemplate.findFirst({
            where: {
                documentType,
                jurisdiction: 'US',
                isActive: true,
                organizationId: null,
            },
            orderBy: { version: 'desc' },
        });
    }
    if (!template)
        return null;
    return formatTemplate(template);
}
async function getTemplateById(templateId) {
    const template = await prisma.documentTemplate.findUnique({
        where: { id: templateId },
    });
    if (!template)
        return null;
    return formatTemplate(template);
}
async function resolveTemplate(templateId, jurisdiction) {
    const template = await getTemplateById(templateId);
    if (!template)
        return null;
    const variant = await prisma.documentTemplateVariant.findUnique({
        where: {
            templateId_jurisdiction: {
                templateId,
                jurisdiction,
            },
        },
    });
    if (!variant)
        return template;
    const overrides = parseJsonObject(variant.sectionOverrides);
    const resolvedSections = template.sections.map(section => {
        const override = overrides[section.id];
        if (!override)
            return section;
        return {
            ...section,
            ...override,
        };
    });
    return {
        ...template,
        jurisdiction,
        sections: resolvedSections,
    };
}
function getUnfilledPlaceholders(template, currentValues) {
    const unfilled = [];
    for (const placeholder of template.placeholders) {
        const value = currentValues[placeholder.id];
        const isFilled = value !== undefined && value.trim() !== '';
        if (!isFilled) {
            const sectionIds = template.sections
                .filter(s => s.baseContent.includes(`{{${placeholder.id}}}`))
                .map(s => s.id);
            unfilled.push({
                placeholder,
                currentValue: value,
                sectionIds,
            });
        }
    }
    return unfilled;
}
function validatePlaceholders(template, values) {
    const errors = [];
    const warnings = [];
    for (const placeholder of template.placeholders) {
        const value = values[placeholder.id];
        if (placeholder.required && (!value || value.trim() === '')) {
            errors.push({
                placeholderId: placeholder.id,
                message: `${placeholder.displayName} is required`,
            });
            continue;
        }
        if (!value || value.trim() === '')
            continue;
        if (placeholder.validation) {
            const { pattern, minLength, maxLength, min, max } = placeholder.validation;
            if (pattern && !new RegExp(pattern).test(value)) {
                errors.push({
                    placeholderId: placeholder.id,
                    message: `${placeholder.displayName} has an invalid format`,
                });
            }
            if (minLength && value.length < minLength) {
                errors.push({
                    placeholderId: placeholder.id,
                    message: `${placeholder.displayName} must be at least ${minLength} characters`,
                });
            }
            if (maxLength && value.length > maxLength) {
                errors.push({
                    placeholderId: placeholder.id,
                    message: `${placeholder.displayName} must be no more than ${maxLength} characters`,
                });
            }
            if (placeholder.type === 'number' || placeholder.type === 'currency') {
                const numValue = parseFloat(value);
                if (isNaN(numValue)) {
                    errors.push({
                        placeholderId: placeholder.id,
                        message: `${placeholder.displayName} must be a valid number`,
                    });
                }
                else {
                    if (min !== undefined && numValue < min) {
                        errors.push({
                            placeholderId: placeholder.id,
                            message: `${placeholder.displayName} must be at least ${min}`,
                        });
                    }
                    if (max !== undefined && numValue > max) {
                        errors.push({
                            placeholderId: placeholder.id,
                            message: `${placeholder.displayName} must be no more than ${max}`,
                        });
                    }
                }
            }
        }
        if (placeholder.type === 'email') {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(value)) {
                errors.push({
                    placeholderId: placeholder.id,
                    message: `${placeholder.displayName} must be a valid email address`,
                });
            }
        }
        if (placeholder.type === 'date') {
            const date = new Date(value);
            if (isNaN(date.getTime())) {
                errors.push({
                    placeholderId: placeholder.id,
                    message: `${placeholder.displayName} must be a valid date`,
                });
            }
        }
    }
    return {
        isValid: errors.length === 0,
        errors,
        warnings,
    };
}
function applyPlaceholders(content, values) {
    let result = content;
    for (const [key, value] of Object.entries(values)) {
        const placeholder = `{{${key}}}`;
        result = result.replace(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), value || placeholder);
    }
    return result;
}
function extractPlaceholdersFromContent(content) {
    const regex = /\{\{([A-Z_]+)\}\}/g;
    const matches = [];
    let match;
    while ((match = regex.exec(content)) !== null) {
        if (!matches.includes(match[1])) {
            matches.push(match[1]);
        }
    }
    return matches;
}
async function createOrganizationTemplate(organizationId, data) {
    const template = await prisma.documentTemplate.create({
        data: {
            organizationId,
            documentType: data.documentType,
            name: data.name,
            description: data.description || null,
            jurisdiction: data.jurisdiction,
            sections: JSON.stringify(data.sections),
            placeholders: JSON.stringify(data.placeholders),
            isActive: true,
            isOfficial: false,
            createdBy: data.createdBy,
        },
    });
    return formatTemplate(template);
}
function formatTemplate(template) {
    return {
        id: template.id,
        documentType: template.documentType,
        name: template.name,
        description: template.description,
        version: template.version,
        jurisdiction: template.jurisdiction,
        sections: parseJsonArray(template.sections),
        placeholders: parseJsonArray(template.placeholders),
        isActive: template.isActive,
        isOfficial: template.isOfficial,
        organizationId: template.organizationId,
        createdBy: template.createdBy,
        createdAt: template.createdAt,
        updatedAt: template.updatedAt,
    };
}
function parseJsonArray(json) {
    try {
        const parsed = JSON.parse(json);
        return Array.isArray(parsed) ? parsed : [];
    }
    catch {
        return [];
    }
}
function parseJsonObject(json) {
    try {
        return JSON.parse(json);
    }
    catch {
        return {};
    }
}
//# sourceMappingURL=templateService.js.map