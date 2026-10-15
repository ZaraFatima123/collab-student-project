-- Partial indexes express invariants not supported by the Prisma schema DSL.
CREATE UNIQUE INDEX "one_pending_invitation_per_user"
  ON "ProjectInvitation" ("projectId", "invitedUserId") WHERE "status" = 'PENDING';
CREATE UNIQUE INDEX "one_pending_join_request_per_user"
  ON "JoinRequest" ("projectId", "userId") WHERE "status" = 'PENDING';
CREATE UNIQUE INDEX "one_owner_per_project"
  ON "ProjectMember" ("projectId") WHERE "role" = 'OWNER';

ALTER TABLE "Project" ADD CONSTRAINT "project_date_range"
  CHECK ("startDate" IS NULL OR "dueDate" IS NULL OR "dueDate" >= "startDate");
ALTER TABLE "Task" ADD CONSTRAINT "task_not_own_parent"
  CHECK ("parentTaskId" IS NULL OR "parentTaskId" <> "id");
ALTER TABLE "Task" ADD CONSTRAINT "completion_timestamp_matches_status"
  CHECK (("status" = 'COMPLETED' AND "completedAt" IS NOT NULL)
    OR ("status" <> 'COMPLETED' AND "completedAt" IS NULL));
