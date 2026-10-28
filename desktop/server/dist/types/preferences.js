"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_PREFERENCES = exports.PROFESSIONAL_DEFAULTS = exports.INDIVIDUAL_DEFAULTS = exports.STUDENT_DEFAULTS = void 0;
exports.getDefaultPreferences = getDefaultPreferences;
exports.mergePreferences = mergePreferences;
exports.isValidUserType = isValidUserType;
exports.parseUserPreferences = parseUserPreferences;
exports.STUDENT_DEFAULTS = {
    features: {
        studySets: true,
        flashcards: true,
        quizMode: true,
        clientMatters: false,
        teamWorkspace: false,
        documentComparison: true,
        aiDrafting: true,
    },
    labels: {
        studySetsLabel: 'study_sets',
        casesLabel: 'cases',
        vaultLabel: 'vault',
    },
    aiTone: 'educational',
    ai: {
        analysisDepth: 'quick',
    },
    dashboard: {
        showLearningSection: true,
        showQuickStats: true,
        compactMode: false,
    },
    notifications: {
        studyReminders: true,
        deadlineAlerts: true,
        caseUpdates: false,
    },
    onboardingCompleted: false,
};
exports.INDIVIDUAL_DEFAULTS = {
    features: {
        studySets: true,
        flashcards: true,
        quizMode: true,
        clientMatters: true,
        teamWorkspace: false,
        documentComparison: true,
        aiDrafting: true,
    },
    labels: {
        studySetsLabel: 'study_sets',
        casesLabel: 'cases',
        vaultLabel: 'vault',
    },
    aiTone: 'balanced',
    ai: {
        analysisDepth: 'standard',
    },
    dashboard: {
        showLearningSection: true,
        showQuickStats: true,
        compactMode: false,
    },
    notifications: {
        studyReminders: false,
        deadlineAlerts: true,
        caseUpdates: true,
    },
    onboardingCompleted: false,
};
exports.PROFESSIONAL_DEFAULTS = {
    features: {
        studySets: true,
        flashcards: false,
        quizMode: false,
        clientMatters: true,
        teamWorkspace: true,
        documentComparison: true,
        aiDrafting: true,
    },
    labels: {
        studySetsLabel: 'research_library',
        casesLabel: 'client_matters',
        vaultLabel: 'document_library',
    },
    aiTone: 'professional',
    ai: {
        analysisDepth: 'thorough',
    },
    dashboard: {
        showLearningSection: false,
        showQuickStats: true,
        compactMode: true,
    },
    notifications: {
        studyReminders: false,
        deadlineAlerts: true,
        caseUpdates: true,
    },
    onboardingCompleted: false,
};
exports.DEFAULT_PREFERENCES = {
    student: exports.STUDENT_DEFAULTS,
    individual: exports.INDIVIDUAL_DEFAULTS,
    professional: exports.PROFESSIONAL_DEFAULTS,
};
function getDefaultPreferences(userType) {
    return { ...exports.DEFAULT_PREFERENCES[userType] };
}
function mergePreferences(userType, userPrefs) {
    const defaults = getDefaultPreferences(userType);
    if (!userPrefs) {
        return defaults;
    }
    return {
        features: { ...defaults.features, ...userPrefs.features },
        labels: { ...defaults.labels, ...userPrefs.labels },
        aiTone: userPrefs.aiTone ?? defaults.aiTone,
        ai: { ...defaults.ai, ...userPrefs.ai },
        dashboard: { ...defaults.dashboard, ...userPrefs.dashboard },
        notifications: { ...defaults.notifications, ...userPrefs.notifications },
        onboardingCompleted: userPrefs.onboardingCompleted ?? defaults.onboardingCompleted,
    };
}
function isValidUserType(type) {
    return ['student', 'individual', 'professional'].includes(type);
}
function parseUserPreferences(json) {
    if (!json)
        return null;
    try {
        return JSON.parse(json);
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=preferences.js.map