"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSession = createSession;
exports.refreshSession = refreshSession;
exports.validateSession = validateSession;
exports.updateSessionActivity = updateSessionActivity;
exports.revokeSession = revokeSession;
exports.revokeAllSessions = revokeAllSessions;
exports.getActiveSessions = getActiveSessions;
exports.cleanupExpiredSessions = cleanupExpiredSessions;
exports.getSessionById = getSessionById;
exports.logout = logout;
const client_1 = require("@prisma/client");
const crypto_1 = __importDefault(require("crypto"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const auditService_1 = require("./auditService");
const emailService_1 = require("./emailService");
const prisma = new client_1.PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_CONFIG = {
    maxConcurrentSessions: 5,
    sessionTimeout: 8 * 60 * 60,
    absoluteTimeout: 7 * 24 * 60 * 60,
};
function parseUserAgent(userAgent) {
    if (!userAgent)
        return {};
    const info = {};
    if (userAgent.includes('Firefox')) {
        info.browser = 'Firefox';
    }
    else if (userAgent.includes('Chrome') && !userAgent.includes('Edg')) {
        info.browser = 'Chrome';
    }
    else if (userAgent.includes('Safari') && !userAgent.includes('Chrome')) {
        info.browser = 'Safari';
    }
    else if (userAgent.includes('Edg')) {
        info.browser = 'Edge';
    }
    else if (userAgent.includes('MSIE') || userAgent.includes('Trident')) {
        info.browser = 'Internet Explorer';
    }
    if (userAgent.includes('Windows')) {
        info.os = 'Windows';
    }
    else if (userAgent.includes('Mac OS')) {
        info.os = 'macOS';
    }
    else if (userAgent.includes('Linux')) {
        info.os = 'Linux';
    }
    else if (userAgent.includes('Android')) {
        info.os = 'Android';
    }
    else if (userAgent.includes('iOS') || userAgent.includes('iPhone') || userAgent.includes('iPad')) {
        info.os = 'iOS';
    }
    if (userAgent.includes('Mobile') || userAgent.includes('Android')) {
        info.device = 'Mobile';
    }
    else if (userAgent.includes('Tablet') || userAgent.includes('iPad')) {
        info.device = 'Tablet';
    }
    else {
        info.device = 'Desktop';
    }
    return info;
}
async function getSessionConfig(organizationId) {
    if (organizationId) {
        const org = await prisma.organization.findUnique({
            where: { id: organizationId },
            select: { settings: true },
        });
        if (org?.settings) {
            try {
                const settings = JSON.parse(org.settings);
                if (settings.sessionPolicy) {
                    return { ...DEFAULT_CONFIG, ...settings.sessionPolicy };
                }
            }
            catch {
            }
        }
    }
    return DEFAULT_CONFIG;
}
function generateTokens() {
    return {
        token: crypto_1.default.randomBytes(32).toString('hex'),
        refreshToken: crypto_1.default.randomBytes(32).toString('hex'),
    };
}
async function createSession(userId, req, alertNewDevice = true) {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, username: true, organizationId: true },
    });
    if (!user) {
        throw new Error('User not found');
    }
    const config = await getSessionConfig(user.organizationId || undefined);
    const activeSessions = await prisma.userSession.count({
        where: {
            userId,
            isActive: true,
            expiresAt: { gt: new Date() },
        },
    });
    if (activeSessions >= config.maxConcurrentSessions) {
        const oldestSession = await prisma.userSession.findFirst({
            where: {
                userId,
                isActive: true,
            },
            orderBy: { createdAt: 'asc' },
        });
        if (oldestSession) {
            await prisma.userSession.update({
                where: { id: oldestSession.id },
                data: { isActive: false },
            });
        }
    }
    const { token, refreshToken } = generateTokens();
    const userAgent = req.headers['user-agent'];
    const deviceInfo = parseUserAgent(userAgent);
    const ipAddress = req.ip || req.socket.remoteAddress || null;
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS);
    const session = await prisma.userSession.create({
        data: {
            id: crypto_1.default.randomUUID(),
            userId,
            token,
            refreshToken,
            deviceInfo: JSON.stringify(deviceInfo),
            ipAddress,
            userAgent: userAgent || null,
            location: null,
            isActive: true,
            lastActivityAt: new Date(),
            expiresAt,
        },
    });
    const accessToken = jsonwebtoken_1.default.sign({
        userId,
        email: user.email,
        sessionId: session.id,
    }, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });
    if (alertNewDevice) {
        const existingSessions = await prisma.userSession.findMany({
            where: {
                userId,
                id: { not: session.id },
                deviceInfo: JSON.stringify(deviceInfo),
            },
            take: 1,
        });
        if (existingSessions.length === 0) {
            try {
                await (0, emailService_1.sendNewDeviceLoginAlert)(user.email, {
                    ...deviceInfo,
                    ipAddress: ipAddress || undefined,
                }, user.username || undefined);
            }
            catch (error) {
                console.error('[SESSION] Failed to send new device alert:', error);
            }
        }
    }
    await (0, auditService_1.logAuditEvent)(userId, user.organizationId, {
        action: auditService_1.AUDIT_ACTIONS.LOGIN,
        resourceType: 'session',
        resourceId: session.id,
        ipAddress: ipAddress || undefined,
        userAgent,
        newValue: deviceInfo,
        isCompliance: true,
    });
    console.log(`[SESSION] Created session ${session.id} for user ${userId}`);
    return {
        accessToken,
        refreshToken,
        expiresAt,
        sessionId: session.id,
    };
}
async function refreshSession(refreshToken) {
    const session = await prisma.userSession.findUnique({
        where: { refreshToken },
        include: { user: true },
    });
    if (!session) {
        console.log('[SESSION] Refresh failed: session not found');
        return null;
    }
    if (!session.isActive) {
        console.log('[SESSION] Refresh failed: session inactive');
        return null;
    }
    if (new Date(session.expiresAt) < new Date()) {
        console.log('[SESSION] Refresh failed: session expired');
        await prisma.userSession.update({
            where: { id: session.id },
            data: { isActive: false },
        });
        return null;
    }
    const config = await getSessionConfig(session.user.organizationId || undefined);
    const inactivityLimit = new Date(session.lastActivityAt.getTime() + config.sessionTimeout * 1000);
    if (new Date() > inactivityLimit) {
        console.log('[SESSION] Refresh failed: inactivity timeout');
        await prisma.userSession.update({
            where: { id: session.id },
            data: { isActive: false },
        });
        return null;
    }
    const { token: newToken, refreshToken: newRefreshToken } = generateTokens();
    const newExpiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS);
    await prisma.userSession.update({
        where: { id: session.id },
        data: {
            token: newToken,
            refreshToken: newRefreshToken,
            lastActivityAt: new Date(),
            expiresAt: newExpiresAt,
        },
    });
    const accessToken = jsonwebtoken_1.default.sign({
        userId: session.userId,
        email: session.user.email,
        sessionId: session.id,
    }, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });
    console.log(`[SESSION] Refreshed session ${session.id}`);
    return {
        accessToken,
        refreshToken: newRefreshToken,
        expiresAt: newExpiresAt,
        sessionId: session.id,
    };
}
async function validateSession(sessionId) {
    const session = await prisma.userSession.findUnique({
        where: { id: sessionId },
        select: {
            userId: true,
            isActive: true,
            expiresAt: true,
            lastActivityAt: true,
            user: {
                select: { organizationId: true },
            },
        },
    });
    if (!session || !session.isActive) {
        return { valid: false };
    }
    if (new Date(session.expiresAt) < new Date()) {
        return { valid: false };
    }
    const config = await getSessionConfig(session.user.organizationId || undefined);
    const inactivityLimit = new Date(session.lastActivityAt.getTime() + config.sessionTimeout * 1000);
    if (new Date() > inactivityLimit) {
        return { valid: false };
    }
    return { valid: true, userId: session.userId };
}
async function updateSessionActivity(sessionId) {
    await prisma.userSession.update({
        where: { id: sessionId },
        data: { lastActivityAt: new Date() },
    });
}
async function revokeSession(sessionId, userId, revokedBy) {
    const session = await prisma.userSession.findUnique({
        where: { id: sessionId },
        include: { user: true },
    });
    if (!session || session.userId !== userId) {
        return false;
    }
    await prisma.userSession.update({
        where: { id: sessionId },
        data: { isActive: false },
    });
    await (0, auditService_1.logAuditEvent)(revokedBy || userId, session.user.organizationId, {
        action: 'session.revoke',
        resourceType: 'session',
        resourceId: sessionId,
        newValue: { revokedBy: revokedBy || userId },
        isCompliance: true,
    });
    console.log(`[SESSION] Revoked session ${sessionId}`);
    return true;
}
async function revokeAllSessions(userId, exceptSessionId) {
    const where = {
        userId,
        isActive: true,
    };
    if (exceptSessionId) {
        where.id = { not: exceptSessionId };
    }
    const result = await prisma.userSession.updateMany({
        where,
        data: { isActive: false },
    });
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { organizationId: true },
    });
    await (0, auditService_1.logAuditEvent)(userId, user?.organizationId || null, {
        action: 'session.revoke_all',
        resourceType: 'session',
        newValue: { count: result.count, exceptSessionId },
        isCompliance: true,
    });
    console.log(`[SESSION] Revoked ${result.count} sessions for user ${userId}`);
    return result.count;
}
async function getActiveSessions(userId, currentSessionId) {
    const sessions = await prisma.userSession.findMany({
        where: {
            userId,
            isActive: true,
            expiresAt: { gt: new Date() },
        },
        orderBy: { lastActivityAt: 'desc' },
    });
    return sessions.map((session) => ({
        id: session.id,
        deviceInfo: session.deviceInfo ? JSON.parse(session.deviceInfo) : null,
        ipAddress: session.ipAddress,
        location: session.location,
        lastActivityAt: session.lastActivityAt,
        createdAt: session.createdAt,
        isCurrent: session.id === currentSessionId,
    }));
}
async function cleanupExpiredSessions() {
    const result = await prisma.userSession.deleteMany({
        where: {
            OR: [
                { expiresAt: { lt: new Date() } },
                {
                    isActive: false,
                    createdAt: { lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
                },
            ],
        },
    });
    console.log(`[SESSION] Cleaned up ${result.count} expired sessions`);
    return result.count;
}
async function getSessionById(sessionId) {
    const session = await prisma.userSession.findUnique({
        where: { id: sessionId },
    });
    if (!session)
        return null;
    return {
        id: session.id,
        deviceInfo: session.deviceInfo ? JSON.parse(session.deviceInfo) : null,
        ipAddress: session.ipAddress,
        location: session.location,
        lastActivityAt: session.lastActivityAt,
        createdAt: session.createdAt,
        isCurrent: false,
    };
}
async function logout(sessionId, userId) {
    await revokeSession(sessionId, userId);
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { organizationId: true },
    });
    await (0, auditService_1.logAuditEvent)(userId, user?.organizationId || null, {
        action: auditService_1.AUDIT_ACTIONS.LOGOUT,
        resourceType: 'session',
        resourceId: sessionId,
        isCompliance: true,
    });
    console.log(`[SESSION] User ${userId} logged out`);
}
//# sourceMappingURL=sessionService.js.map