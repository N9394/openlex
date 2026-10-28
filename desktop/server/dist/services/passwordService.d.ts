export interface PasswordPolicy {
    minLength: number;
    requireUppercase: boolean;
    requireLowercase: boolean;
    requireNumbers: boolean;
    requireSymbols: boolean;
    preventReuse: number;
    maxAge: number;
}
export interface PolicyResult {
    isValid: boolean;
    errors: string[];
}
export declare function getPasswordPolicy(organizationId?: string): Promise<PasswordPolicy>;
export declare function validatePasswordPolicy(password: string, userId?: string): Promise<PolicyResult>;
export declare function checkPasswordHistory(userId: string, newPassword: string): Promise<boolean>;
export declare function requestPasswordReset(email: string): Promise<void>;
export declare function resetPassword(token: string, newPassword: string): Promise<{
    success: boolean;
    error?: string;
}>;
export declare function changePassword(userId: string, currentPassword: string, newPassword: string): Promise<{
    success: boolean;
    error?: string;
}>;
export declare function checkPasswordExpiry(userId: string): Promise<{
    expired: boolean;
    daysRemaining: number | null;
}>;
export declare function handleFailedLogin(email: string, ipAddress?: string): Promise<{
    locked: boolean;
    lockDuration?: number;
}>;
export declare function resetFailedAttempts(userId: string): Promise<void>;
export declare function isAccountLocked(email: string): Promise<{
    locked: boolean;
    unlockAt?: Date;
    permanent?: boolean;
}>;
export declare function unlockAccount(userId: string, adminUserId: string): Promise<void>;
//# sourceMappingURL=passwordService.d.ts.map