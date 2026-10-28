export type UserType = 'student' | 'individual' | 'professional';
export interface FeatureFlags {
    studySets: boolean;
    flashcards: boolean;
    quizMode: boolean;
    clientMatters: boolean;
    teamWorkspace: boolean;
    documentComparison: boolean;
    aiDrafting: boolean;
}
export interface LabelPreferences {
    studySetsLabel: 'study_sets' | 'research_library';
    casesLabel: 'cases' | 'client_matters';
    vaultLabel: 'vault' | 'document_library';
}
export type AITone = 'educational' | 'professional' | 'balanced';
export interface DashboardPreferences {
    showLearningSection: boolean;
    showQuickStats: boolean;
    compactMode: boolean;
}
export interface NotificationPreferences {
    studyReminders: boolean;
    deadlineAlerts: boolean;
    caseUpdates: boolean;
}
export type AnalysisDepth = 'quick' | 'standard' | 'thorough';
export interface AIPreferences {
    analysisDepth: AnalysisDepth;
}
export interface UserPreferences {
    features: FeatureFlags;
    labels: LabelPreferences;
    aiTone: AITone;
    ai: AIPreferences;
    dashboard: DashboardPreferences;
    notifications: NotificationPreferences;
    onboardingCompleted: boolean;
    hasUsedNavigator?: boolean;
    hasUsedResearch?: boolean;
    checklistDismissed?: boolean;
}
export declare const STUDENT_DEFAULTS: UserPreferences;
export declare const INDIVIDUAL_DEFAULTS: UserPreferences;
export declare const PROFESSIONAL_DEFAULTS: UserPreferences;
export declare const DEFAULT_PREFERENCES: Record<UserType, UserPreferences>;
export declare function getDefaultPreferences(userType: UserType): UserPreferences;
export declare function mergePreferences(userType: UserType, userPrefs: Partial<UserPreferences> | null): UserPreferences;
export declare function isValidUserType(type: string): type is UserType;
export declare function parseUserPreferences(json: string | null): Partial<UserPreferences> | null;
//# sourceMappingURL=preferences.d.ts.map