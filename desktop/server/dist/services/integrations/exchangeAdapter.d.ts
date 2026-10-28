import { IntegrationAdapter, ExchangeConfig, ConnectionResult, SyncResult, ConnectionStatus, CalendarEvent, EmailItem } from './baseAdapter';
export declare class ExchangeAdapter implements IntegrationAdapter<ExchangeConfig> {
    readonly type: "exchange";
    status: ConnectionStatus;
    config: ExchangeConfig | null;
    private accessToken;
    private tokenExpiry;
    initialize(config: ExchangeConfig): Promise<void>;
    testConnection(): Promise<ConnectionResult>;
    connect(): Promise<ConnectionResult>;
    disconnect(): Promise<void>;
    sync(): Promise<SyncResult>;
    getHealth(): Promise<{
        healthy: boolean;
        lastCheck: Date;
        details: Record<string, unknown>;
    }>;
    getCalendarEvents(daysAhead?: number): Promise<CalendarEvent[]>;
    createCalendarEvent(event: Omit<CalendarEvent, 'id'>): Promise<CalendarEvent | null>;
    getRecentEmails(count?: number): Promise<EmailItem[]>;
    searchEmails(query: string, limit?: number): Promise<EmailItem[]>;
    private getGraphAccessToken;
    private getGraphCalendarEvents;
    private createGraphCalendarEvent;
    private getGraphEmails;
    private searchGraphEmails;
    private testEwsConnection;
    private getEwsCalendarEvents;
    private createEwsCalendarEvent;
    private getEwsEmails;
    private searchEwsEmails;
}
export declare const createExchangeAdapter: () => ExchangeAdapter;
//# sourceMappingURL=exchangeAdapter.d.ts.map