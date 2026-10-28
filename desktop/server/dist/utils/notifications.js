"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createNotification = createNotification;
exports.notifyDocumentAnalysisComplete = notifyDocumentAnalysisComplete;
exports.notifyStudySetGenerated = notifyStudySetGenerated;
exports.notifyCaseUpdate = notifyCaseUpdate;
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
async function createNotification(params) {
    try {
        const notification = await prisma.notification.create({
            data: {
                userId: params.userId,
                type: params.type,
                title: params.title,
                message: params.message,
                entityType: params.entityType,
                entityId: params.entityId,
                actionUrl: params.actionUrl,
                actionLabel: params.actionLabel,
            }
        });
        console.log(`[NOTIFICATIONS] Created notification for user ${params.userId}: ${params.title}`);
        return notification;
    }
    catch (error) {
        console.error('[NOTIFICATIONS] Error creating notification:', error);
        throw error;
    }
}
async function notifyDocumentAnalysisComplete(userId, documentId, filename) {
    return createNotification({
        userId,
        type: 'document_analysis_complete',
        title: 'Document Analysis Complete',
        message: `Your document "${filename}" has been analyzed and is ready to review.`,
        entityType: 'document',
        entityId: documentId,
        actionUrl: `/documents/${documentId}`,
        actionLabel: 'View Analysis'
    });
}
async function notifyStudySetGenerated(userId, studySetId, title, cardCount) {
    return createNotification({
        userId,
        type: 'study_set_generated',
        title: 'Flashcards Generated',
        message: `${cardCount} flashcards have been generated for "${title}". Start studying now!`,
        entityType: 'study_set',
        entityId: studySetId,
        actionUrl: `/study/${studySetId}`,
        actionLabel: 'Start Studying'
    });
}
async function notifyCaseUpdate(userId, caseId, caseTitle, message) {
    return createNotification({
        userId,
        type: 'case_update',
        title: 'Case Update',
        message: `${caseTitle}: ${message}`,
        entityType: 'case',
        entityId: caseId,
        actionUrl: `/cases/${caseId}`,
        actionLabel: 'View Case'
    });
}
//# sourceMappingURL=notifications.js.map