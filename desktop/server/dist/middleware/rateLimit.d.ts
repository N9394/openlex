export declare const loginLimiter: import("express-rate-limit").RateLimitRequestHandler;
export declare const passwordResetLimiter: import("express-rate-limit").RateLimitRequestHandler;
export declare const mfaLimiter: import("express-rate-limit").RateLimitRequestHandler;
export declare const signupLimiter: import("express-rate-limit").RateLimitRequestHandler;
export declare const apiLimiter: import("express-rate-limit").RateLimitRequestHandler;
export declare const strictApiLimiter: import("express-rate-limit").RateLimitRequestHandler;
export declare const ssoLimiter: import("express-rate-limit").RateLimitRequestHandler;
export declare const sessionLimiter: import("express-rate-limit").RateLimitRequestHandler;
export declare const uploadLimiter: import("express-rate-limit").RateLimitRequestHandler;
export declare const exportLimiter: import("express-rate-limit").RateLimitRequestHandler;
export declare function createRateLimiter(options: {
    windowMs: number;
    max: number;
    message?: string;
    keyPrefix?: string;
}): import("express-rate-limit").RateLimitRequestHandler;
//# sourceMappingURL=rateLimit.d.ts.map