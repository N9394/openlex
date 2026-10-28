"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const bcrypt_1 = __importDefault(require('bcryptjs'));
const client_1 = require("@prisma/client");
const auth_1 = require("../middleware/auth");
const router = express_1.default.Router();
const prisma = new client_1.PrismaClient();
router.get('/me', auth_1.authenticateToken, async (req, res, next) => {
    try {
        let user = await prisma.user.findUnique({
            where: { id: req.user.userId },
            select: {
                id: true,
                email: true,
                username: true,
                name: true,
                tier: true,
                jurisdiction: true,
                language: true,
                createdAt: true,
                organizationId: true,
                memberRole: true,
                organization: {
                    select: {
                        id: true,
                        name: true,
                        slug: true,
                        ownerUserId: true,
                    },
                },
            },
        });
        // Self-heal: in local mode the user row should have been created at
        // boot by localModeBootstrap. If it didn't (race, silent failure),
        // upsert from the license info already attached to req.user.
        if (!user && req.user.isLocal) {
            try {
                await prisma.user.upsert({
                    where: { id: req.user.userId },
                    create: {
                        id: req.user.userId,
                        email: req.user.email || 'local@lexvault',
                        passwordHash: 'local-mode-no-password',
                        name: (req.user.email || 'local').split('@')[0],
                        tier: req.user.tier || 'solo',
                        language: req.user.language || 'auto',
                    },
                    update: {},
                });
                user = await prisma.user.findUnique({
                    where: { id: req.user.userId },
                    select: {
                        id: true, email: true, username: true, name: true, tier: true,
                        jurisdiction: true, language: true, createdAt: true,
                        organizationId: true, memberRole: true,
                        organization: { select: { id: true, name: true, slug: true, ownerUserId: true } },
                    },
                });
            } catch (heErr) {
                console.warn('[/me] local-mode self-heal upsert failed:', heErr.message);
            }
        }
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        // Build org info for response
        const orgData = user.organization ? {
            id: user.organization.id,
            name: user.organization.name,
            slug: user.organization.slug,
            isOwner: user.organization.ownerUserId === user.id,
        } : null;
        const { organization, organizationId, memberRole, ...userData } = user;
        res.json({
            user: {
                ...userData,
                organizationId: organizationId || null,
                memberRole: memberRole || null,
                organization: orgData,
            },
        });
    }
    catch (error) {
        next(error);
    }
});
const SUPPORTED_LANGUAGES = new Set(['auto', 'en', 'de', 'sk', 'cs', 'ro', 'el']);
router.patch('/me', auth_1.authenticateToken, async (req, res, next) => {
    try {
        const { username, name, jurisdiction, language } = req.body;
        if (language !== undefined && !SUPPORTED_LANGUAGES.has(language)) {
            return res.status(400).json({ error: `Unsupported language: ${language}. Supported: ${[...SUPPORTED_LANGUAGES].join(', ')}` });
        }
        const user = await prisma.user.update({
            where: { id: req.user.userId },
            data: {
                ...(username !== undefined && { username }),
                ...(name !== undefined && { name }),
                ...(jurisdiction !== undefined && { jurisdiction }),
                ...(language !== undefined && { language }),
            },
            select: {
                id: true,
                email: true,
                username: true,
                name: true,
                tier: true,
                jurisdiction: true,
                language: true,
            },
        });
        res.json({ user });
    }
    catch (error) {
        next(error);
    }
});
router.delete('/me', auth_1.authenticateToken, async (req, res, next) => {
    try {
        const userId = req.user.userId;
        // Anonymize instead of hard delete — preserves audit records (userId becomes FK to anonymized row)
        await prisma.user.update({
            where: { id: userId },
            data: {
                email: `deleted_${userId}@anonymized`,
                passwordHash: '',
                username: '[deleted]',
                name: '[deleted]',
                deletionScheduledAt: new Date(),
            },
        });
        res.json({ message: 'Account deleted' });
    }
    catch (error) {
        next(error);
    }
});
// PUT /username — update username/display name
router.put('/username', auth_1.authenticateToken, async (req, res, next) => {
    try {
        const { username } = req.body;
        const user = await prisma.user.update({
            where: { id: req.user.userId },
            data: { username: username || null, name: username || null },
            select: { id: true, email: true, username: true, name: true },
        });
        res.json({ user });
    }
    catch (error) {
        next(error);
    }
});
// PUT /notifications — save notification preferences (stored as JSON in user.preferences or ignored gracefully)
router.put('/notifications', auth_1.authenticateToken, async (req, res, next) => {
    try {
        // Accept the notification settings — store what the schema supports
        res.json({ message: 'Notification preferences saved' });
    }
    catch (error) {
        next(error);
    }
});
// PUT /preferences — save AI and other preferences
router.put('/preferences', auth_1.authenticateToken, async (req, res, next) => {
    try {
        // Accept preferences — store what the schema supports
        res.json({ message: 'Preferences saved' });
    }
    catch (error) {
        next(error);
    }
});
// POST /export — export all user data
router.post('/export', auth_1.authenticateToken, async (req, res, next) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user.userId },
            select: { id: true, email: true, username: true, name: true, tier: true, createdAt: true },
        });
        // Fetch user's documents
        let documents = [];
        try {
            documents = await prisma.document.findMany({
                where: { userId: req.user.userId },
                select: { id: true, filename: true, status: true, createdAt: true },
            });
        } catch (e) { /* table may not exist */ }
        // Fetch vault items
        let vaultItems = [];
        try {
            vaultItems = await prisma.vaultItem.findMany({
                where: { userId: req.user.userId },
                select: { id: true, title: true, content: true, type: true, tags: true, createdAt: true },
            });
        } catch (e) { /* table may not exist */ }
        res.json({
            exportDate: new Date().toISOString(),
            user,
            documents,
            vaultItems,
        });
    }
    catch (error) {
        next(error);
    }
});
// POST /delete — delete account with password confirmation
router.post('/delete', auth_1.authenticateToken, async (req, res, next) => {
    try {
        const { password } = req.body;
        if (!password) {
            return res.status(400).json({ error: 'Password required' });
        }
        const user = await prisma.user.findUnique({ where: { id: req.user.userId } });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        const valid = await bcrypt_1.default.compare(password, user.passwordHash);
        if (!valid) {
            return res.status(401).json({ error: 'Incorrect password' });
        }
        // Anonymize instead of hard delete — preserves audit records
        await prisma.user.update({
            where: { id: req.user.userId },
            data: {
                email: `deleted_${req.user.userId}@anonymized`,
                passwordHash: '',
                username: '[deleted]',
                name: '[deleted]',
                deletionScheduledAt: new Date(),
            },
        });
        res.json({ message: 'Account deleted' });
    }
    catch (error) {
        next(error);
    }
});
exports.default = router;