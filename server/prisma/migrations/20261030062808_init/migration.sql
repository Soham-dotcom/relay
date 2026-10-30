-- CreateEnum
CREATE TYPE "SessionKind" AS ENUM ('MEETING', 'TRANSFER');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('PLANNED', 'HELD', 'CLOSED');

-- CreateEnum
CREATE TYPE "Attendance" AS ENUM ('INVITED', 'ATTENDED', 'MISSED');

-- CreateEnum
CREATE TYPE "ItemStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'DROPPED');

-- CreateEnum
CREATE TYPE "ItemEventType" AS ENUM ('CREATED', 'STATUS_CHANGED', 'REASSIGNED', 'DUE_CHANGED', 'CARRIED_FORWARD', 'OUTCOME_RECORDED');

-- CreateEnum
CREATE TYPE "DocSource" AS ENUM ('DOCUMENT', 'MEETING');

-- CreateEnum
CREATE TYPE "ConflictStatus" AS ENUM ('OPEN', 'DISMISSED', 'RESOLVED');

-- CreateTable
CREATE TABLE "Person" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "kind" "SessionKind" NOT NULL DEFAULT 'MEETING',
    "title" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'PLANNED',
    "agenda" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "summary" TEXT,
    "fromPersonId" TEXT,
    "toPersonId" TEXT,
    "previousId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Participant" (
    "sessionId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "attendance" "Attendance" NOT NULL DEFAULT 'INVITED',

    CONSTRAINT "Participant_pkey" PRIMARY KEY ("sessionId","personId")
);

-- CreateTable
CREATE TABLE "Decision" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Decision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActionItem" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "ownerId" TEXT,
    "dueDate" TIMESTAMP(3),
    "status" "ItemStatus" NOT NULL DEFAULT 'OPEN',
    "outcome" TEXT,
    "originSessionId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemEvent" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "type" "ItemEventType" NOT NULL,
    "fromValue" TEXT,
    "toValue" TEXT,
    "note" TEXT,
    "sessionId" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeDoc" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "source" "DocSource" NOT NULL DEFAULT 'DOCUMENT',
    "sessionId" TEXT,
    "embedding" DOUBLE PRECISION[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeDoc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeLink" (
    "id" TEXT NOT NULL,
    "docId" TEXT NOT NULL,
    "itemId" TEXT,
    "decisionId" TEXT,
    "reason" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DecisionConflict" (
    "id" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "pastDecisionId" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "status" "ConflictStatus" NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DecisionConflict_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Person_email_key" ON "Person"("email");

-- CreateIndex
CREATE INDEX "Session_scheduledAt_idx" ON "Session"("scheduledAt");

-- CreateIndex
CREATE INDEX "ActionItem_status_idx" ON "ActionItem"("status");

-- CreateIndex
CREATE INDEX "ActionItem_ownerId_idx" ON "ActionItem"("ownerId");

-- CreateIndex
CREATE INDEX "ItemEvent_itemId_at_idx" ON "ItemEvent"("itemId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeDoc_sessionId_key" ON "KnowledgeDoc"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeLink_docId_itemId_key" ON "KnowledgeLink"("docId", "itemId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeLink_docId_decisionId_key" ON "KnowledgeLink"("docId", "decisionId");

-- CreateIndex
CREATE UNIQUE INDEX "DecisionConflict_decisionId_pastDecisionId_key" ON "DecisionConflict"("decisionId", "pastDecisionId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_previousId_fkey" FOREIGN KEY ("previousId") REFERENCES "Session"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Participant" ADD CONSTRAINT "Participant_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Participant" ADD CONSTRAINT "Participant_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionItem" ADD CONSTRAINT "ActionItem_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionItem" ADD CONSTRAINT "ActionItem_originSessionId_fkey" FOREIGN KEY ("originSessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionItem" ADD CONSTRAINT "ActionItem_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemEvent" ADD CONSTRAINT "ItemEvent_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "ActionItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemEvent" ADD CONSTRAINT "ItemEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeDoc" ADD CONSTRAINT "KnowledgeDoc_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeLink" ADD CONSTRAINT "KnowledgeLink_docId_fkey" FOREIGN KEY ("docId") REFERENCES "KnowledgeDoc"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeLink" ADD CONSTRAINT "KnowledgeLink_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "ActionItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeLink" ADD CONSTRAINT "KnowledgeLink_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "Decision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionConflict" ADD CONSTRAINT "DecisionConflict_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "Decision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionConflict" ADD CONSTRAINT "DecisionConflict_pastDecisionId_fkey" FOREIGN KEY ("pastDecisionId") REFERENCES "Decision"("id") ON DELETE CASCADE ON UPDATE CASCADE;
