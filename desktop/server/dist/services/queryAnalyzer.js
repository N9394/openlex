"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeQuery = analyzeQuery;
exports.hasJurisdictionMention = hasJurisdictionMention;
exports.isCrossBorderQuery = isCrossBorderQuery;
exports.extractJurisdictions = extractJurisdictions;
const jurisdictionIntelligence_1 = require("./jurisdictionIntelligence");
const JURISDICTION_PATTERNS = {
    'AT': [
        /\b(austria|austrian|österreich|österreichisch)\b/i,
        /\b(wien|vienna|graz|salzburg|innsbruck|linz)\b/i,
        /\b(abgb|stgb|zpo|ugb|gmbhg|aktg|kschg|mrg|arbvg|bag|anvg)\b/i,
        /\b(ogh|vfgh|vwgh|bvwg|lvwg)\b/i,
        /\b(oberster\s+gerichtshof|verfassungsgerichtshof|verwaltungsgerichtshof)\b/i,
    ],
    'SK': [
        /\b(slovakia|slovak|slovensko|slovenský)\b/i,
        /\b(bratislava|košice)\b/i,
        /\b(občiansky\s+zákonník|trestný\s+zákon|obchodný\s+zákonník|zákonník\s+práce)\b/i,
        /\b(najvyšší\s+súd|ústavný\s+súd)\b/i,
        /\bns\s+sr\b/i,
    ],
    'EU': [
        /\b(european\s+union|eu\b|european)\b/i,
        /\b(gdpr|dsgvo|regulation\s+\d+\/\d+|directive\s+\d+\/\d+)\b/i,
        /\b(brussels|strasbourg|luxembourg)\b/i,
        /\b(ecj|eugh|cjeu|court\s+of\s+justice)\b/i,
        /\b(tfeu|teu|charter\s+of\s+fundamental\s+rights)\b/i,
        /\b(regulation|directive|decision)\s+\(?(eu|ec)\)?/i,
    ],
    'DE': [
        /\b(germany|german|deutschland|deutsch)\b/i,
        /\b(berlin|munich|frankfurt|hamburg)\b/i,
        /\b(bgb|stgb|hgb|gmbhg|aktg|zpo|insolvenzordnung|ins[oö])\b/i,
        /\b(bgh|bverfg|bverwg)\b/i,
        /\b(bundesgerichtshof|bundesverfassungsgericht)\b/i,
    ],
    'CZ': [
        /\b(czech|czechia|česk[áý]|česko)\b/i,
        /\b(prague|praha|brno)\b/i,
        /\b(občanský\s+zákoník|trestní\s+zákoník)\b/i,
    ],
    'CH': [
        /\b(switzerland|swiss|schweiz|suisse|svizzera)\b/i,
        /\b(zurich|zürich|geneva|genève|bern|basel)\b/i,
        /\b(or\b|zgb|schweizerisch)\b/i,
        /\b(bundesgericht|bger)\b/i,
    ],
    'UK': [
        /\b(united\s+kingdom|uk\b|britain|british|england|english|scotland|scottish|wales|welsh)\b/i,
        /\b(london|edinburgh|cardiff)\b/i,
        /\b(companies\s+act|sale\s+of\s+goods|consumer\s+rights\s+act)\b/i,
        /\b(uksc|supreme\s+court\s+of\s+the\s+united\s+kingdom)\b/i,
    ],
    'US': [
        /\b(united\s+states|usa|u\.s\.|american)\b/i,
        /\b(new\s+york|california|delaware|texas|florida)\b/i,
        /\b(ucc|restatement|model\s+business\s+corporation\s+act)\b/i,
        /\b(scotus|supreme\s+court\s+of\s+the\s+united\s+states)\b/i,
        /\b(\d+\s+u\.s\.c\.|federal\s+rules)\b/i,
    ],
    'FR': [
        /\b(france|french|français|française)\b/i,
        /\b(paris|lyon|marseille)\b/i,
        /\b(code\s+civil|code\s+pénal|code\s+de\s+commerce)\b/i,
        /\b(cour\s+de\s+cassation)\b/i,
    ],
    'IT': [
        /\b(italy|italian|italia|italiano)\b/i,
        /\b(rome|roma|milan|milano)\b/i,
        /\b(codice\s+civile|codice\s+penale)\b/i,
    ],
    'INTL': [
        /\b(international|transnational|cross[- ]?border)\b/i,
        /\b(cisg|unidroit|hague\s+convention|un\s+convention)\b/i,
        /\b(icj|international\s+court\s+of\s+justice)\b/i,
        /\b(arbitration|icc|uncitral)\b/i,
    ],
};
const CROSS_BORDER_PATTERNS = [
    /cross[- ]?border/i,
    /international/i,
    /transnational/i,
    /multi[- ]?jurisdiction/i,
    /between\s+\w+\s+and\s+\w+/i,
    /from\s+\w+\s+to\s+\w+/i,
    /compare|comparison|compared/i,
    /differ|difference|different/i,
    /both\s+(countries|jurisdictions|laws)/i,
    /multiple\s+(countries|jurisdictions|laws)/i,
    /foreign/i,
    /abroad/i,
    /overseas/i,
    /import|export/i,
    /bilateral|multilateral/i,
    /harmoniz|harmonis/i,
    /conflict\s+of\s+laws?/i,
    /choice\s+of\s+law/i,
    /applicable\s+law/i,
    /recognition|enforcement/i,
    /cross[- ]?national/i,
];
const LEGAL_TOPIC_PATTERNS = {
    'employment': [
        /\b(employment|arbeits|labor|labour|employee|employer|worker|work contract)\b/i,
        /\b(dismissal|termination|kündigung|notice period|severance)\b/i,
        /\b(arbeitsrecht|zákonník\s+práce)\b/i,
    ],
    'contract': [
        /\b(contract|vertrag|agreement|obligation|breach|performance)\b/i,
        /\b(offer|acceptance|consideration|vertragsrecht)\b/i,
        /\b(zmluva|občiansky\s+zákonník)\b/i,
    ],
    'corporate': [
        /\b(corporate|company|gesellschaft|corporation|shareholder|director)\b/i,
        /\b(gmbh|ag|s\.r\.o\.|a\.s\.|ltd|inc|plc)\b/i,
        /\b(merger|acquisition|m&a|takeover)\b/i,
    ],
    'gdpr_privacy': [
        /\b(gdpr|dsgvo|data\s+protection|privacy|personal\s+data)\b/i,
        /\b(data\s+subject|controller|processor|consent)\b/i,
        /\b(data\s+breach|transfer|adequacy)\b/i,
    ],
    'consumer': [
        /\b(consumer|verbraucher|spotrebiteľ|b2c)\b/i,
        /\b(consumer\s+protection|warranty|guarantee|refund|return)\b/i,
        /\b(kschg|verbraucherschutz)\b/i,
    ],
    'real_estate': [
        /\b(real\s+estate|immobilien|property|grundstück|liegenschaft)\b/i,
        /\b(lease|rent|miete|tenancy|landlord|tenant)\b/i,
        /\b(mrg|mietrecht)\b/i,
    ],
    'intellectual_property': [
        /\b(intellectual\s+property|ip|patent|trademark|copyright)\b/i,
        /\b(trade\s+secret|license|licensing|royalty)\b/i,
    ],
    'tax': [
        /\b(tax|steuer|daň|vat|mwst|income\s+tax|corporate\s+tax)\b/i,
        /\b(double\s+taxation|tax\s+treaty|transfer\s+pricing)\b/i,
    ],
    'insolvency': [
        /\b(insolvency|bankruptcy|konkurs|insolvent|liquidation)\b/i,
        /\b(creditor|debtor|restructuring)\b/i,
    ],
    'dispute_resolution': [
        /\b(dispute|litigation|arbitration|mediation)\b/i,
        /\b(court|tribunal|proceedings|lawsuit|claim)\b/i,
        /\b(enforcement|recognition|judgment)\b/i,
    ],
};
const QUERY_TYPE_PATTERNS = {
    'comparison': [
        /compare|comparison|versus|vs\.?|differ|difference/i,
        /how\s+does\s+\w+\s+compare/i,
        /what\s+are\s+the\s+differences?/i,
        /side[- ]?by[- ]?side/i,
    ],
    'conflict_check': [
        /conflict|contradict|incompatible|clash/i,
        /which\s+law\s+(applies|governs)/i,
        /choice\s+of\s+law/i,
        /applicable\s+law/i,
        /conflict\s+of\s+laws?/i,
    ],
    'transaction': [
        /transaction|deal|acquisition|merger|investment/i,
        /contract\s+(with|between)/i,
        /setting\s+up|establish|incorporate/i,
        /do\s+business|operate/i,
    ],
    'research': [
        /what\s+(is|are|does)/i,
        /how\s+(does|do|is|are|to)/i,
        /explain|describe|overview/i,
        /requirements?|obligations?|rights?/i,
        /legal\s+(position|situation|framework)/i,
    ],
};
async function analyzeQuery(query) {
    const normalizedQuery = query.toLowerCase().trim();
    const detectedJurisdictions = detectJurisdictions(query);
    const isCrossBorder = detectCrossBorder(query) || detectedJurisdictions.length > 1;
    const legalTopics = detectLegalTopics(query);
    const queryType = detectQueryType(query, isCrossBorder);
    const suggestedJurisdictions = generateSuggestions(detectedJurisdictions, legalTopics, isCrossBorder);
    const confidence = calculateConfidence(detectedJurisdictions, legalTopics, query);
    return {
        originalQuery: query,
        detectedJurisdictions,
        suggestedJurisdictions,
        isCrossBorder,
        legalTopics,
        queryType,
        confidence,
    };
}
function detectJurisdictions(query) {
    const detected = [];
    for (const [code, patterns] of Object.entries(JURISDICTION_PATTERNS)) {
        if (patterns.some(pattern => pattern.test(query))) {
            detected.push(code);
        }
    }
    return detected;
}
function detectCrossBorder(query) {
    return CROSS_BORDER_PATTERNS.some(pattern => pattern.test(query));
}
function detectLegalTopics(query) {
    const topics = [];
    for (const [topic, patterns] of Object.entries(LEGAL_TOPIC_PATTERNS)) {
        if (patterns.some(pattern => pattern.test(query))) {
            topics.push(topic);
        }
    }
    return topics;
}
function detectQueryType(query, isCrossBorder) {
    for (const [type, patterns] of Object.entries(QUERY_TYPE_PATTERNS)) {
        if (patterns.some(pattern => pattern.test(query))) {
            return type;
        }
    }
    if (isCrossBorder) {
        return 'comparison';
    }
    return 'research';
}
function generateSuggestions(detected, topics, isCrossBorder) {
    const suggestions = [];
    const intelligenceSuggestions = (0, jurisdictionIntelligence_1.suggestJurisdictions)(detected);
    for (const suggestion of intelligenceSuggestions) {
        if (!detected.includes(suggestion.code) && !suggestions.includes(suggestion.code)) {
            suggestions.push(suggestion.code);
        }
    }
    if (topics.includes('gdpr_privacy') && !detected.includes('EU') && !suggestions.includes('EU')) {
        suggestions.unshift('EU');
    }
    if (isCrossBorder && detected.length === 1 && (0, jurisdictionIntelligence_1.isEUMember)(detected[0])) {
        if (!suggestions.includes('EU')) {
            suggestions.unshift('EU');
        }
    }
    return suggestions;
}
function calculateConfidence(detected, topics, query) {
    let confidence = 0.5;
    if (detected.length > 0)
        confidence += 0.2;
    if (detected.length > 1)
        confidence += 0.1;
    if (topics.length > 0)
        confidence += 0.1;
    if (topics.length > 1)
        confidence += 0.05;
    if (query.length > 50)
        confidence += 0.05;
    if (query.length > 100)
        confidence += 0.05;
    return Math.min(confidence, 1.0);
}
function hasJurisdictionMention(query) {
    return Object.values(JURISDICTION_PATTERNS).some(patterns => patterns.some(pattern => pattern.test(query)));
}
function isCrossBorderQuery(query) {
    return detectCrossBorder(query) || detectJurisdictions(query).length > 1;
}
function extractJurisdictions(query) {
    return detectJurisdictions(query);
}
//# sourceMappingURL=queryAnalyzer.js.map