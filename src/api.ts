import { Express, Request } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import * as v from './validation';
import { ProjectService } from './services/projects';
import { MembershipService } from './services/membership';
import { TaskService } from './services/tasks';

export type Endpoint = {
  method: 'get' | 'post' | 'patch' | 'delete'; path: string; summary: string;
  body?: z.ZodType; query?: z.ZodType; status?: number; response: string;
  example?: Record<string, unknown>;
  run: (req: Request, body: any, query: any) => Promise<unknown>;
};
export function endpoints(db: PrismaClient): Endpoint[] {
  const p = new ProjectService(db), m = new MembershipService(db), t = new TaskService(db);
  const uid = (r: Request) => r.currentUser.id;
  const pid = (r: Request) => r.params.projectId as string;
  const param = (r: Request, key: string) => r.params[key] as string;
  return [
    { method: 'post', path: '/api/projects', summary: 'Create a project and OWNER membership atomically', body: v.projectCreate, status: 201, response: 'Project', example: { name: 'Group 9 capstone', visibility: 'DISCOVERABLE' }, run: (r,b) => p.create(uid(r), b) },
    { method: 'get', path: '/api/projects', summary: 'List my projects', query: v.paging, response: 'ProjectList', run: (r,_b,q) => p.list(uid(r),q) },
    { method: 'get', path: '/api/projects/discover', summary: 'Discover active projects with limited public metadata', query: v.paging, response: 'DiscoveryList', run: (r,_b,q) => p.list(uid(r),q,true) },
    { method: 'get', path: '/api/projects/:projectId', summary: 'Read a member project', response: 'Project', run: r => p.get(uid(r),pid(r)) },
    { method: 'patch', path: '/api/projects/:projectId', summary: 'Edit project details or complete/reopen a project (OWNER/LEAD)', body: v.projectPatch, response: 'Project', run: (r,b) => p.patch(uid(r),pid(r),b) },
    { method: 'post', path: '/api/projects/:projectId/archive', summary: 'Permanently archive a project (OWNER)', body: v.empty, response: 'Project', run: r => p.archive(uid(r),pid(r)) },
    { method: 'get', path: '/api/projects/:projectId/summary', summary: 'Task totals, progress and member workload', response: 'Summary', run: r => p.summary(uid(r),pid(r)) },
    { method: 'get', path: '/api/projects/:projectId/members', summary: 'List members (createdAt sorting maps to joinedAt)', query: v.paging, response: 'MemberList', run: (r,_b,q) => p.members(uid(r),pid(r),q) },
    { method: 'patch', path: '/api/projects/:projectId/members/:userId', summary: 'Promote/demote LEAD roles (OWNER)', body: v.rolePatch, response: 'Member', run: (r,b) => p.role(uid(r),pid(r),param(r,'userId'),b) },
    { method: 'delete', path: '/api/projects/:projectId/members/:userId', summary: 'Remove eligible member (OWNER/LEAD)', response: 'Departure', run: r => p.remove(uid(r),pid(r),param(r,'userId')) },
    { method: 'post', path: '/api/projects/:projectId/leave', summary: 'Leave with no unfinished assignments', body: v.empty, response: 'Departure', run: r => p.remove(uid(r),pid(r),uid(r),true) },
    { method: 'post', path: '/api/projects/:projectId/invitations', summary: 'Invite an existing user (OWNER/LEAD)', body: v.inviteCreate, status: 201, response: 'Invitation', run: (r,b) => m.invite(uid(r),pid(r),b) },
    { method: 'get', path: '/api/projects/:projectId/invitations', summary: 'List project invitations (OWNER/LEAD)', query: v.paging, response: 'InvitationList', run: (r,_b,q) => m.invitations(uid(r),q,pid(r)) },
    { method: 'get', path: '/api/me/invitations', summary: 'List invitations addressed to me', query: v.paging, response: 'InvitationList', run: (r,_b,q) => m.invitations(uid(r),q) },
    { method: 'post', path: '/api/invitations/:invitationId/accept', summary: 'Accept an unexpired invitation addressed to me', body: v.empty, response: 'Invitation', run: r => m.respondInvitation(uid(r),param(r,'invitationId'),'accept') },
    { method: 'post', path: '/api/invitations/:invitationId/decline', summary: 'Decline an invitation addressed to me', body: v.empty, response: 'Invitation', run: r => m.respondInvitation(uid(r),param(r,'invitationId'),'decline') },
    { method: 'post', path: '/api/projects/:projectId/invitations/:invitationId/revoke', summary: 'Revoke pending invitation (OWNER/LEAD)', body: v.empty, response: 'Invitation', run: r => m.respondInvitation(uid(r),param(r,'invitationId'),'revoke',pid(r)) },
    { method: 'post', path: '/api/projects/:projectId/join-requests', summary: 'Request membership of an active discoverable project', body: v.joinCreate, status: 201, response: 'JoinRequest', run: (r,b) => m.requestJoin(uid(r),pid(r),b) },
    { method: 'get', path: '/api/projects/:projectId/join-requests', summary: 'List project requests (OWNER/LEAD)', query: v.paging, response: 'JoinRequestList', run: (r,_b,q) => m.requests(uid(r),q,pid(r)) },
    { method: 'get', path: '/api/me/join-requests', summary: 'List my join requests', query: v.paging, response: 'JoinRequestList', run: (r,_b,q) => m.requests(uid(r),q) },
    { method: 'patch', path: '/api/projects/:projectId/join-requests/:requestId', summary: 'Approve/reject a pending request (OWNER/LEAD)', body: v.joinReview, response: 'JoinRequest', run: (r,b) => m.review(uid(r),pid(r),param(r,'requestId'),b.status) },
    { method: 'post', path: '/api/projects/:projectId/join-requests/:requestId/cancel', summary: 'Cancel my pending request', body: v.empty, response: 'JoinRequest', run: r => m.review(uid(r),pid(r),param(r,'requestId'),'CANCELLED') },
    { method: 'post', path: '/api/projects/:projectId/tasks', summary: 'Create task or subtask (OWNER/LEAD)', body: v.taskCreate, status: 201, response: 'Task', example: { title: 'Design schema', priority: 'HIGH' }, run: (r,b) => t.create(uid(r),pid(r),b) },
    { method: 'get', path: '/api/projects/:projectId/tasks', summary: 'List/filter project tasks', query: v.taskQuery, response: 'TaskList', run: (r,_b,q) => t.list(uid(r),pid(r),q) },
    { method: 'get', path: '/api/projects/:projectId/tasks/:taskId', summary: 'Read a project task', response: 'Task', run: r => t.get(uid(r),pid(r),param(r,'taskId')) },
    { method: 'patch', path: '/api/projects/:projectId/tasks/:taskId', summary: 'Edit task details or parent (OWNER/LEAD)', body: v.taskPatch, response: 'Task', run: (r,b) => t.patch(uid(r),pid(r),param(r,'taskId'),b) },
    { method: 'patch', path: '/api/projects/:projectId/tasks/:taskId/assignee', summary: 'Assign, reassign or unassign (OWNER/LEAD)', body: v.assigneePatch, response: 'Task', run: (r,b) => t.assign(uid(r),pid(r),param(r,'taskId'),b) },
    { method: 'patch', path: '/api/projects/:projectId/tasks/:taskId/status', summary: 'Update status (OWNER/LEAD or assignee)', body: v.statusPatch, response: 'Task', run: (r,b) => t.status(uid(r),pid(r),param(r,'taskId'),b) },
  ];
}
export function registerApi(app: Express, definitions: Endpoint[]) {
  for (const e of definitions) {
    app[e.method](e.path, async (req, res) => {
      for (const value of Object.values(req.params)) v.id.parse(value);
      const body = e.body ? e.body.parse(req.body ?? {}) : v.empty.parse(req.body ?? {});
      const query = (e.query ?? v.empty).parse(req.query);
      const result = await e.run(req, body, query);
      res.status(e.status ?? 200).json(e.query ? result : { data: result });
    });
  }
}
