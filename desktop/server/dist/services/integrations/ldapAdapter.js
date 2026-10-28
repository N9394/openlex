"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createLdapAdapter = exports.LdapAdapter = void 0;
class LdapAdapter {
    type = 'ldap';
    status = 'disconnected';
    config = null;
    client = null;
    async initialize(config) {
        this.config = config;
        this.status = 'disconnected';
    }
    async testConnection() {
        if (!this.config) {
            return { success: false, status: 'error', message: 'No configuration provided' };
        }
        try {
            const url = `${this.config.useTLS ? 'ldaps' : 'ldap'}://${this.config.server}:${this.config.port}`;
            if (process.env.NODE_ENV === 'development' && !process.env.LDAP_REAL) {
                return {
                    success: true,
                    status: 'connected',
                    message: `Connected to ${url} (mock)`,
                    details: {
                        server: this.config.server,
                        baseDn: this.config.baseDn,
                        tls: this.config.useTLS,
                    },
                };
            }
            return {
                success: false,
                status: 'error',
                message: 'LDAP client not configured - install ldapjs for production',
            };
        }
        catch (error) {
            return {
                success: false,
                status: 'error',
                message: error instanceof Error ? error.message : 'Connection failed',
            };
        }
    }
    async connect() {
        this.status = 'connecting';
        const result = await this.testConnection();
        this.status = result.status;
        return result;
    }
    async disconnect() {
        if (this.client) {
            this.client = null;
        }
        this.status = 'disconnected';
    }
    async sync() {
        const result = {
            success: false,
            itemsSynced: 0,
            itemsFailed: 0,
            errors: [],
            lastSyncTime: new Date(),
        };
        if (this.status !== 'connected') {
            await this.connect();
        }
        if (this.status !== 'connected') {
            result.errors.push('Not connected to LDAP');
            return result;
        }
        try {
            const users = await this.getAllUsers();
            result.itemsSynced = users.length;
            result.success = true;
        }
        catch (error) {
            result.errors.push(error instanceof Error ? error.message : 'Sync failed');
        }
        return result;
    }
    async getHealth() {
        const connectionResult = await this.testConnection();
        return {
            healthy: connectionResult.success,
            lastCheck: new Date(),
            details: {
                status: this.status,
                server: this.config?.server,
                baseDn: this.config?.baseDn,
            },
        };
    }
    async authenticate(username, password) {
        if (!this.config) {
            return { success: false, error: 'LDAP not configured' };
        }
        try {
            const userDn = this.buildUserDn(username);
            if (process.env.NODE_ENV === 'development' && !process.env.LDAP_REAL) {
                if (password.length >= 4) {
                    const user = await this.findUser(username);
                    if (user) {
                        return { success: true, user };
                    }
                }
                return { success: false, error: 'Invalid credentials' };
            }
            return { success: false, error: 'LDAP authentication not implemented in production mode' };
        }
        catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Authentication failed',
            };
        }
    }
    async findUser(username) {
        if (!this.config)
            return null;
        try {
            const filter = this.config.userSearchFilter.replace('{username}', username);
            if (process.env.NODE_ENV === 'development' && !process.env.LDAP_REAL) {
                return {
                    username,
                    email: `${username}@lawfirm.local`,
                    displayName: username.charAt(0).toUpperCase() + username.slice(1),
                    groups: ['Attorneys', 'Staff'],
                    dn: `CN=${username},${this.config.baseDn}`,
                    enabled: true,
                };
            }
            return null;
        }
        catch (error) {
            console.error('[LdapAdapter] Find user error:', error);
            return null;
        }
    }
    async getAllUsers() {
        if (!this.config)
            return [];
        try {
            if (process.env.NODE_ENV === 'development' && !process.env.LDAP_REAL) {
                return [
                    {
                        username: 'jsmith',
                        email: 'jsmith@lawfirm.local',
                        displayName: 'John Smith',
                        groups: ['Partners', 'Litigation'],
                        dn: `CN=jsmith,${this.config.baseDn}`,
                        enabled: true,
                    },
                    {
                        username: 'mjohnson',
                        email: 'mjohnson@lawfirm.local',
                        displayName: 'Mary Johnson',
                        groups: ['Associates', 'Corporate'],
                        dn: `CN=mjohnson,${this.config.baseDn}`,
                        enabled: true,
                    },
                    {
                        username: 'bwilliams',
                        email: 'bwilliams@lawfirm.local',
                        displayName: 'Bob Williams',
                        groups: ['Paralegals', 'Litigation'],
                        dn: `CN=bwilliams,${this.config.baseDn}`,
                        enabled: true,
                    },
                ];
            }
            return [];
        }
        catch (error) {
            console.error('[LdapAdapter] Get all users error:', error);
            return [];
        }
    }
    async getUserGroups(username) {
        const user = await this.findUser(username);
        return user?.groups || [];
    }
    async isUserInGroup(username, groupName) {
        const groups = await this.getUserGroups(username);
        return groups.includes(groupName);
    }
    mapGroupsToRole(groups) {
        if (groups.includes('Partners') || groups.includes('IT-Admin')) {
            return 'owner';
        }
        if (groups.includes('Associates') || groups.includes('Office-Managers')) {
            return 'admin';
        }
        return 'member';
    }
    mapGroupsToTier(groups) {
        if (groups.includes('Partners') || groups.includes('Associates')) {
            return 'annual';
        }
        return 'free';
    }
    buildUserDn(username) {
        if (!this.config)
            return '';
        const usernameAttr = this.config.attributeMapping.username || 'sAMAccountName';
        return `${usernameAttr}=${username},${this.config.baseDn}`;
    }
    mapSearchResult(result) {
        if (!this.config) {
            return {
                username: '',
                email: '',
                displayName: '',
                groups: [],
                dn: result.dn,
                enabled: false,
            };
        }
        const attrs = result.attributes;
        const mapping = this.config.attributeMapping;
        return {
            username: this.getAttr(attrs, mapping.username) || '',
            email: this.getAttr(attrs, mapping.email) || '',
            displayName: this.getAttr(attrs, mapping.displayName) || '',
            groups: this.getAttrArray(attrs, mapping.groups || 'memberOf'),
            dn: result.dn,
            enabled: this.getAttr(attrs, 'userAccountControl') !== '514',
        };
    }
    getAttr(attrs, name) {
        const value = attrs[name];
        if (Array.isArray(value))
            return value[0] || '';
        return value || '';
    }
    getAttrArray(attrs, name) {
        const value = attrs[name];
        if (Array.isArray(value))
            return value;
        if (value)
            return [value];
        return [];
    }
}
exports.LdapAdapter = LdapAdapter;
const createLdapAdapter = () => new LdapAdapter();
exports.createLdapAdapter = createLdapAdapter;
//# sourceMappingURL=ldapAdapter.js.map