"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireTier = requireTier;
exports.requireFeature = requireFeature;
exports.requireMinTier = requireMinTier;
exports.attachTier = attachTier;
exports.tierRequiresAuth = tierRequiresAuth;
const client_1 = require("@prisma/client");
const tiers_1 = require("../config/tiers");
const prisma = new client_1.PrismaClient();
async function getEffectiveTier(userId) {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
            organization: true,
        },
    });
    if (!user) {
        return 'free';
    }
    if (user.organization?.tier) {
        return user.organization.tier;
    }
    return user.tier || 'free';
}
function requireTier(...allowedTiers) {
    return async (req, res, next) => {
        if (!req.user?.userId) {
            res.status(401).json({
                error: 'Authentication required',
                code: 'AUTH_REQUIRED',
                upgradeUrl: '/pricing',
            });
            return;
        }
        try {
            const effectiveTier = await getEffectiveTier(req.user.userId);
            if (!allowedTiers.includes(effectiveTier)) {
                const requiredTierDisplay = allowedTiers
                    .map(t => tiers_1.TIERS[t]?.displayName)
                    .filter(Boolean)
                    .join(', ');
                res.status(403).json({
                    error: 'Upgrade required',
                    code: 'TIER_REQUIRED',
                    currentTier: effectiveTier,
                    requiredTiers: allowedTiers,
                    message: `This feature requires ${requiredTierDisplay} tier or higher.`,
                    upgradeUrl: '/pricing',
                });
                return;
            }
            req.effectiveTier = effectiveTier;
            req.tierConfig = tiers_1.TIERS[effectiveTier];
            next();
        }
        catch (error) {
            console.error('[TierGate] Error checking tier:', error);
            res.status(500).json({ error: 'Failed to verify access' });
        }
    };
}
function requireFeature(feature) {
    return async (req, res, next) => {
        if (!req.user?.userId) {
            res.status(401).json({
                error: 'Authentication required',
                code: 'AUTH_REQUIRED',
                upgradeUrl: '/pricing',
            });
            return;
        }
        try {
            const effectiveTier = await getEffectiveTier(req.user.userId);
            const tierConfig = (0, tiers_1.getTier)(effectiveTier);
            if (!tierConfig) {
                res.status(403).json({
                    error: 'Invalid tier',
                    code: 'INVALID_TIER',
                    upgradeUrl: '/pricing',
                });
                return;
            }
            if (!tierConfig.features[feature]) {
                const tiersWithFeature = Object.keys(tiers_1.TIERS)
                    .filter(t => tiers_1.TIERS[t].features[feature])
                    .map(t => tiers_1.TIERS[t].displayName);
                res.status(403).json({
                    error: 'Feature not available',
                    code: 'FEATURE_REQUIRED',
                    feature,
                    currentTier: effectiveTier,
                    message: `The "${feature}" feature is available in: ${tiersWithFeature.join(', ')}.`,
                    upgradeUrl: '/pricing',
                });
                return;
            }
            req.effectiveTier = effectiveTier;
            req.tierConfig = tierConfig;
            next();
        }
        catch (error) {
            console.error('[TierGate] Error checking feature:', error);
            res.status(500).json({ error: 'Failed to verify feature access' });
        }
    };
}
function requireMinTier(minTier) {
    return async (req, res, next) => {
        if (!req.user?.userId) {
            res.status(401).json({
                error: 'Authentication required',
                code: 'AUTH_REQUIRED',
                upgradeUrl: '/pricing',
            });
            return;
        }
        try {
            const effectiveTier = await getEffectiveTier(req.user.userId);
            const comparison = (0, tiers_1.compareTiers)(effectiveTier, minTier);
            if (comparison < 0) {
                const minTierConfig = (0, tiers_1.getTier)(minTier);
                res.status(403).json({
                    error: 'Upgrade required',
                    code: 'MIN_TIER_REQUIRED',
                    currentTier: effectiveTier,
                    requiredTier: minTier,
                    message: `This feature requires ${minTierConfig?.displayName || minTier} tier or higher.`,
                    upgradeUrl: '/pricing',
                });
                return;
            }
            req.effectiveTier = effectiveTier;
            req.tierConfig = tiers_1.TIERS[effectiveTier];
            next();
        }
        catch (error) {
            console.error('[TierGate] Error checking min tier:', error);
            res.status(500).json({ error: 'Failed to verify access' });
        }
    };
}
function attachTier(req, _res, next) {
    (async () => {
        try {
            if (req.user?.userId) {
                const effectiveTier = await getEffectiveTier(req.user.userId);
                req.effectiveTier = effectiveTier;
                req.tierConfig = tiers_1.TIERS[effectiveTier];
            }
            else {
                req.effectiveTier = 'free';
                req.tierConfig = tiers_1.TIERS.free;
            }
            next();
        }
        catch (error) {
            console.error('[TierGate] Error attaching tier:', error);
            req.effectiveTier = 'free';
            req.tierConfig = tiers_1.TIERS.free;
            next();
        }
    })();
}
function tierRequiresAuth(tierName) {
    const tier = (0, tiers_1.getTier)(tierName);
    return tier?.requiresAuth ?? true;
}
//# sourceMappingURL=tierGate.js.map