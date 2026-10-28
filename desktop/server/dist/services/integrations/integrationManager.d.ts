import { PrismaClient } from '@prisma/client';
import { IntegrationType, ConnectionStatus, ConnectionResult, SyncResult, AnyIntegrationConfig, IntegrationManager as IIntegrationManager } from './baseAdapter';
import { ExchangeAdapter } from './exchangeAdapter';
import { LdapAdapter } from './ldapAdapter';
export declare class IntegrationManagerService implements IIntegrationManager {
    private prisma;
    private adapters;
    constructor(prisma: PrismaClient);
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
    getExchangeAdapter(integrationId: string): Promise<ExchangeAdapter | null>;
    getLdapAdapter(integrationId: string): Promise<LdapAdapter | null>;
    getEnabledLdapAdapter(organizationId: string): Promise<LdapAdapter | null>;
    private getOrCreateAdapter;
    private encryptConfig;
    private decryptConfig;
}
export declare const getIntegrationManager: (prisma: PrismaClient) => IntegrationManagerService;
//# sourceMappingURL=integrationManager.d.ts.map