import 'dotenv/config';
import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { createApp } from '../src/app';
import { loadConfig } from '../src/config';
import { seed, seedUsers } from '../prisma/seed';
import { migrateTestDatabase, testDatabaseUrl } from './test-database';

const url = testDatabaseUrl();
const db = new PrismaClient({ datasources: { db: { url } } });
const app = createApp(db, loadConfig({ NODE_ENV: 'test', DEV_IDENTITY_ENABLED: 'true' }));
const [A, B, C, D] = seedUsers.map(u => u.id) as [string,string,string,string];
function api(method: 'get'|'post'|'patch'|'delete', path: string, user = A, body?: object) {
  const req = request(app)[method](path).set('X-Dev-User-Id', user);
  return body === undefined ? req : req.send(body);
}
async function project(visibility: 'PRIVATE'|'DISCOVERABLE' = 'DISCOVERABLE') {
  const res = await api('post','/api/projects',A,{ name: 'Capstone', visibility }).expect(201);
  return res.body.data.id as string;
}
async function inviteMember(pid: string, user = B) {
  const invitation = await api('post',`/api/projects/${pid}/invitations`,A,{ invitedUserId: user }).expect(201);
  await api('post',`/api/invitations/${invitation.body.data.id}/accept`,user,{}).expect(200);
  return invitation.body.data.id as string;
}
async function task(pid: string, body: object = {}) {
  const response = await api('post',`/api/projects/${pid}/tasks`,A,{ title: 'Build module', ...body }).expect(201);
  return response.body.data;
}
before(async () => { migrateTestDatabase(url); await db.$connect(); await seed(db); });
beforeEach(async () => {
  // Test URL was validated before connecting. Only this isolated database is reset.
  await db.$executeRawUnsafe('TRUNCATE "Project", "User" CASCADE');
  await seed(db);
});
after(async () => { await db.$disconnect(); });

test('project creation derives creator from currentUser and creates exactly one owner atomically', async () => {
  await api('post','/api/projects',A,{ name: 'Spoof', creatorId: B }).expect(400);
  assert.equal(await db.project.count(),0);
  const pid = await project();
  const stored = await db.project.findUniqueOrThrow({ where: { id: pid }, include: { members: true } });
  assert.equal(stored.creatorId,A);
  assert.deepEqual(stored.members.map(m => [m.userId,m.role]),[[A,'OWNER']]);
  await assert.rejects(db.project.create({ data: { name: 'Rollback', creatorId: A, members: { create: { userId: '00000000-0000-4000-8000-000000000099', role: 'OWNER' } } } }));
  assert.equal(await db.project.count(),1);
});

test('development identity rejects missing, malformed and unknown IDs; disabled adapter fails closed', async () => {
  await request(app).get('/api/projects').expect(401);
  await api('get','/api/projects','invalid').expect(401);
  await api('get','/api/projects','00000000-0000-4000-8000-000000000099').expect(401);
  const disabled = createApp(db,loadConfig({ NODE_ENV: 'production' }));
  await request(disabled).get('/api/projects').set('X-Dev-User-Id',A).expect(503);
  assert.throws(() => createApp(db,{ ...loadConfig({}), devIdentityEnabled: true }),/production/);
  await request(disabled).get('/api/health').expect(200);
});

test('private data stays behind membership; discovery exposes only public active metadata', async () => {
  const pid = await project();
  const privateId = await project('PRIVATE');
  await task(pid);
  const listing = await api('get','/api/projects',B).expect(200);
  assert.equal(listing.body.data.length,0);
  for (const suffix of ['', '/tasks','/members','/summary']) await api('get',`/api/projects/${pid}${suffix}`,B).expect(403);
  const discovery = await api('get','/api/projects/discover',B).expect(200);
  assert.deepEqual(discovery.body.data.map((p:any) => p.id),[pid]);
  for (const field of ['creatorId','members','tasks','updatedAt']) assert.equal(field in discovery.body.data[0],false);
  await api('post',`/api/projects/${privateId}/join-requests`,B,{}).expect(403);
  await api('patch',`/api/projects/${pid}`,A,{ status:'COMPLETED' }).expect(200);
  assert.equal((await api('get','/api/projects/discover',B)).body.data.length,0);
});

test('join workflow, task assignment, member status and summary work end to end', async () => {
  const pid = await project();
  const join = await api('post',`/api/projects/${pid}/join-requests`,B,{ message:'I can help' }).expect(201);
  await api('patch',`/api/projects/${pid}/join-requests/${join.body.data.id}`,A,{ status:'APPROVED' }).expect(200);
  const t = await task(pid);
  await api('patch',`/api/projects/${pid}/tasks/${t.id}/assignee`,A,{ assigneeId:B }).expect(200);
  await api('patch',`/api/projects/${pid}/tasks/${t.id}/status`,B,{ status:'IN_PROGRESS' }).expect(200);
  const summary = (await api('get',`/api/projects/${pid}/summary`,A).expect(200)).body.data;
  assert.equal(summary.totalTasks,1);
  assert.equal(summary.countsByStatus.IN_PROGRESS,1);
  assert.equal(summary.memberWorkload.find((m:any) => m.userId === B).openTasks,1);
});

test('concurrent approvals and acceptance serialize, preserve uniqueness and resolve pending records', async () => {
  const pid = await project();
  const join = await api('post',`/api/projects/${pid}/join-requests`,B,{}).expect(201);
  await api('post',`/api/projects/${pid}/join-requests`,B,{}).expect(409);
  const invitation = await api('post',`/api/projects/${pid}/invitations`,A,{ invitedUserId:B }).expect(201);
  const results = await Promise.all([
    api('patch',`/api/projects/${pid}/join-requests/${join.body.data.id}`,A,{ status:'APPROVED' }),
    api('patch',`/api/projects/${pid}/join-requests/${join.body.data.id}`,A,{ status:'APPROVED' }),
    api('post',`/api/invitations/${invitation.body.data.id}/accept`,B,{}),
  ]);
  assert.deepEqual(results.map(r => r.status).sort(),[200,409,409]);
  assert.equal(await db.projectMember.count({ where:{ projectId:pid,userId:B } }),1);
  assert.equal((await db.joinRequest.findUniqueOrThrow({ where:{id:join.body.data.id} })).status,'APPROVED');
  assert.equal((await db.projectInvitation.findUniqueOrThrow({ where:{id:invitation.body.data.id} })).status,'ACCEPTED');
  await assert.rejects(db.projectMember.create({ data:{ projectId:pid,userId:B } }));
});

test('invitations grant no access until acceptance; wrong user, duplicates and expiry are rejected', async () => {
  const pid = await project('PRIVATE');
  const invitation = await api('post',`/api/projects/${pid}/invitations`,A,{ invitedUserId:B }).expect(201);
  const iid = invitation.body.data.id;
  await api('get',`/api/projects/${pid}`,B).expect(403);
  await api('post',`/api/invitations/${iid}/accept`,C,{}).expect(403);
  await api('post',`/api/invitations/${iid}/decline`,C,{}).expect(403);
  await api('post',`/api/projects/${pid}/invitations`,A,{ invitedUserId:B }).expect(409);
  await db.projectInvitation.update({ where:{id:iid},data:{expiresAt:new Date(Date.now()-10000)} });
  const expired = await api('post',`/api/invitations/${iid}/accept`,B,{}).expect(409);
  assert.equal(expired.body.error.code,'INVITATION_EXPIRED');
  assert.equal(await db.projectMember.count({ where:{projectId:pid,userId:B} }),0);
  const fresh = await api('post',`/api/projects/${pid}/invitations`,A,{ invitedUserId:B }).expect(201);
  assert.equal((await db.projectInvitation.findUniqueOrThrow({where:{id:iid}})).status,'REVOKED');
  await api('post',`/api/invitations/${fresh.body.data.id}/accept`,B,{}).expect(200);
  await api('post',`/api/invitations/${fresh.body.data.id}/accept`,B,{}).expect(409);
});

test('pending invitations can be declined/revoked; requests cancelled/rejected only by authorized actors', async () => {
  const pid = await project();
  const i1 = await api('post',`/api/projects/${pid}/invitations`,A,{invitedUserId:B}).expect(201);
  await api('post',`/api/invitations/${i1.body.data.id}/decline`,B,{}).expect(200);
  const i2 = await api('post',`/api/projects/${pid}/invitations`,A,{invitedUserId:B}).expect(201);
  await api('post',`/api/projects/${pid}/invitations/${i2.body.data.id}/revoke`,A,{}).expect(200);
  await api('post',`/api/invitations/${i2.body.data.id}/accept`,B,{}).expect(409);
  const j1 = await api('post',`/api/projects/${pid}/join-requests`,B,{}).expect(201);
  await api('post',`/api/projects/${pid}/join-requests/${j1.body.data.id}/cancel`,C,{}).expect(403);
  await api('post',`/api/projects/${pid}/join-requests/${j1.body.data.id}/cancel`,B,{}).expect(200);
  const j2 = await api('post',`/api/projects/${pid}/join-requests`,B,{}).expect(201);
  await api('patch',`/api/projects/${pid}/join-requests/${j2.body.data.id}`,A,{status:'REJECTED'}).expect(200);
  await api('patch',`/api/projects/${pid}/join-requests/${j2.body.data.id}`,A,{status:'APPROVED'}).expect(409);
});

test('OWNER/LEAD/MEMBER permissions prevent role escalation and task control violations', async () => {
  const pid = await project();
  await inviteMember(pid,B); await inviteMember(pid,C); await inviteMember(pid,D);
  const t = await task(pid,{assigneeId:B});
  await api('patch',`/api/projects/${pid}`,B,{name:'No'}).expect(403);
  await api('patch',`/api/projects/${pid}/members/${B}`,B,{role:'LEAD'}).expect(403);
  await api('post',`/api/projects/${pid}/tasks`,B,{title:'No'}).expect(403);
  await api('post',`/api/projects/${pid}/invitations`,B,{invitedUserId:C}).expect(403);
  await api('get',`/api/projects/${pid}/join-requests`,B).expect(403);
  await api('patch',`/api/projects/${pid}/tasks/${t.id}`,B,{title:'No'}).expect(403);
  await api('patch',`/api/projects/${pid}/tasks/${t.id}/assignee`,B,{assigneeId:C}).expect(403);
  await api('patch',`/api/projects/${pid}/tasks/${t.id}/status`,C,{status:'COMPLETED'}).expect(403);
  await api('patch',`/api/projects/${pid}/members/${C}`,A,{role:'LEAD'}).expect(200);
  await api('patch',`/api/projects/${pid}/members/${D}`,A,{role:'LEAD'}).expect(200);
  await api('patch',`/api/projects/${pid}`,C,{name:'Lead edit'}).expect(200);
  await api('patch',`/api/projects/${pid}/tasks/${t.id}`,C,{title:'Lead edit'}).expect(200);
  await api('patch',`/api/projects/${pid}/members/${B}`,C,{role:'LEAD'}).expect(403);
  await api('delete',`/api/projects/${pid}/members/${D}`,C).expect(403);
  await api('delete',`/api/projects/${pid}/members/${A}`,C).expect(409);
  await api('post',`/api/projects/${pid}/archive`,C,{}).expect(403);
  await api('patch',`/api/projects/${pid}/members/${A}`,A,{role:'MEMBER'}).expect(409);
  await api('post',`/api/projects/${pid}/leave`,A,{}).expect(409);
});

test('all nested resources and parent tasks must belong to route project', async () => {
  const p1 = await project(), p2 = await project();
  const t = await task(p1);
  await api('get',`/api/projects/${p2}/tasks/${t.id}`).expect(404);
  await api('patch',`/api/projects/${p2}/tasks/${t.id}`,A,{title:'No'}).expect(404);
  await api('patch',`/api/projects/${p2}/tasks/${t.id}/status`,A,{status:'COMPLETED'}).expect(404);
  await api('patch',`/api/projects/${p2}/tasks/${t.id}/assignee`,A,{assigneeId:A}).expect(404);
  await api('post',`/api/projects/${p2}/tasks`,A,{title:'No',parentTaskId:t.id}).expect(404);
  const jr = await api('post',`/api/projects/${p1}/join-requests`,B,{}).expect(201);
  await api('patch',`/api/projects/${p2}/join-requests/${jr.body.data.id}`,A,{status:'APPROVED'}).expect(404);
  await api('post',`/api/projects/${p2}/join-requests/${jr.body.data.id}/cancel`,B,{}).expect(404);
  const inv = await api('post',`/api/projects/${p1}/invitations`,A,{invitedUserId:C}).expect(201);
  await api('post',`/api/projects/${p2}/invitations/${inv.body.data.id}/revoke`,A,{}).expect(404);
});

test('nonmember assignments fail at API and database levels; subtask cycles and self-parenting fail', async () => {
  const pid = await project();
  const root = await task(pid);
  const child = await task(pid,{parentTaskId:root.id});
  const leaf = await task(pid,{parentTaskId:child.id});
  await api('post',`/api/projects/${pid}/tasks`,A,{title:'No',assigneeId:B}).expect(400);
  await api('patch',`/api/projects/${pid}/tasks/${root.id}/assignee`,A,{assigneeId:B}).expect(400);
  await assert.rejects(db.task.update({ where:{id:root.id},data:{assigneeId:B} }));
  await api('patch',`/api/projects/${pid}/tasks/${root.id}`,A,{parentTaskId:root.id}).expect(409);
  await api('patch',`/api/projects/${pid}/tasks/${root.id}`,A,{parentTaskId:leaf.id}).expect(409);
  await api('patch',`/api/projects/${pid}/tasks/${child.id}`,A,{parentTaskId:null}).expect(200);
});

test('concurrent task parenting cannot introduce a cycle', async () => {
  const pid = await project(); const t1 = await task(pid), t2 = await task(pid);
  const responses = await Promise.all([
    api('patch',`/api/projects/${pid}/tasks/${t1.id}`,A,{parentTaskId:t2.id}),
    api('patch',`/api/projects/${pid}/tasks/${t2.id}`,A,{parentTaskId:t1.id}),
  ]);
  assert.deepEqual(responses.map(r => r.status).sort(),[200,409]);
});

test('unfinished assignments block departure/removal; explicit unassignment permits it', async () => {
  const pid = await project(); await inviteMember(pid);
  const t = await task(pid,{assigneeId:B});
  await api('post',`/api/projects/${pid}/leave`,B,{}).expect(409);
  await api('delete',`/api/projects/${pid}/members/${B}`,A).expect(409);
  assert.equal((await db.task.findUniqueOrThrow({where:{id:t.id}})).assigneeId,B);
  await api('patch',`/api/projects/${pid}/tasks/${t.id}/assignee`,A,{assigneeId:null}).expect(200);
  await api('post',`/api/projects/${pid}/leave`,B,{}).expect(200);
  await api('get',`/api/projects/${pid}`,B).expect(403);
});

test('completed assignment cleanup is explicit in departure response', async () => {
  const pid = await project(); await inviteMember(pid);
  const t = await task(pid,{assigneeId:B});
  await api('patch',`/api/projects/${pid}/tasks/${t.id}/status`,B,{status:'COMPLETED'}).expect(200);
  const departed = await api('post',`/api/projects/${pid}/leave`,B,{}).expect(200);
  assert.equal(departed.body.data.clearedCompletedAssignments,1);
  const stored = await db.task.findUniqueOrThrow({where:{id:t.id}});
  assert.equal(stored.assigneeId,null); assert.equal(stored.status,'COMPLETED');
});

test('concurrent assignment and departure cannot leave an assignment to a nonmember', async () => {
  const pid = await project(); await inviteMember(pid);
  const t = await task(pid);
  const results = await Promise.all([
    api('post',`/api/projects/${pid}/leave`,B,{}),
    api('patch',`/api/projects/${pid}/tasks/${t.id}/assignee`,A,{assigneeId:B}),
  ]);
  assert.equal(results.filter(r => r.status === 200).length,1);
  const stored = await db.task.findUniqueOrThrow({where:{id:t.id}});
  const member = await db.projectMember.findUnique({where:{projectId_userId:{projectId:pid,userId:B}}});
  assert.ok(stored.assigneeId === null || member !== null);
});

test('completedAt is stable for repeated completion and cleared when reopened', async () => {
  const pid = await project(); const t = await task(pid);
  const done = await api('patch',`/api/projects/${pid}/tasks/${t.id}/status`,A,{status:'COMPLETED'}).expect(200);
  assert.ok(done.body.data.completedAt);
  const repeated = await api('patch',`/api/projects/${pid}/tasks/${t.id}/status`,A,{status:'COMPLETED'}).expect(200);
  assert.equal(repeated.body.data.completedAt,done.body.data.completedAt);
  const reopened = await api('patch',`/api/projects/${pid}/tasks/${t.id}/status`,A,{status:'TODO'}).expect(200);
  assert.equal(reopened.body.data.completedAt,null);
});

test('completed projects reject all task mutations until OWNER/LEAD reopens', async () => {
  const pid = await project(); const t = await task(pid);
  await api('patch',`/api/projects/${pid}`,A,{status:'COMPLETED'}).expect(200);
  await api('post',`/api/projects/${pid}/tasks`,A,{title:'No'}).expect(409);
  await api('patch',`/api/projects/${pid}/tasks/${t.id}`,A,{title:'No'}).expect(409);
  await api('patch',`/api/projects/${pid}/tasks/${t.id}/status`,A,{status:'COMPLETED'}).expect(409);
  await api('patch',`/api/projects/${pid}/tasks/${t.id}/assignee`,A,{assigneeId:A}).expect(409);
  await api('patch',`/api/projects/${pid}`,A,{status:'ACTIVE'}).expect(200);
  await api('patch',`/api/projects/${pid}/tasks/${t.id}/status`,A,{status:'COMPLETED'}).expect(200);
});

test('archived projects remain readable and reject every project mutation family', async () => {
  const pid = await project(); await inviteMember(pid,B);
  const t = await task(pid);
  const inv = await api('post',`/api/projects/${pid}/invitations`,A,{invitedUserId:C}).expect(201);
  const jr = await api('post',`/api/projects/${pid}/join-requests`,D,{}).expect(201);
  await api('post',`/api/projects/${pid}/archive`,A,{}).expect(200);
  for (const suffix of ['', '/tasks','/members','/summary']) await api('get',`/api/projects/${pid}${suffix}`,B).expect(200);
  const changes: ['post'|'patch'|'delete',string,string,object?][] = [
    ['patch','',A,{name:'No'}],['post','/archive',A,{}],['post','/leave',B,{}],
    ['patch',`/members/${B}`,A,{role:'LEAD'}],['delete',`/members/${B}`,A],
    ['post','/invitations',A,{invitedUserId:D}],['post',`/invitations/${inv.body.data.id}/revoke`,A,{}],
    ['post','/join-requests',C,{}],['patch',`/join-requests/${jr.body.data.id}`,A,{status:'APPROVED'}],
    ['post',`/join-requests/${jr.body.data.id}/cancel`,D,{}],['post','/tasks',A,{title:'No'}],
    ['patch',`/tasks/${t.id}`,A,{title:'No'}],['patch',`/tasks/${t.id}/assignee`,A,{assigneeId:B}],['patch',`/tasks/${t.id}/status`,A,{status:'COMPLETED'}],
  ];
  for (const [method,suffix,user,body] of changes) await api(method,`/api/projects/${pid}${suffix}`,user,body).expect(409);
  await api('post',`/api/invitations/${inv.body.data.id}/accept`,C,{}).expect(409);
  await api('post',`/api/invitations/${inv.body.data.id}/decline`,C,{}).expect(409);
});

test('summary counts subtasks once, overdue unfinished tasks, zero-work members and completion percentage', async () => {
  const pid = await project(); await inviteMember(pid,B); await inviteMember(pid,C);
  const root = await task(pid,{assigneeId:B,dueDate:'2020-01-01T00:00:00Z'});
  await task(pid,{parentTaskId:root.id,assigneeId:B});
  const done = await task(pid,{assigneeId:C,dueDate:'2020-01-01T00:00:00Z'});
  await api('patch',`/api/projects/${pid}/tasks/${done.id}/status`,C,{status:'COMPLETED'}).expect(200);
  await task(pid);
  const summary = (await api('get',`/api/projects/${pid}/summary`).expect(200)).body.data;
  assert.equal(summary.totalTasks,4); assert.equal(summary.countsByStatus.TODO,3);
  assert.equal(summary.countsByStatus.COMPLETED,1); assert.equal(summary.completionPercentage,25);
  assert.equal(summary.overdueUnfinishedTasks,1); assert.equal(summary.unassignedOpenTasks,1);
  assert.deepEqual(summary.memberWorkload.map((m:any) => [m.userId,m.openTasks]),[[A,0],[B,2],[C,0]]);
  const emptyId = await project();
  assert.equal((await api('get',`/api/projects/${emptyId}/summary`)).body.data.completionPercentage,0);
});

test('pagination, bounded sizes, task filters and sorting are consistent', async () => {
  const pid = await project(); await inviteMember(pid,B);
  await task(pid,{title:'Alpha',priority:'HIGH',assigneeId:B});
  await task(pid,{title:'Beta',priority:'LOW'});
  await task(pid,{title:'Gamma',priority:'HIGH'});
  const page = await api('get',`/api/projects/${pid}/tasks?pageSize=1&page=2&sort=title`).expect(200);
  assert.equal(page.body.data[0].title,'Beta'); assert.equal(page.body.pagination.total,3);
  const filtered = await api('get',`/api/projects/${pid}/tasks?priority=HIGH&status=TODO&assigneeId=${B}`).expect(200);
  assert.equal(filtered.body.data.length,1); assert.equal(filtered.body.data[0].title,'Alpha');
  assert.equal((await api('get',`/api/projects/${pid}/tasks?assigneeId=unassigned`)).body.pagination.total,2);
  for (const query of ['pageSize=101','page=0','sort=password','status=INVALID','unexpected=1']) await api('get',`/api/projects/${pid}/tasks?${query}`).expect(400);
  for (const path of ['/api/projects','/api/projects/discover','/api/me/invitations','/api/me/join-requests','/api/dev/users',`/api/projects/${pid}/members`,`/api/projects/${pid}/invitations`,`/api/projects/${pid}/join-requests`]) {
    const res = await api('get',`${path}?pageSize=1`).expect(200);
    assert.ok(res.body.data.length <= 1); assert.equal(res.body.pagination.pageSize,1);
  }
});

test('strict input, valid timezone-qualified dates and date range checks prevent mass assignment', async () => {
  await api('post','/api/projects',A,{name:'No',startDate:'2026-12-02T00:00:00Z',dueDate:'2026-12-01T00:00:00Z'}).expect(400);
  await api('post','/api/projects',A,{name:'No',startDate:'2026-02-30T00:00:00Z'}).expect(400);
  await api('post','/api/projects',A,{name:'No',startDate:'2026-12-01'}).expect(400);
  const pid = await project(); const t = await task(pid);
  await api('patch',`/api/projects/${pid}`,A,{startDate:'2026-12-02T00:00:00Z'}).expect(200);
  await api('patch',`/api/projects/${pid}`,A,{dueDate:'2026-12-01T00:00:00Z'}).expect(400);
  await api('patch',`/api/projects/${pid}/tasks/${t.id}`,A,{createdById:B}).expect(400);
  await api('patch',`/api/projects/${pid}/tasks/${t.id}`,A,{status:'COMPLETED'}).expect(400);
  await api('post',`/api/projects/${pid}/join-requests`,B,{actingUserId:A}).expect(400);
  await api('get','/api/projects/not-a-uuid').expect(400);
  const badJson = await request(app).post('/api/projects').set('X-Dev-User-Id',A).set('Content-Type','application/json').send('{').expect(400);
  assert.equal(badJson.body.error.code,'INVALID_BODY'); assert.equal('stack' in badJson.body.error,false);
});

test('database constraints enforce cross-project parent and completion timestamp consistency', async () => {
  const p1 = await project(), p2 = await project(); const t1 = await task(p1), t2 = await task(p2);
  await assert.rejects(db.task.update({where:{id:t2.id},data:{parentTaskId:t1.id}}));
  await assert.rejects(db.task.update({where:{id:t1.id},data:{status:'COMPLETED'}}));
  await assert.rejects(db.task.update({where:{id:t1.id},data:{parentTaskId:t1.id}}));
});

test('public health and OpenAPI describe every required endpoint and development header', async () => {
  await request(app).get('/api/health').expect(200);
  await request(app).get('/api/docs/').expect(200);
  const spec = (await request(app).get('/api/openapi.json').expect(200)).body;
  assert.equal(spec.openapi,'3.1.0');
  assert.equal(spec.components.securitySchemes.DevelopmentIdentity.name,'X-Dev-User-Id');
  assert.ok(spec.paths['/api/projects/{projectId}/tasks/{taskId}/status'].patch);
  assert.ok(spec.paths['/api/projects/{projectId}/join-requests/{requestId}'].patch);
  await api('post','/api/users',A,{name:'No'}).expect(404);
});
