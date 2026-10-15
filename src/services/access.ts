import { Prisma, PrismaClient, Project, ProjectMember } from '@prisma/client';
import { fail } from '../errors';

export type Tx = Prisma.TransactionClient;
export async function projectAccess(tx: Tx, projectId: string, userId: string, options: { write?: boolean; manage?: boolean; task?: boolean; member?: boolean } = {}) {
  // Every project mutation takes the same row lock BEFORE reading policy state.
  // Read Committed then observes the last committed mutation after waiting.
  if (options.write) await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${projectId}::uuid FOR UPDATE`;
  const project = await tx.project.findUnique({ where: { id: projectId } });
  if (!project) fail(404, 'PROJECT_NOT_FOUND', 'Project not found');
  const member = await tx.projectMember.findUnique({ where: { projectId_userId: { projectId, userId } } });
  if (options.member !== false && !member) fail(403, 'MEMBERSHIP_REQUIRED', 'Project membership is required');
  if (options.manage) requireManager(member);
  if (options.write && project.status === 'ARCHIVED') fail(409, 'PROJECT_ARCHIVED', 'Archived projects are read-only');
  if (options.task && project.status === 'COMPLETED') fail(409, 'PROJECT_COMPLETED', 'Reopen this project before changing tasks');
  return { project, member };
}
export function requireManager(member: ProjectMember | null) {
  if (!member || member.role === 'MEMBER') fail(403, 'MANAGER_REQUIRED', 'OWNER or LEAD role is required');
}
export function requireOwner(member: ProjectMember | null) {
  if (member?.role !== 'OWNER') fail(403, 'OWNER_REQUIRED', 'OWNER role is required');
}
export function checkDates(project: Pick<Project, 'startDate' | 'dueDate'>) {
  if (project.startDate && project.dueDate && project.dueDate < project.startDate) fail(400, 'INVALID_DATE_RANGE', 'dueDate must not precede startDate');
}
export function transaction<T>(db: PrismaClient, run: (tx: Tx) => Promise<T>) {
  return db.$transaction(run, { isolationLevel: 'ReadCommitted', maxWait: 10000, timeout: 15000 });
}
export function snapshot<T>(db: PrismaClient, run: (tx: Tx) => Promise<T>) {
  return db.$transaction(run, { isolationLevel: 'RepeatableRead', timeout: 15000 });
}
