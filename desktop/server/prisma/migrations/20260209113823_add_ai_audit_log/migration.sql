-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "username" TEXT,
    "name" TEXT,
    "passwordHash" TEXT NOT NULL,
    "tier" TEXT NOT NULL DEFAULT 'free',
    "userType" TEXT NOT NULL DEFAULT 'individual',
    "userPreferences" TEXT,
    "jurisdiction" TEXT DEFAULT 'US',
    "language" TEXT DEFAULT 'en',
    "documentsThisWeek" INTEGER NOT NULL DEFAULT 0,
    "weekResetDate" DATETIME NOT NULL,
    "organizationId" TEXT,
    "memberRole" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" DATETIME,
    "deletionScheduledAt" DATETIME,
    "stripeCustomerId" TEXT,
    "stripeSubId" TEXT,
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" DATETIME,
    "passwordChangedAt" DATETIME,
    "passwordHistory" TEXT,
    "extendedRoleId" TEXT,
    CONSTRAINT "users_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "users_extendedRoleId_fkey" FOREIGN KEY ("extendedRoleId") REFERENCES "extended_roles" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'firm',
    "ownerUserId" TEXT NOT NULL,
    "tier" TEXT NOT NULL DEFAULT 'free',
    "settings" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "organization_integrations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "config" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "organization_integrations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "organization_invitations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "invitedBy" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "organization_invitations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "filepath" TEXT NOT NULL,
    "filesize" INTEGER NOT NULL,
    "mimetype" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "extractedText" TEXT,
    "anonymizedText" TEXT,
    "encryptedOriginal" TEXT,
    "piiDetections" TEXT,
    "piiProcessedAt" DATETIME,
    "analysis" TEXT,
    "summary" TEXT,
    "keyClauses" TEXT,
    "glossary" TEXT,
    "riskFlags" TEXT,
    "importantDates" TEXT,
    "readabilityScore" TEXT,
    "overallRiskScore" TEXT,
    "missingElements" TEXT,
    "clarityScore" TEXT,
    "rightsObligations" TEXT,
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "documents_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "document_versions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "filepath" TEXT NOT NULL,
    "filesize" INTEGER NOT NULL,
    "mimetype" TEXT NOT NULL,
    "extractedText" TEXT,
    "keyClauses" TEXT,
    "changeNote" TEXT,
    "changedBy" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "document_versions_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "document_comments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "pageNumber" INTEGER,
    "startOffset" INTEGER,
    "endOffset" INTEGER,
    "selectedText" TEXT,
    "type" TEXT NOT NULL DEFAULT 'comment',
    "parentId" TEXT,
    "isResolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" DATETIME,
    "resolvedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "document_comments_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "vault_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'clause',
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "category" TEXT,
    "tags" TEXT,
    "folderId" TEXT,
    "sourceDocumentId" TEXT,
    "sourceType" TEXT,
    "notes" TEXT,
    "isFavorite" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "vault_items_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "study_sets" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "jurisdiction" TEXT,
    "category" TEXT NOT NULL,
    "isOfficial" BOOLEAN NOT NULL DEFAULT true,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "cardCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "study_sets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "study_cards" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "setId" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "definition" TEXT NOT NULL,
    "example" TEXT,
    "audioUrl" TEXT,
    "imageUrl" TEXT,
    "distractors" TEXT,
    "difficulty" TEXT NOT NULL DEFAULT 'medium',
    "importance" TEXT NOT NULL DEFAULT 'medium',
    "position" INTEGER NOT NULL DEFAULT 0,
    "isReported" BOOLEAN NOT NULL DEFAULT false,
    "reportReason" TEXT,
    "reportedBy" TEXT,
    "reportedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "study_cards_setId_fkey" FOREIGN KEY ("setId") REFERENCES "study_sets" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "study_progress" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "masteryLevel" INTEGER NOT NULL DEFAULT 0,
    "nextReviewDate" DATETIME,
    "intervalDays" INTEGER NOT NULL DEFAULT 1,
    "easeFactor" REAL NOT NULL DEFAULT 2.5,
    "correctCount" INTEGER NOT NULL DEFAULT 0,
    "incorrectCount" INTEGER NOT NULL DEFAULT 0,
    "totalReviews" INTEGER NOT NULL DEFAULT 0,
    "isStarred" BOOLEAN NOT NULL DEFAULT false,
    "lastReviewedAt" DATETIME,
    "lastResult" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "study_progress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "study_progress_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "study_cards" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "study_sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "studyMode" TEXT NOT NULL,
    "setId" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    "durationSeconds" INTEGER,
    "cardsStudied" INTEGER NOT NULL DEFAULT 0,
    "correctAnswers" INTEGER NOT NULL DEFAULT 0,
    "incorrectAnswers" INTEGER NOT NULL DEFAULT 0,
    "scorePercentage" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "study_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "leaderboard_scores" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "correctAnswers" INTEGER NOT NULL,
    "totalQuestions" INTEGER NOT NULL,
    "timeUsed" INTEGER NOT NULL,
    "gameMode" TEXT NOT NULL DEFAULT 'challenge',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "leaderboard_scores_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "cases" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "caseType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "description" TEXT,
    "companyName" TEXT,
    "clientName" TEXT,
    "clientId" TEXT,
    "startDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deadline" DATETIME,
    "tags" TEXT,
    "notes" TEXT,
    "documents" TEXT,
    "vaultItems" TEXT,
    "clarityScore" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "cases_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "cases_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "case_collaborators" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "invitedBy" TEXT NOT NULL,
    "invitedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "case_collaborators_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "case_collaborators_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "case_tags" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#D4AF37',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "case_tags_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "case_checklists" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "case_checklists_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "case_checklist_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "checklistId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "assignedTo" TEXT,
    "dueDate" DATETIME,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "completedAt" DATETIME,
    "completedBy" TEXT,
    CONSTRAINT "case_checklist_items_checklistId_fkey" FOREIGN KEY ("checklistId") REFERENCES "case_checklists" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "case_checklist_comments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "itemId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "case_checklist_comments_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "case_checklist_items" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "case_timeline_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "eventType" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'normal',
    "isAutoGenerated" BOOLEAN NOT NULL DEFAULT false,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "color" TEXT NOT NULL DEFAULT '#D4AF37',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "createdBy" TEXT NOT NULL,
    CONSTRAINT "case_timeline_events_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "case_activity_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "changes" TEXT,
    "details" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "case_activity_logs_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "actionUrl" TEXT,
    "actionLabel" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "case_entities" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "role" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "documentId" TEXT,
    "positionX" REAL,
    "positionY" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "case_entities_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "case_relationships" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "fromEntityId" TEXT NOT NULL,
    "toEntityId" TEXT NOT NULL,
    "relationType" TEXT NOT NULL,
    "label" TEXT,
    "description" TEXT,
    "strength" TEXT NOT NULL DEFAULT 'normal',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "case_relationships_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "case_relationships_fromEntityId_fkey" FOREIGN KEY ("fromEntityId") REFERENCES "case_entities" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "case_relationships_toEntityId_fkey" FOREIGN KEY ("toEntityId") REFERENCES "case_entities" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "signature_requests" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT,
    "subject" TEXT,
    "message" TEXT,
    "signers" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "signedDocumentUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "signature_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "signature_requests_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "research_queries" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "sources" TEXT NOT NULL,
    "results" TEXT,
    "caseId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "research_queries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "research_queries_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "api_integrations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "apiKey" TEXT,
    "baseUrl" TEXT,
    "config" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastUsed" DATETIME,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "api_integrations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "research_conversations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "caseId" TEXT,
    "title" TEXT,
    "jurisdiction" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "research_conversations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "research_conversations_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "research_messages" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sources" TEXT,
    "actions" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "research_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "research_conversations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "research_summaries" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "keyFindings" TEXT NOT NULL,
    "sources" TEXT NOT NULL,
    "jurisdiction" TEXT,
    "caseId" TEXT,
    "vaultItemId" TEXT,
    "conversationId" TEXT,
    "sourceCount" INTEGER NOT NULL DEFAULT 0,
    "confidence" REAL NOT NULL DEFAULT 0.8,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "research_summaries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "research_summaries_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "legal_api_endpoints" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jurisdiction" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "authType" TEXT NOT NULL DEFAULT 'none',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "rateLimit" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "clients" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'individual',
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "website" TEXT,
    "notes" TEXT,
    "customFields" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "clients_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "clients_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "client_contacts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "notes" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "client_contacts_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "matters" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "caseId" TEXT,
    "matterNumber" TEXT,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'general',
    "status" TEXT NOT NULL DEFAULT 'open',
    "description" TEXT,
    "billingType" TEXT,
    "billingRate" REAL,
    "openDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closeDate" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "matters_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "matters_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "team_spaces" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT,
    "icon" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isPrivate" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "team_spaces_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "team_space_members" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "teamSpaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "team_space_members_teamSpaceId_fkey" FOREIGN KEY ("teamSpaceId") REFERENCES "team_spaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "team_space_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "team_space_cases" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "teamSpaceId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "addedBy" TEXT NOT NULL,
    CONSTRAINT "team_space_cases_teamSpaceId_fkey" FOREIGN KEY ("teamSpaceId") REFERENCES "team_spaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "team_space_cases_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "user_ml_preferences" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "preferredModel" TEXT NOT NULL DEFAULT 'auto',
    "temperature" REAL NOT NULL DEFAULT 0.7,
    "maxTokens" INTEGER NOT NULL DEFAULT 2048,
    "enableThinking" BOOLEAN NOT NULL DEFAULT false,
    "enableStreaming" BOOLEAN NOT NULL DEFAULT true,
    "analysisDepth" TEXT NOT NULL DEFAULT 'standard',
    "includeExamples" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "user_ml_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "custom_prompts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "placeholders" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "custom_prompts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "organization_ml_preferences" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "defaultModel" TEXT NOT NULL DEFAULT 'auto',
    "defaultTemperature" REAL NOT NULL DEFAULT 0.7,
    "defaultMaxTokens" INTEGER NOT NULL DEFAULT 2048,
    "defaultAnalysisDepth" TEXT NOT NULL DEFAULT 'standard',
    "enableMLLearning" BOOLEAN NOT NULL DEFAULT true,
    "enableAutoTagging" BOOLEAN NOT NULL DEFAULT true,
    "enableSuggestions" BOOLEAN NOT NULL DEFAULT true,
    "enableSharedModels" BOOLEAN NOT NULL DEFAULT true,
    "retainTrainingData" BOOLEAN NOT NULL DEFAULT true,
    "dataRetentionDays" INTEGER NOT NULL DEFAULT 365,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "organization_ml_preferences_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "organization_ai_instructions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "instruction" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'general',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "appliesToTeams" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "organization_ai_instructions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "firm_behavior_patterns" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "patternType" TEXT NOT NULL,
    "inputPattern" TEXT NOT NULL,
    "outputPattern" TEXT NOT NULL,
    "confidence" REAL NOT NULL DEFAULT 0.5,
    "exampleCount" INTEGER NOT NULL DEFAULT 1,
    "caseTypes" TEXT,
    "documentTypes" TEXT,
    "clientTypes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastUsed" DATETIME,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "acceptedCount" INTEGER NOT NULL DEFAULT 0,
    "rejectedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "firm_behavior_patterns_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ml_training_examples" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "inputData" TEXT NOT NULL,
    "outputData" TEXT NOT NULL,
    "caseId" TEXT,
    "documentId" TEXT,
    "clientId" TEXT,
    "isExplicit" BOOLEAN NOT NULL DEFAULT true,
    "wasAISuggested" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ml_training_examples_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "organization_ml_models" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "modelType" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "trainingDataCount" INTEGER NOT NULL DEFAULT 0,
    "accuracy" REAL,
    "lastTrainedAt" DATETIME,
    "lastEvaluatedAt" DATETIME,
    "modelPath" TEXT,
    "status" TEXT NOT NULL DEFAULT 'training',
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "organization_ml_models_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "prediction_feedback" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "predictionType" TEXT NOT NULL,
    "predictionInput" TEXT NOT NULL,
    "predictionOutput" TEXT NOT NULL,
    "actualOutput" TEXT,
    "feedback" TEXT NOT NULL,
    "feedbackReason" TEXT,
    "patternId" TEXT,
    "caseId" TEXT,
    "documentId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "prediction_feedback_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "firm_clause_preferences" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "clauseType" TEXT NOT NULL,
    "clauseSubtype" TEXT,
    "preferredText" TEXT NOT NULL,
    "alternatives" TEXT NOT NULL,
    "avoidList" TEXT NOT NULL,
    "confidence" REAL NOT NULL DEFAULT 0.5,
    "exampleCount" INTEGER NOT NULL DEFAULT 1,
    "lastUsedAt" DATETIME,
    "lastUpdatedAt" DATETIME NOT NULL,
    "sourceDocumentIds" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "firm_clause_preferences_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "firm_style_profiles" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "formalityLevel" REAL NOT NULL DEFAULT 0.7,
    "avgSentenceLength" REAL NOT NULL DEFAULT 20,
    "avgParagraphLength" REAL NOT NULL DEFAULT 3,
    "preferredTerms" TEXT NOT NULL DEFAULT '{}',
    "avoidedTerms" TEXT NOT NULL DEFAULT '[]',
    "industryTerms" TEXT NOT NULL DEFAULT '[]',
    "structurePatterns" TEXT NOT NULL DEFAULT '{}',
    "numberingStyle" TEXT NOT NULL DEFAULT 'numeric',
    "headingStyle" TEXT NOT NULL DEFAULT 'title',
    "analyzedDocuments" INTEGER NOT NULL DEFAULT 0,
    "lastAnalyzedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "firm_style_profiles_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "firm_clause_examples" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "clauseType" TEXT NOT NULL,
    "clauseText" TEXT NOT NULL,
    "extractedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "wasAccepted" BOOLEAN NOT NULL DEFAULT true,
    "quality" REAL NOT NULL DEFAULT 0.5,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "firm_clause_examples_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "usage_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT,
    "userId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "eventCategory" TEXT NOT NULL,
    "tokensUsed" INTEGER,
    "processingTime" INTEGER,
    "inputSize" INTEGER,
    "outputSize" INTEGER,
    "feature" TEXT,
    "caseId" TEXT,
    "documentId" TEXT,
    "isBillable" BOOLEAN NOT NULL DEFAULT true,
    "billedAmount" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "usage_aggregates" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT,
    "userId" TEXT,
    "date" DATETIME NOT NULL,
    "periodType" TEXT NOT NULL DEFAULT 'daily',
    "aiQueries" INTEGER NOT NULL DEFAULT 0,
    "tokensUsed" INTEGER NOT NULL DEFAULT 0,
    "documentsAnalyzed" INTEGER NOT NULL DEFAULT 0,
    "researchSearches" INTEGER NOT NULL DEFAULT 0,
    "draftsCreated" INTEGER NOT NULL DEFAULT 0,
    "archivistChats" INTEGER NOT NULL DEFAULT 0,
    "estimatedCost" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "resourceId" TEXT,
    "previousValue" TEXT,
    "newValue" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "requestId" TEXT,
    "isCompliance" BOOLEAN NOT NULL DEFAULT false,
    "retentionDays" INTEGER NOT NULL DEFAULT 365,
    "searchQuery" TEXT,
    "documentsAccessed" TEXT,
    "matterId" TEXT,
    "complianceCategory" TEXT,
    "dataClassification" TEXT,
    "sessionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ai_audit_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT,
    "conversationId" TEXT,
    "caseId" TEXT,
    "requestType" TEXT NOT NULL,
    "userQuery" TEXT NOT NULL,
    "ragSearches" TEXT,
    "nliVerifications" TEXT,
    "quoteVerifications" TEXT,
    "llmCalls" TEXT,
    "response" TEXT NOT NULL,
    "sourcesUsed" TEXT,
    "overallConfidence" TEXT NOT NULL DEFAULT 'unverified',
    "nliVerifiedClaims" INTEGER NOT NULL DEFAULT 0,
    "totalClaims" INTEGER NOT NULL DEFAULT 0,
    "quotesVerified" INTEGER NOT NULL DEFAULT 0,
    "totalQuotes" INTEGER NOT NULL DEFAULT 0,
    "jurisdiction" TEXT,
    "jurisdictionSource" TEXT,
    "totalDurationMs" INTEGER NOT NULL DEFAULT 0,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "seats" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "email" TEXT,
    "seatType" TEXT NOT NULL DEFAULT 'member',
    "status" TEXT NOT NULL DEFAULT 'active',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "monthlyCost" REAL,
    "billingStartDate" DATETIME,
    "billingEndDate" DATETIME,
    "assignedAt" DATETIME,
    "assignedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "seats_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "billing_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "description" TEXT,
    "amount" REAL NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "periodStart" DATETIME,
    "periodEnd" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "invoiceId" TEXT,
    "paymentId" TEXT,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "billing_events_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "planName" TEXT NOT NULL,
    "billingCycle" TEXT NOT NULL DEFAULT 'monthly',
    "basePrice" REAL NOT NULL DEFAULT 0,
    "pricePerSeat" REAL NOT NULL DEFAULT 0,
    "includedSeats" INTEGER NOT NULL DEFAULT 1,
    "maxSeats" INTEGER,
    "maxDocuments" INTEGER,
    "maxStorage" INTEGER,
    "maxAIQueries" INTEGER,
    "currentSeats" INTEGER NOT NULL DEFAULT 1,
    "currentDocuments" INTEGER NOT NULL DEFAULT 0,
    "currentStorage" INTEGER NOT NULL DEFAULT 0,
    "currentAIQueries" INTEGER NOT NULL DEFAULT 0,
    "currentPeriodStart" DATETIME,
    "currentPeriodEnd" DATETIME,
    "trialEndsAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'active',
    "canceledAt" DATETIME,
    "cancelReason" TEXT,
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "subscriptions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "seat_client_assignments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "seatId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'assigned',
    "assignedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedBy" TEXT,
    CONSTRAINT "seat_client_assignments_seatId_fkey" FOREIGN KEY ("seatId") REFERENCES "seats" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "seat_client_assignments_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "seat_case_assignments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "seatId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'assigned',
    "assignedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedBy" TEXT,
    CONSTRAINT "seat_case_assignments_seatId_fkey" FOREIGN KEY ("seatId") REFERENCES "seats" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "seat_case_assignments_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "action_feedback" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT,
    "actionType" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "documentId" TEXT,
    "caseId" TEXT,
    "feedback" TEXT NOT NULL,
    "outcome" TEXT,
    "legalMode" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "case_health_snapshots" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "healthScore" INTEGER NOT NULL,
    "components" TEXT NOT NULL,
    "redFlags" TEXT NOT NULL,
    "missingForType" TEXT NOT NULL,
    "caseType" TEXT,
    "generatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "alert_preferences" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "alertType" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "riskThreshold" INTEGER,
    "daysBeforeDeadline" INTEGER,
    "healthThreshold" INTEGER,
    "channels" TEXT NOT NULL DEFAULT '["in_app"]',
    "quietHoursStart" TEXT,
    "quietHoursEnd" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "alert_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "proactive_alerts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "alertType" TEXT NOT NULL,
    "urgency" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "actionUrl" TEXT,
    "documentId" TEXT,
    "caseId" TEXT,
    "metadata" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "isDismissed" BOOLEAN NOT NULL DEFAULT false,
    "readAt" DATETIME,
    "dismissedAt" DATETIME,
    "deliveredVia" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "proactive_alerts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "alert_scan_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scanType" TEXT NOT NULL,
    "userId" TEXT,
    "organizationId" TEXT,
    "alertsGenerated" INTEGER NOT NULL DEFAULT 0,
    "documentsScanned" INTEGER NOT NULL DEFAULT 0,
    "casesScanned" INTEGER NOT NULL DEFAULT 0,
    "startedAt" DATETIME NOT NULL,
    "completedAt" DATETIME,
    "durationMs" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'running',
    "errorMessage" TEXT
);

-- CreateTable
CREATE TABLE "document_templates" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "jurisdiction" TEXT NOT NULL DEFAULT 'US',
    "sections" TEXT NOT NULL,
    "placeholders" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isOfficial" BOOLEAN NOT NULL DEFAULT true,
    "organizationId" TEXT,
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "document_templates_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "document_template_variants" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "templateId" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL,
    "sectionOverrides" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "document_template_variants_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "document_templates" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "document_draft_sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "situation" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL DEFAULT 'US',
    "language" TEXT NOT NULL DEFAULT 'en',
    "status" TEXT NOT NULL DEFAULT 'in_progress',
    "currentSectionIndex" INTEGER NOT NULL DEFAULT 0,
    "answers" TEXT NOT NULL DEFAULT '{}',
    "placeholderValues" TEXT NOT NULL DEFAULT '{}',
    "generatedSections" TEXT NOT NULL DEFAULT '[]',
    "finalDocument" TEXT,
    "disclaimerAccepted" BOOLEAN NOT NULL DEFAULT false,
    "disclaimerAcceptedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "completedAt" DATETIME,
    CONSTRAINT "document_draft_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "document_draft_sessions_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "document_templates" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "anonymous_sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionToken" TEXT NOT NULL,
    "docsUsedThisMonth" INTEGER NOT NULL DEFAULT 0,
    "lastResetMonth" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "client_shares" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "recipientEmail" TEXT,
    "recipientName" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "maxViews" INTEGER,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "sections" TEXT NOT NULL DEFAULT '["summary","keyClauses","riskFlags","clarityScore"]',
    "passwordHash" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "revokedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastViewedAt" DATETIME
);

-- CreateTable
CREATE TABLE "usage_records" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT,
    "month" TEXT NOT NULL,
    "documentsAnalyzed" INTEGER NOT NULL DEFAULT 0,
    "aiQueriesUsed" INTEGER NOT NULL DEFAULT 0,
    "draftsCreated" INTEGER NOT NULL DEFAULT 0,
    "researchQueries" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "usage_records_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "analytics_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "sessionId" TEXT,
    "organizationId" TEXT,
    "event" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "properties" TEXT,
    "metadata" TEXT,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "analysis_feedback" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "summaryHelpful" BOOLEAN,
    "risksAccurate" BOOLEAN,
    "clausesClear" BOOLEAN,
    "glossaryUseful" BOOLEAN,
    "overallAccuracy" INTEGER,
    "comments" TEXT,
    "issues" TEXT,
    "analysisVersion" TEXT,
    "jurisdiction" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "document_comparisons" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "documentAId" TEXT NOT NULL,
    "documentBId" TEXT NOT NULL,
    "differences" TEXT NOT NULL,
    "riskChanges" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "stats" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "document_comparisons_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "approval_workflows" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT,
    "documentId" TEXT,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "currentStep" INTEGER NOT NULL DEFAULT 0,
    "steps" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "completedAt" DATETIME
);

-- CreateTable
CREATE TABLE "bulk_upload_jobs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT,
    "totalFiles" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "processedFiles" INTEGER NOT NULL DEFAULT 0,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "results" TEXT NOT NULL DEFAULT '[]',
    "caseId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    CONSTRAINT "bulk_upload_jobs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "mfa_secrets" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "mfa_secrets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "mfa_backup_codes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mfaSecretId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "mfa_backup_codes_mfaSecretId_fkey" FOREIGN KEY ("mfaSecretId") REFERENCES "mfa_secrets" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "sso_configurations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "entityId" TEXT,
    "ssoUrl" TEXT,
    "certificate" TEXT,
    "clientId" TEXT,
    "clientSecret" TEXT,
    "enforceSso" BOOLEAN NOT NULL DEFAULT false,
    "autoProvision" BOOLEAN NOT NULL DEFAULT true,
    "defaultRole" TEXT NOT NULL DEFAULT 'member',
    "azureTenantId" TEXT,
    "azureLoginUrl" TEXT,
    "domainHints" TEXT,
    "groupMappings" TEXT,
    "syncGroupsOnLogin" BOOLEAN NOT NULL DEFAULT true,
    "scimEnabled" BOOLEAN NOT NULL DEFAULT false,
    "scimToken" TEXT,
    "scimEndpoint" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "sso_configurations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "azure_ad_group_syncs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ssoConfigId" TEXT NOT NULL,
    "azureGroupId" TEXT NOT NULL,
    "azureGroupName" TEXT NOT NULL,
    "localRole" TEXT NOT NULL,
    "practiceAreaId" TEXT,
    "lastSyncAt" DATETIME,
    "memberCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "azure_ad_group_syncs_ssoConfigId_fkey" FOREIGN KEY ("ssoConfigId") REFERENCES "sso_configurations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "azure_ad_group_syncs_practiceAreaId_fkey" FOREIGN KEY ("practiceAreaId") REFERENCES "practice_areas" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "practice_areas" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "parentId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "practice_areas_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "practice_areas_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "practice_areas" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "extended_roles" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "canCreateCases" BOOLEAN NOT NULL DEFAULT false,
    "canDeleteCases" BOOLEAN NOT NULL DEFAULT false,
    "canViewBilling" BOOLEAN NOT NULL DEFAULT false,
    "canApproveDocuments" BOOLEAN NOT NULL DEFAULT false,
    "canAccessAllCases" BOOLEAN NOT NULL DEFAULT false,
    "canManageTeam" BOOLEAN NOT NULL DEFAULT false,
    "canExportData" BOOLEAN NOT NULL DEFAULT false,
    "canViewAuditLogs" BOOLEAN NOT NULL DEFAULT false,
    "restrictedToPracticeAreaId" TEXT,
    "standardHourlyRate" REAL,
    "billingCode" TEXT,
    "additionalPermissions" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "extended_roles_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "extended_roles_restrictedToPracticeAreaId_fkey" FOREIGN KEY ("restrictedToPracticeAreaId") REFERENCES "practice_areas" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "user_practice_areas" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "practiceAreaId" TEXT NOT NULL,
    "accessLevel" TEXT NOT NULL DEFAULT 'read',
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "canCreateCases" BOOLEAN NOT NULL DEFAULT false,
    "assignedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedBy" TEXT,
    CONSTRAINT "user_practice_areas_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "user_practice_areas_practiceAreaId_fkey" FOREIGN KEY ("practiceAreaId") REFERENCES "practice_areas" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "search_audit_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT,
    "userId" TEXT NOT NULL,
    "searchType" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "jurisdiction" TEXT,
    "resultCount" INTEGER NOT NULL,
    "resultsViewed" TEXT,
    "caseId" TEXT,
    "matterId" TEXT,
    "pageUrl" TEXT,
    "searchDuration" INTEGER,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "sessionId" TEXT,
    "containsPII" BOOLEAN NOT NULL DEFAULT false,
    "complianceCategory" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "customer_api_keys" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "scopes" TEXT NOT NULL,
    "ipWhitelist" TEXT,
    "rateLimit" INTEGER NOT NULL DEFAULT 1000,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastUsedAt" DATETIME,
    "expiresAt" DATETIME,
    "totalRequests" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "customer_api_keys_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "api_request_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "apiKeyId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "responseTime" INTEGER NOT NULL,
    "ipAddress" TEXT,
    "requestBody" TEXT,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "api_request_logs_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "customer_api_keys" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "content_update_packages" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "version" TEXT NOT NULL,
    "packageType" TEXT NOT NULL,
    "jurisdiction" TEXT,
    "contentDate" DATETIME NOT NULL,
    "chunkCount" INTEGER NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "channelType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'available',
    "appliedAt" DATETIME,
    "appliedBy" TEXT,
    "changelog" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "content_sync_schedules" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "syncEnabled" BOOLEAN NOT NULL DEFAULT false,
    "syncMethod" TEXT NOT NULL DEFAULT 'usb',
    "syncFrequency" TEXT NOT NULL DEFAULT 'monthly',
    "syncWindowEnabled" BOOLEAN NOT NULL DEFAULT false,
    "syncWindowStart" TEXT,
    "syncWindowEnd" TEXT,
    "syncWindowDays" TEXT,
    "serverUrl" TEXT,
    "serverApiKey" TEXT,
    "jurisdictions" TEXT NOT NULL,
    "lastSyncAt" DATETIME,
    "nextSyncAt" DATETIME,
    "lastSyncStatus" TEXT,
    "lastSyncError" TEXT,
    "autoApply" BOOLEAN NOT NULL DEFAULT false,
    "requireApproval" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "content_sync_schedules_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "organization_update_history" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL,
    "packageType" TEXT NOT NULL,
    "appliedBy" TEXT NOT NULL,
    "appliedAt" DATETIME NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'usb',
    "chunksAdded" INTEGER NOT NULL DEFAULT 0,
    "chunksUpdated" INTEGER NOT NULL DEFAULT 0,
    "chunksRemoved" INTEGER NOT NULL DEFAULT 0,
    "subscriptionFrequency" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "organization_update_history_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "sso_sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "expiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sso_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "user_sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "deviceInfo" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "location" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastActivityAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "password_reset_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "system_settings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "update_history" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "packageId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL,
    "chunksAdded" INTEGER NOT NULL DEFAULT 0,
    "chunksUpdated" INTEGER NOT NULL DEFAULT 0,
    "chunksRemoved" INTEGER NOT NULL DEFAULT 0,
    "metadata" TEXT,
    "appliedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedBy" TEXT
);

-- CreateTable
CREATE TABLE "update_metadata" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "currentVersion" TEXT NOT NULL DEFAULT '0.0.0',
    "lastCheckedAt" DATETIME,
    "checkEnabled" BOOLEAN NOT NULL DEFAULT true,
    "checkInterval" INTEGER NOT NULL DEFAULT 86400000,
    "pendingVersion" TEXT,
    "pendingPackagePath" TEXT,
    "pendingChangelog" TEXT,
    "pendingSize" INTEGER,
    "downloadProgress" INTEGER,
    "downloadStartedAt" DATETIME,
    "lastAppliedAt" DATETIME,
    "lastAppliedVersion" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "llm_cache" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "inputHash" TEXT NOT NULL,
    "output" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "taskType" TEXT NOT NULL,
    "hitCount" INTEGER NOT NULL DEFAULT 0,
    "lastHitAt" DATETIME,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "entity_links" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "linkType" TEXT NOT NULL,
    "isAutoGenerated" BOOLEAN NOT NULL DEFAULT false,
    "confidence" REAL,
    "detectedBy" TEXT,
    "context" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT
);

-- CreateTable
CREATE TABLE "local_integrations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT,
    "type" TEXT NOT NULL,
    "config" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'disconnected',
    "lastSyncAt" DATETIME,
    "lastError" TEXT,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "syncInterval" INTEGER NOT NULL DEFAULT 3600000,
    "autoSync" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "sync_queue_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT,
    "operation" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "lastAttempt" DATETIME,
    "lastError" TEXT,
    "completedAt" DATETIME,
    "endpoint" TEXT
);

-- CreateTable
CREATE TABLE "dms_integrations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'imanage',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "serverUrl" TEXT,
    "clientId" TEXT,
    "clientSecretEnc" TEXT,
    "tenant" TEXT,
    "accessTokenEnc" TEXT,
    "refreshTokenEnc" TEXT,
    "tokenExpiresAt" DATETIME,
    "syncDirection" TEXT NOT NULL DEFAULT 'bidirectional',
    "autoSync" BOOLEAN NOT NULL DEFAULT true,
    "syncFrequencyMinutes" INTEGER NOT NULL DEFAULT 15,
    "defaultWorkspaceId" TEXT,
    "workspaceMappings" TEXT,
    "status" TEXT NOT NULL DEFAULT 'disconnected',
    "lastSyncAt" DATETIME,
    "lastSyncError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "dms_integrations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "document_dms_links" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT NOT NULL,
    "dmsProvider" TEXT NOT NULL,
    "dmsDocumentId" TEXT NOT NULL,
    "dmsPath" TEXT,
    "dmsVersion" TEXT,
    "dmsIntegrationId" TEXT,
    "syncStatus" TEXT NOT NULL DEFAULT 'synced',
    "lastSyncAt" DATETIME,
    "localChecksum" TEXT,
    "dmsChecksum" TEXT,
    "dmsMetadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "document_dms_links_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "document_dms_links_dmsIntegrationId_fkey" FOREIGN KEY ("dmsIntegrationId") REFERENCES "dms_integrations" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "dms_workspace_mappings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "dmsWorkspaceId" TEXT NOT NULL,
    "dmsWorkspaceName" TEXT NOT NULL,
    "dmsWorkspacePath" TEXT,
    "caseId" TEXT,
    "syncEnabled" BOOLEAN NOT NULL DEFAULT true,
    "syncFilters" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "dms_workspace_mappings_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "billing_system_integrations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'elite3e',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "serverUrl" TEXT,
    "apiKeyEnc" TEXT,
    "clientIdEnc" TEXT,
    "clientSecretEnc" TEXT,
    "accessTokenEnc" TEXT,
    "refreshTokenEnc" TEXT,
    "tokenExpiresAt" DATETIME,
    "syncMatters" BOOLEAN NOT NULL DEFAULT true,
    "syncTimeEntries" BOOLEAN NOT NULL DEFAULT true,
    "syncExpenses" BOOLEAN NOT NULL DEFAULT false,
    "syncInvoices" BOOLEAN NOT NULL DEFAULT false,
    "defaultTimekeeperCode" TEXT,
    "defaultTaskCode" TEXT,
    "status" TEXT NOT NULL DEFAULT 'disconnected',
    "lastSyncAt" DATETIME,
    "lastSyncError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "billing_system_integrations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "matter_billing_links" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "billingProvider" TEXT NOT NULL,
    "billingMatterId" TEXT NOT NULL,
    "matterNumber" TEXT,
    "clientNumber" TEXT,
    "billingIntegrationId" TEXT,
    "syncStatus" TEXT NOT NULL DEFAULT 'synced',
    "lastSyncAt" DATETIME,
    "billingMetadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "matter_billing_links_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "matter_billing_links_billingIntegrationId_fkey" FOREIGN KEY ("billingIntegrationId") REFERENCES "billing_system_integrations" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "time_entries" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "caseId" TEXT,
    "date" DATETIME NOT NULL,
    "hours" REAL NOT NULL,
    "description" TEXT NOT NULL,
    "narrative" TEXT,
    "taskCode" TEXT,
    "phaseCode" TEXT,
    "expenseCode" TEXT,
    "hourlyRate" REAL,
    "amount" REAL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "billingIntegrationId" TEXT,
    "billingEntryId" TEXT,
    "syncStatus" TEXT NOT NULL DEFAULT 'pending',
    "syncError" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "documentId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "time_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "time_entries_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "time_entries_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "time_entries_billingIntegrationId_fkey" FOREIGN KEY ("billingIntegrationId") REFERENCES "billing_system_integrations" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "offices" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "address" TEXT,
    "city" TEXT,
    "country" TEXT,
    "latitude" REAL,
    "longitude" REAL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "jurisdictions" TEXT,
    "syncEnabled" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncAt" DATETIME,
    "syncPriority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "offices_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "server_nodes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "officeId" TEXT,
    "nodeId" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "version" TEXT,
    "internalUrl" TEXT NOT NULL,
    "externalUrl" TEXT,
    "publicKey" TEXT,
    "isLeader" BOOLEAN NOT NULL DEFAULT false,
    "canAcceptWrites" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'offline',
    "lastHeartbeat" DATETIME,
    "cpuUsage" REAL,
    "memoryUsage" REAL,
    "diskUsage" REAL,
    "activeRequests" INTEGER,
    "lastSyncedVersion" INTEGER NOT NULL DEFAULT 0,
    "lastFullSyncAt" DATETIME,
    "pendingChanges" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "server_nodes_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "server_nodes_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "offices" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "sync_operations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceNodeId" TEXT NOT NULL,
    "targetNodeId" TEXT NOT NULL,
    "operationType" TEXT NOT NULL,
    "dataTypes" TEXT NOT NULL,
    "fromVersion" INTEGER NOT NULL,
    "toVersion" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "progress" REAL NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "recordsTotal" INTEGER NOT NULL DEFAULT 0,
    "recordsSynced" INTEGER NOT NULL DEFAULT 0,
    "recordsFailed" INTEGER NOT NULL DEFAULT 0,
    "bytesTransferred" INTEGER NOT NULL DEFAULT 0,
    "scheduledAt" DATETIME,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sync_operations_sourceNodeId_fkey" FOREIGN KEY ("sourceNodeId") REFERENCES "server_nodes" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "sync_operations_targetNodeId_fkey" FOREIGN KEY ("targetNodeId") REFERENCES "server_nodes" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "sync_conflicts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "syncOperationId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "fieldName" TEXT NOT NULL,
    "sourceValue" TEXT NOT NULL,
    "targetValue" TEXT NOT NULL,
    "sourceVersion" INTEGER NOT NULL,
    "targetVersion" INTEGER NOT NULL,
    "resolvedBy" TEXT,
    "resolvedValue" TEXT,
    "resolvedAt" DATETIME,
    "resolution" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "node_registry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "currentLeaderId" TEXT,
    "leaderElectedAt" DATETIME,
    "leaderTerm" INTEGER NOT NULL DEFAULT 0,
    "discoveryMethod" TEXT NOT NULL DEFAULT 'manual',
    "discoveryConfig" TEXT,
    "syncStrategy" TEXT NOT NULL DEFAULT 'eventual',
    "conflictStrategy" TEXT NOT NULL DEFAULT 'last_write_wins',
    "syncIntervalSec" INTEGER NOT NULL DEFAULT 300,
    "globalVersion" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "node_registry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "licenses" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "licenseKey" TEXT NOT NULL,
    "licenseType" TEXT NOT NULL,
    "validFrom" DATETIME NOT NULL,
    "validUntil" DATETIME NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "features" TEXT NOT NULL DEFAULT '{}',
    "signature" TEXT NOT NULL,
    "publicKeyId" TEXT NOT NULL,
    "lastVerifiedAt" DATETIME,
    "offlineGraceDays" INTEGER NOT NULL DEFAULT 30,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "licenses_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "data_entitlements" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "licenseId" TEXT NOT NULL,
    "dataType" TEXT NOT NULL,
    "dataCode" TEXT NOT NULL,
    "dataVersion" TEXT,
    "scope" TEXT,
    "priceAtPurchase" REAL,
    "pricingFactors" TEXT,
    "includesUpdates" BOOLEAN NOT NULL DEFAULT true,
    "updateFrequency" TEXT NOT NULL DEFAULT 'monthly',
    "updatesUntil" DATETIME,
    "lastDeliveredVersion" TEXT,
    "lastDeliveredAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "data_entitlements_licenseId_fkey" FOREIGN KEY ("licenseId") REFERENCES "licenses" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "pricing_formulas" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dataType" TEXT NOT NULL,
    "dataCode" TEXT,
    "basePrice" REAL NOT NULL,
    "multipliers" TEXT NOT NULL DEFAULT '[]',
    "minPrice" REAL NOT NULL DEFAULT 0,
    "maxPrice" REAL,
    "validFrom" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" DATETIME,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "license_usage_records" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "licenseId" TEXT NOT NULL,
    "usageType" TEXT NOT NULL,
    "usageDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "dataCode" TEXT,
    "count" INTEGER NOT NULL DEFAULT 1,
    "tokensUsed" INTEGER,
    "chunksQueried" INTEGER,
    "syncedAt" DATETIME,
    CONSTRAINT "license_usage_records_licenseId_fkey" FOREIGN KEY ("licenseId") REFERENCES "licenses" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "data_catalog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dataType" TEXT NOT NULL,
    "dataCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "chunkCount" INTEGER NOT NULL DEFAULT 0,
    "lastUpdated" DATETIME,
    "updateFrequency" TEXT NOT NULL DEFAULT 'monthly',
    "coverage" TEXT NOT NULL DEFAULT '{}',
    "complexityTier" TEXT NOT NULL DEFAULT 'standard',
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "document_research_sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "documentIds" TEXT NOT NULL,
    "title" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "focusedClause" TEXT,
    "mentionedTopics" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "document_research_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "document_research_messages" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "referencedDocs" TEXT,
    "referencedClauses" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "document_research_messages_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "document_research_sessions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "cross_reference_reports" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "searchTerm" TEXT NOT NULL,
    "documentIds" TEXT,
    "matrix" TEXT NOT NULL,
    "summary" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cross_reference_reports_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "contradiction_scans" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "documentIds" TEXT NOT NULL,
    "contradictions" TEXT NOT NULL,
    "summary" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "contradiction_scans_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_stripeCustomerId_key" ON "users"("stripeCustomerId");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_organizationId_idx" ON "users"("organizationId");

-- CreateIndex
CREATE INDEX "users_extendedRoleId_idx" ON "users"("extendedRoleId");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE INDEX "organizations_ownerUserId_idx" ON "organizations"("ownerUserId");

-- CreateIndex
CREATE INDEX "organizations_slug_idx" ON "organizations"("slug");

-- CreateIndex
CREATE INDEX "organization_integrations_organizationId_idx" ON "organization_integrations"("organizationId");

-- CreateIndex
CREATE INDEX "organization_integrations_provider_idx" ON "organization_integrations"("provider");

-- CreateIndex
CREATE UNIQUE INDEX "organization_integrations_organizationId_provider_key" ON "organization_integrations"("organizationId", "provider");

-- CreateIndex
CREATE INDEX "organization_invitations_email_idx" ON "organization_invitations"("email");

-- CreateIndex
CREATE INDEX "organization_invitations_status_idx" ON "organization_invitations"("status");

-- CreateIndex
CREATE UNIQUE INDEX "organization_invitations_organizationId_email_key" ON "organization_invitations"("organizationId", "email");

-- CreateIndex
CREATE INDEX "documents_userId_idx" ON "documents"("userId");

-- CreateIndex
CREATE INDEX "documents_status_idx" ON "documents"("status");

-- CreateIndex
CREATE INDEX "documents_createdAt_idx" ON "documents"("createdAt");

-- CreateIndex
CREATE INDEX "document_versions_documentId_idx" ON "document_versions"("documentId");

-- CreateIndex
CREATE INDEX "document_versions_version_idx" ON "document_versions"("version");

-- CreateIndex
CREATE UNIQUE INDEX "document_versions_documentId_version_key" ON "document_versions"("documentId", "version");

-- CreateIndex
CREATE INDEX "document_comments_documentId_idx" ON "document_comments"("documentId");

-- CreateIndex
CREATE INDEX "document_comments_userId_idx" ON "document_comments"("userId");

-- CreateIndex
CREATE INDEX "document_comments_parentId_idx" ON "document_comments"("parentId");

-- CreateIndex
CREATE INDEX "document_comments_isResolved_idx" ON "document_comments"("isResolved");

-- CreateIndex
CREATE INDEX "vault_items_userId_idx" ON "vault_items"("userId");

-- CreateIndex
CREATE INDEX "vault_items_type_idx" ON "vault_items"("type");

-- CreateIndex
CREATE INDEX "vault_items_category_idx" ON "vault_items"("category");

-- CreateIndex
CREATE INDEX "vault_items_folderId_idx" ON "vault_items"("folderId");

-- CreateIndex
CREATE INDEX "vault_items_isFavorite_idx" ON "vault_items"("isFavorite");

-- CreateIndex
CREATE INDEX "vault_items_createdAt_idx" ON "vault_items"("createdAt");

-- CreateIndex
CREATE INDEX "study_sets_userId_idx" ON "study_sets"("userId");

-- CreateIndex
CREATE INDEX "study_sets_category_idx" ON "study_sets"("category");

-- CreateIndex
CREATE INDEX "study_sets_jurisdiction_idx" ON "study_sets"("jurisdiction");

-- CreateIndex
CREATE INDEX "study_sets_isOfficial_idx" ON "study_sets"("isOfficial");

-- CreateIndex
CREATE INDEX "study_cards_setId_idx" ON "study_cards"("setId");

-- CreateIndex
CREATE INDEX "study_cards_difficulty_idx" ON "study_cards"("difficulty");

-- CreateIndex
CREATE INDEX "study_cards_isReported_idx" ON "study_cards"("isReported");

-- CreateIndex
CREATE INDEX "study_progress_userId_idx" ON "study_progress"("userId");

-- CreateIndex
CREATE INDEX "study_progress_cardId_idx" ON "study_progress"("cardId");

-- CreateIndex
CREATE INDEX "study_progress_nextReviewDate_idx" ON "study_progress"("nextReviewDate");

-- CreateIndex
CREATE INDEX "study_progress_masteryLevel_idx" ON "study_progress"("masteryLevel");

-- CreateIndex
CREATE UNIQUE INDEX "study_progress_userId_cardId_key" ON "study_progress"("userId", "cardId");

-- CreateIndex
CREATE INDEX "study_sessions_userId_idx" ON "study_sessions"("userId");

-- CreateIndex
CREATE INDEX "study_sessions_studyMode_idx" ON "study_sessions"("studyMode");

-- CreateIndex
CREATE INDEX "study_sessions_startedAt_idx" ON "study_sessions"("startedAt");

-- CreateIndex
CREATE INDEX "leaderboard_scores_userId_idx" ON "leaderboard_scores"("userId");

-- CreateIndex
CREATE INDEX "leaderboard_scores_score_idx" ON "leaderboard_scores"("score");

-- CreateIndex
CREATE INDEX "leaderboard_scores_createdAt_idx" ON "leaderboard_scores"("createdAt");

-- CreateIndex
CREATE INDEX "cases_userId_idx" ON "cases"("userId");

-- CreateIndex
CREATE INDEX "cases_status_idx" ON "cases"("status");

-- CreateIndex
CREATE INDEX "cases_clientId_idx" ON "cases"("clientId");

-- CreateIndex
CREATE INDEX "cases_caseType_idx" ON "cases"("caseType");

-- CreateIndex
CREATE INDEX "cases_createdAt_idx" ON "cases"("createdAt");

-- CreateIndex
CREATE INDEX "case_collaborators_caseId_idx" ON "case_collaborators"("caseId");

-- CreateIndex
CREATE INDEX "case_collaborators_userId_idx" ON "case_collaborators"("userId");

-- CreateIndex
CREATE INDEX "case_collaborators_status_idx" ON "case_collaborators"("status");

-- CreateIndex
CREATE UNIQUE INDEX "case_collaborators_caseId_userId_key" ON "case_collaborators"("caseId", "userId");

-- CreateIndex
CREATE INDEX "case_tags_caseId_idx" ON "case_tags"("caseId");

-- CreateIndex
CREATE INDEX "case_tags_name_idx" ON "case_tags"("name");

-- CreateIndex
CREATE INDEX "case_checklists_caseId_idx" ON "case_checklists"("caseId");

-- CreateIndex
CREATE INDEX "case_checklist_items_checklistId_idx" ON "case_checklist_items"("checklistId");

-- CreateIndex
CREATE INDEX "case_checklist_items_assignedTo_idx" ON "case_checklist_items"("assignedTo");

-- CreateIndex
CREATE INDEX "case_checklist_comments_itemId_idx" ON "case_checklist_comments"("itemId");

-- CreateIndex
CREATE INDEX "case_checklist_comments_userId_idx" ON "case_checklist_comments"("userId");

-- CreateIndex
CREATE INDEX "case_timeline_events_caseId_idx" ON "case_timeline_events"("caseId");

-- CreateIndex
CREATE INDEX "case_timeline_events_date_idx" ON "case_timeline_events"("date");

-- CreateIndex
CREATE INDEX "case_timeline_events_eventType_idx" ON "case_timeline_events"("eventType");

-- CreateIndex
CREATE INDEX "case_activity_logs_caseId_idx" ON "case_activity_logs"("caseId");

-- CreateIndex
CREATE INDEX "case_activity_logs_userId_idx" ON "case_activity_logs"("userId");

-- CreateIndex
CREATE INDEX "case_activity_logs_createdAt_idx" ON "case_activity_logs"("createdAt");

-- CreateIndex
CREATE INDEX "notifications_userId_idx" ON "notifications"("userId");

-- CreateIndex
CREATE INDEX "notifications_isRead_idx" ON "notifications"("isRead");

-- CreateIndex
CREATE INDEX "notifications_createdAt_idx" ON "notifications"("createdAt");

-- CreateIndex
CREATE INDEX "case_entities_caseId_idx" ON "case_entities"("caseId");

-- CreateIndex
CREATE INDEX "case_entities_type_idx" ON "case_entities"("type");

-- CreateIndex
CREATE INDEX "case_relationships_caseId_idx" ON "case_relationships"("caseId");

-- CreateIndex
CREATE INDEX "case_relationships_fromEntityId_idx" ON "case_relationships"("fromEntityId");

-- CreateIndex
CREATE INDEX "case_relationships_toEntityId_idx" ON "case_relationships"("toEntityId");

-- CreateIndex
CREATE INDEX "signature_requests_userId_idx" ON "signature_requests"("userId");

-- CreateIndex
CREATE INDEX "signature_requests_caseId_idx" ON "signature_requests"("caseId");

-- CreateIndex
CREATE INDEX "signature_requests_documentId_idx" ON "signature_requests"("documentId");

-- CreateIndex
CREATE INDEX "signature_requests_status_idx" ON "signature_requests"("status");

-- CreateIndex
CREATE INDEX "signature_requests_externalId_idx" ON "signature_requests"("externalId");

-- CreateIndex
CREATE INDEX "research_queries_userId_idx" ON "research_queries"("userId");

-- CreateIndex
CREATE INDEX "research_queries_caseId_idx" ON "research_queries"("caseId");

-- CreateIndex
CREATE INDEX "api_integrations_userId_idx" ON "api_integrations"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "api_integrations_userId_provider_key" ON "api_integrations"("userId", "provider");

-- CreateIndex
CREATE INDEX "research_conversations_userId_idx" ON "research_conversations"("userId");

-- CreateIndex
CREATE INDEX "research_conversations_caseId_idx" ON "research_conversations"("caseId");

-- CreateIndex
CREATE INDEX "research_messages_conversationId_idx" ON "research_messages"("conversationId");

-- CreateIndex
CREATE INDEX "research_summaries_userId_idx" ON "research_summaries"("userId");

-- CreateIndex
CREATE INDEX "research_summaries_caseId_idx" ON "research_summaries"("caseId");

-- CreateIndex
CREATE INDEX "research_summaries_conversationId_idx" ON "research_summaries"("conversationId");

-- CreateIndex
CREATE INDEX "legal_api_endpoints_jurisdiction_idx" ON "legal_api_endpoints"("jurisdiction");

-- CreateIndex
CREATE UNIQUE INDEX "legal_api_endpoints_jurisdiction_provider_key" ON "legal_api_endpoints"("jurisdiction", "provider");

-- CreateIndex
CREATE INDEX "clients_userId_idx" ON "clients"("userId");

-- CreateIndex
CREATE INDEX "clients_organizationId_idx" ON "clients"("organizationId");

-- CreateIndex
CREATE INDEX "clients_status_idx" ON "clients"("status");

-- CreateIndex
CREATE INDEX "client_contacts_clientId_idx" ON "client_contacts"("clientId");

-- CreateIndex
CREATE INDEX "matters_clientId_idx" ON "matters"("clientId");

-- CreateIndex
CREATE INDEX "matters_caseId_idx" ON "matters"("caseId");

-- CreateIndex
CREATE INDEX "matters_status_idx" ON "matters"("status");

-- CreateIndex
CREATE INDEX "team_spaces_organizationId_idx" ON "team_spaces"("organizationId");

-- CreateIndex
CREATE INDEX "team_space_members_teamSpaceId_idx" ON "team_space_members"("teamSpaceId");

-- CreateIndex
CREATE INDEX "team_space_members_userId_idx" ON "team_space_members"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "team_space_members_teamSpaceId_userId_key" ON "team_space_members"("teamSpaceId", "userId");

-- CreateIndex
CREATE INDEX "team_space_cases_teamSpaceId_idx" ON "team_space_cases"("teamSpaceId");

-- CreateIndex
CREATE INDEX "team_space_cases_caseId_idx" ON "team_space_cases"("caseId");

-- CreateIndex
CREATE UNIQUE INDEX "team_space_cases_teamSpaceId_caseId_key" ON "team_space_cases"("teamSpaceId", "caseId");

-- CreateIndex
CREATE UNIQUE INDEX "user_ml_preferences_userId_key" ON "user_ml_preferences"("userId");

-- CreateIndex
CREATE INDEX "custom_prompts_userId_idx" ON "custom_prompts"("userId");

-- CreateIndex
CREATE INDEX "custom_prompts_category_idx" ON "custom_prompts"("category");

-- CreateIndex
CREATE UNIQUE INDEX "organization_ml_preferences_organizationId_key" ON "organization_ml_preferences"("organizationId");

-- CreateIndex
CREATE INDEX "organization_ai_instructions_organizationId_idx" ON "organization_ai_instructions"("organizationId");

-- CreateIndex
CREATE INDEX "organization_ai_instructions_isActive_idx" ON "organization_ai_instructions"("isActive");

-- CreateIndex
CREATE INDEX "firm_behavior_patterns_organizationId_idx" ON "firm_behavior_patterns"("organizationId");

-- CreateIndex
CREATE INDEX "firm_behavior_patterns_patternType_idx" ON "firm_behavior_patterns"("patternType");

-- CreateIndex
CREATE INDEX "firm_behavior_patterns_confidence_idx" ON "firm_behavior_patterns"("confidence");

-- CreateIndex
CREATE INDEX "ml_training_examples_organizationId_idx" ON "ml_training_examples"("organizationId");

-- CreateIndex
CREATE INDEX "ml_training_examples_actionType_idx" ON "ml_training_examples"("actionType");

-- CreateIndex
CREATE INDEX "ml_training_examples_createdAt_idx" ON "ml_training_examples"("createdAt");

-- CreateIndex
CREATE INDEX "organization_ml_models_organizationId_idx" ON "organization_ml_models"("organizationId");

-- CreateIndex
CREATE INDEX "organization_ml_models_status_idx" ON "organization_ml_models"("status");

-- CreateIndex
CREATE UNIQUE INDEX "organization_ml_models_organizationId_modelType_version_key" ON "organization_ml_models"("organizationId", "modelType", "version");

-- CreateIndex
CREATE INDEX "prediction_feedback_organizationId_idx" ON "prediction_feedback"("organizationId");

-- CreateIndex
CREATE INDEX "prediction_feedback_predictionType_idx" ON "prediction_feedback"("predictionType");

-- CreateIndex
CREATE INDEX "prediction_feedback_feedback_idx" ON "prediction_feedback"("feedback");

-- CreateIndex
CREATE INDEX "prediction_feedback_createdAt_idx" ON "prediction_feedback"("createdAt");

-- CreateIndex
CREATE INDEX "firm_clause_preferences_organizationId_idx" ON "firm_clause_preferences"("organizationId");

-- CreateIndex
CREATE INDEX "firm_clause_preferences_clauseType_idx" ON "firm_clause_preferences"("clauseType");

-- CreateIndex
CREATE UNIQUE INDEX "firm_clause_preferences_organizationId_clauseType_clauseSubtype_key" ON "firm_clause_preferences"("organizationId", "clauseType", "clauseSubtype");

-- CreateIndex
CREATE UNIQUE INDEX "firm_style_profiles_organizationId_key" ON "firm_style_profiles"("organizationId");

-- CreateIndex
CREATE INDEX "firm_clause_examples_organizationId_idx" ON "firm_clause_examples"("organizationId");

-- CreateIndex
CREATE INDEX "firm_clause_examples_clauseType_idx" ON "firm_clause_examples"("clauseType");

-- CreateIndex
CREATE INDEX "usage_events_organizationId_idx" ON "usage_events"("organizationId");

-- CreateIndex
CREATE INDEX "usage_events_userId_idx" ON "usage_events"("userId");

-- CreateIndex
CREATE INDEX "usage_events_eventType_idx" ON "usage_events"("eventType");

-- CreateIndex
CREATE INDEX "usage_events_eventCategory_idx" ON "usage_events"("eventCategory");

-- CreateIndex
CREATE INDEX "usage_events_createdAt_idx" ON "usage_events"("createdAt");

-- CreateIndex
CREATE INDEX "usage_aggregates_organizationId_idx" ON "usage_aggregates"("organizationId");

-- CreateIndex
CREATE INDEX "usage_aggregates_userId_idx" ON "usage_aggregates"("userId");

-- CreateIndex
CREATE INDEX "usage_aggregates_date_idx" ON "usage_aggregates"("date");

-- CreateIndex
CREATE UNIQUE INDEX "usage_aggregates_organizationId_userId_date_periodType_key" ON "usage_aggregates"("organizationId", "userId", "date", "periodType");

-- CreateIndex
CREATE INDEX "audit_logs_organizationId_idx" ON "audit_logs"("organizationId");

-- CreateIndex
CREATE INDEX "audit_logs_userId_idx" ON "audit_logs"("userId");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "audit_logs_resource_idx" ON "audit_logs"("resource");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_isCompliance_idx" ON "audit_logs"("isCompliance");

-- CreateIndex
CREATE INDEX "audit_logs_matterId_idx" ON "audit_logs"("matterId");

-- CreateIndex
CREATE INDEX "audit_logs_sessionId_idx" ON "audit_logs"("sessionId");

-- CreateIndex
CREATE INDEX "ai_audit_logs_userId_idx" ON "ai_audit_logs"("userId");

-- CreateIndex
CREATE INDEX "ai_audit_logs_organizationId_idx" ON "ai_audit_logs"("organizationId");

-- CreateIndex
CREATE INDEX "ai_audit_logs_conversationId_idx" ON "ai_audit_logs"("conversationId");

-- CreateIndex
CREATE INDEX "ai_audit_logs_caseId_idx" ON "ai_audit_logs"("caseId");

-- CreateIndex
CREATE INDEX "ai_audit_logs_requestType_idx" ON "ai_audit_logs"("requestType");

-- CreateIndex
CREATE INDEX "ai_audit_logs_overallConfidence_idx" ON "ai_audit_logs"("overallConfidence");

-- CreateIndex
CREATE INDEX "ai_audit_logs_createdAt_idx" ON "ai_audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "seats_organizationId_idx" ON "seats"("organizationId");

-- CreateIndex
CREATE INDEX "seats_userId_idx" ON "seats"("userId");

-- CreateIndex
CREATE INDEX "seats_isActive_idx" ON "seats"("isActive");

-- CreateIndex
CREATE INDEX "billing_events_organizationId_idx" ON "billing_events"("organizationId");

-- CreateIndex
CREATE INDEX "billing_events_eventType_idx" ON "billing_events"("eventType");

-- CreateIndex
CREATE INDEX "billing_events_status_idx" ON "billing_events"("status");

-- CreateIndex
CREATE INDEX "billing_events_createdAt_idx" ON "billing_events"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_organizationId_key" ON "subscriptions"("organizationId");

-- CreateIndex
CREATE INDEX "subscriptions_status_idx" ON "subscriptions"("status");

-- CreateIndex
CREATE INDEX "subscriptions_planId_idx" ON "subscriptions"("planId");

-- CreateIndex
CREATE INDEX "seat_client_assignments_seatId_idx" ON "seat_client_assignments"("seatId");

-- CreateIndex
CREATE INDEX "seat_client_assignments_clientId_idx" ON "seat_client_assignments"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "seat_client_assignments_seatId_clientId_key" ON "seat_client_assignments"("seatId", "clientId");

-- CreateIndex
CREATE INDEX "seat_case_assignments_seatId_idx" ON "seat_case_assignments"("seatId");

-- CreateIndex
CREATE INDEX "seat_case_assignments_caseId_idx" ON "seat_case_assignments"("caseId");

-- CreateIndex
CREATE UNIQUE INDEX "seat_case_assignments_seatId_caseId_key" ON "seat_case_assignments"("seatId", "caseId");

-- CreateIndex
CREATE INDEX "action_feedback_userId_idx" ON "action_feedback"("userId");

-- CreateIndex
CREATE INDEX "action_feedback_organizationId_idx" ON "action_feedback"("organizationId");

-- CreateIndex
CREATE INDEX "action_feedback_actionType_idx" ON "action_feedback"("actionType");

-- CreateIndex
CREATE INDEX "action_feedback_documentId_idx" ON "action_feedback"("documentId");

-- CreateIndex
CREATE INDEX "action_feedback_caseId_idx" ON "action_feedback"("caseId");

-- CreateIndex
CREATE INDEX "case_health_snapshots_caseId_idx" ON "case_health_snapshots"("caseId");

-- CreateIndex
CREATE INDEX "case_health_snapshots_generatedAt_idx" ON "case_health_snapshots"("generatedAt");

-- CreateIndex
CREATE INDEX "alert_preferences_userId_idx" ON "alert_preferences"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "alert_preferences_userId_alertType_key" ON "alert_preferences"("userId", "alertType");

-- CreateIndex
CREATE INDEX "proactive_alerts_userId_isRead_idx" ON "proactive_alerts"("userId", "isRead");

-- CreateIndex
CREATE INDEX "proactive_alerts_userId_alertType_idx" ON "proactive_alerts"("userId", "alertType");

-- CreateIndex
CREATE INDEX "proactive_alerts_documentId_idx" ON "proactive_alerts"("documentId");

-- CreateIndex
CREATE INDEX "proactive_alerts_caseId_idx" ON "proactive_alerts"("caseId");

-- CreateIndex
CREATE INDEX "proactive_alerts_createdAt_idx" ON "proactive_alerts"("createdAt");

-- CreateIndex
CREATE INDEX "alert_scan_logs_scanType_idx" ON "alert_scan_logs"("scanType");

-- CreateIndex
CREATE INDEX "alert_scan_logs_userId_idx" ON "alert_scan_logs"("userId");

-- CreateIndex
CREATE INDEX "alert_scan_logs_startedAt_idx" ON "alert_scan_logs"("startedAt");

-- CreateIndex
CREATE INDEX "document_templates_documentType_idx" ON "document_templates"("documentType");

-- CreateIndex
CREATE INDEX "document_templates_jurisdiction_idx" ON "document_templates"("jurisdiction");

-- CreateIndex
CREATE INDEX "document_templates_isActive_idx" ON "document_templates"("isActive");

-- CreateIndex
CREATE INDEX "document_templates_organizationId_idx" ON "document_templates"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "document_templates_documentType_jurisdiction_version_organizationId_key" ON "document_templates"("documentType", "jurisdiction", "version", "organizationId");

-- CreateIndex
CREATE INDEX "document_template_variants_templateId_idx" ON "document_template_variants"("templateId");

-- CreateIndex
CREATE UNIQUE INDEX "document_template_variants_templateId_jurisdiction_key" ON "document_template_variants"("templateId", "jurisdiction");

-- CreateIndex
CREATE INDEX "document_draft_sessions_userId_idx" ON "document_draft_sessions"("userId");

-- CreateIndex
CREATE INDEX "document_draft_sessions_templateId_idx" ON "document_draft_sessions"("templateId");

-- CreateIndex
CREATE INDEX "document_draft_sessions_status_idx" ON "document_draft_sessions"("status");

-- CreateIndex
CREATE INDEX "document_draft_sessions_createdAt_idx" ON "document_draft_sessions"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "anonymous_sessions_sessionToken_key" ON "anonymous_sessions"("sessionToken");

-- CreateIndex
CREATE INDEX "anonymous_sessions_sessionToken_idx" ON "anonymous_sessions"("sessionToken");

-- CreateIndex
CREATE INDEX "anonymous_sessions_lastUsedAt_idx" ON "anonymous_sessions"("lastUsedAt");

-- CreateIndex
CREATE UNIQUE INDEX "client_shares_token_key" ON "client_shares"("token");

-- CreateIndex
CREATE INDEX "client_shares_token_idx" ON "client_shares"("token");

-- CreateIndex
CREATE INDEX "client_shares_documentId_idx" ON "client_shares"("documentId");

-- CreateIndex
CREATE INDEX "client_shares_userId_idx" ON "client_shares"("userId");

-- CreateIndex
CREATE INDEX "client_shares_expiresAt_idx" ON "client_shares"("expiresAt");

-- CreateIndex
CREATE INDEX "usage_records_userId_idx" ON "usage_records"("userId");

-- CreateIndex
CREATE INDEX "usage_records_month_idx" ON "usage_records"("month");

-- CreateIndex
CREATE UNIQUE INDEX "usage_records_userId_month_key" ON "usage_records"("userId", "month");

-- CreateIndex
CREATE INDEX "analytics_events_userId_idx" ON "analytics_events"("userId");

-- CreateIndex
CREATE INDEX "analytics_events_organizationId_idx" ON "analytics_events"("organizationId");

-- CreateIndex
CREATE INDEX "analytics_events_event_idx" ON "analytics_events"("event");

-- CreateIndex
CREATE INDEX "analytics_events_category_idx" ON "analytics_events"("category");

-- CreateIndex
CREATE INDEX "analytics_events_timestamp_idx" ON "analytics_events"("timestamp");

-- CreateIndex
CREATE INDEX "analysis_feedback_userId_idx" ON "analysis_feedback"("userId");

-- CreateIndex
CREATE INDEX "analysis_feedback_documentId_idx" ON "analysis_feedback"("documentId");

-- CreateIndex
CREATE INDEX "analysis_feedback_rating_idx" ON "analysis_feedback"("rating");

-- CreateIndex
CREATE UNIQUE INDEX "analysis_feedback_userId_documentId_key" ON "analysis_feedback"("userId", "documentId");

-- CreateIndex
CREATE INDEX "document_comparisons_userId_idx" ON "document_comparisons"("userId");

-- CreateIndex
CREATE INDEX "approval_workflows_caseId_idx" ON "approval_workflows"("caseId");

-- CreateIndex
CREATE INDEX "approval_workflows_documentId_idx" ON "approval_workflows"("documentId");

-- CreateIndex
CREATE INDEX "approval_workflows_status_idx" ON "approval_workflows"("status");

-- CreateIndex
CREATE INDEX "approval_workflows_createdBy_idx" ON "approval_workflows"("createdBy");

-- CreateIndex
CREATE INDEX "bulk_upload_jobs_userId_idx" ON "bulk_upload_jobs"("userId");

-- CreateIndex
CREATE INDEX "bulk_upload_jobs_status_idx" ON "bulk_upload_jobs"("status");

-- CreateIndex
CREATE INDEX "bulk_upload_jobs_createdAt_idx" ON "bulk_upload_jobs"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "mfa_secrets_userId_key" ON "mfa_secrets"("userId");

-- CreateIndex
CREATE INDEX "mfa_backup_codes_mfaSecretId_idx" ON "mfa_backup_codes"("mfaSecretId");

-- CreateIndex
CREATE UNIQUE INDEX "sso_configurations_organizationId_key" ON "sso_configurations"("organizationId");

-- CreateIndex
CREATE INDEX "azure_ad_group_syncs_ssoConfigId_idx" ON "azure_ad_group_syncs"("ssoConfigId");

-- CreateIndex
CREATE INDEX "azure_ad_group_syncs_practiceAreaId_idx" ON "azure_ad_group_syncs"("practiceAreaId");

-- CreateIndex
CREATE UNIQUE INDEX "azure_ad_group_syncs_ssoConfigId_azureGroupId_key" ON "azure_ad_group_syncs"("ssoConfigId", "azureGroupId");

-- CreateIndex
CREATE INDEX "practice_areas_organizationId_idx" ON "practice_areas"("organizationId");

-- CreateIndex
CREATE INDEX "practice_areas_parentId_idx" ON "practice_areas"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "practice_areas_organizationId_code_key" ON "practice_areas"("organizationId", "code");

-- CreateIndex
CREATE INDEX "extended_roles_organizationId_idx" ON "extended_roles"("organizationId");

-- CreateIndex
CREATE INDEX "extended_roles_level_idx" ON "extended_roles"("level");

-- CreateIndex
CREATE UNIQUE INDEX "extended_roles_organizationId_code_key" ON "extended_roles"("organizationId", "code");

-- CreateIndex
CREATE INDEX "user_practice_areas_userId_idx" ON "user_practice_areas"("userId");

-- CreateIndex
CREATE INDEX "user_practice_areas_practiceAreaId_idx" ON "user_practice_areas"("practiceAreaId");

-- CreateIndex
CREATE UNIQUE INDEX "user_practice_areas_userId_practiceAreaId_key" ON "user_practice_areas"("userId", "practiceAreaId");

-- CreateIndex
CREATE INDEX "search_audit_logs_organizationId_createdAt_idx" ON "search_audit_logs"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "search_audit_logs_userId_idx" ON "search_audit_logs"("userId");

-- CreateIndex
CREATE INDEX "search_audit_logs_searchType_idx" ON "search_audit_logs"("searchType");

-- CreateIndex
CREATE INDEX "search_audit_logs_jurisdiction_idx" ON "search_audit_logs"("jurisdiction");

-- CreateIndex
CREATE INDEX "search_audit_logs_caseId_idx" ON "search_audit_logs"("caseId");

-- CreateIndex
CREATE INDEX "search_audit_logs_matterId_idx" ON "search_audit_logs"("matterId");

-- CreateIndex
CREATE INDEX "customer_api_keys_organizationId_idx" ON "customer_api_keys"("organizationId");

-- CreateIndex
CREATE INDEX "customer_api_keys_keyHash_idx" ON "customer_api_keys"("keyHash");

-- CreateIndex
CREATE INDEX "customer_api_keys_keyPrefix_idx" ON "customer_api_keys"("keyPrefix");

-- CreateIndex
CREATE INDEX "customer_api_keys_isActive_idx" ON "customer_api_keys"("isActive");

-- CreateIndex
CREATE INDEX "api_request_logs_apiKeyId_createdAt_idx" ON "api_request_logs"("apiKeyId", "createdAt");

-- CreateIndex
CREATE INDEX "api_request_logs_statusCode_idx" ON "api_request_logs"("statusCode");

-- CreateIndex
CREATE INDEX "content_update_packages_version_idx" ON "content_update_packages"("version");

-- CreateIndex
CREATE INDEX "content_update_packages_jurisdiction_idx" ON "content_update_packages"("jurisdiction");

-- CreateIndex
CREATE INDEX "content_update_packages_status_idx" ON "content_update_packages"("status");

-- CreateIndex
CREATE INDEX "content_update_packages_contentDate_idx" ON "content_update_packages"("contentDate");

-- CreateIndex
CREATE UNIQUE INDEX "content_sync_schedules_organizationId_key" ON "content_sync_schedules"("organizationId");

-- CreateIndex
CREATE INDEX "organization_update_history_organizationId_jurisdiction_idx" ON "organization_update_history"("organizationId", "jurisdiction");

-- CreateIndex
CREATE INDEX "organization_update_history_organizationId_appliedAt_idx" ON "organization_update_history"("organizationId", "appliedAt");

-- CreateIndex
CREATE INDEX "organization_update_history_version_idx" ON "organization_update_history"("version");

-- CreateIndex
CREATE INDEX "sso_sessions_userId_idx" ON "sso_sessions"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "sso_sessions_userId_provider_key" ON "sso_sessions"("userId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "user_sessions_token_key" ON "user_sessions"("token");

-- CreateIndex
CREATE UNIQUE INDEX "user_sessions_refreshToken_key" ON "user_sessions"("refreshToken");

-- CreateIndex
CREATE INDEX "user_sessions_userId_idx" ON "user_sessions"("userId");

-- CreateIndex
CREATE INDEX "user_sessions_token_idx" ON "user_sessions"("token");

-- CreateIndex
CREATE INDEX "user_sessions_expiresAt_idx" ON "user_sessions"("expiresAt");

-- CreateIndex
CREATE INDEX "user_sessions_isActive_idx" ON "user_sessions"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_key" ON "password_reset_tokens"("token");

-- CreateIndex
CREATE INDEX "password_reset_tokens_token_idx" ON "password_reset_tokens"("token");

-- CreateIndex
CREATE INDEX "password_reset_tokens_userId_idx" ON "password_reset_tokens"("userId");

-- CreateIndex
CREATE INDEX "password_reset_tokens_expiresAt_idx" ON "password_reset_tokens"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "system_settings_key_key" ON "system_settings"("key");

-- CreateIndex
CREATE INDEX "update_history_version_idx" ON "update_history"("version");

-- CreateIndex
CREATE INDEX "update_history_appliedAt_idx" ON "update_history"("appliedAt");

-- CreateIndex
CREATE UNIQUE INDEX "llm_cache_inputHash_key" ON "llm_cache"("inputHash");

-- CreateIndex
CREATE INDEX "llm_cache_inputHash_idx" ON "llm_cache"("inputHash");

-- CreateIndex
CREATE INDEX "llm_cache_model_idx" ON "llm_cache"("model");

-- CreateIndex
CREATE INDEX "llm_cache_taskType_idx" ON "llm_cache"("taskType");

-- CreateIndex
CREATE INDEX "llm_cache_expiresAt_idx" ON "llm_cache"("expiresAt");

-- CreateIndex
CREATE INDEX "llm_cache_lastHitAt_idx" ON "llm_cache"("lastHitAt");

-- CreateIndex
CREATE INDEX "entity_links_userId_idx" ON "entity_links"("userId");

-- CreateIndex
CREATE INDEX "entity_links_sourceType_sourceId_idx" ON "entity_links"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "entity_links_targetType_targetId_idx" ON "entity_links"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "entity_links_linkType_idx" ON "entity_links"("linkType");

-- CreateIndex
CREATE UNIQUE INDEX "entity_links_userId_sourceType_sourceId_targetType_targetId_linkType_key" ON "entity_links"("userId", "sourceType", "sourceId", "targetType", "targetId", "linkType");

-- CreateIndex
CREATE INDEX "local_integrations_organizationId_idx" ON "local_integrations"("organizationId");

-- CreateIndex
CREATE INDEX "local_integrations_type_idx" ON "local_integrations"("type");

-- CreateIndex
CREATE INDEX "local_integrations_enabled_idx" ON "local_integrations"("enabled");

-- CreateIndex
CREATE UNIQUE INDEX "local_integrations_organizationId_type_key" ON "local_integrations"("organizationId", "type");

-- CreateIndex
CREATE INDEX "sync_queue_items_userId_idx" ON "sync_queue_items"("userId");

-- CreateIndex
CREATE INDEX "sync_queue_items_organizationId_idx" ON "sync_queue_items"("organizationId");

-- CreateIndex
CREATE INDEX "sync_queue_items_status_idx" ON "sync_queue_items"("status");

-- CreateIndex
CREATE INDEX "sync_queue_items_priority_idx" ON "sync_queue_items"("priority");

-- CreateIndex
CREATE INDEX "sync_queue_items_createdAt_idx" ON "sync_queue_items"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "dms_integrations_organizationId_key" ON "dms_integrations"("organizationId");

-- CreateIndex
CREATE INDEX "document_dms_links_dmsIntegrationId_idx" ON "document_dms_links"("dmsIntegrationId");

-- CreateIndex
CREATE UNIQUE INDEX "document_dms_links_documentId_key" ON "document_dms_links"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "document_dms_links_dmsProvider_dmsDocumentId_key" ON "document_dms_links"("dmsProvider", "dmsDocumentId");

-- CreateIndex
CREATE INDEX "dms_workspace_mappings_caseId_idx" ON "dms_workspace_mappings"("caseId");

-- CreateIndex
CREATE UNIQUE INDEX "dms_workspace_mappings_organizationId_dmsWorkspaceId_key" ON "dms_workspace_mappings"("organizationId", "dmsWorkspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "billing_system_integrations_organizationId_key" ON "billing_system_integrations"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "matter_billing_links_caseId_key" ON "matter_billing_links"("caseId");

-- CreateIndex
CREATE INDEX "matter_billing_links_billingIntegrationId_idx" ON "matter_billing_links"("billingIntegrationId");

-- CreateIndex
CREATE UNIQUE INDEX "matter_billing_links_billingProvider_billingMatterId_key" ON "matter_billing_links"("billingProvider", "billingMatterId");

-- CreateIndex
CREATE INDEX "time_entries_userId_idx" ON "time_entries"("userId");

-- CreateIndex
CREATE INDEX "time_entries_organizationId_idx" ON "time_entries"("organizationId");

-- CreateIndex
CREATE INDEX "time_entries_caseId_idx" ON "time_entries"("caseId");

-- CreateIndex
CREATE INDEX "time_entries_date_idx" ON "time_entries"("date");

-- CreateIndex
CREATE INDEX "time_entries_status_idx" ON "time_entries"("status");

-- CreateIndex
CREATE INDEX "time_entries_billingIntegrationId_idx" ON "time_entries"("billingIntegrationId");

-- CreateIndex
CREATE INDEX "offices_organizationId_idx" ON "offices"("organizationId");

-- CreateIndex
CREATE INDEX "offices_isPrimary_idx" ON "offices"("isPrimary");

-- CreateIndex
CREATE UNIQUE INDEX "offices_organizationId_code_key" ON "offices"("organizationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "server_nodes_nodeId_key" ON "server_nodes"("nodeId");

-- CreateIndex
CREATE INDEX "server_nodes_organizationId_idx" ON "server_nodes"("organizationId");

-- CreateIndex
CREATE INDEX "server_nodes_officeId_idx" ON "server_nodes"("officeId");

-- CreateIndex
CREATE INDEX "server_nodes_status_idx" ON "server_nodes"("status");

-- CreateIndex
CREATE INDEX "server_nodes_isLeader_idx" ON "server_nodes"("isLeader");

-- CreateIndex
CREATE INDEX "sync_operations_sourceNodeId_idx" ON "sync_operations"("sourceNodeId");

-- CreateIndex
CREATE INDEX "sync_operations_targetNodeId_idx" ON "sync_operations"("targetNodeId");

-- CreateIndex
CREATE INDEX "sync_operations_status_idx" ON "sync_operations"("status");

-- CreateIndex
CREATE INDEX "sync_operations_scheduledAt_idx" ON "sync_operations"("scheduledAt");

-- CreateIndex
CREATE INDEX "sync_conflicts_syncOperationId_idx" ON "sync_conflicts"("syncOperationId");

-- CreateIndex
CREATE INDEX "sync_conflicts_resolvedAt_idx" ON "sync_conflicts"("resolvedAt");

-- CreateIndex
CREATE UNIQUE INDEX "node_registry_organizationId_key" ON "node_registry"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "licenses_organizationId_key" ON "licenses"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "licenses_licenseKey_key" ON "licenses"("licenseKey");

-- CreateIndex
CREATE INDEX "licenses_licenseKey_idx" ON "licenses"("licenseKey");

-- CreateIndex
CREATE INDEX "licenses_validUntil_idx" ON "licenses"("validUntil");

-- CreateIndex
CREATE INDEX "data_entitlements_dataCode_idx" ON "data_entitlements"("dataCode");

-- CreateIndex
CREATE UNIQUE INDEX "data_entitlements_licenseId_dataType_dataCode_key" ON "data_entitlements"("licenseId", "dataType", "dataCode");

-- CreateIndex
CREATE UNIQUE INDEX "pricing_formulas_dataType_dataCode_validFrom_key" ON "pricing_formulas"("dataType", "dataCode", "validFrom");

-- CreateIndex
CREATE INDEX "license_usage_records_licenseId_usageDate_idx" ON "license_usage_records"("licenseId", "usageDate");

-- CreateIndex
CREATE INDEX "license_usage_records_usageType_idx" ON "license_usage_records"("usageType");

-- CreateIndex
CREATE UNIQUE INDEX "data_catalog_dataType_dataCode_key" ON "data_catalog"("dataType", "dataCode");

-- CreateIndex
CREATE INDEX "document_research_sessions_userId_idx" ON "document_research_sessions"("userId");

-- CreateIndex
CREATE INDEX "document_research_sessions_status_idx" ON "document_research_sessions"("status");

-- CreateIndex
CREATE INDEX "document_research_messages_sessionId_idx" ON "document_research_messages"("sessionId");

-- CreateIndex
CREATE INDEX "cross_reference_reports_userId_idx" ON "cross_reference_reports"("userId");

-- CreateIndex
CREATE INDEX "cross_reference_reports_searchTerm_idx" ON "cross_reference_reports"("searchTerm");

-- CreateIndex
CREATE INDEX "contradiction_scans_userId_idx" ON "contradiction_scans"("userId");

-- CreateIndex
CREATE INDEX "contradiction_scans_status_idx" ON "contradiction_scans"("status");
