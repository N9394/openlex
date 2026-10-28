"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.exportLimiter = exports.uploadLimiter = exports.sessionLimiter = exports.ssoLimiter = exports.strictApiLimiter = exports.apiLimiter = exports.signupLimiter = exports.mfaLimiter = exports.passwordResetLimiter = exports.loginLimiter = void 0;
exports.createRateLimiter = createRateLimiter;
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const getUserOrIpKey = (req) => {
    if (req.user?.userId) {
        return `user:${req.user.userId}`;
    }
    return `ip:${req.ip || req.socket.remoteAddress || 'unknown'}`;
};
const rateLimitHandler = (_req, res) => {
    res.status(429).json({
        error: 'Too many requests',
        message: 'Please try again later',
        retryAfter: res.get('Retry-After'),
    });
};
exports.loginLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: {
        error: 'Too many login attempts',
        message: 'Please try again in 15 minutes',
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `login:${req.ip}`,
    handler: rateLimitHandler,
    skip: (_req) => {
        return process.env.NODE_ENV === 'test';
    },
});
exports.passwordResetLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 60 * 1000,
    max: 3,
    message: {
        error: 'Too many password reset requests',
        message: 'Please try again in 1 hour',
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `reset:${req.ip}`,
    handler: rateLimitHandler,
});
exports.mfaLimiter = (0, express_rate_limit_1.default)({
    windowMs: 5 * 60 * 1000,
    max: 10,
    message: {
        error: 'Too many MFA verification attempts',
        message: 'Please try again in 5 minutes',
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: getUserOrIpKey,
    handler: rateLimitHandler,
});
exports.signupLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 60 * 1000,
    max: 5,
    message: {
        error: 'Too many accounts created',
        message: 'Please try again later',
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `signup:${req.ip}`,
    handler: rateLimitHandler,
});
exports.apiLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 1000,
    max: 100,
    message: {
        error: 'Too many requests',
        message: 'Please slow down',
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: getUserOrIpKey,
    handler: rateLimitHandler,
    skip: (req) => {
        return req.path === '/health';
    },
});
exports.strictApiLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 1000,
    max: 20,
    message: {
        error: 'Too many requests',
        message: 'This operation is rate limited. Please wait.',
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: getUserOrIpKey,
    handler: rateLimitHandler,
});
exports.ssoLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 1000,
    max: 10,
    message: {
        error: 'Too many SSO attempts',
        message: 'Please try again in a minute',
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `sso:${req.ip}`,
    handler: rateLimitHandler,
});
exports.sessionLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 1000,
    max: 30,
    message: {
        error: 'Too many session operations',
        message: 'Please slow down',
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: getUserOrIpKey,
    handler: rateLimitHandler,
});
exports.uploadLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 60 * 1000,
    max: 20,
    message: {
        error: 'Upload limit reached',
        message: 'Please try again later',
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: getUserOrIpKey,
    handler: rateLimitHandler,
});
exports.exportLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 60 * 1000,
    max: 10,
    message: {
        error: 'Export limit reached',
        message: 'Please try again later',
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: getUserOrIpKey,
    handler: rateLimitHandler,
});
function createRateLimiter(options) {
    return (0, express_rate_limit_1.default)({
        windowMs: options.windowMs,
        max: options.max,
        message: {
            error: 'Rate limit exceeded',
            message: options.message || 'Please try again later',
        },
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req) => `${options.keyPrefix || 'custom'}:${getUserOrIpKey(req)}`,
        handler: rateLimitHandler,
    });
}
//# sourceMappingURL=rateLimit.js.map