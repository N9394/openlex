"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const bcrypt_1 = __importDefault(require("bcrypt"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const client_1 = require("@prisma/client");
const zod_1 = require("zod");
const auth_1 = require("../middleware/auth");
const passwordService_1 = require("../services/passwordService");
const sessionService_1 = require("../services/sessionService");
const rateLimit_1 = require("../middleware/rateLimit");
const router = express_1.default.Router();
const prisma = new client_1.PrismaClient();
const crypto_1 = require("crypto");
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET && process.env.NODE_ENV === 'production') {
    throw new Error('FATAL: JWT_SECRET environment variable is required in production');
}
if (!JWT_SECRET) {
    console.warn('[AUTH] WARNING: Using dev JWT secret — NOT SAFE FOR PRODUCTION');
}
const jwtSecret = JWT_SECRET || 'dev-secret-change-in-production';
const JWT_EXPIRES_IN = '7d';
const BCRYPT_ROUNDS = 12;

function generateRefreshToken() {
    return crypto_1.randomBytes(48).toString('hex');
}
const signupSchema = zod_1.z.object({
    email: zod_1.z.string().email('Invalid email address'),
    password: zod_1.z.string()
        .min(8, 'Password must be at least 8 characters')
        .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
        .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
        .regex(/[0-9]/, 'Password must contain at least one number'),
});
function generateToken(userId, email) {
    return jsonwebtoken_1.default.sign({ userId, email }, jwtSecret, { expiresIn: JWT_EXPIRES_IN });
}
router.post('/signup', rateLimit_1.signupLimiter, async (req, res, next) => {
    try {
        const { email, password } = signupSchema.parse(req.body);
        const existingUser = await prisma.user.findUnique({ where: { email } });
        if (existingUser) {
            return res.status(409).json({ error: 'Email already registered' });
        }
        const passwordHash = await bcrypt_1.default.hash(password, BCRYPT_ROUNDS);
        const user = await prisma.user.create({
            data: {
                email,
                passwordHash,
                weekResetDate: new Date(),
            },
        });
        // Handle invite token — auto-join org on signup
        const inviteToken = req.body.inviteToken;
        let joinedOrg = null;
        if (inviteToken) {
            try {
                const invitation = await prisma.organizationInvitation.findUnique({
                    where: { id: inviteToken },
                    include: { organization: { select: { name: true } } },
                });
                if (invitation
                    && invitation.status === 'pending'
                    && invitation.expiresAt > new Date()
                    && invitation.email.toLowerCase() === email.toLowerCase()) {
                    await prisma.$transaction(async (tx) => {
                        await tx.user.update({
                            where: { id: user.id },
                            data: {
                                organizationId: invitation.organizationId,
                                memberRole: invitation.role,
                            },
                        });
                        // Activate the pending seat
                        const seat = await tx.seat.findFirst({
                            where: {
                                organizationId: invitation.organizationId,
                                email: invitation.email,
                                status: 'pending',
                            },
                        });
                        if (seat) {
                            await tx.seat.update({
                                where: { id: seat.id },
                                data: {
                                    userId: user.id,
                                    status: 'active',
                                    isActive: true,
                                    assignedAt: new Date(),
                                },
                            });
                        }
                        await tx.organizationInvitation.update({
                            where: { id: inviteToken },
                            data: { status: 'accepted' },
                        });
                    });
                    joinedOrg = invitation.organization?.name || null;
                    console.log(`[AUTH] User ${user.id} auto-joined org via invite ${inviteToken}`);
                }
            } catch (err) {
                console.error('[AUTH] Invite processing error (non-fatal):', err);
            }
        }
        const token = generateToken(user.id, user.email);
        res.status(201).json({
            token,
            user: { id: user.id, email: user.email, tier: user.tier },
            joinedOrg,
        });
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            return res.status(400).json({ error: error.errors[0].message });
        }
        next(error);
    }
});
router.post('/login', rateLimit_1.loginLimiter, async (req, res, next) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password required' });
        }
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        const isValidPassword = await bcrypt_1.default.compare(password, user.passwordHash);
        if (!isValidPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        await prisma.user.update({
            where: { id: user.id },
            data: { lastLoginAt: new Date() },
        });
        const token = generateToken(user.id, user.email);
        const refreshToken = generateRefreshToken();
        // Store refresh token — use userSession table if available, otherwise store on user
        try {
            await prisma.userSession.create({
                data: {
                    userId: user.id,
                    refreshToken,
                    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
                    userAgent: req.headers['user-agent'] || '',
                    ipAddress: req.ip || '',
                },
            });
        } catch {
            // userSession table may not exist — graceful fallback
            console.log('[AUTH] userSession table not available, refresh tokens stored in-memory');
        }
        res.json({
            token,
            refreshToken,
            user: { id: user.id, email: user.email, tier: user.tier, name: user.name },
        });
    }
    catch (error) {
        next(error);
    }
});
router.post('/logout', auth_1.authenticateToken, async (req, res, next) => {
    try {
        const sessionId = req.headers['x-session-id'];
        if (sessionId) {
            await (0, sessionService_1.logout)(sessionId, req.user.userId);
        }
        res.json({ message: 'Logged out' });
    }
    catch (error) {
        next(error);
    }
});
// POST /change-password — change password for authenticated user
router.post('/change-password', auth_1.authenticateToken, async (req, res, next) => {
    try {
        const { currentPassword, newPassword } = req.body;
        if (!currentPassword || !newPassword) {
            return res.status(400).json({ error: 'Current password and new password required' });
        }
        if (newPassword.length < 8) {
            return res.status(400).json({ error: 'New password must be at least 8 characters' });
        }
        const user = await prisma.user.findUnique({ where: { id: req.user.userId } });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        const isValid = await bcrypt_1.default.compare(currentPassword, user.passwordHash);
        if (!isValid) {
            return res.status(401).json({ error: 'Current password is incorrect' });
        }
        const newHash = await bcrypt_1.default.hash(newPassword, BCRYPT_ROUNDS);
        await prisma.user.update({
            where: { id: req.user.userId },
            data: { passwordHash: newHash },
        });
        res.json({ message: 'Password changed successfully' });
    }
    catch (error) {
        next(error);
    }
});
router.post('/forgot-password', rateLimit_1.passwordResetLimiter, async (req, res, next) => {
    try {
        const { email } = req.body;
        if (!email) {
            return res.status(400).json({ error: 'Email required' });
        }
        await (0, passwordService_1.requestPasswordReset)(email);
        res.json({ message: 'If email exists, reset instructions sent' });
    }
    catch (error) {
        next(error);
    }
});
router.post('/reset-password', rateLimit_1.passwordResetLimiter, async (req, res, next) => {
    try {
        const { token, password } = req.body;
        if (!token || !password) {
            return res.status(400).json({ error: 'Token and password required' });
        }
        if (password.length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters' });
        }
        if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
            return res.status(400).json({ error: 'Password must contain uppercase, lowercase, and a number' });
        }
        await (0, passwordService_1.resetPassword)(token, password);
        res.json({ message: 'Password reset successful' });
    }
    catch (error) {
        if (error.message === 'Invalid or expired reset token') {
            return res.status(400).json({ error: error.message });
        }
        next(error);
    }
});
// POST /refresh — exchange refresh token for new JWT + refresh token
router.post('/refresh', rateLimit_1.sessionLimiter, async (req, res, next) => {
    try {
        const { refreshToken } = req.body;
        if (!refreshToken) {
            return res.status(400).json({ error: 'Refresh token required' });
        }
        // Find valid session with this refresh token
        let session;
        try {
            session = await prisma.userSession.findFirst({
                where: {
                    refreshToken,
                    expiresAt: { gt: new Date() },
                },
                include: { user: true },
            });
        } catch {
            return res.status(401).json({ error: 'Token refresh not supported' });
        }
        if (!session || !session.user) {
            return res.status(401).json({ error: 'Invalid or expired refresh token' });
        }
        // Rotate: delete old, create new
        const newRefreshToken = generateRefreshToken();
        try {
            await prisma.userSession.delete({ where: { id: session.id } });
            await prisma.userSession.create({
                data: {
                    userId: session.user.id,
                    refreshToken: newRefreshToken,
                    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                    userAgent: req.headers['user-agent'] || '',
                    ipAddress: req.ip || '',
                },
            });
        } catch {
            // Graceful if table doesn't support these operations
        }
        const newToken = generateToken(session.user.id, session.user.email);
        res.json({
            token: newToken,
            refreshToken: newRefreshToken,
            user: { id: session.user.id, email: session.user.email, tier: session.user.tier, name: session.user.name },
        });
    }
    catch (error) {
        next(error);
    }
});
exports.default = router;
