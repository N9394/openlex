import { IntegrationAdapter, LdapConfig, ConnectionResult, SyncResult, ConnectionStatus, LdapUser } from './baseAdapter';
export declare class LdapAdapter implements IntegrationAdapter<LdapConfig> {
    readonly type: "ldap";
    status: ConnectionStatus;
    config: LdapConfig | null;
    private client;
    initialize(config: LdapConfig): Promise<void>;
    testConnection(): Promise<ConnectionResult>;
    connect(): Promise<ConnectionResult>;
    disconnect(): Promise<void>;
    sync(): Promise<SyncResult>;
    getHealth(): Promise<{
        healthy: boolean;
        lastCheck: Date;
        details: Record<string, unknown>;
    }>;
    authenticate(username: string, password: string): Promise<{
        success: boolean;
        user?: LdapUser;
        error?: string;
    }>;
    findUser(username: string): Promise<LdapUser | null>;
    getAllUsers(): Promise<LdapUser[]>;
    getUserGroups(username: string): Promise<string[]>;
    isUserInGroup(username: string, groupName: string): Promise<boolean>;
    mapGroupsToRole(groups: string[]): string;
    mapGroupsToTier(groups: string[]): string;
    private buildUserDn;
    private mapSearchResult;
    private getAttr;
    private getAttrArray;
}
export declare const createLdapAdapter: () => LdapAdapter;
//# sourceMappingURL=ldapAdapter.d.ts.map