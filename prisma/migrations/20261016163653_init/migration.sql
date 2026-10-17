-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'student',
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "lastSeenAt" DATETIME
);

-- CreateTable
CREATE TABLE "StudentProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "grade" TEXT NOT NULL DEFAULT '高一',
    "curriculumId" TEXT,
    "textbookVersion" TEXT,
    "electiveSubjects" TEXT NOT NULL DEFAULT '[]',
    "studyGoal" TEXT,
    "examDate" DATETIME,
    "dailyAvailableMinutes" INTEGER NOT NULL DEFAULT 90,
    "weekdayAvailableMinutes" INTEGER,
    "weekendAvailableMinutes" INTEGER,
    "reminderEnabled" BOOLEAN NOT NULL DEFAULT false,
    "reminderTime" TEXT,
    "preferences" TEXT NOT NULL DEFAULT '{}',
    "onboardingCompleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StudentProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StudentProfile_curriculumId_fkey" FOREIGN KEY ("curriculumId") REFERENCES "Curriculum" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Subject" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isElective" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Curriculum" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "region" TEXT,
    "publisher" TEXT,
    "subjectId" TEXT NOT NULL,
    "grade" TEXT,
    "description" TEXT,
    "isApproved" BOOLEAN NOT NULL DEFAULT false,
    "sourceNote" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Curriculum_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "KnowledgePoint" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "grade" TEXT NOT NULL,
    "curriculumId" TEXT,
    "chapter" TEXT NOT NULL,
    "chapterPath" TEXT NOT NULL,
    "parentId" TEXT,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT,
    "difficulty" INTEGER NOT NULL DEFAULT 3,
    "commonMistakes" TEXT NOT NULL DEFAULT '[]',
    "typicalQuestionTypes" TEXT NOT NULL DEFAULT '[]',
    "reviewStatus" TEXT NOT NULL DEFAULT 'draft',
    "source" TEXT NOT NULL DEFAULT 'manual',
    "sourceNote" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "KnowledgePoint_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "KnowledgePoint_curriculumId_fkey" FOREIGN KEY ("curriculumId") REFERENCES "Curriculum" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "KnowledgePoint_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "KnowledgePoint" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "KnowledgePointRelation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fromId" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "relationType" TEXT NOT NULL,
    "strength" INTEGER NOT NULL DEFAULT 3,
    "note" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "KnowledgePointRelation_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "KnowledgePoint" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "KnowledgePointRelation_toId_fkey" FOREIGN KEY ("toId") REFERENCES "KnowledgePoint" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Question" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "grade" TEXT,
    "chapter" TEXT,
    "stem" TEXT NOT NULL,
    "stemFormat" TEXT NOT NULL DEFAULT 'text',
    "choices" TEXT NOT NULL DEFAULT '[]',
    "correctAnswer" TEXT,
    "explanation" TEXT,
    "imagePath" TEXT,
    "imageMimeType" TEXT,
    "imageBytes" INTEGER,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "sourceNote" TEXT,
    "ocrConfidence" REAL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Question_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Question_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "QuestionKnowledgePoint" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "questionId" TEXT NOT NULL,
    "knowledgePointId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT true,
    "weight" REAL NOT NULL DEFAULT 1,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "confidence" REAL NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "QuestionKnowledgePoint_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "QuestionKnowledgePoint_knowledgePointId_fkey" FOREIGN KEY ("knowledgePointId") REFERENCES "KnowledgePoint" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WrongAnswerRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "studentAnswer" TEXT,
    "correctAnswerSnapshot" TEXT,
    "errorTypes" TEXT NOT NULL DEFAULT '[]',
    "likelyCauses" TEXT NOT NULL DEFAULT '[]',
    "explanation" TEXT,
    "errorConfidence" REAL,
    "editedByUser" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "sourceNote" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "correctCount" INTEGER NOT NULL DEFAULT 0,
    "lastReviewedAt" DATETIME,
    "lastReviewResult" TEXT,
    "nextReviewAt" DATETIME,
    "resolvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "WrongAnswerRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "WrongAnswerRecord_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AnswerAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "wrongAnswerRecordId" TEXT,
    "answer" TEXT,
    "isCorrect" BOOLEAN NOT NULL,
    "independence" TEXT NOT NULL DEFAULT 'independent',
    "difficultySnapshot" INTEGER NOT NULL DEFAULT 3,
    "timeSpentSeconds" INTEGER,
    "errorTypes" TEXT NOT NULL DEFAULT '[]',
    "note" TEXT,
    "context" TEXT NOT NULL DEFAULT 'practice',
    "studyTaskId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AnswerAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AnswerAttempt_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AnswerAttempt_wrongAnswerRecordId_fkey" FOREIGN KEY ("wrongAnswerRecordId") REFERENCES "WrongAnswerRecord" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AnswerAttempt_studyTaskId_fkey" FOREIGN KEY ("studyTaskId") REFERENCES "StudyTask" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UserKnowledgeMastery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "knowledgePointId" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'unevaluated',
    "score" INTEGER,
    "confidence" REAL NOT NULL DEFAULT 0,
    "evidenceCount" INTEGER NOT NULL DEFAULT 0,
    "recentAccuracy" REAL,
    "recentSampleSize" INTEGER NOT NULL DEFAULT 0,
    "repeatedErrorTypes" TEXT NOT NULL DEFAULT '{}',
    "needsPrerequisiteReview" BOOLEAN NOT NULL DEFAULT false,
    "nextAction" TEXT,
    "lastEvaluatedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserKnowledgeMastery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "UserKnowledgeMastery_knowledgePointId_fkey" FOREIGN KEY ("knowledgePointId") REFERENCES "KnowledgePoint" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LearningResource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "platform" TEXT,
    "url" TEXT NOT NULL,
    "verificationStatus" TEXT NOT NULL DEFAULT 'unverified',
    "lastVerifiedAt" DATETIME,
    "verifiedBy" TEXT,
    "subjectId" TEXT,
    "grade" TEXT,
    "difficulty" INTEGER,
    "durationSeconds" INTEGER,
    "description" TEXT,
    "content" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdBy" TEXT NOT NULL DEFAULT 'system',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LearningResource_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ResourceKnowledgePoint" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "resourceId" TEXT NOT NULL,
    "knowledgePointId" TEXT NOT NULL,
    "relevance" REAL NOT NULL DEFAULT 1,
    "matchSource" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ResourceKnowledgePoint_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "LearningResource" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ResourceKnowledgePoint_knowledgePointId_fkey" FOREIGN KEY ("knowledgePointId") REFERENCES "KnowledgePoint" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StudyPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "planType" TEXT NOT NULL,
    "goal" TEXT,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "generatedBy" TEXT NOT NULL DEFAULT 'rule-engine',
    "rationale" TEXT NOT NULL DEFAULT '{}',
    "plannedMinutes" INTEGER NOT NULL DEFAULT 0,
    "availableMinutes" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "StudyPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StudyTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "planId" TEXT,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subjectId" TEXT,
    "knowledgePointId" TEXT,
    "resourceId" TEXT,
    "taskType" TEXT NOT NULL,
    "estimatedMinutes" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "completionCriteria" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 3,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "scheduledDate" DATETIME NOT NULL,
    "dueDate" DATETIME,
    "completedAt" DATETIME,
    "actualMinutes" INTEGER,
    "result" TEXT DEFAULT '{}',
    "rescheduledFromId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StudyTask_planId_fkey" FOREIGN KEY ("planId") REFERENCES "StudyPlan" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "StudyTask_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StudyTask_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "StudyTask_knowledgePointId_fkey" FOREIGN KEY ("knowledgePointId") REFERENCES "KnowledgePoint" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "StudyTask_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "LearningResource" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "StudyTask_rescheduledFromId_fkey" FOREIGN KEY ("rescheduledFromId") REFERENCES "StudyTask" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StudySession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "studyTaskId" TEXT,
    "startedAt" DATETIME NOT NULL,
    "endedAt" DATETIME,
    "durationMinutes" INTEGER NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'task',
    "subjectId" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StudySession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReviewSchedule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "wrongAnswerRecordId" TEXT,
    "knowledgePointId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "dueAt" DATETIME NOT NULL,
    "intervalDays" INTEGER NOT NULL DEFAULT 1,
    "repetition" INTEGER NOT NULL DEFAULT 0,
    "easeFactor" REAL NOT NULL DEFAULT 2.5,
    "lastResult" TEXT,
    "lastReviewedAt" DATETIME,
    "historyJson" TEXT NOT NULL DEFAULT '[]',
    "origin" TEXT NOT NULL DEFAULT 'rule-engine',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ReviewSchedule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReviewSchedule_wrongAnswerRecordId_fkey" FOREIGN KEY ("wrongAnswerRecordId") REFERENCES "WrongAnswerRecord" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ReviewSchedule_knowledgePointId_fkey" FOREIGN KEY ("knowledgePointId") REFERENCES "KnowledgePoint" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '新的提问',
    "mode" TEXT NOT NULL DEFAULT 'guided',
    "subjectId" TEXT,
    "grade" TEXT,
    "questionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "Conversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Conversation_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "contentType" TEXT NOT NULL DEFAULT 'markdown',
    "metadataJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ModelCallLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "service" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "promptChars" INTEGER NOT NULL DEFAULT 0,
    "completionChars" INTEGER NOT NULL DEFAULT 0,
    "promptTokens" INTEGER,
    "completionTokens" INTEGER,
    "estimatedCostUsd" REAL,
    "schemaValidated" BOOLEAN NOT NULL DEFAULT false,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ModelCallLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_isArchived_idx" ON "User"("isArchived");

-- CreateIndex
CREATE UNIQUE INDEX "StudentProfile_userId_key" ON "StudentProfile"("userId");

-- CreateIndex
CREATE INDEX "StudentProfile_curriculumId_idx" ON "StudentProfile"("curriculumId");

-- CreateIndex
CREATE UNIQUE INDEX "Subject_code_key" ON "Subject"("code");

-- CreateIndex
CREATE INDEX "Curriculum_subjectId_idx" ON "Curriculum"("subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "Curriculum_subjectId_name_grade_key" ON "Curriculum"("subjectId", "name", "grade");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgePoint_code_key" ON "KnowledgePoint"("code");

-- CreateIndex
CREATE INDEX "KnowledgePoint_subjectId_grade_idx" ON "KnowledgePoint"("subjectId", "grade");

-- CreateIndex
CREATE INDEX "KnowledgePoint_parentId_idx" ON "KnowledgePoint"("parentId");

-- CreateIndex
CREATE INDEX "KnowledgePoint_reviewStatus_idx" ON "KnowledgePoint"("reviewStatus");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgePoint_subjectId_chapterPath_name_grade_key" ON "KnowledgePoint"("subjectId", "chapterPath", "name", "grade");

-- CreateIndex
CREATE INDEX "KnowledgePointRelation_fromId_idx" ON "KnowledgePointRelation"("fromId");

-- CreateIndex
CREATE INDEX "KnowledgePointRelation_toId_idx" ON "KnowledgePointRelation"("toId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgePointRelation_fromId_toId_relationType_key" ON "KnowledgePointRelation"("fromId", "toId", "relationType");

-- CreateIndex
CREATE INDEX "Question_userId_status_idx" ON "Question"("userId", "status");

-- CreateIndex
CREATE INDEX "Question_subjectId_idx" ON "Question"("subjectId");

-- CreateIndex
CREATE INDEX "Question_userId_createdAt_idx" ON "Question"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "QuestionKnowledgePoint_knowledgePointId_idx" ON "QuestionKnowledgePoint"("knowledgePointId");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionKnowledgePoint_questionId_knowledgePointId_key" ON "QuestionKnowledgePoint"("questionId", "knowledgePointId");

-- CreateIndex
CREATE INDEX "WrongAnswerRecord_userId_status_idx" ON "WrongAnswerRecord"("userId", "status");

-- CreateIndex
CREATE INDEX "WrongAnswerRecord_userId_nextReviewAt_idx" ON "WrongAnswerRecord"("userId", "nextReviewAt");

-- CreateIndex
CREATE INDEX "WrongAnswerRecord_userId_createdAt_idx" ON "WrongAnswerRecord"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WrongAnswerRecord_userId_questionId_key" ON "WrongAnswerRecord"("userId", "questionId");

-- CreateIndex
CREATE INDEX "AnswerAttempt_userId_questionId_idx" ON "AnswerAttempt"("userId", "questionId");

-- CreateIndex
CREATE INDEX "AnswerAttempt_userId_createdAt_idx" ON "AnswerAttempt"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AnswerAttempt_questionId_idx" ON "AnswerAttempt"("questionId");

-- CreateIndex
CREATE INDEX "AnswerAttempt_context_idx" ON "AnswerAttempt"("context");

-- CreateIndex
CREATE INDEX "UserKnowledgeMastery_userId_level_idx" ON "UserKnowledgeMastery"("userId", "level");

-- CreateIndex
CREATE INDEX "UserKnowledgeMastery_userId_updatedAt_idx" ON "UserKnowledgeMastery"("userId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserKnowledgeMastery_userId_knowledgePointId_key" ON "UserKnowledgeMastery"("userId", "knowledgePointId");

-- CreateIndex
CREATE INDEX "LearningResource_verificationStatus_idx" ON "LearningResource"("verificationStatus");

-- CreateIndex
CREATE INDEX "LearningResource_resourceType_idx" ON "LearningResource"("resourceType");

-- CreateIndex
CREATE INDEX "LearningResource_subjectId_idx" ON "LearningResource"("subjectId");

-- CreateIndex
CREATE INDEX "ResourceKnowledgePoint_knowledgePointId_idx" ON "ResourceKnowledgePoint"("knowledgePointId");

-- CreateIndex
CREATE UNIQUE INDEX "ResourceKnowledgePoint_resourceId_knowledgePointId_key" ON "ResourceKnowledgePoint"("resourceId", "knowledgePointId");

-- CreateIndex
CREATE INDEX "StudyPlan_userId_status_idx" ON "StudyPlan"("userId", "status");

-- CreateIndex
CREATE INDEX "StudyPlan_userId_planType_idx" ON "StudyPlan"("userId", "planType");

-- CreateIndex
CREATE INDEX "StudyTask_userId_scheduledDate_idx" ON "StudyTask"("userId", "scheduledDate");

-- CreateIndex
CREATE INDEX "StudyTask_userId_status_idx" ON "StudyTask"("userId", "status");

-- CreateIndex
CREATE INDEX "StudyTask_planId_idx" ON "StudyTask"("planId");

-- CreateIndex
CREATE INDEX "StudySession_userId_startedAt_idx" ON "StudySession"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "ReviewSchedule_userId_dueAt_status_idx" ON "ReviewSchedule"("userId", "dueAt", "status");

-- CreateIndex
CREATE INDEX "ReviewSchedule_userId_status_idx" ON "ReviewSchedule"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewSchedule_userId_wrongAnswerRecordId_key" ON "ReviewSchedule"("userId", "wrongAnswerRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewSchedule_userId_knowledgePointId_key" ON "ReviewSchedule"("userId", "knowledgePointId");

-- CreateIndex
CREATE INDEX "Conversation_userId_updatedAt_idx" ON "Conversation"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "ModelCallLog_userId_createdAt_idx" ON "ModelCallLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ModelCallLog_service_createdAt_idx" ON "ModelCallLog"("service", "createdAt");

-- CreateIndex
CREATE INDEX "ModelCallLog_status_idx" ON "ModelCallLog"("status");
