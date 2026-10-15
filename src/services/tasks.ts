import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import * as v from '../validation';
import { fail } from '../errors';
import { projectAccess, snapshot, transaction, Tx } from './access';

async function getTask(tx: Tx, projectId: string, taskId: string) {
  const task = await tx.task.findFirst({ where: { id: taskId, projectId } });
  if (!task) fail(404, 'TASK_NOT_FOUND', 'Task not found in this project');
  return task;
}
async function checkAssignee(tx: Tx, projectId: string, assigneeId?: string | null) {
  if (assigneeId && !await tx.projectMember.findUnique({ where: { projectId_userId: { projectId, userId: assigneeId } } })) fail(400, 'ASSIGNEE_NOT_MEMBER', 'Assignee must be a current project member');
}
async function checkParent(tx: Tx, projectId: string, parentId?: string | null, taskId?: string) {
  const visited = new Set<string>(taskId ? [taskId] : []);
  let cursor = parentId;
  while (cursor) {
    if (visited.has(cursor)) fail(409, 'TASK_CYCLE', 'A task cannot be its own ancestor');
    visited.add(cursor);
    cursor = (await getTask(tx, projectId, cursor)).parentTaskId;
  }
}
export class TaskService {
  constructor(private db: PrismaClient) {}
  list(userId: string, projectId: string, q: v.TaskQuery) {
    return snapshot(this.db, async tx => {
      await projectAccess(tx, projectId, userId);
      const where = { projectId, status: q.status, priority: q.priority, assigneeId: q.assigneeId === 'unassigned' ? null : q.assigneeId };
      return v.paginated(await tx.task.findMany({ where, ...v.listArgs(q) }), await tx.task.count({ where }), q);
    });
  }
  get(userId: string, projectId: string, taskId: string) {
    return snapshot(this.db, async tx => { await projectAccess(tx, projectId, userId); return getTask(tx, projectId, taskId); });
  }
  create(userId: string, projectId: string, body: z.infer<typeof v.taskCreate>) {
    return transaction(this.db, async tx => {
      await projectAccess(tx, projectId, userId, { write: true, manage: true, task: true });
      await checkAssignee(tx, projectId, body.assigneeId);
      await checkParent(tx, projectId, body.parentTaskId);
      return tx.task.create({ data: { ...body, projectId, createdById: userId } });
    });
  }
  patch(userId: string, projectId: string, taskId: string, body: z.infer<typeof v.taskPatch>) {
    return transaction(this.db, async tx => {
      await projectAccess(tx, projectId, userId, { write: true, manage: true, task: true });
      await getTask(tx, projectId, taskId);
      await checkParent(tx, projectId, body.parentTaskId, taskId);
      return tx.task.update({ where: { id: taskId }, data: body });
    });
  }
  assign(userId: string, projectId: string, taskId: string, body: z.infer<typeof v.assigneePatch>) {
    return transaction(this.db, async tx => {
      await projectAccess(tx, projectId, userId, { write: true, manage: true, task: true });
      await getTask(tx, projectId, taskId);
      await checkAssignee(tx, projectId, body.assigneeId);
      return tx.task.update({ where: { id: taskId }, data: body });
    });
  }
  status(userId: string, projectId: string, taskId: string, body: z.infer<typeof v.statusPatch>) {
    return transaction(this.db, async tx => {
      const { member } = await projectAccess(tx, projectId, userId, { write: true, task: true });
      const task = await getTask(tx, projectId, taskId);
      if (member?.role === 'MEMBER' && task.assigneeId !== userId) fail(403, 'TASK_CONTROL_REQUIRED', 'Only project managers or the assignee can update task status');
      return tx.task.update({ where: { id: taskId }, data: { status: body.status, completedAt: body.status === 'COMPLETED' ? task.completedAt ?? new Date() : null } });
    });
  }
}
