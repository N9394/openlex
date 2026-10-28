"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPasswordPolicy = getPasswordPolicy;
exports.validatePasswordPolicy = validatePasswordPolicy;
exports.checkPasswordHistory = checkPasswordHistory;
exports.requestPasswordReset = requestPasswordReset;
exports.resetPassword = resetPassword;
exports.changePassword = changePassword;
exports.checkPasswordExpiry = checkPasswordExpiry;
exports.handleFailedLogin = handleFailedLogin;
exports.resetFailedAttempts = resetFailedAttempts;
exports.isAccountLocked = isAccountLocked;
exports.unlockAccount = unlockAccount;
const client_1 = require("@prisma/client");
const bcrypt_1 = __importDefault(require("bcrypt"));
const crypto_1 = __importDefault(require("crypto"));
const emailService_1 = require("./emailService");
const auditService_1 = require("./auditService");
const prisma = new client_1.PrismaClient();
const DEFAULT_POLICY = {
    minLength: 12,
    requireUppercase: true,
    requireLowercase: true,
    requireNumbers: true,
    requireSymbols: false,
    preventReuse: 5,
    maxAge: 0,
};
async function getPasswordPolicy(organizationId) {
    if (organizationId) {
        const org = await prisma.organization.findUnique({
            where: { id: organizationId },
            select: { settings: true },
        });
        if (org?.settings) {
            try {
                const settings = JSON.parse(org.settings);
                if (settings.passwordPolicy) {
                    return { ...DEFAULT_POLICY, ...settings.passwordPolicy };
                }
            }
            catch {
            }
        }
    }
    return DEFAULT_POLICY;
}
async function validatePasswordPolicy(password, userId) {
    const errors = [];
    let policy = DEFAULT_POLICY;
    if (userId) {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { organizationId: true },
        });
        if (user?.organizationId) {
            policy = await getPasswordPolicy(user.organizationId);
        }
    }
    if (password.length < policy.minLength) {
        errors.push(`Password must be at least ${policy.minLength} characters`);
    }
    if (policy.requireUppercase && !/[A-Z]/.test(password)) {
        errors.push('Password must contain at least one uppercase letter');
    }
    if (policy.requireLowercase && !/[a-z]/.test(password)) {
        errors.push('Password must contain at least one lowercase letter');
    }
    if (policy.requireNumbers && !/\d/.test(password)) {
        errors.push('Password must contain at least one number');
    }
    if (policy.requireSymbols && !/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
        errors.push('Password must contain at least one special character');
    }
    return {
        isValid: errors.length === 0,
        errors,
    };
}
async function checkPasswordHistory(userId, newPassword) {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { passwordHistory: true, organizationId: true },
    });
    if (!user)
        return true;
    const policy = await getPasswordPolicy(user.organizationId || undefined);
    if (policy.preventReuse === 0)
        return true;
    if (!user.passwordHistory)
        return true;
    try {
        const history = JSON.parse(user.passwordHistory);
        const recentHashes = history.slice(0, policy.preventReuse);
        for (const hash of recentHashes) {
            if (await bcrypt_1.default.compare(newPassword, hash)) {
                return false;
            }
        }
    }
    catch {
        return true;
    }
    return true;
}
async function addToPasswordHistory(userId, passwordHash) {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { passwordHistory: true },
    });
    let history = [];
    if (user?.passwordHistory) {
        try {
            history = JSON.parse(user.passwordHistory);
        }
        catch {
            history = [];
        }
    }
    history.unshift(passwordHash);
    history = history.slice(0, 10);
    await prisma.user.update({
        where: { id: userId },
        data: { passwordHistory: JSON.stringify(history) },
    });
}
async function requestPasswordReset(email) {
    const user = await prisma.user.findUnique({
        where: { email: email.toLowerCase() },
    });
    if (!user) {
        console.log(`[PASSWORD] Reset requested for non-existent email: ${email}`);
        return;
    }
    if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
        console.log(`[PASSWORD] Reset requested for locked account: ${email}`);
        return;
    }
    await prisma.passwordResetToken.updateMany({
        where: {
            userId: user.id,
            usedAt: null,
        },
        data: {
            usedAt: new Date(),
        },
    });
    const token = crypto_1.default.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await prisma.passwordResetToken.create({
        data: {
            id: crypto_1.default.randomUUID(),
            userId: user.id,
            token,
            expiresAt,
        },
    });
    try {
        await (0, emailService_1.sendPasswordResetEmail)(user.email, token, user.username || undefined);
        console.log(`[PASSWORD] Reset email sent to: ${email}`);
    }
    catch (error) {
        console.error('[PASSWORD] Failed to send reset email:', error);
        throw new Error('Failed to send reset email');
    }
    await (0, auditService_1.logAuditEvent)(user.id, user.organizationId, {
        action: auditService_1.AUDIT_ACTIONS.PASSWORD_RESET,
        resourceType: auditService_1.RESOURCE_TYPES.USER,
        resourceId: user.id,
        isCompliance: true,
    });
}
async function resetPassword(token, newPassword) {
    const resetToken = await prisma.passwordResetToken.findUnique({
        where: { token },
        include: { user: true },
    });
    if (!resetToken) {
        return { success: false, error: 'Invalid or expired reset token' };
    }
    if (resetToken.usedAt) {
        return { success: false, error: 'This reset token has already been used' };
    }
    if (new Date(resetToken.expiresAt) < new Date()) {
        return { success: false, error: 'Reset token has expired' };
    }
    const policyResult = await validatePasswordPolicy(newPassword, resetToken.userId);
    if (!policyResult.isValid) {
        return { success: false, error: policyResult.errors.join('. ') };
    }
    const historyOk = await checkPasswordHistory(resetToken.userId, newPassword);
    if (!historyOk) {
        return { success: false, error: 'Cannot reuse a recent password' };
    }
    const passwordHash = await bcrypt_1.default.hash(newPassword, 12);
    await addToPasswordHistory(resetToken.userId, resetToken.user.passwordHash);
    await prisma.user.update({
        where: { id: resetToken.userId },
        data: {
            passwordHash,
            passwordChangedAt: new Date(),
            failedLoginAttempts: 0,
            lockedUntil: null,
        },
    });
    await prisma.passwordResetToken.update({
        where: { id: resetToken.id },
        data: { usedAt: new Date() },
    });
    await prisma.userSession.updateMany({
        where: { userId: resetToken.userId },
        data: { isActive: false },
    });
    await (0, auditService_1.logAuditEvent)(resetToken.userId, resetToken.user.organizationId, {
        action: auditService_1.AUDIT_ACTIONS.PASSWORD_RESET,
        resourceType: auditService_1.RESOURCE_TYPES.USER,
        resourceId: resetToken.userId,
        isCompliance: true,
    });
    console.log(`[PASSWORD] Password reset successful for user: ${resetToken.userId}`);
    return { success: true };
}
async function changePassword(userId, currentPassword, newPassword) {
    const user = await prisma.user.findUnique({
        where: { id: userId },
    });
    if (!user) {
        return { success: false, error: 'User not found' };
    }
    const isValid = await bcrypt_1.default.compare(currentPassword, user.passwordHash);
    if (!isValid) {
        return { success: false, error: 'Current password is incorrect' };
    }
    const policyResult = await validatePasswordPolicy(newPassword, userId);
    if (!policyResult.isValid) {
        return { success: false, error: policyResult.errors.join('. ') };
    }
    const historyOk = await checkPasswordHistory(userId, newPassword);
    if (!historyOk) {
        return { success: false, error: 'Cannot reuse a recent password' };
    }
    const passwordHash = await bcrypt_1.default.hash(newPassword, 12);
    await addToPasswordHistory(userId, user.passwordHash);
    await prisma.user.update({
        where: { id: userId },
        data: {
            passwordHash,
            passwordChangedAt: new Date(),
        },
    });
    await (0, auditService_1.logAuditEvent)(userId, user.organizationId, {
        action: auditService_1.AUDIT_ACTIONS.PASSWORD_CHANGE,
        resourceType: auditService_1.RESOURCE_TYPES.USER,
        resourceId: userId,
        isCompliance: true,
    });
    console.log(`[PASSWORD] Password changed for user: ${userId}`);
    return { success: true };
}
async function checkPasswordExpiry(userId) {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { passwordChangedAt: true, organizationId: true },
    });
    if (!user) {
        return { expired: false, daysRemaining: null };
    }
    const policy = await getPasswordPolicy(user.organizationId || undefined);
    if (policy.maxAge === 0) {
        return { expired: false, daysRemaining: null };
    }
    const passwordDate = user.passwordChangedAt || new Date(0);
    const expiryDate = new Date(passwordDate);
    expiryDate.setDate(expiryDate.getDate() + policy.maxAge);
    const now = new Date();
    const expired = now > expiryDate;
    const daysRemaining = Math.max(0, Math.ceil((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
    return { expired, daysRemaining: expired ? 0 : daysRemaining };
}
async function handleFailedLogin(email, ipAddress) {
    const user = await prisma.user.findUnique({
        where: { email: email.toLowerCase() },
    });
    if (!user) {
        return { locked: false };
    }
    const attempts = (user.failedLoginAttempts || 0) + 1;
    let lockedUntil = null;
    let lockDuration;
    if (attempts >= 20) {
        lockedUntil = new Date('2099-12-31');
        lockDuration = -1;
    }
    else if (attempts >= 10) {
        lockedUntil = new Date(Date.now() + 60 * 60 * 1000);
        lockDuration = 60;
    }
    else if (attempts >= 5) {
        lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
        lockDuration = 15;
    }
    await prisma.user.update({
        where: { id: user.id },
        data: {
            failedLoginAttempts: attempts,
            lockedUntil,
        },
    });
    await (0, auditService_1.logAuditEvent)(user.id, user.organizationId, {
        action: auditService_1.AUDIT_ACTIONS.LOGIN_FAILED,
        resourceType: 'session',
        ipAddress,
        newValue: { attempts, locked: !!lockedUntil },
        isCompliance: true,
    });
    if (lockedUntil) {
        console.log(`[PASSWORD] Account locked for user: ${email}, duration: ${lockDuration} minutes`);
    }
    return { locked: !!lockedUntil, lockDuration };
}
async function resetFailedAttempts(userId) {
    await prisma.user.update({
        where: { id: userId },
        data: {
            failedLoginAttempts: 0,
            lockedUntil: null,
        },
    });
}
async function isAccountLocked(email) {
    const user = await prisma.user.findUnique({
        where: { email: email.toLowerCase() },
        select: { lockedUntil: true },
    });
    if (!user || !user.lockedUntil) {
        return { locked: false };
    }
    const lockDate = new Date(user.lockedUntil);
    if (lockDate.getFullYear() >= 2099) {
        return { locked: true, permanent: true };
    }
    if (lockDate > new Date()) {
        return { locked: true, unlockAt: lockDate };
    }
    return { locked: false };
}
async function unlockAccount(userId, adminUserId) {
    await prisma.user.update({
        where: { id: userId },
        data: {
            failedLoginAttempts: 0,
            lockedUntil: null,
        },
    });
    const admin = await prisma.user.findUnique({
        where: { id: adminUserId },
        select: { organizationId: true },
    });
    await (0, auditService_1.logAuditEvent)(adminUserId, admin?.organizationId || null, {
        action: auditService_1.AUDIT_ACTIONS.ADMIN_ACTION,
        resourceType: auditService_1.RESOURCE_TYPES.USER,
        resourceId: userId,
        newValue: { action: 'unlock_account' },
        isCompliance: true,
    });
    console.log(`[PASSWORD] Account unlocked by admin: ${adminUserId} for user: ${userId}`);
}
//# sourceMappingURL=passwordService.js.map