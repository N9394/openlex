export interface AuditLogInput {
    action: string;
    resourceType: string;
    resourceId?: string;
    previousValue?: any;
    newValue?: any;
    ipAddress?: string;
    userAgent?: string;
    requestId?: string;
    isCompliance?: boolean;
}
export interface AuditLogEntry {
    id: string;
    createdAt: Date;
    userId: string;
    userName?: string;
    action: string;
    resource: string;
    resourceId?: string;
    previousValue?: any;
    newValue?: any;
    ipAddress?: string;
}
export interface AuditLogFilter {
    userId?: string;
    action?: string;
    resource?: string;
    resourceId?: string;
    startDate?: Date;
    endDate?: Date;
    ipAddress?: string;
}
export declare const AUDIT_ACTIONS: {
    readonly LOGIN: "auth.login";
    readonly LOGOUT: "auth.logout";
    readonly LOGIN_FAILED: "auth.login_failed";
    readonly PASSWORD_CHANGE: "auth.password_change";
    readonly PASSWORD_RESET: "auth.password_reset";
    readonly MFA_ENABLED: "auth.mfa_enabled";
    readonly MFA_DISABLED: "auth.mfa_disabled";
    readonly USER_CREATE: "user.create";
    readonly USER_UPDATE: "user.update";
    readonly USER_DELETE: "user.delete";
    readonly USER_INVITE: "user.invite";
    readonly USER_ROLE_CHANGE: "user.role_change";
    readonly ORG_SETTINGS_UPDATE: "org.settings_update";
    readonly ORG_MEMBER_ADD: "org.member_add";
    readonly ORG_MEMBER_REMOVE: "org.member_remove";
    readonly ORG_TEAM_CREATE: "org.team_create";
    readonly ORG_TEAM_UPDATE: "org.team_update";
    readonly ORG_TEAM_DELETE: "org.team_delete";
    readonly CASE_CREATE: "case.create";
    readonly CASE_UPDATE: "case.update";
    readonly CASE_DELETE: "case.delete";
    readonly CASE_SHARE: "case.share";
    readonly CASE_UNSHARE: "case.unshare";
    readonly CASE_EXPORT: "case.export";
    readonly DOCUMENT_UPLOAD: "document.upload";
    readonly DOCUMENT_UPDATE: "document.update";
    readonly DOCUMENT_DELETE: "document.delete";
    readonly DOCUMENT_DOWNLOAD: "document.download";
    readonly DOCUMENT_SHARE: "document.share";
    readonly CLIENT_CREATE: "client.create";
    readonly CLIENT_UPDATE: "client.update";
    readonly CLIENT_DELETE: "client.delete";
    readonly DATA_EXPORT: "data.export";
    readonly DATA_IMPORT: "data.import";
    readonly DATA_DELETE: "data.delete";
    readonly API_KEY_CREATE: "api.key_create";
    readonly API_KEY_REVOKE: "api.key_revoke";
    readonly API_INTEGRATION_ADD: "api.integration_add";
    readonly API_INTEGRATION_REMOVE: "api.integration_remove";
    readonly SUBSCRIPTION_CHANGE: "billing.subscription_change";
    readonly SEAT_ADD: "billing.seat_add";
    readonly SEAT_REMOVE: "billing.seat_remove";
    readonly PAYMENT_METHOD_UPDATE: "billing.payment_method_update";
    readonly ADMIN_ACCESS: "admin.access";
    readonly ADMIN_ACTION: "admin.action";
    readonly SETTINGS_CHANGE: "settings.change";
};
export declare const RESOURCE_TYPES: {
    readonly USER: "user";
    readonly ORGANIZATION: "organization";
    readonly TEAM: "team";
    readonly CASE: "case";
    readonly DOCUMENT: "document";
    readonly CLIENT: "client";
    readonly VAULT_ITEM: "vault_item";
    readonly API_KEY: "api_key";
    readonly INTEGRATION: "integration";
    readonly SUBSCRIPTION: "subscription";
    readonly SETTINGS: "settings";
};
export declare function logAuditEvent(userId: string, organizationId: string | null, event: AuditLogInput): Promise<string>;
export declare function logWithChanges<T extends Record<string, any>>(userId: string, organizationId: string | null, action: string, resourceType: string, resourceId: string, oldValue: T | null, newValue: T | null, metadata?: Record<string, any>): Promise<string>;
export declare function getAuditLogs(organizationId: string, filter?: AuditLogFilter, pagination?: {
    page: number;
    limit: number;
}): Promise<{
    logs: AuditLogEntry[];
    total: number;
    pages: number;
}>;
export declare function getResourceAuditTrail(organizationId: string, resource: string, resourceId: string): Promise<AuditLogEntry[]>;
export declare function getUserActivityLog(organizationId: string, userId: string, days?: number): Promise<AuditLogEntry[]>;
export declare function getAuditStats(organizationId: string, days?: number): Promise<{
    totalEvents: number;
    eventsByAction: Record<string, number>;
    eventsByUser: Record<string, number>;
    eventsByResource: Record<string, number>;
    dailyTrend: Array<{
        date: string;
        count: number;
    }>;
}>;
export declare function getSecurityEvents(organizationId: string, days?: number): Promise<AuditLogEntry[]>;
export declare function exportAuditLogs(organizationId: string, startDate: Date, endDate: Date, format?: 'json' | 'csv'): Promise<string>;
export declare function cleanupOldAuditLogs(retentionDays?: number): Promise<number>;
//# sourceMappingURL=auditService.d.ts.map