import { z } from 'zod';

export const id = z.uuid();
export const date = z.iso.datetime({ offset: true });
export const status = z.enum(['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'COMPLETED']);
export const priority = z.enum(['LOW', 'MEDIUM', 'HIGH']);
const text = z.string().trim().min(1).max(200);
const projectFields = {
  name: text, description: z.string().max(10000), visibility: z.enum(['PRIVATE', 'DISCOVERABLE']),
  startDate: date.nullable(), dueDate: date.nullable(),
};
export const projectCreate = z.strictObject(projectFields).partial().required({ name: true });
export const projectPatch = z.strictObject({ ...projectFields, status: z.enum(['ACTIVE', 'COMPLETED']) }).partial().refine(v => Object.keys(v).length > 0, 'Supply at least one field');
export const rolePatch = z.strictObject({ role: z.enum(['MEMBER', 'LEAD']) });
export const inviteCreate = z.strictObject({ invitedUserId: id, expiresAt: date.optional() });
export const joinCreate = z.strictObject({ message: z.string().trim().max(2000).optional() });
export const joinReview = z.strictObject({ status: z.enum(['APPROVED', 'REJECTED']) });
const taskFields = {
  title: text, description: z.string().max(10000), priority,
  parentTaskId: id.nullable(), dueDate: date.nullable(),
};
export const taskCreate = z.strictObject({ ...taskFields, assigneeId: id.nullable() }).partial().required({ title: true });
export const taskPatch = z.strictObject(taskFields).partial().refine(v => Object.keys(v).length > 0, 'Supply at least one field');
export const assigneePatch = z.strictObject({ assigneeId: id.nullable() });
export const statusPatch = z.strictObject({ status });
export const empty = z.strictObject({});
const pagingFields = {
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(['createdAt', '-createdAt']).default('-createdAt'),
};
export const paging = z.strictObject(pagingFields);
export const taskQuery = z.strictObject({
  ...pagingFields, sort: z.enum(['createdAt', '-createdAt', 'dueDate', '-dueDate', 'title', '-title']).default('-createdAt'),
  status: status.optional(), priority: priority.optional(), assigneeId: z.union([id, z.literal('unassigned')]).optional(),
});
export type Paging = z.infer<typeof paging>;
export type TaskQuery = z.infer<typeof taskQuery>;
export function listArgs(q: Paging | TaskQuery, fieldOverride?: string) {
  const field = fieldOverride ?? q.sort.replace(/^-/, '');
  return { skip: (q.page - 1) * q.pageSize, take: q.pageSize, orderBy: [{ [field]: q.sort.startsWith('-') ? 'desc' as const : 'asc' as const }, { id: 'asc' as const }] };
}
export function paginated<T>(data: T[], total: number, q: Paging | TaskQuery) {
  return { data, pagination: { page: q.page, pageSize: q.pageSize, total, totalPages: Math.ceil(total / q.pageSize) } };
}
