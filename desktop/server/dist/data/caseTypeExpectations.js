"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CASE_TYPE_EXPECTATIONS = void 0;
exports.getCaseTypeExpectation = getCaseTypeExpectation;
exports.getAllCaseTypes = getAllCaseTypes;
exports.matchesExpectedDocument = matchesExpectedDocument;
exports.CASE_TYPE_EXPECTATIONS = {
    mediation: {
        type: 'mediation',
        label: 'Mediation',
        description: 'Alternative dispute resolution through a neutral mediator',
        expectedDocuments: [
            {
                name: 'Mediation Agreement',
                importance: 'critical',
                description: 'Agreement to mediate with terms and conditions',
                keywords: ['mediation agreement', 'mediation terms', 'adr agreement'],
            },
            {
                name: 'Position Statement',
                importance: 'critical',
                description: 'Summary of your position and key issues',
                keywords: ['position statement', 'position paper', 'opening statement'],
            },
            {
                name: 'Supporting Evidence',
                importance: 'recommended',
                description: 'Documents supporting your position',
                keywords: ['evidence', 'exhibit', 'supporting document'],
            },
            {
                name: 'Confidentiality Agreement',
                importance: 'recommended',
                description: 'NDA for mediation proceedings',
                keywords: ['confidentiality', 'nda', 'non-disclosure'],
            },
            {
                name: 'Settlement Proposal',
                importance: 'optional',
                description: 'Draft settlement terms if applicable',
                keywords: ['settlement', 'proposal', 'offer'],
            },
        ],
        typicalTimeline: '1-3 months',
        riskFactors: ['confidentiality breaches', 'power imbalance', 'incomplete disclosure'],
    },
    trial: {
        type: 'trial',
        label: 'Trial',
        description: 'Formal court litigation proceedings',
        expectedDocuments: [
            {
                name: 'Complaint/Petition',
                importance: 'critical',
                description: 'Initial pleading filed to start the case',
                keywords: ['complaint', 'petition', 'pleading', 'filing'],
            },
            {
                name: 'Answer/Response',
                importance: 'critical',
                description: 'Response to complaint or petition',
                keywords: ['answer', 'response', 'defense', 'reply'],
            },
            {
                name: 'Discovery Documents',
                importance: 'critical',
                description: 'Interrogatories, depositions, document requests',
                keywords: ['discovery', 'interrogatory', 'deposition', 'subpoena'],
            },
            {
                name: 'Evidence/Exhibits',
                importance: 'critical',
                description: 'All evidence to be presented at trial',
                keywords: ['evidence', 'exhibit', 'proof', 'documentation'],
            },
            {
                name: 'Motion Filings',
                importance: 'recommended',
                description: 'Summary judgment, dismiss, or other motions',
                keywords: ['motion', 'summary judgment', 'dismiss', 'filing'],
            },
            {
                name: 'Witness Statements',
                importance: 'recommended',
                description: 'Statements from witnesses or experts',
                keywords: ['witness', 'statement', 'affidavit', 'testimony'],
            },
            {
                name: 'Expert Reports',
                importance: 'optional',
                description: 'Reports from expert witnesses',
                keywords: ['expert', 'report', 'opinion', 'specialist'],
            },
        ],
        typicalTimeline: '6-18 months',
        riskFactors: ['missed deadlines', 'incomplete discovery', 'evidence admissibility', 'witness credibility'],
    },
    consulting: {
        type: 'consulting',
        label: 'Consulting',
        description: 'Legal advisory and consultation services',
        expectedDocuments: [
            {
                name: 'Engagement Letter',
                importance: 'critical',
                description: 'Terms of legal engagement and scope',
                keywords: ['engagement', 'retainer', 'scope', 'terms of service'],
            },
            {
                name: 'Client Information',
                importance: 'critical',
                description: 'Background information about the client',
                keywords: ['client', 'background', 'information', 'profile'],
            },
            {
                name: 'Issue Summary',
                importance: 'recommended',
                description: 'Summary of legal issues being consulted on',
                keywords: ['issue', 'summary', 'question', 'matter'],
            },
            {
                name: 'Relevant Contracts',
                importance: 'recommended',
                description: 'Contracts relevant to the consultation',
                keywords: ['contract', 'agreement', 'document'],
            },
            {
                name: 'Legal Memo',
                importance: 'optional',
                description: 'Written legal analysis or opinion',
                keywords: ['memo', 'memorandum', 'analysis', 'opinion'],
            },
        ],
        typicalTimeline: '1-4 weeks',
        riskFactors: ['scope creep', 'unclear objectives', 'missing background information'],
    },
    negotiation: {
        type: 'negotiation',
        label: 'Negotiation',
        description: 'Contract or deal negotiation between parties',
        expectedDocuments: [
            {
                name: 'Draft Agreement',
                importance: 'critical',
                description: 'The contract or agreement being negotiated',
                keywords: ['draft', 'agreement', 'contract', 'proposed'],
            },
            {
                name: 'Term Sheet',
                importance: 'recommended',
                description: 'Summary of key terms being negotiated',
                keywords: ['term sheet', 'terms', 'summary', 'key points'],
            },
            {
                name: 'Redline/Markup',
                importance: 'recommended',
                description: 'Track changes showing negotiation progress',
                keywords: ['redline', 'markup', 'track changes', 'revision'],
            },
            {
                name: 'Counterparty Information',
                importance: 'recommended',
                description: 'Information about the other party',
                keywords: ['counterparty', 'other party', 'vendor', 'partner'],
            },
            {
                name: 'Previous Correspondence',
                importance: 'optional',
                description: 'Email or letter exchanges about terms',
                keywords: ['correspondence', 'email', 'letter', 'communication'],
            },
        ],
        typicalTimeline: '2-8 weeks',
        riskFactors: ['unclear authority', 'undisclosed terms', 'power imbalance', 'deadline pressure'],
    },
    subpoena: {
        type: 'subpoena',
        label: 'Subpoena',
        description: 'Response to or issuance of legal subpoenas',
        expectedDocuments: [
            {
                name: 'Subpoena Document',
                importance: 'critical',
                description: 'The subpoena itself with all requirements',
                keywords: ['subpoena', 'summons', 'court order'],
            },
            {
                name: 'Response/Objection',
                importance: 'critical',
                description: 'Formal response or objection to subpoena',
                keywords: ['response', 'objection', 'motion to quash'],
            },
            {
                name: 'Responsive Documents',
                importance: 'recommended',
                description: 'Documents being produced in response',
                keywords: ['production', 'responsive', 'documents', 'records'],
            },
            {
                name: 'Privilege Log',
                importance: 'recommended',
                description: 'Log of withheld privileged documents',
                keywords: ['privilege', 'log', 'withheld', 'protected'],
            },
            {
                name: 'Protective Order',
                importance: 'optional',
                description: 'Order protecting sensitive information',
                keywords: ['protective order', 'confidential', 'seal'],
            },
        ],
        typicalTimeline: '2-4 weeks',
        riskFactors: ['missed deadlines', 'privilege waiver', 'incomplete production', 'sanctions risk'],
    },
    'contract-drafting': {
        type: 'contract-drafting',
        label: 'Contract Drafting',
        description: 'Creation and drafting of legal contracts',
        expectedDocuments: [
            {
                name: 'Draft Contract',
                importance: 'critical',
                description: 'The contract being drafted',
                keywords: ['draft', 'contract', 'agreement'],
            },
            {
                name: 'Requirements Document',
                importance: 'critical',
                description: 'Client requirements and objectives',
                keywords: ['requirements', 'specifications', 'objectives', 'brief'],
            },
            {
                name: 'Template/Precedent',
                importance: 'recommended',
                description: 'Template or precedent being used',
                keywords: ['template', 'precedent', 'form', 'standard'],
            },
            {
                name: 'Party Information',
                importance: 'recommended',
                description: 'Details about all parties to the contract',
                keywords: ['party', 'parties', 'entity', 'corporation'],
            },
            {
                name: 'Supporting Schedules',
                importance: 'optional',
                description: 'Exhibits, schedules, or annexures',
                keywords: ['schedule', 'exhibit', 'annex', 'appendix'],
            },
        ],
        typicalTimeline: '1-4 weeks',
        riskFactors: ['ambiguous terms', 'missing clauses', 'inconsistent definitions', 'regulatory compliance'],
    },
    research: {
        type: 'research',
        label: 'Legal Research',
        description: 'In-depth legal research and analysis',
        expectedDocuments: [
            {
                name: 'Research Question',
                importance: 'critical',
                description: 'Clear statement of research objectives',
                keywords: ['question', 'issue', 'research', 'inquiry'],
            },
            {
                name: 'Research Memo',
                importance: 'critical',
                description: 'Written research findings and analysis',
                keywords: ['memo', 'memorandum', 'research', 'findings'],
            },
            {
                name: 'Case Law',
                importance: 'recommended',
                description: 'Relevant case law and precedents',
                keywords: ['case', 'precedent', 'ruling', 'decision'],
            },
            {
                name: 'Statutory References',
                importance: 'recommended',
                description: 'Relevant statutes and regulations',
                keywords: ['statute', 'regulation', 'code', 'law'],
            },
            {
                name: 'Secondary Sources',
                importance: 'optional',
                description: 'Treatises, articles, and commentary',
                keywords: ['article', 'treatise', 'commentary', 'journal'],
            },
        ],
        typicalTimeline: '1-3 weeks',
        riskFactors: ['outdated research', 'missing jurisdiction', 'incomplete analysis', 'bias in sources'],
    },
    other: {
        type: 'other',
        label: 'Other',
        description: 'General or miscellaneous legal matters',
        expectedDocuments: [
            {
                name: 'Matter Description',
                importance: 'recommended',
                description: 'Description of the legal matter',
                keywords: ['description', 'summary', 'overview', 'matter'],
            },
            {
                name: 'Relevant Documents',
                importance: 'recommended',
                description: 'Any relevant supporting documents',
                keywords: ['document', 'file', 'record'],
            },
            {
                name: 'Client Notes',
                importance: 'optional',
                description: 'Notes from client meetings or calls',
                keywords: ['note', 'meeting', 'call', 'memo'],
            },
        ],
        typicalTimeline: 'Varies',
        riskFactors: ['undefined scope', 'unclear objectives'],
    },
};
function getCaseTypeExpectation(caseType) {
    return exports.CASE_TYPE_EXPECTATIONS[caseType] || exports.CASE_TYPE_EXPECTATIONS.other;
}
function getAllCaseTypes() {
    return Object.values(exports.CASE_TYPE_EXPECTATIONS).map((exp) => ({
        type: exp.type,
        label: exp.label,
    }));
}
function matchesExpectedDocument(documentTitle, documentContent, expectedDoc) {
    const searchText = `${documentTitle} ${documentContent || ''}`.toLowerCase();
    return expectedDoc.keywords.some((keyword) => searchText.includes(keyword.toLowerCase()));
}
//# sourceMappingURL=caseTypeExpectations.js.map