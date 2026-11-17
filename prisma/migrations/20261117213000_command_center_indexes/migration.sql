CREATE INDEX "Client_active_lastSyncedAt_idx" ON "Client"("active", "lastSyncedAt");
CREATE INDEX "Task_deleted_clickupUpdatedAt_idx" ON "Task"("deleted", "clickupUpdatedAt");
CREATE INDEX "Task_deleted_dueDate_idx" ON "Task"("deleted", "dueDate");
CREATE INDEX "TaskIntelligence_classificationVersion_verificationStatus_needsAmi_idx"
  ON "TaskIntelligence"("classificationVersion", "verificationStatus", "needsAmi");
CREATE INDEX "TaskIntelligence_agentState_riskLevel_idx" ON "TaskIntelligence"("agentState", "riskLevel");
