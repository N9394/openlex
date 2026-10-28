interface CreateNotificationParams {
    userId: string;
    type: 'document_analysis_complete' | 'study_set_generated' | 'case_update' | 'system';
    title: string;
    message: string;
    entityType?: 'document' | 'study_set' | 'case' | 'vault_item';
    entityId?: string;
    actionUrl?: string;
    actionLabel?: string;
}
export declare function createNotification(params: CreateNotificationParams): Promise<{
    userId: string;
    id: string;
    createdAt: Date;
    type: string;
    message: string;
    title: string;
    entityType: string | null;
    entityId: string | null;
    actionUrl: string | null;
    actionLabel: string | null;
    isRead: boolean;
}>;
export declare function notifyDocumentAnalysisComplete(userId: string, documentId: string, filename: string): Promise<{
    userId: string;
    id: string;
    createdAt: Date;
    type: string;
    message: string;
    title: string;
    entityType: string | null;
    entityId: string | null;
    actionUrl: string | null;
    actionLabel: string | null;
    isRead: boolean;
}>;
export declare function notifyStudySetGenerated(userId: string, studySetId: string, title: string, cardCount: number): Promise<{
    userId: string;
    id: string;
    createdAt: Date;
    type: string;
    message: string;
    title: string;
    entityType: string | null;
    entityId: string | null;
    actionUrl: string | null;
    actionLabel: string | null;
    isRead: boolean;
}>;
export declare function notifyCaseUpdate(userId: string, caseId: string, caseTitle: string, message: string): Promise<{
    userId: string;
    id: string;
    createdAt: Date;
    type: string;
    message: string;
    title: string;
    entityType: string | null;
    entityId: string | null;
    actionUrl: string | null;
    actionLabel: string | null;
    isRead: boolean;
}>;
export {};
//# sourceMappingURL=notifications.d.ts.map