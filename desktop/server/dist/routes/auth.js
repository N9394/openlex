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
const router = express_1.default.Router();
const prisma = new client_1.PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const JWT_EXPIRES_IN = '7d';
const BCRYPT_ROUNDS = 12;
const signupSchema = zod_1.z.object({
    email: zod_1.z.string().email('Invalid email address'),
    password: zod_1.z.string()
        .min(8, 'Password must be at least 8 characters')
        .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
        .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
        .regex(/[0-9]/, 'Password must contain at least one number'),
});
function generateToken(userId, email) {
    return jsonwebtoken_1.default.sign({ userId, email }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}
router.post('/signup', async (req, res, next) => {
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
        const token = generateToken(user.id, user.email);
        res.status(201).json({
            token,
            user: { id: user.id, email: user.email, tier: user.tier },
        });
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            return res.status(400).json({ error: error.errors[0].message });
        }
        next(error);
    }
});
router.post('/login', async (req, res, next) => {
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
        res.json({
            token,
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
router.post('/forgot-password', async (req, res, next) => {
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
router.post('/reset-password', async (req, res, next) => {
    try {
        const { token, password } = req.body;
        if (!token || !password) {
            return res.status(400).json({ error: 'Token and password required' });
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
exports.default = router;
//# sourceMappingURL=auth.js.map