"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
const templates = [
    {
        documentType: 'nda',
        name: 'Non-Disclosure Agreement (NDA)',
        description: 'A mutual or one-way agreement to protect confidential information shared between parties.',
        jurisdiction: 'US',
        placeholders: [
            {
                id: 'DISCLOSING_PARTY_NAME',
                displayName: 'Disclosing Party Name',
                description: 'Full legal name of the party sharing confidential information',
                type: 'text',
                required: true,
                group: 'Parties',
                validation: { minLength: 2, maxLength: 200 },
            },
            {
                id: 'DISCLOSING_PARTY_ADDRESS',
                displayName: 'Disclosing Party Address',
                description: 'Full address of the disclosing party',
                type: 'address',
                required: true,
                group: 'Parties',
            },
            {
                id: 'RECEIVING_PARTY_NAME',
                displayName: 'Receiving Party Name',
                description: 'Full legal name of the party receiving confidential information',
                type: 'text',
                required: true,
                group: 'Parties',
                validation: { minLength: 2, maxLength: 200 },
            },
            {
                id: 'RECEIVING_PARTY_ADDRESS',
                displayName: 'Receiving Party Address',
                description: 'Full address of the receiving party',
                type: 'address',
                required: true,
                group: 'Parties',
            },
            {
                id: 'EFFECTIVE_DATE',
                displayName: 'Effective Date',
                description: 'Date when the agreement becomes effective',
                type: 'date',
                required: true,
                group: 'Agreement Details',
            },
            {
                id: 'NDA_TYPE',
                displayName: 'NDA Type',
                description: 'Whether this is a mutual or one-way NDA',
                type: 'select',
                required: true,
                group: 'Agreement Details',
                options: [
                    { value: 'mutual', label: 'Mutual (Both parties share information)' },
                    { value: 'one-way', label: 'One-Way (Only disclosing party shares)' },
                ],
            },
            {
                id: 'PURPOSE',
                displayName: 'Purpose of Disclosure',
                description: 'Brief description of why confidential information is being shared',
                type: 'text',
                required: true,
                group: 'Agreement Details',
                validation: { minLength: 10, maxLength: 500 },
            },
            {
                id: 'CONFIDENTIALITY_PERIOD',
                displayName: 'Confidentiality Period',
                description: 'How long the confidentiality obligation lasts',
                type: 'select',
                required: true,
                group: 'Terms',
                options: [
                    { value: '1_year', label: '1 Year' },
                    { value: '2_years', label: '2 Years' },
                    { value: '3_years', label: '3 Years' },
                    { value: '5_years', label: '5 Years' },
                    { value: 'perpetual', label: 'Perpetual (No expiration)' },
                ],
            },
            {
                id: 'GOVERNING_STATE',
                displayName: 'Governing State',
                description: 'State whose laws will govern the agreement',
                type: 'text',
                required: true,
                group: 'Legal',
                validation: { minLength: 2, maxLength: 50 },
            },
        ],
        sections: [
            {
                id: 'recitals',
                title: 'Recitals',
                type: 'fixed',
                order: 1,
                baseContent: `WHEREAS, {{DISCLOSING_PARTY_NAME}} ("Disclosing Party") possesses certain confidential and proprietary information;

WHEREAS, {{RECEIVING_PARTY_NAME}} ("Receiving Party") desires to receive such information for the purpose of {{PURPOSE}};

WHEREAS, the parties wish to protect the confidentiality of such information under the terms set forth herein;

NOW, THEREFORE, in consideration of the mutual covenants and agreements contained herein, the parties agree as follows:`,
                includeByDefault: true,
                requiredPlaceholders: ['DISCLOSING_PARTY_NAME', 'RECEIVING_PARTY_NAME', 'PURPOSE'],
            },
            {
                id: 'definition',
                title: 'Definition of Confidential Information',
                type: 'customizable',
                order: 2,
                baseContent: `"Confidential Information" means any and all information, whether written, oral, electronic, visual, or in any other form, that is disclosed by the Disclosing Party to the Receiving Party, including but not limited to:

(a) Trade secrets, inventions, ideas, processes, computer programs, and technical data;
(b) Business information, including customer lists, pricing, marketing plans, and financial data;
(c) Any information marked as "Confidential" or that would reasonably be understood to be confidential.

Confidential Information does not include information that:
(i) Is or becomes publicly available through no fault of the Receiving Party;
(ii) Was rightfully in the Receiving Party's possession before disclosure;
(iii) Is independently developed by the Receiving Party without use of Confidential Information;
(iv) Is rightfully obtained from a third party without restriction on disclosure.`,
                customizationPrompt: 'Customize the definition of confidential information based on the purpose and industry. Add specific categories relevant to the disclosed information.',
                includeByDefault: true,
                legalNotes: [
                    'Definition should be specific enough to be enforceable but broad enough to cover intended disclosures',
                    'Exclusions are standard and help ensure enforceability',
                ],
            },
            {
                id: 'obligations',
                title: 'Obligations of Receiving Party',
                type: 'customizable',
                order: 3,
                baseContent: `The Receiving Party agrees to:

(a) Hold and maintain the Confidential Information in strict confidence;
(b) Not disclose the Confidential Information to any third parties without prior written consent;
(c) Use the Confidential Information solely for the Purpose stated herein;
(d) Protect the Confidential Information using at least the same degree of care as it uses to protect its own confidential information, but no less than reasonable care;
(e) Limit access to the Confidential Information to employees and contractors who have a need to know and who are bound by confidentiality obligations at least as restrictive as those contained herein;
(f) Promptly notify the Disclosing Party of any unauthorized disclosure or use of the Confidential Information.`,
                customizationPrompt: 'Adjust obligations based on the sensitivity of information and business relationship. Consider adding specific security requirements if needed.',
                includeByDefault: true,
                legalNotes: [
                    'The "reasonable care" standard is commonly used but parties may negotiate for "best efforts" or specific security measures',
                ],
            },
            {
                id: 'term',
                title: 'Term and Termination',
                type: 'fixed',
                order: 4,
                baseContent: `This Agreement shall commence on the Effective Date and shall continue for a period of {{CONFIDENTIALITY_PERIOD}} from the date of disclosure of any Confidential Information.

Either party may terminate this Agreement at any time by providing thirty (30) days written notice to the other party. However, the confidentiality obligations set forth herein shall survive termination and continue for the full duration specified above.

Upon termination or expiration of this Agreement, or upon request by the Disclosing Party, the Receiving Party shall promptly return or destroy all Confidential Information and any copies thereof.`,
                includeByDefault: true,
                requiredPlaceholders: ['CONFIDENTIALITY_PERIOD'],
            },
            {
                id: 'remedies',
                title: 'Remedies',
                type: 'fixed',
                order: 5,
                baseContent: `The Receiving Party acknowledges that any breach of this Agreement may cause irreparable harm to the Disclosing Party for which monetary damages may be inadequate. Accordingly, the Disclosing Party shall be entitled to seek equitable relief, including injunction and specific performance, in addition to all other remedies available at law or in equity.`,
                includeByDefault: true,
                legalNotes: [
                    'Injunctive relief language strengthens the agreement but actual relief depends on court discretion',
                ],
            },
            {
                id: 'governing_law',
                title: 'Governing Law',
                type: 'fixed',
                order: 6,
                baseContent: `This Agreement shall be governed by and construed in accordance with the laws of the State of {{GOVERNING_STATE}}, without regard to its conflict of laws principles.

Any dispute arising out of or relating to this Agreement shall be resolved in the state or federal courts located in {{GOVERNING_STATE}}, and each party consents to the exclusive jurisdiction of such courts.`,
                includeByDefault: true,
                requiredPlaceholders: ['GOVERNING_STATE'],
            },
            {
                id: 'signatures',
                title: 'Signatures',
                type: 'fixed',
                order: 7,
                baseContent: `IN WITNESS WHEREOF, the parties have executed this Non-Disclosure Agreement as of the Effective Date.


DISCLOSING PARTY:

{{DISCLOSING_PARTY_NAME}}

By: _________________________________
Name:
Title:
Date:


RECEIVING PARTY:

{{RECEIVING_PARTY_NAME}}

By: _________________________________
Name:
Title:
Date:`,
                includeByDefault: true,
                requiredPlaceholders: ['DISCLOSING_PARTY_NAME', 'RECEIVING_PARTY_NAME'],
            },
        ],
    },
    {
        documentType: 'contractor_agreement',
        name: 'Independent Contractor Agreement',
        description: 'Agreement for hiring an independent contractor to perform services.',
        jurisdiction: 'US',
        placeholders: [
            {
                id: 'CLIENT_NAME',
                displayName: 'Client Name',
                description: 'Full legal name of the company or individual hiring the contractor',
                type: 'text',
                required: true,
                group: 'Parties',
                validation: { minLength: 2, maxLength: 200 },
            },
            {
                id: 'CLIENT_ADDRESS',
                displayName: 'Client Address',
                description: 'Full address of the client',
                type: 'address',
                required: true,
                group: 'Parties',
            },
            {
                id: 'CONTRACTOR_NAME',
                displayName: 'Contractor Name',
                description: 'Full legal name of the independent contractor',
                type: 'text',
                required: true,
                group: 'Parties',
                validation: { minLength: 2, maxLength: 200 },
            },
            {
                id: 'CONTRACTOR_ADDRESS',
                displayName: 'Contractor Address',
                description: 'Full address of the contractor',
                type: 'address',
                required: true,
                group: 'Parties',
            },
            {
                id: 'EFFECTIVE_DATE',
                displayName: 'Effective Date',
                description: 'Date when the agreement becomes effective',
                type: 'date',
                required: true,
                group: 'Agreement Details',
            },
            {
                id: 'SERVICES_DESCRIPTION',
                displayName: 'Services Description',
                description: 'Detailed description of services to be provided',
                type: 'text',
                required: true,
                group: 'Scope of Work',
                validation: { minLength: 20, maxLength: 2000 },
            },
            {
                id: 'PAYMENT_AMOUNT',
                displayName: 'Payment Amount',
                description: 'Total payment or rate for services',
                type: 'currency',
                required: true,
                group: 'Payment',
            },
            {
                id: 'PAYMENT_SCHEDULE',
                displayName: 'Payment Schedule',
                description: 'How often payment will be made',
                type: 'select',
                required: true,
                group: 'Payment',
                options: [
                    { value: 'upon_completion', label: 'Upon Completion' },
                    { value: 'weekly', label: 'Weekly' },
                    { value: 'bi_weekly', label: 'Bi-Weekly' },
                    { value: 'monthly', label: 'Monthly' },
                    { value: 'milestone', label: 'Per Milestone' },
                ],
            },
            {
                id: 'TERM_END_DATE',
                displayName: 'Term End Date',
                description: 'Date when the agreement ends (if fixed term)',
                type: 'date',
                required: false,
                group: 'Term',
            },
            {
                id: 'NOTICE_PERIOD',
                displayName: 'Notice Period for Termination',
                description: 'Days of notice required to terminate',
                type: 'select',
                required: true,
                group: 'Term',
                options: [
                    { value: '7', label: '7 Days' },
                    { value: '14', label: '14 Days' },
                    { value: '30', label: '30 Days' },
                    { value: '60', label: '60 Days' },
                ],
            },
            {
                id: 'GOVERNING_STATE',
                displayName: 'Governing State',
                description: 'State whose laws will govern the agreement',
                type: 'text',
                required: true,
                group: 'Legal',
                validation: { minLength: 2, maxLength: 50 },
            },
        ],
        sections: [
            {
                id: 'recitals',
                title: 'Recitals',
                type: 'fixed',
                order: 1,
                baseContent: `This Independent Contractor Agreement ("Agreement") is entered into as of {{EFFECTIVE_DATE}} by and between:

{{CLIENT_NAME}} ("Client"), located at {{CLIENT_ADDRESS}}

and

{{CONTRACTOR_NAME}} ("Contractor"), located at {{CONTRACTOR_ADDRESS}}

WHEREAS, Client desires to engage Contractor to perform certain services; and

WHEREAS, Contractor represents that it has the skills, experience, and ability to perform such services;

NOW, THEREFORE, in consideration of the mutual covenants contained herein, the parties agree as follows:`,
                includeByDefault: true,
                requiredPlaceholders: ['CLIENT_NAME', 'CLIENT_ADDRESS', 'CONTRACTOR_NAME', 'CONTRACTOR_ADDRESS', 'EFFECTIVE_DATE'],
            },
            {
                id: 'services',
                title: 'Scope of Services',
                type: 'customizable',
                order: 2,
                baseContent: `Contractor agrees to provide the following services to Client:

{{SERVICES_DESCRIPTION}}

Contractor shall perform the Services in a professional and workmanlike manner, consistent with industry standards. Contractor shall devote sufficient time, attention, and resources to complete the Services as specified.

The manner and means by which Contractor performs the Services shall be determined by Contractor, subject to Client's reasonable requirements regarding deliverables and timelines.`,
                customizationPrompt: 'Expand the services description based on the project specifics. Include deliverables, milestones, and acceptance criteria where appropriate.',
                includeByDefault: true,
                requiredPlaceholders: ['SERVICES_DESCRIPTION'],
                legalNotes: [
                    'Be specific about deliverables to avoid disputes',
                    'The independence language helps establish contractor status',
                ],
            },
            {
                id: 'compensation',
                title: 'Compensation',
                type: 'fixed',
                order: 3,
                baseContent: `In consideration of the Services, Client shall pay Contractor:

Amount: {{PAYMENT_AMOUNT}}
Payment Schedule: {{PAYMENT_SCHEDULE}}

Contractor shall submit invoices in accordance with the payment schedule. Client shall pay all undisputed invoices within thirty (30) days of receipt.

Contractor is solely responsible for all taxes, including self-employment taxes, arising from payments under this Agreement. Client will not withhold any taxes from payments to Contractor.`,
                includeByDefault: true,
                requiredPlaceholders: ['PAYMENT_AMOUNT', 'PAYMENT_SCHEDULE'],
            },
            {
                id: 'independent_contractor',
                title: 'Independent Contractor Status',
                type: 'fixed',
                order: 4,
                baseContent: `Contractor is an independent contractor and not an employee, partner, or agent of Client. Nothing in this Agreement shall be construed to create an employment, partnership, or agency relationship.

Contractor shall:
(a) Determine its own hours, location, and methods of performing the Services;
(b) Provide its own equipment and supplies unless otherwise agreed;
(c) Be free to provide services to other clients;
(d) Not be entitled to employee benefits from Client.

Contractor acknowledges that it is not eligible for unemployment insurance, workers' compensation, or other employee benefits from Client.`,
                includeByDefault: true,
                legalNotes: [
                    'This section is critical for establishing contractor status',
                    'Actual practice must match this language to avoid misclassification risk',
                ],
            },
            {
                id: 'intellectual_property',
                title: 'Intellectual Property',
                type: 'customizable',
                order: 5,
                baseContent: `All work product, deliverables, inventions, and materials created by Contractor in the performance of the Services ("Work Product") shall be the sole and exclusive property of Client.

Contractor hereby assigns to Client all right, title, and interest in and to the Work Product, including all intellectual property rights therein. Contractor agrees to execute any documents and take any actions necessary to perfect Client's ownership.

Contractor retains ownership of any pre-existing intellectual property that Contractor uses in performing the Services ("Contractor IP"). Contractor grants Client a non-exclusive, perpetual, royalty-free license to use any Contractor IP incorporated into the Work Product.`,
                customizationPrompt: 'Adjust IP terms based on the nature of the work. For creative work, consider moral rights. For software, consider open source components.',
                includeByDefault: true,
                legalNotes: [
                    'Work-for-hire rules vary by jurisdiction and type of work',
                    'Assignment language provides broader protection than work-for-hire alone',
                ],
            },
            {
                id: 'confidentiality',
                title: 'Confidentiality',
                type: 'fixed',
                order: 6,
                baseContent: `Contractor agrees to hold in confidence all non-public information disclosed by Client during the term of this Agreement ("Confidential Information").

Contractor shall:
(a) Use Confidential Information only as necessary to perform the Services;
(b) Not disclose Confidential Information to any third party without Client's written consent;
(c) Protect Confidential Information with reasonable care;
(d) Return or destroy all Confidential Information upon termination of this Agreement.

This obligation shall survive termination of this Agreement for a period of three (3) years.`,
                includeByDefault: true,
            },
            {
                id: 'term_termination',
                title: 'Term and Termination',
                type: 'fixed',
                order: 7,
                baseContent: `This Agreement shall commence on the Effective Date and continue until completion of the Services, unless earlier terminated.

Either party may terminate this Agreement:
(a) For convenience, upon {{NOTICE_PERIOD}} days written notice;
(b) Immediately, if the other party materially breaches this Agreement and fails to cure within ten (10) days of notice.

Upon termination:
(a) Client shall pay Contractor for all Services performed through the termination date;
(b) Contractor shall deliver all completed Work Product to Client;
(c) The confidentiality, IP, and indemnification provisions shall survive.`,
                includeByDefault: true,
                requiredPlaceholders: ['NOTICE_PERIOD'],
            },
            {
                id: 'indemnification',
                title: 'Indemnification',
                type: 'fixed',
                order: 8,
                baseContent: `Contractor shall indemnify, defend, and hold harmless Client from any claims, damages, or expenses arising from:
(a) Contractor's negligence or willful misconduct;
(b) Contractor's breach of this Agreement;
(c) Any claim that the Work Product infringes third-party intellectual property rights.

Client shall indemnify, defend, and hold harmless Contractor from any claims, damages, or expenses arising from Client's use of the Work Product in violation of applicable law.`,
                includeByDefault: true,
            },
            {
                id: 'governing_law',
                title: 'Governing Law',
                type: 'fixed',
                order: 9,
                baseContent: `This Agreement shall be governed by the laws of the State of {{GOVERNING_STATE}}, without regard to conflict of laws principles.

Any dispute arising under this Agreement shall be resolved in the courts of {{GOVERNING_STATE}}, and each party consents to the jurisdiction of such courts.`,
                includeByDefault: true,
                requiredPlaceholders: ['GOVERNING_STATE'],
            },
            {
                id: 'signatures',
                title: 'Signatures',
                type: 'fixed',
                order: 10,
                baseContent: `IN WITNESS WHEREOF, the parties have executed this Agreement as of the date first written above.


CLIENT:

{{CLIENT_NAME}}

By: _________________________________
Name:
Title:
Date:


CONTRACTOR:

{{CONTRACTOR_NAME}}

By: _________________________________
Name:
Title:
Date:`,
                includeByDefault: true,
                requiredPlaceholders: ['CLIENT_NAME', 'CONTRACTOR_NAME'],
            },
        ],
    },
    {
        documentType: 'service_agreement',
        name: 'Service Agreement',
        description: 'General agreement for the provision of professional services.',
        jurisdiction: 'US',
        placeholders: [
            {
                id: 'PROVIDER_NAME',
                displayName: 'Service Provider Name',
                description: 'Full legal name of the service provider',
                type: 'text',
                required: true,
                group: 'Parties',
                validation: { minLength: 2, maxLength: 200 },
            },
            {
                id: 'PROVIDER_ADDRESS',
                displayName: 'Provider Address',
                description: 'Full address of the service provider',
                type: 'address',
                required: true,
                group: 'Parties',
            },
            {
                id: 'PROVIDER_EMAIL',
                displayName: 'Provider Email',
                description: 'Contact email for the service provider',
                type: 'email',
                required: true,
                group: 'Parties',
            },
            {
                id: 'CLIENT_NAME',
                displayName: 'Client Name',
                description: 'Full legal name of the client',
                type: 'text',
                required: true,
                group: 'Parties',
                validation: { minLength: 2, maxLength: 200 },
            },
            {
                id: 'CLIENT_ADDRESS',
                displayName: 'Client Address',
                description: 'Full address of the client',
                type: 'address',
                required: true,
                group: 'Parties',
            },
            {
                id: 'CLIENT_EMAIL',
                displayName: 'Client Email',
                description: 'Contact email for the client',
                type: 'email',
                required: true,
                group: 'Parties',
            },
            {
                id: 'EFFECTIVE_DATE',
                displayName: 'Effective Date',
                description: 'Date when the agreement becomes effective',
                type: 'date',
                required: true,
                group: 'Agreement Details',
            },
            {
                id: 'SERVICES_DESCRIPTION',
                displayName: 'Services Description',
                description: 'Description of services to be provided',
                type: 'text',
                required: true,
                group: 'Services',
                validation: { minLength: 20, maxLength: 2000 },
            },
            {
                id: 'SERVICE_FEE',
                displayName: 'Service Fee',
                description: 'Total fee or rate for services',
                type: 'currency',
                required: true,
                group: 'Payment',
            },
            {
                id: 'PAYMENT_TERMS',
                displayName: 'Payment Terms',
                description: 'When payment is due',
                type: 'select',
                required: true,
                group: 'Payment',
                options: [
                    { value: 'advance', label: 'Payment in Advance' },
                    { value: 'completion', label: 'Upon Completion' },
                    { value: 'net_15', label: 'Net 15 Days' },
                    { value: 'net_30', label: 'Net 30 Days' },
                    { value: '50_50', label: '50% Upfront, 50% on Completion' },
                ],
            },
            {
                id: 'GOVERNING_STATE',
                displayName: 'Governing State',
                description: 'State whose laws will govern the agreement',
                type: 'text',
                required: true,
                group: 'Legal',
                validation: { minLength: 2, maxLength: 50 },
            },
        ],
        sections: [
            {
                id: 'introduction',
                title: 'Introduction',
                type: 'fixed',
                order: 1,
                baseContent: `SERVICE AGREEMENT

This Service Agreement ("Agreement") is entered into as of {{EFFECTIVE_DATE}} by and between:

Provider: {{PROVIDER_NAME}}
Address: {{PROVIDER_ADDRESS}}
Email: {{PROVIDER_EMAIL}}

Client: {{CLIENT_NAME}}
Address: {{CLIENT_ADDRESS}}
Email: {{CLIENT_EMAIL}}`,
                includeByDefault: true,
                requiredPlaceholders: ['EFFECTIVE_DATE', 'PROVIDER_NAME', 'PROVIDER_ADDRESS', 'PROVIDER_EMAIL', 'CLIENT_NAME', 'CLIENT_ADDRESS', 'CLIENT_EMAIL'],
            },
            {
                id: 'services',
                title: 'Services',
                type: 'customizable',
                order: 2,
                baseContent: `1. SERVICES

Provider agrees to provide the following services to Client:

{{SERVICES_DESCRIPTION}}

Provider shall perform all services in a professional manner consistent with industry standards. Provider shall dedicate sufficient time and resources to complete the services as described.`,
                customizationPrompt: 'Expand the services section based on the specific services being provided. Include any deliverables, timelines, or milestones.',
                includeByDefault: true,
                requiredPlaceholders: ['SERVICES_DESCRIPTION'],
            },
            {
                id: 'compensation',
                title: 'Compensation',
                type: 'fixed',
                order: 3,
                baseContent: `2. COMPENSATION

Client agrees to pay Provider:

Service Fee: {{SERVICE_FEE}}
Payment Terms: {{PAYMENT_TERMS}}

Additional expenses must be pre-approved by Client in writing. Late payments shall accrue interest at the rate of 1.5% per month or the maximum rate permitted by law, whichever is less.`,
                includeByDefault: true,
                requiredPlaceholders: ['SERVICE_FEE', 'PAYMENT_TERMS'],
            },
            {
                id: 'term',
                title: 'Term and Termination',
                type: 'fixed',
                order: 4,
                baseContent: `3. TERM AND TERMINATION

This Agreement begins on the Effective Date and continues until the services are completed, unless terminated earlier.

Either party may terminate this Agreement:
- With 14 days written notice for any reason
- Immediately if the other party materially breaches and fails to cure within 7 days

Upon termination, Client shall pay for all services completed through the termination date.`,
                includeByDefault: true,
            },
            {
                id: 'warranties',
                title: 'Warranties and Liability',
                type: 'fixed',
                order: 5,
                baseContent: `4. WARRANTIES AND LIABILITY

Provider warrants that services will be performed in a professional manner.

EXCEPT AS EXPRESSLY STATED, PROVIDER MAKES NO WARRANTIES, EXPRESS OR IMPLIED.

Provider's total liability under this Agreement shall not exceed the total fees paid by Client. Neither party shall be liable for indirect, incidental, or consequential damages.`,
                includeByDefault: true,
                legalNotes: [
                    'Limitation of liability clauses may not be enforceable in all situations',
                    'Consumer protection laws may override these provisions for consumer clients',
                ],
            },
            {
                id: 'general',
                title: 'General Provisions',
                type: 'fixed',
                order: 6,
                baseContent: `5. GENERAL PROVISIONS

Governing Law: This Agreement shall be governed by the laws of {{GOVERNING_STATE}}.

Entire Agreement: This Agreement constitutes the entire agreement between the parties.

Amendments: This Agreement may only be amended in writing signed by both parties.

Severability: If any provision is found invalid, the remaining provisions shall remain in effect.

Notices: All notices shall be in writing and sent to the addresses above.`,
                includeByDefault: true,
                requiredPlaceholders: ['GOVERNING_STATE'],
            },
            {
                id: 'signatures',
                title: 'Signatures',
                type: 'fixed',
                order: 7,
                baseContent: `IN WITNESS WHEREOF, the parties have executed this Agreement as of the Effective Date.


PROVIDER:

{{PROVIDER_NAME}}

Signature: _________________________________
Date:


CLIENT:

{{CLIENT_NAME}}

Signature: _________________________________
Date:`,
                includeByDefault: true,
                requiredPlaceholders: ['PROVIDER_NAME', 'CLIENT_NAME'],
            },
        ],
    },
];
async function seedDocumentTemplates() {
    console.log('🌱 Starting document templates seed...\n');
    try {
        console.log('🗑️  Clearing existing template data...');
        await prisma.documentDraftSession.deleteMany({});
        await prisma.documentTemplateVariant.deleteMany({});
        await prisma.documentTemplate.deleteMany({});
        console.log('✅ Cleared existing data\n');
        for (const templateData of templates) {
            console.log(`📄 Creating: ${templateData.name}`);
            console.log(`   Type: ${templateData.documentType}`);
            console.log(`   Jurisdiction: ${templateData.jurisdiction}`);
            console.log(`   Sections: ${templateData.sections.length}`);
            console.log(`   Placeholders: ${templateData.placeholders.length}`);
            const template = await prisma.documentTemplate.create({
                data: {
                    documentType: templateData.documentType,
                    name: templateData.name,
                    description: templateData.description,
                    jurisdiction: templateData.jurisdiction,
                    sections: JSON.stringify(templateData.sections),
                    placeholders: JSON.stringify(templateData.placeholders),
                    isActive: true,
                    isOfficial: true,
                    version: 1,
                },
            });
            console.log(`✅ Created template: ${template.id}\n`);
        }
        const totalTemplates = await prisma.documentTemplate.count();
        console.log('═══════════════════════════════════════');
        console.log('🎉 Seed completed successfully!');
        console.log('═══════════════════════════════════════');
        console.log(`📄 Total templates: ${totalTemplates}`);
        console.log('═══════════════════════════════════════\n');
        const byType = await prisma.documentTemplate.groupBy({
            by: ['documentType'],
            _count: true,
        });
        console.log('📊 Breakdown by document type:');
        for (const item of byType) {
            console.log(`   ${item.documentType}: ${item._count} template(s)`);
        }
        console.log('');
    }
    catch (error) {
        console.error('❌ Error seeding document templates:', error);
        throw error;
    }
    finally {
        await prisma.$disconnect();
    }
}
seedDocumentTemplates()
    .catch((error) => {
    console.error(error);
    process.exit(1);
});
//# sourceMappingURL=seedDocumentTemplates.js.map