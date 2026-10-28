"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.businessBundles = void 0;
exports.getBusinessBundle = getBusinessBundle;
exports.getRecommendedBundles = getRecommendedBundles;
exports.businessBundles = [
    {
        id: 'freelancer-starter',
        name: 'Freelancer Starter Kit',
        tagline: 'Everything you need to start freelancing professionally',
        description: 'Complete legal foundation for solo freelancers and contractors. Protect yourself, get paid, and work confidently.',
        icon: '🚀',
        targetAudience: 'Solo freelancers, contractors, consultants',
        price: 'One-time setup',
        popular: true,
        included: [
            {
                id: 'service-agreement',
                name: 'Service Agreement Template',
                description: 'Professional contract for your client work',
                category: 'Contract',
                estimatedTime: '15 min',
            },
            {
                id: 'invoice-template',
                name: 'Invoice Template',
                description: 'Clear, professional invoices with payment terms',
                category: 'Financial',
                estimatedTime: '5 min',
            },
            {
                id: 'nda',
                name: 'Non-Disclosure Agreement',
                description: 'Protect confidential client information',
                category: 'Protection',
                estimatedTime: '10 min',
            },
            {
                id: 'late-payment-letter',
                name: 'Late Payment Reminder',
                description: 'Professional follow-up for overdue invoices',
                category: 'Financial',
                estimatedTime: '5 min',
            },
            {
                id: 'scope-change-request',
                name: 'Scope Change Request Form',
                description: 'Document additional work and costs',
                category: 'Project Management',
                estimatedTime: '5 min',
            },
        ],
        bonusFeatures: [
            'Legal Calendar for tracking payment deadlines',
            'Rights & Obligations summary for each document',
            'Micro-Learning: "Freelancer Legal Basics"',
        ],
    },
    {
        id: 'online-store-basics',
        name: 'Online Store Essentials',
        tagline: 'Legal foundation for e-commerce',
        description: 'Protect your online business with essential legal documents and policies.',
        icon: '🛒',
        targetAudience: 'E-commerce stores, online sellers',
        price: 'One-time setup',
        included: [
            {
                id: 'terms-conditions',
                name: 'Terms & Conditions',
                description: 'Website terms for your online store',
                category: 'Policy',
                estimatedTime: '20 min',
            },
            {
                id: 'privacy-policy',
                name: 'Privacy Policy',
                description: 'GDPR-compliant privacy policy',
                category: 'Policy',
                estimatedTime: '15 min',
            },
            {
                id: 'return-policy',
                name: 'Return & Refund Policy',
                description: 'Clear customer return guidelines',
                category: 'Policy',
                estimatedTime: '10 min',
            },
            {
                id: 'shipping-policy',
                name: 'Shipping Policy',
                description: 'Delivery terms and responsibilities',
                category: 'Policy',
                estimatedTime: '10 min',
            },
            {
                id: 'cookie-notice',
                name: 'Cookie Notice',
                description: 'EU-compliant cookie consent',
                category: 'Policy',
                estimatedTime: '5 min',
            },
        ],
        bonusFeatures: [
            'Document Health Check for all policies',
            'Consumer rights compliance checker',
            'Micro-Learning: "E-commerce Legal Basics"',
        ],
    },
    {
        id: 'contractor-pro',
        name: 'Contractor Professional Pack',
        tagline: 'Comprehensive protection for contractors',
        description: 'Full suite of documents for professional contractors and service providers.',
        icon: '💼',
        targetAudience: 'Contractors, service providers, agencies',
        price: 'Professional package',
        included: [
            {
                id: 'master-service-agreement',
                name: 'Master Service Agreement',
                description: 'Comprehensive contract template',
                category: 'Contract',
                estimatedTime: '25 min',
            },
            {
                id: 'statement-of-work',
                name: 'Statement of Work Template',
                description: 'Define specific project scope',
                category: 'Project',
                estimatedTime: '15 min',
            },
            {
                id: 'liability-waiver',
                name: 'Liability Waiver',
                description: 'Limit your legal exposure',
                category: 'Protection',
                estimatedTime: '15 min',
            },
            {
                id: 'ip-assignment',
                name: 'Intellectual Property Assignment',
                description: 'Transfer IP rights to clients',
                category: 'IP',
                estimatedTime: '10 min',
            },
            {
                id: 'contractor-agreement',
                name: 'Subcontractor Agreement',
                description: 'Hire help while protecting yourself',
                category: 'Contract',
                estimatedTime: '20 min',
            },
            {
                id: 'project-closure',
                name: 'Project Completion Certificate',
                description: 'Formal project signoff',
                category: 'Project',
                estimatedTime: '5 min',
            },
        ],
        bonusFeatures: [
            'Deadline extraction for all contracts',
            'Rights & Obligations breakdown',
            'Risk assessment for each document',
            'Micro-Learning: "Contractor Legal Mastery"',
        ],
    },
    {
        id: 'startup-foundation',
        name: 'Startup Foundation Kit',
        tagline: 'Legal basics for new businesses',
        description: 'Essential documents for launching and running a startup.',
        icon: '🌱',
        targetAudience: 'Startups, new businesses, founders',
        price: 'Startup special',
        included: [
            {
                id: 'co-founder-agreement',
                name: 'Co-Founder Agreement',
                description: 'Define roles, equity, and responsibilities',
                category: 'Founding',
                estimatedTime: '30 min',
            },
            {
                id: 'employee-contract',
                name: 'Employment Contract Template',
                description: 'Standard employment agreements',
                category: 'HR',
                estimatedTime: '20 min',
            },
            {
                id: 'advisor-agreement',
                name: 'Advisor Agreement',
                description: 'Formalize advisor relationships',
                category: 'Business',
                estimatedTime: '15 min',
            },
            {
                id: 'vendor-agreement',
                name: 'Vendor Agreement',
                description: 'Contracts with suppliers',
                category: 'Business',
                estimatedTime: '15 min',
            },
            {
                id: 'confidentiality',
                name: 'Employee Confidentiality Agreement',
                description: 'Protect company secrets',
                category: 'Protection',
                estimatedTime: '10 min',
            },
        ],
        bonusFeatures: [
            'Startup-specific legal calendar',
            'Compliance checklist',
            'Micro-Learning: "Startup Legal Fundamentals"',
        ],
    },
    {
        id: 'property-landlord',
        name: 'Landlord Essentials',
        tagline: 'For property owners and landlords',
        description: 'Manage your rental properties with proper legal documentation.',
        icon: '🏠',
        targetAudience: 'Landlords, property managers',
        price: 'Property owner package',
        included: [
            {
                id: 'rental-agreement',
                name: 'Rental Agreement Template',
                description: 'Comprehensive tenant contract',
                category: 'Property',
                estimatedTime: '25 min',
            },
            {
                id: 'move-in-checklist',
                name: 'Move-In Condition Report',
                description: 'Document property condition',
                category: 'Property',
                estimatedTime: '10 min',
            },
            {
                id: 'late-rent-notice',
                name: 'Late Rent Notice',
                description: 'Professional rent reminder',
                category: 'Property',
                estimatedTime: '5 min',
            },
            {
                id: 'lease-termination',
                name: 'Lease Termination Notice',
                description: 'End tenancy properly',
                category: 'Property',
                estimatedTime: '10 min',
            },
            {
                id: 'maintenance-request',
                name: 'Maintenance Request Form',
                description: 'Track repair requests',
                category: 'Property',
                estimatedTime: '5 min',
            },
        ],
        bonusFeatures: [
            'Rental law compliance checker',
            'Deadline tracking for lease renewals',
            'Micro-Learning: "Landlord Rights & Responsibilities"',
        ],
    },
];
function getBusinessBundle(id) {
    return exports.businessBundles.find(bundle => bundle.id === id);
}
function getRecommendedBundles(userType) {
    const recommendations = {
        freelancer: ['freelancer-starter', 'contractor-pro'],
        'online-seller': ['online-store-basics'],
        startup: ['startup-foundation', 'contractor-pro'],
        landlord: ['property-landlord'],
        contractor: ['contractor-pro', 'freelancer-starter'],
    };
    const bundleIds = recommendations[userType.toLowerCase()] || [];
    return bundleIds
        .map(id => getBusinessBundle(id))
        .filter((b) => b !== undefined);
}
//# sourceMappingURL=businessBundles.js.map