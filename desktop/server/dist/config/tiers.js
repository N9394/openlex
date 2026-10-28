"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TIERS = void 0;
exports.getTier = getTier;
exports.tierHasFeature = tierHasFeature;
exports.getTierDocumentLimit = getTierDocumentLimit;
exports.tierRequiresAuth = tierRequiresAuth;
exports.getTiersWithFeature = getTiersWithFeature;
exports.compareTiers = compareTiers;
exports.getNextTier = getNextTier;
exports.getTierPriceDisplay = getTierPriceDisplay;
exports.TIERS = {
    free: {
        name: 'free',
        displayName: 'Free',
        description: 'Try LexVault with basic document analysis',
        price: 0,
        requiresAuth: false,
        limits: {
            documentsPerMonth: 3,
            analysisDepth: 'basic',
            saveDocuments: false,
            history: false,
        },
        features: {
            documentAnalysis: true,
            fullClauses: false,
            glossary: false,
            dates: false,
            cases: false,
            clients: false,
            vault: false,
            research: false,
            navigator: false,
            study: false,
        },
    },
    plus: {
        name: 'plus',
        displayName: 'Plus',
        description: 'Full document analysis with history',
        price: 1500,
        priceAnnual: 12000,
        stripePriceId: process.env.STRIPE_PRICE_PLUS,
        stripePriceIdAnnual: process.env.STRIPE_PRICE_PLUS_ANNUAL,
        requiresAuth: true,
        limits: {
            documentsPerMonth: 30,
            analysisDepth: 'full',
            saveDocuments: true,
            history: true,
        },
        features: {
            documentAnalysis: true,
            fullClauses: true,
            glossary: true,
            dates: true,
            cases: false,
            clients: false,
            vault: false,
            research: false,
            navigator: false,
            study: true,
        },
    },
    pro: {
        name: 'pro',
        displayName: 'Pro',
        description: 'Complete legal toolkit for solo practitioners',
        price: 4900,
        priceAnnual: 39900,
        stripePriceId: process.env.STRIPE_PRICE_PRO,
        stripePriceIdAnnual: process.env.STRIPE_PRICE_PRO_ANNUAL,
        requiresAuth: true,
        limits: {
            documentsPerMonth: -1,
            analysisDepth: 'full',
            saveDocuments: true,
            history: true,
        },
        features: {
            documentAnalysis: true,
            fullClauses: true,
            glossary: true,
            dates: true,
            cases: true,
            clients: true,
            vault: true,
            research: true,
            navigator: true,
            study: true,
        },
    },
    team: {
        name: 'team',
        displayName: 'Team',
        description: 'Collaborate with your team',
        price: 3900,
        priceAnnual: 31900,
        stripePriceId: process.env.STRIPE_PRICE_TEAM,
        stripePriceIdAnnual: process.env.STRIPE_PRICE_TEAM_ANNUAL,
        requiresAuth: true,
        isPerSeat: true,
        minSeats: 2,
        limits: {
            documentsPerMonth: -1,
            analysisDepth: 'full',
            saveDocuments: true,
            history: true,
        },
        features: {
            documentAnalysis: true,
            fullClauses: true,
            glossary: true,
            dates: true,
            cases: true,
            clients: true,
            vault: true,
            research: true,
            navigator: true,
            study: true,
            teamCollaboration: true,
            sharedCases: true,
            roleBasedAccess: true,
        },
    },
    firm: {
        name: 'firm',
        displayName: 'Firm',
        description: 'For larger firms with advanced needs',
        price: 2900,
        priceAnnual: 23900,
        stripePriceId: process.env.STRIPE_PRICE_FIRM,
        stripePriceIdAnnual: process.env.STRIPE_PRICE_FIRM_ANNUAL,
        requiresAuth: true,
        isPerSeat: true,
        minSeats: 11,
        limits: {
            documentsPerMonth: -1,
            analysisDepth: 'full',
            saveDocuments: true,
            history: true,
        },
        features: {
            documentAnalysis: true,
            fullClauses: true,
            glossary: true,
            dates: true,
            cases: true,
            clients: true,
            vault: true,
            research: true,
            navigator: true,
            study: true,
            teamCollaboration: true,
            sharedCases: true,
            roleBasedAccess: true,
            prioritySupport: true,
            advancedAnalytics: true,
            firmMemory: true,
        },
    },
    enterprise: {
        name: 'enterprise',
        displayName: 'Enterprise',
        description: 'Custom solutions for large organizations',
        price: 0,
        requiresAuth: true,
        isPerSeat: true,
        limits: {
            documentsPerMonth: -1,
            analysisDepth: 'full',
            saveDocuments: true,
            history: true,
        },
        features: {
            documentAnalysis: true,
            fullClauses: true,
            glossary: true,
            dates: true,
            cases: true,
            clients: true,
            vault: true,
            research: true,
            navigator: true,
            study: true,
            teamCollaboration: true,
            sharedCases: true,
            roleBasedAccess: true,
            prioritySupport: true,
            advancedAnalytics: true,
            firmMemory: true,
        },
    },
    student: {
        name: 'student',
        displayName: 'Student',
        description: 'For law students and learners',
        price: 900,
        priceAnnual: 6000,
        stripePriceId: process.env.STRIPE_PRICE_STUDENT,
        stripePriceIdAnnual: process.env.STRIPE_PRICE_STUDENT_ANNUAL,
        requiresAuth: true,
        limits: {
            documentsPerMonth: 20,
            analysisDepth: 'full',
            saveDocuments: true,
            history: true,
        },
        features: {
            documentAnalysis: true,
            fullClauses: true,
            glossary: true,
            dates: true,
            cases: false,
            clients: false,
            vault: false,
            research: false,
            navigator: false,
            study: true,
            flashcards: true,
            quizzes: true,
        },
    },
};
function getTier(tierName) {
    return exports.TIERS[tierName] || null;
}
function tierHasFeature(tierName, feature) {
    const tier = getTier(tierName);
    if (!tier)
        return false;
    return tier.features[feature] === true;
}
function getTierDocumentLimit(tierName) {
    const tier = getTier(tierName);
    if (!tier)
        return 0;
    return tier.limits.documentsPerMonth;
}
function tierRequiresAuth(tierName) {
    const tier = getTier(tierName);
    if (!tier)
        return true;
    return tier.requiresAuth;
}
function getTiersWithFeature(feature) {
    return Object.keys(exports.TIERS).filter(tierName => exports.TIERS[tierName].features[feature]);
}
function compareTiers(tier1, tier2) {
    const tierOrder = {
        free: 0,
        student: 1,
        plus: 2,
        pro: 3,
        team: 4,
        firm: 5,
        enterprise: 6,
    };
    return (tierOrder[tier1] ?? 0) - (tierOrder[tier2] ?? 0);
}
function getNextTier(currentTier) {
    const upgradeMap = {
        free: 'plus',
        student: 'plus',
        plus: 'pro',
        pro: 'team',
        team: 'firm',
    };
    return upgradeMap[currentTier] || null;
}
function getTierPriceDisplay(tierName, annual = false) {
    const tier = getTier(tierName);
    if (!tier)
        return '';
    if (tier.price === 0) {
        return tierName === 'enterprise' ? 'Custom' : 'Free';
    }
    const price = annual && tier.priceAnnual ? tier.priceAnnual : tier.price;
    const monthly = annual ? Math.round(price / 12) : price;
    const perSeat = tier.isPerSeat ? '/seat' : '';
    return `$${(monthly / 100).toFixed(0)}${perSeat}/mo`;
}
//# sourceMappingURL=tiers.js.map