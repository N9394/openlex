import { Request } from 'express';
export interface SessionTokens {
    accessToken: string;
    refreshToken: string;
    expiresAt: Date;
    sessionId: string;
}
export interface SessionInfo {
    id: string;
    deviceInfo: {
        browser?: string;
        os?: string;
        device?: string;
    } | null;
    ipAddress: string | null;
    location: string | null;
    lastActivityAt: Date;
    createdAt: Date;
    isCurrent: boolean;
}
export declare function createSession(userId: string, req: Request, alertNewDevice?: boolean): Promise<SessionTokens>;
export declare function refreshSession(refreshToken: string): Promise<SessionTokens | null>;
export declare function validateSession(sessionId: string): Promise<{
    valid: boolean;
    userId?: string;
}>;
export declare function updateSessionActivity(sessionId: string): Promise<void>;
export declare function revokeSession(sessionId: string, userId: string, revokedBy?: string): Promise<boolean>;
export declare function revokeAllSessions(userId: string, exceptSessionId?: string): Promise<number>;
export declare function getActiveSessions(userId: string, currentSessionId?: string): Promise<SessionInfo[]>;
export declare function cleanupExpiredSessions(): Promise<number>;
export declare function getSessionById(sessionId: string): Promise<SessionInfo | null>;
export declare function logout(sessionId: string, userId: string): Promise<void>;
//# sourceMappingURL=sessionService.d.ts.map