"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EU_MEMBERS = exports.JURISDICTIONS = void 0;
exports.getJurisdiction = getJurisdiction;
exports.getAllJurisdictions = getAllJurisdictions;
exports.getRelatedJurisdictions = getRelatedJurisdictions;
exports.isEUMember = isEUMember;
exports.shouldIncludeEU = shouldIncludeEU;
exports.suggestJurisdictions = suggestJurisdictions;
exports.explainRelationship = explainRelationship;
exports.expandJurisdictions = expandJurisdictions;
exports.getPotentialConflictAreas = getPotentialConflictAreas;
exports.JURISDICTIONS = {
    'AT': {
        code: 'AT',
        name: 'Austria',
        nameLocal: 'Österreich',
        legalSystem: 'civil',
        languages: ['de'],
        isEUMember: true,
        euJoinDate: '1995-01-01',
        related: ['EU', 'DE', 'CH'],
        relationship: {
            type: 'supremacy',
            description: 'EU law takes precedence. Austrian law heavily influenced by German legal tradition (shared ABGB roots).'
        },
        notes: 'Civil law system based on ABGB (1811). Strong German legal influence. Federal structure with 9 Länder.',
        keyLaws: ['ABGB', 'StGB', 'ZPO', 'UGB', 'GmbHG', 'AktG', 'KSchG', 'MRG'],
        courts: [
            { name: 'Supreme Court', nameLocal: 'Oberster Gerichtshof', type: 'supreme', abbreviation: 'OGH' },
            { name: 'Constitutional Court', nameLocal: 'Verfassungsgerichtshof', type: 'constitutional', abbreviation: 'VfGH' },
            { name: 'Supreme Administrative Court', nameLocal: 'Verwaltungsgerichtshof', type: 'administrative', abbreviation: 'VwGH' },
            { name: 'Federal Administrative Court', nameLocal: 'Bundesverwaltungsgericht', type: 'administrative', abbreviation: 'BVwG' },
        ]
    },
    'SK': {
        code: 'SK',
        name: 'Slovakia',
        nameLocal: 'Slovensko',
        legalSystem: 'civil',
        languages: ['sk'],
        isEUMember: true,
        euJoinDate: '2004-05-01',
        related: ['EU', 'CZ'],
        relationship: {
            type: 'supremacy',
            description: 'EU law takes precedence. Some laws harmonized with Czech Republic due to shared history.'
        },
        notes: 'Civil law system. Former Czechoslovakia - some legal continuity with Czech Republic.',
        keyLaws: ['Občiansky zákonník', 'Trestný zákon', 'Obchodný zákonník', 'Zákonník práce'],
        courts: [
            { name: 'Supreme Court', nameLocal: 'Najvyšší súd SR', type: 'supreme', abbreviation: 'NS SR' },
            { name: 'Constitutional Court', nameLocal: 'Ústavný súd SR', type: 'constitutional', abbreviation: 'ÚS SR' },
            { name: 'Supreme Administrative Court', nameLocal: 'Najvyšší správny súd SR', type: 'administrative', abbreviation: 'NSS SR' },
        ]
    },
    'EU': {
        code: 'EU',
        name: 'European Union',
        legalSystem: 'mixed',
        languages: ['en', 'de', 'fr'],
        isEUMember: false,
        related: ['AT', 'SK', 'DE', 'FR', 'IT'],
        relationship: {
            type: 'supremacy',
            description: 'EU law has supremacy over national law in areas of EU competence (Costa v ENEL, 1964).'
        },
        notes: 'Supranational legal order. Regulations directly applicable, Directives require transposition.',
        keyLaws: ['TFEU', 'TEU', 'GDPR', 'UCPD', 'CRD', 'Rome I', 'Rome II', 'Brussels I'],
        courts: [
            { name: 'Court of Justice', type: 'supreme', abbreviation: 'ECJ' },
            { name: 'General Court', type: 'specialized', abbreviation: 'GC' },
        ]
    },
    'DE': {
        code: 'DE',
        name: 'Germany',
        nameLocal: 'Deutschland',
        legalSystem: 'civil',
        languages: ['de'],
        isEUMember: true,
        euJoinDate: '1958-01-01',
        related: ['EU', 'AT', 'CH'],
        relationship: {
            type: 'supremacy',
            description: 'EU law takes precedence. German legal scholarship highly influential across Europe.'
        },
        notes: 'Civil law system based on BGB (1900). Strong academic tradition. Federal structure with 16 Länder.',
        keyLaws: ['BGB', 'StGB', 'HGB', 'GmbHG', 'AktG', 'ZPO', 'InsO'],
        courts: [
            { name: 'Federal Court of Justice', nameLocal: 'Bundesgerichtshof', type: 'supreme', abbreviation: 'BGH' },
            { name: 'Federal Constitutional Court', nameLocal: 'Bundesverfassungsgericht', type: 'constitutional', abbreviation: 'BVerfG' },
            { name: 'Federal Administrative Court', nameLocal: 'Bundesverwaltungsgericht', type: 'administrative', abbreviation: 'BVerwG' },
        ]
    },
    'CZ': {
        code: 'CZ',
        name: 'Czech Republic',
        nameLocal: 'Česká republika',
        legalSystem: 'civil',
        languages: ['cs'],
        isEUMember: true,
        euJoinDate: '2004-05-01',
        related: ['EU', 'SK'],
        relationship: {
            type: 'harmonized',
            description: 'Some laws harmonized with Slovakia due to shared Czechoslovak history.'
        },
        notes: 'Civil law system. Former Czechoslovakia.',
        keyLaws: ['Občanský zákoník', 'Trestní zákoník', 'Zákoník práce'],
        courts: [
            { name: 'Supreme Court', nameLocal: 'Nejvyšší soud', type: 'supreme', abbreviation: 'NS' },
            { name: 'Constitutional Court', nameLocal: 'Ústavní soud', type: 'constitutional', abbreviation: 'ÚS' },
        ]
    },
    'CH': {
        code: 'CH',
        name: 'Switzerland',
        nameLocal: 'Schweiz / Suisse / Svizzera',
        legalSystem: 'civil',
        languages: ['de', 'fr', 'it'],
        isEUMember: false,
        related: ['DE', 'AT', 'FR', 'IT'],
        relationship: {
            type: 'bilateral',
            description: 'Not EU member but has bilateral agreements. Influenced by German, French, and Italian law.'
        },
        notes: 'Civil law with cantonal variations. Strong direct democracy elements.',
        keyLaws: ['ZGB', 'OR', 'StGB'],
        courts: [
            { name: 'Federal Supreme Court', nameLocal: 'Bundesgericht', type: 'supreme', abbreviation: 'BGer' },
        ]
    },
    'UK': {
        code: 'UK',
        name: 'United Kingdom',
        legalSystem: 'common',
        languages: ['en'],
        isEUMember: false,
        related: ['US', 'AU', 'CA'],
        relationship: {
            type: 'influence',
            description: 'Common law tradition. Post-Brexit, some EU law retained as UK law.'
        },
        notes: 'Common law system. England/Wales, Scotland (mixed), Northern Ireland have distinct systems.',
        keyLaws: ['Companies Act', 'Sale of Goods Act', 'Consumer Rights Act', 'Employment Rights Act'],
        courts: [
            { name: 'Supreme Court', type: 'supreme', abbreviation: 'UKSC' },
        ]
    },
    'US': {
        code: 'US',
        name: 'United States',
        legalSystem: 'common',
        languages: ['en'],
        isEUMember: false,
        related: ['UK', 'CA'],
        relationship: {
            type: 'influence',
            description: 'Common law tradition derived from English law. Federal/state dual system.'
        },
        notes: 'Federal common law system with significant state variations. Louisiana has civil law influence.',
        keyLaws: ['UCC', 'Restatements'],
        courts: [
            { name: 'Supreme Court', type: 'supreme', abbreviation: 'SCOTUS' },
        ]
    },
    'INTL': {
        code: 'INTL',
        name: 'International',
        legalSystem: 'mixed',
        languages: ['en', 'fr'],
        isEUMember: false,
        related: [],
        relationship: {
            type: 'none',
            description: 'International law, treaties, and conventions.'
        },
        notes: 'International treaties, UN conventions, Hague Conference conventions.',
        keyLaws: ['CISG', 'UNIDROIT', 'Hague Conventions', 'NY Convention'],
        courts: [
            { name: 'International Court of Justice', type: 'supreme', abbreviation: 'ICJ' },
        ]
    },
};
exports.EU_MEMBERS = ['AT', 'SK', 'DE', 'FR', 'IT', 'ES', 'PT', 'NL', 'BE', 'LU', 'IE', 'DK', 'SE', 'FI', 'PL', 'CZ', 'HU', 'RO', 'BG', 'HR', 'SI', 'EE', 'LV', 'LT', 'CY', 'MT', 'GR'];
function getJurisdiction(code) {
    return exports.JURISDICTIONS[code.toUpperCase()];
}
function getAllJurisdictions() {
    return Object.values(exports.JURISDICTIONS);
}
function getRelatedJurisdictions(code) {
    const jurisdiction = exports.JURISDICTIONS[code.toUpperCase()];
    return jurisdiction?.related || [];
}
function isEUMember(code) {
    return exports.EU_MEMBERS.includes(code.toUpperCase());
}
function shouldIncludeEU(jurisdictions) {
    const upperCodes = jurisdictions.map(j => j.toUpperCase());
    if (upperCodes.includes('EU'))
        return false;
    return upperCodes.some(code => isEUMember(code));
}
function suggestJurisdictions(selected) {
    const suggestions = [];
    const upperSelected = selected.map(s => s.toUpperCase());
    if (shouldIncludeEU(selected)) {
        suggestions.push({
            code: 'EU',
            name: 'European Union',
            reason: 'EU law takes precedence over national law for EU member states',
            relevance: 'high',
        });
    }
    for (const code of upperSelected) {
        const related = getRelatedJurisdictions(code);
        for (const relatedCode of related) {
            if (!upperSelected.includes(relatedCode) && !suggestions.some(s => s.code === relatedCode)) {
                const relatedInfo = exports.JURISDICTIONS[relatedCode];
                if (relatedInfo) {
                    const sourceInfo = exports.JURISDICTIONS[code];
                    suggestions.push({
                        code: relatedCode,
                        name: relatedInfo.name,
                        reason: `${sourceInfo?.name || code} has legal connections with ${relatedInfo.name}`,
                        relevance: relatedCode === 'EU' ? 'high' : 'medium',
                    });
                }
            }
        }
    }
    if (upperSelected.includes('AT') && upperSelected.includes('SK')) {
        if (!suggestions.some(s => s.reason.includes('bilateral'))) {
            suggestions.push({
                code: 'INTL',
                name: 'International',
                reason: 'Austria and Slovakia have bilateral agreements on judicial cooperation',
                relevance: 'low',
            });
        }
    }
    return suggestions;
}
function explainRelationship(code1, code2) {
    const j1 = exports.JURISDICTIONS[code1.toUpperCase()];
    const j2 = exports.JURISDICTIONS[code2.toUpperCase()];
    if (!j1 || !j2)
        return '';
    if (code2.toUpperCase() === 'EU' && isEUMember(code1)) {
        return `${j1.name} is an EU member state. EU law (regulations, directives) takes precedence over national law in areas of EU competence.`;
    }
    if (j1.legalSystem === j2.legalSystem) {
        return `Both ${j1.name} and ${j2.name} follow the ${j1.legalSystem} law tradition, which may lead to similar legal concepts and interpretations.`;
    }
    if (j1.legalSystem !== j2.legalSystem) {
        return `${j1.name} (${j1.legalSystem} law) and ${j2.name} (${j2.legalSystem} law) follow different legal traditions. Caution is advised when comparing legal concepts.`;
    }
    if (j1.related.includes(code2.toUpperCase())) {
        return j1.relationship.description;
    }
    return '';
}
function expandJurisdictions(codes, options = {}) {
    const { includeEU = true, includeRelated = false } = options;
    const result = new Set(codes.map(c => c.toUpperCase()));
    if (includeEU && shouldIncludeEU(codes)) {
        result.add('EU');
    }
    if (includeRelated) {
        for (const code of codes) {
            const related = getRelatedJurisdictions(code);
            related.forEach(r => result.add(r));
        }
    }
    return Array.from(result);
}
function getPotentialConflictAreas(jurisdictions) {
    const conflicts = [];
    if (jurisdictions.some(j => isEUMember(j))) {
        conflicts.push('GDPR implementation details');
        conflicts.push('Consumer protection standards');
        conflicts.push('Employment law harmonization');
    }
    const hasCivil = jurisdictions.some(j => exports.JURISDICTIONS[j]?.legalSystem === 'civil');
    const hasCommon = jurisdictions.some(j => exports.JURISDICTIONS[j]?.legalSystem === 'common');
    if (hasCivil && hasCommon) {
        conflicts.push('Contract formation and interpretation');
        conflicts.push('Tort/delict standards');
        conflicts.push('Evidence rules');
    }
    return conflicts;
}
//# sourceMappingURL=jurisdictionIntelligence.js.map