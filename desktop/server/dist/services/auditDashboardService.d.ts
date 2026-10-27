export interface AuditLogEntry {
    id: string;
    organizationId: string | null;
    userId: string;
    action: string;
    resource: string;
    resourceId: string | null;
    previousValue: any;
    newValue: any;
    ipAddress: string | null;
    userAgent: string | null;
    requestId: string | null;
    isCompliance: boolean;
    createdAt: Date;
    user?: {
        email: string;
        username: string | null;
    };
}
export interface AuditQueryFilters {
    startDate?: Date;
    endDate?: Date;
    action?: string;
    resource?: string;
    userId?: string;
    resourceId?: string;
    isCompliance?: boolean;
    search?: string;
}
export interface AuditStats {
    totalEvents: number;
    eventsByAction: Record<string, number>;
    eventsByResource: Record<string, number>;
    eventsByUser: Array<{
        userId: string;
        email: string;
        count: number;
    }>;
    complianceEvents: number;
    recentActivity: AuditLogEntry[];
}
export interface AuditDashboardData {
    stats: AuditStats;
    recentLogs: AuditLogEntry[];
    topActions: Array<{
        action: string;
        count: number;
    }>;
    topResources: Array<{
        resource: string;
        count: number;
    }>;
    activityByDay: Array<{
        date: string;
        count: number;
    }>;
}
export declare function queryAuditLogs(organizationId: string | null, filters: AuditQueryFilters, options?: {
    limit?: number;
    offset?: number;
    includeUser?: boolean;
}): Promise<{
    logs: AuditLogEntry[];
    total: number;
}>;
export declare function getAuditStats(organizationId: string | null, dateRange?: {
    startDate?: Date;
    endDate?: Date;
}): Promise<AuditStats>;
export declare function getAuditDashboard(organizationId: string | null, days?: number): Promise<AuditDashboardData>;
export declare function exportAuditLogsToCSV(organizationId: string | null, filters: AuditQueryFilters): Promise<string>;
export declare function getComplianceAuditLogs(organizationId: string | null, options?: {
    limit?: number;
    offset?: number;
}): Promise<{
    logs: AuditLogEntry[];
    total: number;
}>;
export declare function getFilterOptions(organizationId: string | null): Promise<{
    actions: string[];
    resources: string[];
    users: Array<{
        id: string;
        email: string;
    }>;
}>;
export declare function createAuditLog(entry: {
    organizationId?: string;
    userId: string;
    action: string;
    resource: string;
    resourceId?: string;
    previousValue?: any;
    newValue?: any;
    ipAddress?: string;
    userAgent?: string;
    requestId?: string;
    isCompliance?: boolean;
}): Promise<void>;
//# sourceMappingURL=auditDashboardService.d.ts.map