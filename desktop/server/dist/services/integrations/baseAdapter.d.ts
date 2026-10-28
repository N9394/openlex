export type IntegrationType = 'exchange' | 'ldap' | 'sharepoint' | 'scanner' | 'file_share';
export type ConnectionStatus = 'connected' | 'disconnected' | 'error' | 'connecting';
export interface IntegrationConfig {
    type: IntegrationType;
}
export interface ExchangeConfig extends IntegrationConfig {
    type: 'exchange';
    server: string;
    username: string;
    password?: string;
    domain?: string;
    useOAuth?: boolean;
    oauthTenantId?: string;
    oauthClientId?: string;
    oauthClientSecret?: string;
    version?: 'ews' | 'graph';
}
export interface LdapConfig extends IntegrationConfig {
    type: 'ldap';
    server: string;
    port: number;
    baseDn: string;
    bindDn: string;
    bindPassword?: string;
    useTLS: boolean;
    userSearchFilter: string;
    groupSearchFilter?: string;
    attributeMapping: {
        username: string;
        email: string;
        displayName: string;
        groups?: string;
    };
}
export interface SharePointConfig extends IntegrationConfig {
    type: 'sharepoint';
    siteUrl: string;
    libraryName: string;
    clientId: string;
    clientSecret?: string;
    tenantId?: string;
    syncFolders?: string[];
    matterFolderPattern?: string;
}
export interface ScannerConfig extends IntegrationConfig {
    type: 'scanner';
    scannerType: 'twain' | 'sane' | 'network';
    deviceId?: string;
    networkAddress?: string;
    defaultResolution: number;
    defaultColorMode: 'color' | 'grayscale' | 'blackwhite';
    defaultFormat: 'pdf' | 'tiff' | 'jpeg';
    ocrEnabled: boolean;
    autoUpload: boolean;
    defaultMatterId?: string;
}
export interface FileShareConfig extends IntegrationConfig {
    type: 'file_share';
    protocol: 'smb' | 'nfs' | 'webdav';
    server: string;
    sharePath: string;
    username?: string;
    password?: string;
    domain?: string;
    watchFolders?: string[];
}
export type AnyIntegrationConfig = ExchangeConfig | LdapConfig | SharePointConfig | ScannerConfig | FileShareConfig;
export interface ConnectionResult {
    success: boolean;
    status: ConnectionStatus;
    message?: string;
    details?: Record<string, unknown>;
}
export interface SyncResult {
    success: boolean;
    itemsSynced: number;
    itemsFailed: number;
    errors: string[];
    lastSyncTime: Date;
}
export interface CalendarEvent {
    id: string;
    subject: string;
    start: Date;
    end: Date;
    location?: string;
    body?: string;
    attendees?: string[];
    isAllDay?: boolean;
    reminderMinutes?: number;
    linkedMatterId?: string;
    linkedClientId?: string;
}
export interface EmailItem {
    id: string;
    subject: string;
    from: string;
    to: string[];
    cc?: string[];
    receivedAt: Date;
    body?: string;
    hasAttachments?: boolean;
    attachmentCount?: number;
    linkedMatterId?: string;
}
export interface LdapUser {
    username: string;
    email: string;
    displayName: string;
    groups: string[];
    dn: string;
    enabled: boolean;
}
export interface SharePointDocument {
    id: string;
    name: string;
    path: string;
    modifiedAt: Date;
    modifiedBy: string;
    size: number;
    webUrl: string;
    linkedMatterId?: string;
}
export interface ScanJob {
    id: string;
    status: 'pending' | 'scanning' | 'processing' | 'completed' | 'failed';
    filename?: string;
    pages?: number;
    ocrText?: string;
    documentId?: string;
    matterId?: string;
}
export interface IntegrationAdapter<TConfig extends IntegrationConfig> {
    readonly type: IntegrationType;
    status: ConnectionStatus;
    config: TConfig | null;
    initialize(config: TConfig): Promise<void>;
    testConnection(): Promise<ConnectionResult>;
    connect(): Promise<ConnectionResult>;
    disconnect(): Promise<void>;
    sync(): Promise<SyncResult>;
    getHealth(): Promise<{
        healthy: boolean;
        lastCheck: Date;
        details: Record<string, unknown>;
    }>;
}
export interface IntegrationManager {
    getIntegrations(organizationId: string): Promise<Array<{
        id: string;
        type: IntegrationType;
        enabled: boolean;
        status: ConnectionStatus;
        lastSyncAt?: Date;
    }>>;
    configureIntegration(organizationId: string, config: AnyIntegrationConfig): Promise<string>;
    updateIntegration(integrationId: string, config: Partial<AnyIntegrationConfig>): Promise<void>;
    setEnabled(integrationId: string, enabled: boolean): Promise<void>;
    removeIntegration(integrationId: string): Promise<void>;
    testConnection(integrationId: string): Promise<ConnectionResult>;
    triggerSync(integrationId: string): Promise<SyncResult>;
}
//# sourceMappingURL=baseAdapter.d.ts.map