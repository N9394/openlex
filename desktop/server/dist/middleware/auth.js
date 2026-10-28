"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authenticateToken = authenticateToken;
exports.optionalAuth = optionalAuth;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const fs = require("fs");
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

// ─── Local mode (airgapped App) ───────────────────────────────────────────
// When LEXVAULT_LOCAL_MODE=1, the Express server is running inside the
// Electron App on the user's machine. Identity comes from the signed license
// file when there is one, else the local community user — there is no login
// flow, no cookies, no account. Every authenticated request is automatically
// the single user on this machine.
const LOCAL_MODE = process.env.LEXVAULT_LOCAL_MODE === '1';
const LICENSE_PATH = process.env.LEXVAULT_LICENSE_PATH || '';
const COMMUNITY_USER = Object.freeze({
    userId: 'local',
    email: 'local@lexvault',
    sessionId: 'local',
    tier: 'community',
    language: 'auto',
    entitlements: [],
    isLocal: true,
});

let _cachedLocalUser = null;
let _cachedLocalUserMtime = 0;

function readLocalUser() {
    if (!LICENSE_PATH || !fs.existsSync(LICENSE_PATH)) return COMMUNITY_USER;
    try {
        const stat = fs.statSync(LICENSE_PATH);
        if (_cachedLocalUser && stat.mtimeMs === _cachedLocalUserMtime) return _cachedLocalUser;
        const signed = JSON.parse(fs.readFileSync(LICENSE_PATH, 'utf8'));
        const p = signed.payload || signed;
        _cachedLocalUser = {
            userId: p.account_id || 'local',
            email: p.email || 'local@lexvault',
            sessionId: 'local',
            tier: p.tier || 'solo',
            language: p.language_pref || 'auto',
            entitlements: (p.entitlements || []).map(e => e.code).filter(Boolean),
            isLocal: true,
        };
        _cachedLocalUserMtime = stat.mtimeMs;
        return _cachedLocalUser;
    } catch (err) {
        console.error('[AUTH] local license read error — using the community user:', err);
        return COMMUNITY_USER;
    }
}

function extractToken(req) {
    // 1. Try httpOnly cookie first
    if (req.cookies && req.cookies.token) {
        return req.cookies.token;
    }
    // 2. Fall back to Authorization header (backward compat)
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        return authHeader.substring(7);
    }
    return null;
}

// In local mode, the User row should be present (localModeBootstrap upserts
// it at server start). But that bootstrap can fail silently — and its result
// isn't observable from here. We do a one-shot upsert lazily on the first
// authenticated request to make ALL downstream handlers safe from foreign-key
// violations. After the first successful upsert this is a no-op.
let _localUserEnsured = false;
async function ensureLocalUserRow(localUser) {
    if (_localUserEnsured) return;
    try {
        const { PrismaClient } = require('@prisma/client');
        const prisma = new PrismaClient();
        await prisma.user.upsert({
            where: { id: localUser.userId },
            create: {
                id: localUser.userId,
                email: localUser.email || 'local@lexvault',
                passwordHash: 'local-mode-no-password',
                name: (localUser.email || 'local').split('@')[0],
                tier: localUser.tier || 'solo',
                language: localUser.language || 'auto',
            },
            update: {},
        });
        await prisma.$disconnect();
        _localUserEnsured = true;
        console.log('[auth] local-mode User row ensured for', localUser.userId);
    } catch (err) {
        console.error('[auth] ensureLocalUserRow failed:', err.message);
    }
}

function authenticateToken(req, res, next) {
    if (LOCAL_MODE) {
        const localUser = readLocalUser();
        if (!localUser) {
            res.status(401).json({ error: 'Unauthorized', message: 'License file missing or invalid. Re-launch via the Launcher.' });
            return;
        }
        req.user = localUser;
        // Fire-and-await on first request so the User row exists before any
        // downstream Prisma write that has a userId FK. After the first call
        // it's a fast in-memory check.
        if (!_localUserEnsured) {
            return ensureLocalUserRow(localUser).then(() => next()).catch(() => next());
        }
        return next();
    }
    const token = extractToken(req);
    if (!token) {
        res.status(401).json({
            error: 'Unauthorized',
            message: 'No token provided. Please log in.',
        });
        return;
    }
    try {
        const decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET);
        req.user = {
            userId: decoded.userId,
            email: decoded.email,
            sessionId: decoded.sessionId,
        };
        next();
    }
    catch (error) {
        if (error instanceof jsonwebtoken_1.default.TokenExpiredError) {
            res.status(401).json({
                error: 'Unauthorized',
                message: 'Token has expired. Please log in again.',
            });
            return;
        }
        if (error instanceof jsonwebtoken_1.default.JsonWebTokenError) {
            res.status(401).json({
                error: 'Unauthorized',
                message: 'Invalid token. Please log in again.',
            });
            return;
        }
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Token verification failed.',
        });
    }
}
function optionalAuth(req, res, next) {
    if (LOCAL_MODE) {
        const localUser = readLocalUser();
        if (localUser) req.user = localUser;
        return next();
    }
    const token = extractToken(req);
    if (!token) {
        return next();
    }
    try {
        const decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET);
        req.user = {
            userId: decoded.userId,
            email: decoded.email,
            sessionId: decoded.sessionId,
        };
    }
    catch (error) {
        console.debug('[AUTH] Optional auth failed, continuing without user');
    }
    next();
}
//# sourceMappingURL=auth.js.map
