"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getIntegrationManager = exports.IntegrationManagerService = void 0;
const crypto_1 = __importDefault(require("crypto"));
const exchangeAdapter_1 = require("./exchangeAdapter");
const ldapAdapter_1 = require("./ldapAdapter");
const ENCRYPTION_KEY = process.env.INTEGRATION_ENCRYPTION_KEY || 'default-dev-key-32-characters!';
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
class IntegrationManagerService {
    prisma;
    adapters = new Map();
    constructor(prisma) {
        this.prisma = prisma;
    }
    async getIntegrations(organizationId) {
        const integrations = await this.prisma.localIntegration.findMany({
            where: { organizationId },
            select: {
                id: true,
                type: true,
                enabled: true,
                status: true,
                lastSyncAt: true,
            },
        });
        return integrations.map((int) => ({
            id: int.id,
            type: int.type,
            enabled: int.enabled,
            status: int.status,
            lastSyncAt: int.lastSyncAt || undefined,
        }));
    }
    async configureIntegration(organizationId, config) {
        const existing = await this.prisma.localIntegration.findFirst({
            where: { organizationId, type: config.type },
        });
        if (existing) {
            await this.updateIntegration(existing.id, config);
            return existing.id;
        }
        const encryptedConfig = this.encryptConfig(config);
        const integration = await this.prisma.localIntegration.create({
            data: {
                organizationId,
                type: config.type,
                config: encryptedConfig,
                enabled: false,
                status: 'disconnected',
            },
        });
        return integration.id;
    }
    async updateIntegration(integrationId, config) {
        const existing = await this.prisma.localIntegration.findUnique({
            where: { id: integrationId },
        });
        if (!existing) {
            throw new Error('Integration not found');
        }
        const existingConfig = this.decryptConfig(existing.config);
        const updatedConfig = { ...existingConfig, ...config };
        const encryptedConfig = this.encryptConfig(updatedConfig);
        await this.prisma.localIntegration.update({
            where: { id: integrationId },
            data: { config: encryptedConfig },
        });
        this.adapters.delete(integrationId);
    }
    async setEnabled(integrationId, enabled) {
        const integration = await this.prisma.localIntegration.findUnique({
            where: { id: integrationId },
        });
        if (!integration) {
            throw new Error('Integration not found');
        }
        if (enabled) {
            const result = await this.testConnection(integrationId);
            if (!result.success) {
                throw new Error(`Cannot enable: ${result.message}`);
            }
        }
        await this.prisma.localIntegration.update({
            where: { id: integrationId },
            data: {
                enabled,
                status: enabled ? 'connected' : 'disconnected',
            },
        });
    }
    async removeIntegration(integrationId) {
        const adapter = this.adapters.get(integrationId);
        if (adapter) {
            await adapter.disconnect();
            this.adapters.delete(integrationId);
        }
        await this.prisma.localIntegration.delete({
            where: { id: integrationId },
        });
    }
    async testConnection(integrationId) {
        const adapter = await this.getOrCreateAdapter(integrationId);
        if (!adapter) {
            return { success: false, status: 'error', message: 'Failed to create adapter' };
        }
        const result = await adapter.testConnection();
        await this.prisma.localIntegration.update({
            where: { id: integrationId },
            data: {
                status: result.status,
                lastError: result.success ? null : result.message,
                errorCount: result.success ? 0 : { increment: 1 },
            },
        });
        return result;
    }
    async triggerSync(integrationId) {
        const adapter = await this.getOrCreateAdapter(integrationId);
        if (!adapter) {
            return {
                success: false,
                itemsSynced: 0,
                itemsFailed: 0,
                errors: ['Failed to create adapter'],
                lastSyncTime: new Date(),
            };
        }
        if (adapter.status !== 'connected') {
            const connectResult = await adapter.connect();
            if (!connectResult.success) {
                return {
                    success: false,
                    itemsSynced: 0,
                    itemsFailed: 0,
                    errors: [`Connection failed: ${connectResult.message}`],
                    lastSyncTime: new Date(),
                };
            }
        }
        const result = await adapter.sync();
        await this.prisma.localIntegration.update({
            where: { id: integrationId },
            data: {
                lastSyncAt: result.lastSyncTime,
                lastError: result.errors.length > 0 ? result.errors[0] : null,
            },
        });
        return result;
    }
    async getExchangeAdapter(integrationId) {
        const adapter = await this.getOrCreateAdapter(integrationId);
        if (adapter?.type === 'exchange') {
            return adapter;
        }
        return null;
    }
    async getLdapAdapter(integrationId) {
        const adapter = await this.getOrCreateAdapter(integrationId);
        if (adapter?.type === 'ldap') {
            return adapter;
        }
        return null;
    }
    async getEnabledLdapAdapter(organizationId) {
        const integration = await this.prisma.localIntegration.findFirst({
            where: {
                organizationId,
                type: 'ldap',
                enabled: true,
            },
        });
        if (!integration)
            return null;
        return this.getLdapAdapter(integration.id);
    }
    async getOrCreateAdapter(integrationId) {
        if (this.adapters.has(integrationId)) {
            return this.adapters.get(integrationId);
        }
        const integration = await this.prisma.localIntegration.findUnique({
            where: { id: integrationId },
        });
        if (!integration)
            return null;
        const config = this.decryptConfig(integration.config);
        switch (integration.type) {
            case 'exchange': {
                const adapter = (0, exchangeAdapter_1.createExchangeAdapter)();
                await adapter.initialize(config);
                this.adapters.set(integrationId, adapter);
                return adapter;
            }
            case 'ldap': {
                const adapter = (0, ldapAdapter_1.createLdapAdapter)();
                await adapter.initialize(config);
                this.adapters.set(integrationId, adapter);
                return adapter;
            }
            default:
                console.warn(`[IntegrationManager] Unknown type: ${integration.type}`);
                return null;
        }
    }
    encryptConfig(config) {
        try {
            const iv = crypto_1.default.randomBytes(16);
            const key = crypto_1.default.scryptSync(ENCRYPTION_KEY, 'salt', 32);
            const cipher = crypto_1.default.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
            const json = JSON.stringify(config);
            let encrypted = cipher.update(json, 'utf8', 'hex');
            encrypted += cipher.final('hex');
            const authTag = cipher.getAuthTag();
            return JSON.stringify({
                iv: iv.toString('hex'),
                data: encrypted,
                tag: authTag.toString('hex'),
            });
        }
        catch (error) {
            console.error('[IntegrationManager] Encryption error:', error);
            throw new Error('Failed to encrypt configuration');
        }
    }
    decryptConfig(encrypted) {
        try {
            const { iv, data, tag } = JSON.parse(encrypted);
            const key = crypto_1.default.scryptSync(ENCRYPTION_KEY, 'salt', 32);
            const decipher = crypto_1.default.createDecipheriv(ENCRYPTION_ALGORITHM, key, Buffer.from(iv, 'hex'));
            decipher.setAuthTag(Buffer.from(tag, 'hex'));
            let decrypted = decipher.update(data, 'hex', 'utf8');
            decrypted += decipher.final('utf8');
            return JSON.parse(decrypted);
        }
        catch (error) {
            console.error('[IntegrationManager] Decryption error:', error);
            throw new Error('Failed to decrypt configuration');
        }
    }
}
exports.IntegrationManagerService = IntegrationManagerService;
let instance = null;
const getIntegrationManager = (prisma) => {
    if (!instance) {
        instance = new IntegrationManagerService(prisma);
    }
    return instance;
};
exports.getIntegrationManager = getIntegrationManager;
//# sourceMappingURL=integrationManager.js.map