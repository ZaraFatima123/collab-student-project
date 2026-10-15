import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import * as v from '../validation';
import { fail } from '../errors';
import { checkDates, projectAccess, requireOwner, snapshot, transaction } from './access';

export class ProjectService {
  constructor(private db: PrismaClient) {}
  create(userId: string, body: z.infer<typeof v.projectCreate>) {
    const dates = { startDate: body.startDate ? new Date(body.startDate) : null, dueDate: body.dueDate ? new Date(body.dueDate) : null };
    checkDates(dates);
    return transaction(this.db, tx => tx.project.create({ data: { ...body, ...dates, creatorId: userId, members: { create: { userId, role: 'OWNER' } } } }));
  }
  list(userId: string, q: v.Paging, discover = false) {
    return snapshot(this.db, async tx => {
      const where = discover ? { visibility: 'DISCOVERABLE' as const, status: 'ACTIVE' as const } : { members: { some: { userId } } };
      const data = await tx.project.findMany({ where, ...v.listArgs(q), ...(discover ? { select: { id: true, name: true, description: true, startDate: true, dueDate: true, createdAt: true, visibility: true, status: true } } : {}) });
      return v.paginated(data, await tx.project.count({ where }), q);
    });
  }
  get(userId: string, projectId: string) {
    return snapshot(this.db, async tx => (await projectAccess(tx, projectId, userId)).project);
  }
  patch(userId: string, projectId: string, body: z.infer<typeof v.projectPatch>) {
    return transaction(this.db, async tx => {
      const { project } = await projectAccess(tx, projectId, userId, { write: true, manage: true });
      const startDate = body.startDate === undefined ? project.startDate : body.startDate === null ? null : new Date(body.startDate);
      const dueDate = body.dueDate === undefined ? project.dueDate : body.dueDate === null ? null : new Date(body.dueDate);
      checkDates({ startDate, dueDate });
      return tx.project.update({ where: { id: projectId }, data: { ...body, startDate, dueDate } });
    });
  }
  archive(userId: string, projectId: string) {
    return transaction(this.db, async tx => {
      const { member } = await projectAccess(tx, projectId, userId, { write: true });
      requireOwner(member);
      return tx.project.update({ where: { id: projectId }, data: { status: 'ARCHIVED' } });
    });
  }
  members(userId: string, projectId: string, q: v.Paging) {
    return snapshot(this.db, async tx => {
      await projectAccess(tx, projectId, userId);
      const data = await tx.projectMember.findMany({ where: { projectId }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, orderBy: [{ joinedAt: q.sort.startsWith('-') ? 'desc' : 'asc' }, { userId: 'asc' }], include: { user: true } });
      return v.paginated(data, await tx.projectMember.count({ where: { projectId } }), q);
    });
  }
  role(userId: string, projectId: string, targetId: string, body: z.infer<typeof v.rolePatch>) {
    return transaction(this.db, async tx => {
      const { member } = await projectAccess(tx, projectId, userId, { write: true });
      requireOwner(member);
      const target = await tx.projectMember.findUnique({ where: { projectId_userId: { projectId, userId: targetId } } });
      if (!target) fail(404, 'MEMBER_NOT_FOUND', 'Member not found');
      if (target.role === 'OWNER') fail(409, 'OWNER_IMMUTABLE', 'OWNER membership cannot be changed');
      return tx.projectMember.update({ where: { projectId_userId: { projectId, userId: targetId } }, data: body });
    });
  }
  remove(userId: string, projectId: string, targetId: string, leaving = false) {
    return transaction(this.db, async tx => {
      const { member } = await projectAccess(tx, projectId, userId, { write: true, manage: !leaving });
      const target = await tx.projectMember.findUnique({ where: { projectId_userId: { projectId, userId: targetId } } });
      if (!target) fail(404, 'MEMBER_NOT_FOUND', 'Member not found');
      if (target.role === 'OWNER') fail(409, 'OWNER_IMMUTABLE', 'OWNER cannot leave or be removed');
      if (!leaving && member?.role === 'LEAD' && target.role !== 'MEMBER') fail(403, 'OWNER_REQUIRED', 'LEAD cannot remove another LEAD');
      const unfinished = await tx.task.count({ where: { projectId, assigneeId: targetId, status: { not: 'COMPLETED' } } });
      if (unfinished) fail(409, 'UNFINISHED_ASSIGNMENTS', 'Explicitly reassign or unassign all unfinished tasks before departure');
      // Completed work remains counted, but its assignment is cleared to preserve the membership FK.
      const cleared = await tx.task.updateMany({ where: { projectId, assigneeId: targetId, status: 'COMPLETED' }, data: { assigneeId: null } });
      await tx.projectMember.delete({ where: { projectId_userId: { projectId, userId: targetId } } });
      return { removedUserId: targetId, clearedCompletedAssignments: cleared.count };
    });
  }
  summary(userId: string, projectId: string) {
    return snapshot(this.db, async tx => {
      await projectAccess(tx, projectId, userId);
      const tasks = await tx.task.findMany({ where: { projectId }, select: { status: true, assigneeId: true, dueDate: true } });
      const members = await tx.projectMember.findMany({ where: { projectId }, include: { user: true }, orderBy: { userId: 'asc' } });
      const countsByStatus = { TODO: 0, IN_PROGRESS: 0, IN_REVIEW: 0, COMPLETED: 0 };
      const workload = new Map<string, number>();
      let overdueUnfinishedTasks = 0;
      let unassignedOpenTasks = 0;
      const now = new Date();
      for (const task of tasks) {
        countsByStatus[task.status]++;
        if (task.status !== 'COMPLETED') {
          if (task.dueDate && task.dueDate < now) overdueUnfinishedTasks++;
          if (task.assigneeId) workload.set(task.assigneeId, (workload.get(task.assigneeId) ?? 0) + 1);
          else unassignedOpenTasks++;
        }
      }
      return { totalTasks: tasks.length, countsByStatus, overdueUnfinishedTasks, completionPercentage: tasks.length ? Math.round(countsByStatus.COMPLETED / tasks.length * 10000) / 100 : 0, unassignedOpenTasks, memberWorkload: members.map(m => ({ userId: m.userId, name: m.user.name, openTasks: workload.get(m.userId) ?? 0 })), countedAt: now, subtaskCounting: 'Every task and subtask counts once; no automatic parent completion.' };
    });
  }
}
