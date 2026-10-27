"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ALL_MANDATORY_TERMS = void 0;
exports.getMandatoryTermsFor = getMandatoryTermsFor;
exports.getMandatoryTermsByClauseType = getMandatoryTermsByClauseType;
exports.getStrictlyMandatoryTerms = getStrictlyMandatoryTerms;
exports.buildSearchQuery = buildSearchQuery;
exports.detectJurisdiction = detectJurisdiction;
exports.detectJurisdictionQuick = detectJurisdictionQuick;
exports.validateJurisdictionMatch = validateJurisdictionMatch;
exports.getJurisdictionName = getJurisdictionName;
exports.extractGoverningLawClause = extractGoverningLawClause;
exports.autoDetectJurisdictionForCreation = autoDetectJurisdictionForCreation;
const SK_TERMS = [
    {
        id: 'SK_SRO_CAPITAL',
        jurisdiction: 'SK',
        documentTypes: ['company_formation', 'articles_of_association', 'shareholder_agreement'],
        clauseType: 'share_capital',
        termType: 'minimum_capital',
        statuteRef: 'Obchodný zákonník § 108',
        description: 'Minimum share capital for s.r.o. is 5,000 EUR',
        requirement: 'mandatory',
        searchTerms: ['Obchodný zákonník', '§ 108', 'základné imanie', 'minimum share capital', 'sro'],
        validationRules: [
            { type: 'minimum', field: 'share_capital', value: 5000, unit: 'EUR', errorMessage: 'Share capital must be at least 5,000 EUR per § 108' }
        ],
        defaultText: 'Základné imanie spoločnosti je 5 000 EUR.',
    },
    {
        id: 'SK_SRO_CONTRIBUTION',
        jurisdiction: 'SK',
        documentTypes: ['company_formation', 'articles_of_association'],
        clauseType: 'share_contribution',
        termType: 'minimum_contribution',
        statuteRef: 'Obchodný zákonník § 109',
        description: 'Minimum contribution per shareholder is 750 EUR',
        requirement: 'mandatory',
        searchTerms: ['Obchodný zákonník', '§ 109', 'vklad', 'minimum contribution'],
        validationRules: [
            { type: 'minimum', field: 'contribution', value: 750, unit: 'EUR', errorMessage: 'Each contribution must be at least 750 EUR per § 109' }
        ],
    },
    {
        id: 'SK_SRO_REGISTERED_OFFICE',
        jurisdiction: 'SK',
        documentTypes: ['company_formation', 'articles_of_association'],
        clauseType: 'registered_office',
        termType: 'registered_office',
        statuteRef: 'Obchodný zákonník § 2',
        description: 'Company must have registered office in Slovakia',
        requirement: 'mandatory',
        searchTerms: ['Obchodný zákonník', '§ 2', 'sídlo', 'registered office'],
        validationRules: [
            { type: 'required', field: 'registered_office', errorMessage: 'Registered office address is required per § 2' }
        ],
    },
    {
        id: 'SK_SRO_DIRECTORS',
        jurisdiction: 'SK',
        documentTypes: ['company_formation', 'articles_of_association'],
        clauseType: 'management',
        termType: 'director_requirements',
        statuteRef: 'Obchodný zákonník § 133',
        description: 'Director must be natural person with full legal capacity',
        requirement: 'mandatory',
        searchTerms: ['Obchodný zákonník', '§ 133', 'konateľ', 'director', 'štatutárny orgán'],
        validationRules: [
            { type: 'required', field: 'director', errorMessage: 'At least one director must be appointed per § 133' }
        ],
    },
    {
        id: 'SK_SRO_BUSINESS_OBJECT',
        jurisdiction: 'SK',
        documentTypes: ['company_formation', 'articles_of_association'],
        clauseType: 'business_object',
        termType: 'predmet_podnikania',
        statuteRef: 'Obchodný zákonník § 110',
        description: 'Articles must specify the business activities',
        requirement: 'mandatory',
        searchTerms: ['Obchodný zákonník', '§ 110', 'predmet podnikania', 'business activities'],
        validationRules: [
            { type: 'required', field: 'business_object', errorMessage: 'Business activities must be specified per § 110' }
        ],
    },
    {
        id: 'SK_EMPLOYMENT_WRITTEN',
        jurisdiction: 'SK',
        documentTypes: ['employment', 'employment_contract'],
        clauseType: 'form_requirements',
        termType: 'written_form',
        statuteRef: 'Zákonník práce § 42',
        description: 'Employment contract must be in writing',
        requirement: 'mandatory',
        searchTerms: ['Zákonník práce', '§ 42', 'písomná forma', 'written contract'],
        validationRules: [
            { type: 'required', field: 'written_form', errorMessage: 'Employment contract must be in writing per § 42' }
        ],
    },
    {
        id: 'SK_EMPLOYMENT_ESSENTIALS',
        jurisdiction: 'SK',
        documentTypes: ['employment', 'employment_contract'],
        clauseType: 'essential_terms',
        termType: 'mandatory_content',
        statuteRef: 'Zákonník práce § 43',
        description: 'Contract must contain: job type, place of work, start date, salary',
        requirement: 'mandatory',
        searchTerms: ['Zákonník práce', '§ 43', 'podstatné náležitosti', 'essential terms'],
        validationRules: [
            { type: 'required', field: 'job_type', errorMessage: 'Job type must be specified per § 43' },
            { type: 'required', field: 'workplace', errorMessage: 'Place of work must be specified per § 43' },
            { type: 'required', field: 'start_date', errorMessage: 'Start date must be specified per § 43' },
            { type: 'required', field: 'salary', errorMessage: 'Salary must be specified per § 43' },
        ],
    },
    {
        id: 'SK_EMPLOYMENT_NOTICE',
        jurisdiction: 'SK',
        documentTypes: ['employment', 'employment_contract'],
        clauseType: 'termination',
        termType: 'notice_period',
        statuteRef: 'Zákonník práce § 62',
        description: 'Minimum notice period is 1 month',
        requirement: 'mandatory',
        searchTerms: ['Zákonník práce', '§ 62', 'výpovedná lehota', 'notice period'],
        validationRules: [
            { type: 'minimum', field: 'notice_period', value: 1, unit: 'months', errorMessage: 'Notice period must be at least 1 month per § 62' }
        ],
    },
];
const AT_TERMS = [
    {
        id: 'AT_GMBH_CAPITAL',
        jurisdiction: 'AT',
        documentTypes: ['company_formation', 'gesellschaftsvertrag', 'shareholder_agreement'],
        clauseType: 'share_capital',
        termType: 'stammkapital',
        statuteRef: 'GmbHG § 6',
        description: 'Minimum share capital (Stammkapital) is 35,000 EUR',
        requirement: 'mandatory',
        searchTerms: ['GmbHG', '§ 6', 'Stammkapital', 'Mindestkapital', 'minimum capital'],
        validationRules: [
            { type: 'minimum', field: 'share_capital', value: 35000, unit: 'EUR', errorMessage: 'Stammkapital must be at least 35,000 EUR per § 6 GmbHG' }
        ],
        defaultText: 'Das Stammkapital der Gesellschaft betragt EUR 35.000,00.',
    },
    {
        id: 'AT_GMBH_PRIVILEGED',
        jurisdiction: 'AT',
        documentTypes: ['company_formation', 'gesellschaftsvertrag'],
        clauseType: 'share_capital',
        termType: 'privileged_formation',
        statuteRef: 'GmbHG § 10b',
        description: 'Privileged formation allows 10,000 EUR minimum for 10 years',
        requirement: 'strongly_recommended',
        searchTerms: ['GmbHG', '§ 10b', 'Grundungsprivilegierung', 'privileged formation'],
        validationRules: [
            { type: 'minimum', field: 'share_capital', value: 10000, unit: 'EUR', errorMessage: 'Privileged formation requires at least 10,000 EUR' }
        ],
    },
    {
        id: 'AT_GMBH_ARTICLES',
        jurisdiction: 'AT',
        documentTypes: ['company_formation', 'gesellschaftsvertrag'],
        clauseType: 'form_requirements',
        termType: 'notarial_form',
        statuteRef: 'GmbHG § 4',
        description: 'Articles must be in notarial form',
        requirement: 'mandatory',
        searchTerms: ['GmbHG', '§ 4', 'Gesellschaftsvertrag', 'Notariatsakt', 'notarial'],
        validationRules: [
            { type: 'required', field: 'notarial_form', errorMessage: 'Articles require notarial form per § 4 GmbHG' }
        ],
    },
    {
        id: 'AT_MRG_TERMINATION',
        jurisdiction: 'AT',
        documentTypes: ['lease', 'rental_agreement', 'mietvertrag'],
        clauseType: 'termination',
        termType: 'tenant_protection',
        statuteRef: 'MRG § 30',
        description: 'Landlord can only terminate for specific reasons listed in § 30',
        requirement: 'mandatory',
        searchTerms: ['MRG', '§ 30', 'Kundigungsgrunde', 'Kundigungsbeschrankung', 'termination grounds'],
        validationRules: [
            { type: 'prohibited', field: 'termination_for_convenience', errorMessage: 'Termination for convenience is prohibited for landlords per § 30 MRG' }
        ],
    },
    {
        id: 'AT_MRG_RENT_INCREASE',
        jurisdiction: 'AT',
        documentTypes: ['lease', 'rental_agreement', 'mietvertrag'],
        clauseType: 'payment',
        termType: 'rent_increase_limit',
        statuteRef: 'MRG § 16',
        description: 'Rent increases are limited by the Richtwertmietzins',
        requirement: 'mandatory',
        searchTerms: ['MRG', '§ 16', 'Richtwertmietzins', 'Mietzinserhohung', 'rent increase'],
        validationRules: [
            { type: 'pattern', field: 'rent_increase', value: 'Richtwert|gesetzlich|index', errorMessage: 'Rent increase must comply with § 16 MRG limits' }
        ],
    },
    {
        id: 'AT_EMPLOYMENT_DIENSTZETTEL',
        jurisdiction: 'AT',
        documentTypes: ['employment', 'dienstvertrag'],
        clauseType: 'form_requirements',
        termType: 'dienstzettel',
        statuteRef: 'AVRAG § 2',
        description: 'Employer must provide written statement of employment terms',
        requirement: 'mandatory',
        searchTerms: ['AVRAG', '§ 2', 'Dienstzettel', 'employment terms'],
        validationRules: [
            { type: 'required', field: 'dienstzettel', errorMessage: 'Written employment terms (Dienstzettel) required per § 2 AVRAG' }
        ],
    },
];
const DE_TERMS = [
    {
        id: 'DE_GMBH_CAPITAL',
        jurisdiction: 'DE',
        documentTypes: ['company_formation', 'gesellschaftsvertrag', 'shareholder_agreement'],
        clauseType: 'share_capital',
        termType: 'stammkapital',
        statuteRef: 'GmbHG § 5',
        description: 'Minimum share capital is 25,000 EUR',
        requirement: 'mandatory',
        searchTerms: ['GmbHG', '§ 5', 'Stammkapital', 'Mindestkapital'],
        validationRules: [
            { type: 'minimum', field: 'share_capital', value: 25000, unit: 'EUR', errorMessage: 'Stammkapital must be at least 25,000 EUR per § 5 GmbHG' }
        ],
        defaultText: 'Das Stammkapital der Gesellschaft betragt EUR 25.000,00.',
    },
    {
        id: 'DE_GMBH_CONTRIBUTION',
        jurisdiction: 'DE',
        documentTypes: ['company_formation', 'gesellschaftsvertrag'],
        clauseType: 'share_contribution',
        termType: 'minimum_contribution',
        statuteRef: 'GmbHG § 5',
        description: 'Minimum contribution per share is 1 EUR',
        requirement: 'mandatory',
        searchTerms: ['GmbHG', '§ 5', 'Stammeinlage', 'contribution'],
        validationRules: [
            { type: 'minimum', field: 'contribution', value: 1, unit: 'EUR', errorMessage: 'Each contribution must be at least 1 EUR' }
        ],
    },
    {
        id: 'DE_EMPLOYMENT_NOTICE',
        jurisdiction: 'DE',
        documentTypes: ['employment', 'arbeitsvertrag'],
        clauseType: 'termination',
        termType: 'notice_period',
        statuteRef: 'BGB § 622',
        description: 'Minimum notice period is 4 weeks to 15th or end of month',
        requirement: 'mandatory',
        searchTerms: ['BGB', '§ 622', 'Kundigungsfrist', 'notice period'],
        validationRules: [
            { type: 'minimum', field: 'notice_period', value: 4, unit: 'weeks', errorMessage: 'Notice period must be at least 4 weeks per § 622 BGB' }
        ],
        defaultText: 'Die Kundigungsfrist betragt vier Wochen zum Funfzehnten oder zum Ende eines Kalendermonats.',
    },
    {
        id: 'DE_EMPLOYMENT_NachwG',
        jurisdiction: 'DE',
        documentTypes: ['employment', 'arbeitsvertrag'],
        clauseType: 'essential_terms',
        termType: 'nachweisgesetz',
        statuteRef: 'NachwG § 2',
        description: 'Essential terms must be documented in writing within one month',
        requirement: 'mandatory',
        searchTerms: ['NachwG', '§ 2', 'Nachweisgesetz', 'essential terms', 'written form'],
        validationRules: [
            { type: 'required', field: 'parties', errorMessage: 'Parties must be specified per § 2 NachwG' },
            { type: 'required', field: 'start_date', errorMessage: 'Start date must be specified per § 2 NachwG' },
            { type: 'required', field: 'workplace', errorMessage: 'Workplace must be specified per § 2 NachwG' },
            { type: 'required', field: 'job_description', errorMessage: 'Job description must be specified per § 2 NachwG' },
            { type: 'required', field: 'salary', errorMessage: 'Salary must be specified per § 2 NachwG' },
            { type: 'required', field: 'working_hours', errorMessage: 'Working hours must be specified per § 2 NachwG' },
        ],
    },
    {
        id: 'DE_LEASE_NOTICE',
        jurisdiction: 'DE',
        documentTypes: ['lease', 'mietvertrag'],
        clauseType: 'termination',
        termType: 'notice_period',
        statuteRef: 'BGB § 573c',
        description: 'Tenant notice period is 3 months, landlord notice increases with duration',
        requirement: 'mandatory',
        searchTerms: ['BGB', '§ 573c', 'Kundigungsfrist', 'Mietvertrag', 'notice period'],
        validationRules: [
            { type: 'minimum', field: 'tenant_notice', value: 3, unit: 'months', errorMessage: 'Tenant notice period is 3 months per § 573c BGB' }
        ],
    },
];
const EU_TERMS = [
    {
        id: 'EU_GDPR_DPA',
        jurisdiction: 'EU',
        documentTypes: ['service', 'data_processing', 'vendor_agreement'],
        clauseType: 'data_protection',
        termType: 'dpa_required',
        statuteRef: 'GDPR Art. 28',
        description: 'Data processing agreement required when processing personal data',
        requirement: 'mandatory',
        searchTerms: ['GDPR', 'Art. 28', 'data processing agreement', 'DPA', 'Auftragsverarbeitung'],
        validationRules: [
            { type: 'required', field: 'data_processing_clause', errorMessage: 'Data processing agreement required per GDPR Art. 28' }
        ],
    },
    {
        id: 'EU_GDPR_SUBPROCESSOR',
        jurisdiction: 'EU',
        documentTypes: ['service', 'data_processing'],
        clauseType: 'data_protection',
        termType: 'subprocessor_authorization',
        statuteRef: 'GDPR Art. 28(2)',
        description: 'Prior authorization required for sub-processors',
        requirement: 'mandatory',
        searchTerms: ['GDPR', 'Art. 28', 'sub-processor', 'Unterauftragnehmer'],
        validationRules: [
            { type: 'required', field: 'subprocessor_clause', errorMessage: 'Sub-processor authorization required per GDPR Art. 28(2)' }
        ],
    },
    {
        id: 'EU_CONSUMER_WITHDRAWAL',
        jurisdiction: 'EU',
        documentTypes: ['consumer_contract', 'ecommerce', 'distance_selling'],
        clauseType: 'consumer_rights',
        termType: 'withdrawal_right',
        statuteRef: 'Consumer Rights Directive Art. 9',
        description: '14-day withdrawal right for distance contracts',
        requirement: 'mandatory',
        searchTerms: ['withdrawal right', 'Widerrufsrecht', 'odstupenie od zmluvy', '14 days'],
        validationRules: [
            { type: 'minimum', field: 'withdrawal_period', value: 14, unit: 'days', errorMessage: '14-day withdrawal period required' }
        ],
    },
];
exports.ALL_MANDATORY_TERMS = [
    ...SK_TERMS,
    ...AT_TERMS,
    ...DE_TERMS,
    ...EU_TERMS,
];
function getMandatoryTermsFor(jurisdiction, documentType) {
    return exports.ALL_MANDATORY_TERMS.filter(term => {
        const jurisdictionMatch = term.jurisdiction === jurisdiction || term.jurisdiction === 'EU';
        const documentMatch = !documentType || term.documentTypes.some(dt => documentType.toLowerCase().includes(dt.toLowerCase()) ||
            dt.toLowerCase().includes(documentType.toLowerCase()));
        return jurisdictionMatch && documentMatch;
    });
}
function getMandatoryTermsByClauseType(clauseType, jurisdiction) {
    return exports.ALL_MANDATORY_TERMS.filter(term => term.clauseType === clauseType &&
        (term.jurisdiction === jurisdiction || term.jurisdiction === 'EU'));
}
function getStrictlyMandatoryTerms(jurisdiction, documentType) {
    return getMandatoryTermsFor(jurisdiction, documentType)
        .filter(term => term.requirement === 'mandatory');
}
function buildSearchQuery(term) {
    return term.searchTerms.slice(0, 3).join(' ');
}
const EXPLICIT_JURISDICTION_PATTERNS = {
    SK: [
        /governed\s+by\s+(the\s+)?laws?\s+of\s+slovak/i,
        /subject\s+to\s+slovak\s+law/i,
        /under\s+slovak\s+(law|jurisdiction)/i,
        /slovak\s+law\s+(shall\s+)?(apply|govern)/i,
        /rozhodn[eé]\s+pr[aá]vo[:.]?\s*(je\s+)?(slovensk|SR)/i,
        /pod[lľ]a\s+slovensk[eé]ho\s+pr[aá]va/i,
        /jurisdiction[:.]?\s*slovakia/i,
        /právny\s+poriadok\s+SR/i,
    ],
    AT: [
        /governed\s+by\s+(the\s+)?laws?\s+of\s+austria/i,
        /subject\s+to\s+austrian\s+law/i,
        /under\s+austrian\s+(law|jurisdiction)/i,
        /austrian\s+law\s+(shall\s+)?(apply|govern)/i,
        /rechtswahl[:.]?\s*(ist\s+)?[öo]sterreich/i,
        /[öo]sterreichisches\s+recht\s+(findet\s+)?anwendung/i,
        /nach\s+[öo]sterreichischem\s+recht/i,
        /jurisdiction[:.]?\s*austria/i,
        /gerichtsstand[:.]?\s*wien/i,
    ],
    DE: [
        /governed\s+by\s+(the\s+)?laws?\s+of\s+germany/i,
        /subject\s+to\s+german\s+law/i,
        /under\s+german\s+(law|jurisdiction)/i,
        /german\s+law\s+(shall\s+)?(apply|govern)/i,
        /rechtswahl[:.]?\s*(ist\s+)?deutsch/i,
        /deutsches\s+recht\s+(findet\s+)?anwendung/i,
        /nach\s+deutschem\s+recht/i,
        /jurisdiction[:.]?\s*germany/i,
        /gerichtsstand[:.]?\s*(frankfurt|berlin|münchen|hamburg)/i,
    ],
    EU: [
        /governed\s+by\s+eu(ropean)?\s+(union\s+)?law/i,
        /subject\s+to\s+eu\s+(law|regulations?)/i,
        /eu\s+law\s+(shall\s+)?(apply|govern)/i,
    ],
};
const STATUTE_PATTERNS = {
    SK: [
        { patterns: [/obchodn[yý]\s*z[aá]konn[ií]k/i, /obchz/i], weight: 1.0 },
        { patterns: [/z[aá]konn[ií]k\s*pr[aá]ce/i], weight: 1.0 },
        { patterns: [/slov-lex/i, /zbierka\s*z[aá]konov/i], weight: 0.9 },
        { patterns: [/§\s*\d+[a-z]?\s*(ods\.|odst\.)/i], weight: 0.7 },
        { patterns: [/s\.r\.o\./i, /spoločnosť\s*s\s*ručením/i], weight: 0.8 },
        { patterns: [/základné\s*imanie/i, /vklad\s*spoločníka/i], weight: 0.8 },
        { patterns: [/konateľ/i, /valné\s*zhromaždenie/i], weight: 0.7 },
        { patterns: [/slovenská|slovensko|slovakia/i], weight: 0.6 },
    ],
    AT: [
        { patterns: [/gmbhg\s*§/i, /§\s*\d+[a-z]?\s*gmbhg/i], weight: 1.0 },
        { patterns: [/mrg\s*§/i, /§\s*\d+[a-z]?\s*mrg/i, /mietrechtsgesetz/i], weight: 1.0 },
        { patterns: [/avrag/i, /arbeitsverfassungsgesetz/i], weight: 1.0 },
        { patterns: [/abgb\s*§/i, /§\s*\d+[a-z]?\s*abgb/i], weight: 1.0 },
        { patterns: [/ris\.bka\.gv\.at/i, /rechtsinformationssystem/i], weight: 0.9 },
        { patterns: [/stammkapital.*35[\.,]?000/i], weight: 0.8 },
        { patterns: [/gesellschaftsvertrag/i, /firmenbuch/i], weight: 0.7 },
        { patterns: [/gründungsprivilegierung/i, /§\s*10b/i], weight: 0.9 },
        { patterns: [/österreich|austria|austrian/i], weight: 0.6 },
        { patterns: [/richtwertmietzins/i, /kaution/i], weight: 0.7 },
    ],
    DE: [
        { patterns: [/bgb\s*§/i, /§\s*\d+[a-z]?\s*bgb/i, /bürgerliches\s*gesetzbuch/i], weight: 1.0 },
        { patterns: [/hgb\s*§/i, /§\s*\d+[a-z]?\s*hgb/i, /handelsgesetzbuch/i], weight: 1.0 },
        { patterns: [/gmbhg\s*§\s*5/i, /stammkapital.*25[\.,]?000/i], weight: 0.9 },
        { patterns: [/nachwg/i, /nachweisgesetz/i], weight: 1.0 },
        { patterns: [/kündigungsschutzgesetz|kschg/i], weight: 1.0 },
        { patterns: [/§\s*622\s*bgb/i, /kündigungsfrist.*vier\s*wochen/i], weight: 0.9 },
        { patterns: [/deutschland|germany|german/i], weight: 0.6 },
        { patterns: [/handelsregister/i, /amtsgericht/i], weight: 0.7 },
        { patterns: [/gewerbeordnung|gewo/i], weight: 0.8 },
    ],
    EU: [
        { patterns: [/gdpr|dsgvo|datenschutz-grundverordnung/i], weight: 1.0 },
        { patterns: [/art\.?\s*\d+\s*(abs\.)?\s*(gdpr|dsgvo)/i], weight: 1.0 },
        { patterns: [/european\s*union|eu\s*law|eu\s*regulation/i], weight: 0.8 },
        { patterns: [/directive\s*\d+\/\d+/i, /regulation\s*\d+\/\d+/i], weight: 0.9 },
        { patterns: [/eur-lex/i, /official\s*journal/i], weight: 0.9 },
        { patterns: [/consumer\s*rights\s*directive/i], weight: 0.9 },
        { patterns: [/data\s*processing\s*agreement|dpa|auftragsverarbeitung/i], weight: 0.7 },
    ],
};
const LANGUAGE_PATTERNS = {
    SK: [
        /[áäčďéíĺľňóôŕšťúýž]/i,
        /\b(spoločnosť|zmluva|zákon|právny|povinnosť)\b/i,
    ],
    AT: [
        /\b(gesellschaft|vertrag|gesetz|recht|pflicht)\b/i,
        /ß/,
    ],
    DE: [
        /\b(gesellschaft|vertrag|gesetz|recht|pflicht)\b/i,
        /ß/,
    ],
};
function detectJurisdiction(text) {
    for (const [jurisdiction, patterns] of Object.entries(EXPLICIT_JURISDICTION_PATTERNS)) {
        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match) {
                return {
                    detected: jurisdiction,
                    confidence: 1.0,
                    allMatches: [{
                            jurisdiction,
                            confidence: 1.0,
                            matches: [match[0]],
                            reason: `Explicit jurisdiction statement: "${match[0]}"`,
                        }],
                    isAmbiguous: false,
                    isExplicit: true,
                };
            }
        }
    }
    const allMatches = [];
    for (const [jurisdiction, patternGroups] of Object.entries(STATUTE_PATTERNS)) {
        let totalScore = 0;
        const matches = [];
        for (const group of patternGroups) {
            for (const pattern of group.patterns) {
                const match = text.match(pattern);
                if (match) {
                    totalScore += group.weight;
                    matches.push(match[0]);
                }
            }
        }
        const langPatterns = LANGUAGE_PATTERNS[jurisdiction];
        if (langPatterns) {
            for (const pattern of langPatterns) {
                if (pattern.test(text)) {
                    totalScore += 0.2;
                }
            }
        }
        if (matches.length > 0) {
            allMatches.push({
                jurisdiction,
                confidence: Math.min(totalScore, 1.0),
                matches,
                reason: `Found ${matches.length} statute references: ${matches.slice(0, 3).join(', ')}`,
            });
        }
    }
    allMatches.sort((a, b) => b.confidence - a.confidence);
    if (allMatches.length === 0) {
        return {
            detected: null,
            confidence: 0,
            allMatches: [],
            isAmbiguous: false,
        };
    }
    const top = allMatches[0];
    const second = allMatches[1];
    const isAmbiguous = second && (top.confidence - second.confidence) < 0.3;
    if (isAmbiguous && ['AT', 'DE'].includes(top.jurisdiction) && ['AT', 'DE'].includes(second.jurisdiction)) {
        if (/35[\.,]?000/i.test(text)) {
            return {
                detected: 'AT',
                confidence: 0.9,
                allMatches,
                isAmbiguous: false,
            };
        }
        if (/25[\.,]?000/i.test(text)) {
            return {
                detected: 'DE',
                confidence: 0.9,
                allMatches,
                isAmbiguous: false,
            };
        }
    }
    return {
        detected: top.jurisdiction,
        confidence: top.confidence,
        allMatches,
        isAmbiguous,
    };
}
function detectJurisdictionQuick(text) {
    return detectJurisdiction(text).detected;
}
function validateJurisdictionMatch(text, expectedJurisdiction) {
    const result = detectJurisdiction(text);
    if (!result.detected) {
        return { isMatch: true };
    }
    if (result.detected === expectedJurisdiction) {
        return { isMatch: true };
    }
    if (result.detected === 'EU' && ['SK', 'AT', 'DE'].includes(expectedJurisdiction)) {
        return { isMatch: true };
    }
    return {
        isMatch: false,
        warning: `Document appears to reference ${result.detected} law (${result.allMatches[0]?.matches.slice(0, 2).join(', ')}), but jurisdiction is set to ${expectedJurisdiction}`,
        detected: result.detected,
    };
}
function getJurisdictionName(code) {
    const names = {
        SK: 'Slovakia',
        AT: 'Austria',
        DE: 'Germany',
        EU: 'European Union',
        US: 'United States',
        UK: 'United Kingdom',
    };
    return names[code] || code;
}
function extractGoverningLawClause(text) {
    const sectionPatterns = [
        /(?:governing\s+law|applicable\s+law|choice\s+of\s+law|rechtswahl|rozhodn[eé]\s+pr[aá]vo)[:\s]*([^.]+\.)/gi,
        /this\s+(?:agreement|contract)\s+(?:shall\s+be\s+)?governed\s+by[^.]+\./gi,
        /(?:the\s+)?laws?\s+of\s+\w+\s+(?:shall\s+)?(?:apply|govern)[^.]+\./gi,
    ];
    for (const pattern of sectionPatterns) {
        const match = pattern.exec(text);
        if (match) {
            const clause = match[0];
            const detection = detectJurisdiction(clause);
            if (detection.detected && detection.confidence >= 0.6) {
                return {
                    found: true,
                    jurisdiction: detection.detected,
                    clause: clause.trim(),
                    startIndex: match.index,
                    endIndex: match.index + clause.length,
                };
            }
        }
    }
    return { found: false };
}
function autoDetectJurisdictionForCreation(situationText, userLocale, referencedDocText) {
    const situationDetection = detectJurisdiction(situationText);
    if (situationDetection.isExplicit) {
        return {
            jurisdiction: situationDetection.detected,
            confidence: 'explicit',
            reason: `User specified: "${situationDetection.allMatches[0]?.matches[0]}"`,
            needsConfirmation: false,
        };
    }
    if (referencedDocText) {
        const governingLaw = extractGoverningLawClause(referencedDocText);
        if (governingLaw.found) {
            return {
                jurisdiction: governingLaw.jurisdiction,
                confidence: 'explicit',
                reason: `Document states: "${governingLaw.clause}"`,
                needsConfirmation: false,
            };
        }
    }
    if (situationDetection.detected && situationDetection.confidence >= 0.7) {
        return {
            jurisdiction: situationDetection.detected,
            confidence: 'high',
            reason: situationDetection.allMatches[0]?.reason || 'Detected from legal references',
            needsConfirmation: false,
        };
    }
    if (userLocale) {
        const localeMap = {
            'sk': 'SK', 'sk-SK': 'SK',
            'de-AT': 'AT', 'de-at': 'AT',
            'de': 'DE', 'de-DE': 'DE',
        };
        const fromLocale = localeMap[userLocale];
        if (fromLocale) {
            return {
                jurisdiction: fromLocale,
                confidence: 'low',
                reason: `Inferred from user locale: ${userLocale}`,
                needsConfirmation: true,
            };
        }
    }
    if (situationDetection.detected) {
        return {
            jurisdiction: situationDetection.detected,
            confidence: 'medium',
            reason: situationDetection.allMatches[0]?.reason || 'Weak signals detected',
            needsConfirmation: true,
        };
    }
    return {
        jurisdiction: null,
        confidence: 'none',
        reason: 'Could not determine jurisdiction',
        needsConfirmation: true,
    };
}
//# sourceMappingURL=mandatoryTerms.js.map