-- CreateEnum
CREATE TYPE "ListType" AS ENUM ('AMI', 'NOTIFICATION', 'OTHER');

-- CreateEnum
CREATE TYPE "AgentState" AS ENUM ('NOT_STARTED', 'ACTIVE', 'COMPLETED', 'WAITING_ON_AMI', 'WAITING_ON_TEAM', 'WAITING_ON_CLIENT', 'WAITING_ON_VENDOR', 'NEEDS_REVIEW', 'BLOCKED', 'ISSUE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "WaitingOnType" AS ENUM ('NONE', 'AMI', 'TEAM', 'CLIENT', 'VENDOR', 'OTHER');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateTable
CREATE TABLE "Client" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "clickupFolderId" TEXT NOT NULL,
    "clickupSpaceId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workspace" (
    "id" SERIAL NOT NULL,
    "clickupWorkspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Space" (
    "id" SERIAL NOT NULL,
    "clickupSpaceId" TEXT NOT NULL,
    "workspaceId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Space_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClickUpList" (
    "id" SERIAL NOT NULL,
    "clickupListId" TEXT NOT NULL,
    "clientId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ListType",
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClickUpList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" SERIAL NOT NULL,
    "clickupUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" SERIAL NOT NULL,
    "clickupTaskId" TEXT NOT NULL,
    "clientId" INTEGER NOT NULL,
    "listId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "clickupStatus" TEXT,
    "clickupPriority" TEXT,
    "dueDate" TIMESTAMP(3),
    "clickupCreatedAt" TIMESTAMP(3),
    "clickupUpdatedAt" TIMESTAMP(3),
    "clickupUrl" TEXT,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "rawPayload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskAssignee" (
    "taskId" INTEGER NOT NULL,
    "employeeId" INTEGER NOT NULL,

    CONSTRAINT "TaskAssignee_pkey" PRIMARY KEY ("taskId","employeeId")
);

-- CreateTable
CREATE TABLE "Comment" (
    "id" SERIAL NOT NULL,
    "clickupCommentId" TEXT NOT NULL,
    "taskId" INTEGER NOT NULL,
    "authorClickupId" TEXT,
    "authorName" TEXT,
    "body" TEXT NOT NULL,
    "clickupCreatedAt" TIMESTAMP(3),
    "clickupUpdatedAt" TIMESTAMP(3),
    "rawPayload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskEvent" (
    "id" SERIAL NOT NULL,
    "eventKey" TEXT,
    "taskId" INTEGER,
    "eventType" TEXT NOT NULL,
    "actorClickupId" TEXT,
    "actorName" TEXT,
    "beforeValue" JSONB,
    "afterValue" JSONB,
    "occurredAt" TIMESTAMP(3),
    "rawPayload" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskIntelligence" (
    "id" SERIAL NOT NULL,
    "taskId" INTEGER NOT NULL,
    "agentState" "AgentState" NOT NULL DEFAULT 'UNKNOWN',
    "headline" TEXT,
    "currentSummary" TEXT,
    "needsAmi" BOOLEAN NOT NULL DEFAULT false,
    "amiAction" TEXT,
    "waitingOnType" "WaitingOnType" NOT NULL DEFAULT 'NONE',
    "waitingOnName" TEXT,
    "importanceScore" INTEGER NOT NULL DEFAULT 0,
    "amiAttentionScore" INTEGER NOT NULL DEFAULT 0,
    "riskLevel" "RiskLevel" NOT NULL DEFAULT 'LOW',
    "lastMeaningfulChange" TEXT,
    "lastMeaningfulChangeAt" TIMESTAMP(3),
    "confidence" DOUBLE PRECISION,
    "promptVersion" TEXT,
    "analyzedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskIntelligence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Client_slug_key" ON "Client"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Client_clickupFolderId_key" ON "Client"("clickupFolderId");

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_clickupWorkspaceId_key" ON "Workspace"("clickupWorkspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Space_clickupSpaceId_key" ON "Space"("clickupSpaceId");

-- CreateIndex
CREATE UNIQUE INDEX "ClickUpList_clickupListId_key" ON "ClickUpList"("clickupListId");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_clickupUserId_key" ON "Employee"("clickupUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Task_clickupTaskId_key" ON "Task"("clickupTaskId");

-- CreateIndex
CREATE UNIQUE INDEX "Comment_clickupCommentId_key" ON "Comment"("clickupCommentId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskEvent_eventKey_key" ON "TaskEvent"("eventKey");

-- CreateIndex
CREATE UNIQUE INDEX "TaskIntelligence_taskId_key" ON "TaskIntelligence"("taskId");

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_clickupSpaceId_fkey" FOREIGN KEY ("clickupSpaceId") REFERENCES "Space"("clickupSpaceId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Space" ADD CONSTRAINT "Space_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClickUpList" ADD CONSTRAINT "ClickUpList_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_listId_fkey" FOREIGN KEY ("listId") REFERENCES "ClickUpList"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAssignee" ADD CONSTRAINT "TaskAssignee_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAssignee" ADD CONSTRAINT "TaskAssignee_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskEvent" ADD CONSTRAINT "TaskEvent_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskIntelligence" ADD CONSTRAINT "TaskIntelligence_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
