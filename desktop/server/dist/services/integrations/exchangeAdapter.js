"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createExchangeAdapter = exports.ExchangeAdapter = void 0;
class ExchangeAdapter {
    type = 'exchange';
    status = 'disconnected';
    config = null;
    accessToken = null;
    tokenExpiry = null;
    async initialize(config) {
        this.config = config;
        this.status = 'disconnected';
    }
    async testConnection() {
        if (!this.config) {
            return { success: false, status: 'error', message: 'No configuration provided' };
        }
        try {
            if (this.config.version === 'graph') {
                const token = await this.getGraphAccessToken();
                if (!token) {
                    return { success: false, status: 'error', message: 'Failed to obtain access token' };
                }
                const response = await fetch('https://graph.microsoft.com/v1.0/me', {
                    headers: { Authorization: `Bearer ${token}` },
                });
                if (response.ok) {
                    const user = await response.json();
                    return {
                        success: true,
                        status: 'connected',
                        message: `Connected as ${user.displayName}`,
                        details: { email: user.mail, name: user.displayName },
                    };
                }
                else {
                    return { success: false, status: 'error', message: `API error: ${response.status}` };
                }
            }
            else {
                return await this.testEwsConnection();
            }
        }
        catch (error) {
            return {
                success: false,
                status: 'error',
                message: error instanceof Error ? error.message : 'Unknown error',
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
        this.accessToken = null;
        this.tokenExpiry = null;
        this.status = 'disconnected';
    }
    async sync() {
        if (this.status !== 'connected') {
            await this.connect();
        }
        const result = {
            success: false,
            itemsSynced: 0,
            itemsFailed: 0,
            errors: [],
            lastSyncTime: new Date(),
        };
        if (this.status !== 'connected') {
            result.errors.push('Not connected');
            return result;
        }
        try {
            const calendarEvents = await this.getCalendarEvents(30);
            result.itemsSynced += calendarEvents.length;
            const emails = await this.getRecentEmails(100);
            result.itemsSynced += emails.length;
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
                version: this.config?.version || 'unknown',
                ...connectionResult.details,
            },
        };
    }
    async getCalendarEvents(daysAhead = 7) {
        if (this.status !== 'connected') {
            await this.connect();
        }
        if (this.config?.version === 'graph') {
            return this.getGraphCalendarEvents(daysAhead);
        }
        return this.getEwsCalendarEvents(daysAhead);
    }
    async createCalendarEvent(event) {
        if (this.status !== 'connected') {
            await this.connect();
        }
        if (this.config?.version === 'graph') {
            return this.createGraphCalendarEvent(event);
        }
        return this.createEwsCalendarEvent(event);
    }
    async getRecentEmails(count = 50) {
        if (this.status !== 'connected') {
            await this.connect();
        }
        if (this.config?.version === 'graph') {
            return this.getGraphEmails(count);
        }
        return this.getEwsEmails(count);
    }
    async searchEmails(query, limit = 20) {
        if (this.status !== 'connected') {
            await this.connect();
        }
        if (this.config?.version === 'graph') {
            return this.searchGraphEmails(query, limit);
        }
        return this.searchEwsEmails(query, limit);
    }
    async getGraphAccessToken() {
        if (this.accessToken && this.tokenExpiry && new Date() < this.tokenExpiry) {
            return this.accessToken;
        }
        if (!this.config?.oauthTenantId || !this.config?.oauthClientId || !this.config?.oauthClientSecret) {
            return null;
        }
        try {
            const tokenUrl = `https://login.microsoftonline.com/${this.config.oauthTenantId}/oauth2/v2.0/token`;
            const response = await fetch(tokenUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    client_id: this.config.oauthClientId,
                    client_secret: this.config.oauthClientSecret,
                    scope: 'https://graph.microsoft.com/.default',
                    grant_type: 'client_credentials',
                }),
            });
            if (response.ok) {
                const data = await response.json();
                this.accessToken = data.access_token;
                this.tokenExpiry = new Date(Date.now() + (data.expires_in - 60) * 1000);
                return this.accessToken;
            }
        }
        catch (error) {
            console.error('[ExchangeAdapter] Token fetch error:', error);
        }
        return null;
    }
    async getGraphCalendarEvents(daysAhead) {
        const token = await this.getGraphAccessToken();
        if (!token)
            return [];
        const startDate = new Date().toISOString();
        const endDate = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000).toISOString();
        try {
            const response = await fetch(`https://graph.microsoft.com/v1.0/me/calendarview?startDateTime=${startDate}&endDateTime=${endDate}&$top=100`, { headers: { Authorization: `Bearer ${token}` } });
            if (response.ok) {
                const data = await response.json();
                return (data.value || []).map((event) => ({
                    id: event.id,
                    subject: event.subject,
                    start: new Date(event.start.dateTime),
                    end: new Date(event.end.dateTime),
                    location: event.location?.displayName,
                    body: event.body?.content,
                    attendees: (event.attendees || []).map((a) => a.emailAddress?.address).filter((a) => !!a),
                    isAllDay: event.isAllDay,
                }));
            }
        }
        catch (error) {
            console.error('[ExchangeAdapter] Calendar fetch error:', error);
        }
        return [];
    }
    async createGraphCalendarEvent(event) {
        const token = await this.getGraphAccessToken();
        if (!token)
            return null;
        try {
            const response = await fetch('https://graph.microsoft.com/v1.0/me/events', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    subject: event.subject,
                    start: {
                        dateTime: event.start.toISOString(),
                        timeZone: 'UTC',
                    },
                    end: {
                        dateTime: event.end.toISOString(),
                        timeZone: 'UTC',
                    },
                    location: event.location ? { displayName: event.location } : undefined,
                    body: event.body ? { contentType: 'text', content: event.body } : undefined,
                    attendees: (event.attendees || []).map((email) => ({
                        emailAddress: { address: email },
                        type: 'required',
                    })),
                }),
            });
            if (response.ok) {
                const data = await response.json();
                return {
                    id: data.id,
                    subject: data.subject,
                    start: new Date(data.start.dateTime),
                    end: new Date(data.end.dateTime),
                    location: data.location?.displayName,
                    body: data.body?.content,
                    isAllDay: data.isAllDay,
                };
            }
        }
        catch (error) {
            console.error('[ExchangeAdapter] Create event error:', error);
        }
        return null;
    }
    async getGraphEmails(count) {
        const token = await this.getGraphAccessToken();
        if (!token)
            return [];
        try {
            const response = await fetch(`https://graph.microsoft.com/v1.0/me/messages?$top=${count}&$orderby=receivedDateTime desc`, { headers: { Authorization: `Bearer ${token}` } });
            if (response.ok) {
                const data = await response.json();
                return (data.value || []).map((msg) => ({
                    id: msg.id,
                    subject: msg.subject,
                    from: msg.from?.emailAddress?.address || '',
                    to: (msg.toRecipients || []).map((r) => r.emailAddress?.address).filter((a) => !!a),
                    cc: (msg.ccRecipients || []).map((r) => r.emailAddress?.address).filter((a) => !!a),
                    receivedAt: new Date(msg.receivedDateTime),
                    body: msg.body?.content,
                    hasAttachments: msg.hasAttachments,
                }));
            }
        }
        catch (error) {
            console.error('[ExchangeAdapter] Email fetch error:', error);
        }
        return [];
    }
    async searchGraphEmails(query, limit) {
        const token = await this.getGraphAccessToken();
        if (!token)
            return [];
        try {
            const response = await fetch(`https://graph.microsoft.com/v1.0/me/messages?$search="${encodeURIComponent(query)}"&$top=${limit}`, { headers: { Authorization: `Bearer ${token}` } });
            if (response.ok) {
                const data = await response.json();
                return (data.value || []).map((msg) => ({
                    id: msg.id,
                    subject: msg.subject,
                    from: msg.from?.emailAddress?.address || '',
                    to: (msg.toRecipients || []).map((r) => r.emailAddress?.address).filter((a) => !!a),
                    receivedAt: new Date(msg.receivedDateTime),
                    hasAttachments: msg.hasAttachments,
                }));
            }
        }
        catch (error) {
            console.error('[ExchangeAdapter] Email search error:', error);
        }
        return [];
    }
    async testEwsConnection() {
        return {
            success: false,
            status: 'error',
            message: 'EWS not yet implemented - use Microsoft Graph for cloud Exchange',
        };
    }
    async getEwsCalendarEvents(_daysAhead) {
        console.warn('[ExchangeAdapter] EWS calendar not implemented');
        return [];
    }
    async createEwsCalendarEvent(_event) {
        console.warn('[ExchangeAdapter] EWS event creation not implemented');
        return null;
    }
    async getEwsEmails(_count) {
        console.warn('[ExchangeAdapter] EWS email not implemented');
        return [];
    }
    async searchEwsEmails(_query, _limit) {
        console.warn('[ExchangeAdapter] EWS search not implemented');
        return [];
    }
}
exports.ExchangeAdapter = ExchangeAdapter;
const createExchangeAdapter = () => new ExchangeAdapter();
exports.createExchangeAdapter = createExchangeAdapter;
//# sourceMappingURL=exchangeAdapter.js.map