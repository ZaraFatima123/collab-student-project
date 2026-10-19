CREATE TABLE "TaskCompletion" (
    "id" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "contributorId" UUID,
    "recordedById" UUID,
    "completedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "TaskCompletion_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TaskCompletion_taskId_completedAt_idx" ON "TaskCompletion"("taskId", "completedAt");
CREATE INDEX "TaskCompletion_contributorId_idx" ON "TaskCompletion"("contributorId");
ALTER TABLE "TaskCompletion" ADD CONSTRAINT "TaskCompletion_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TaskCompletion" ADD CONSTRAINT "TaskCompletion_contributorId_fkey" FOREIGN KEY ("contributorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TaskCompletion" ADD CONSTRAINT "TaskCompletion_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Preserve attribution still available in an existing database. The original
-- status-change actor was not stored, so do not invent one for legacy records.
INSERT INTO "TaskCompletion" ("id", "taskId", "contributorId", "recordedById", "completedAt")
SELECT gen_random_uuid(), "id", "assigneeId", NULL, "completedAt"
FROM "Task" WHERE "status" = 'COMPLETED' AND "completedAt" IS NOT NULL;
