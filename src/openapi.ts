import { z } from 'zod';
import { Endpoint } from './api';

const uuid = { type: 'string', format: 'uuid' };
const timestamp = { type: 'string', format: 'date-time' };
const nullable = (schema: object) => ({ anyOf: [schema, { type: 'null' }] });
const enumeration = (...values: string[]) => ({ type: 'string', enum: values });
const object = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({ type: 'object', properties, required });
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const envelope = (schema: object) => object({ data: schema });
const list = (schema: object) => object({ data: { type: 'array', items: schema }, pagination: ref('Pagination') });
const projectExample = { id: '11111111-1111-4111-8111-111111111111', name: 'Group 9 capstone', description: '', creatorId: '00000000-0000-4000-8000-000000000001', visibility: 'DISCOVERABLE', status: 'ACTIVE', startDate: null, dueDate: null, createdAt: '2026-10-15T10:00:00.000Z', updatedAt: '2026-10-15T10:00:00.000Z' };
const taskExample = { id: '22222222-2222-4222-8222-222222222222', projectId: projectExample.id, parentTaskId: null, title: 'Design schema', description: '', status: 'TODO', priority: 'HIGH', assigneeId: null, createdById: projectExample.creatorId, dueDate: null, completedAt: null, createdAt: projectExample.createdAt, updatedAt: projectExample.updatedAt };

export function openApi(endpoints: Endpoint[]) {
  const schemas: Record<string, object> = {
    User: object({ id: uuid, name: { type: 'string' }, email: { type: 'string', format: 'email' } }),
    Project: object({ id: uuid, name: { type: 'string' }, description: { type: 'string' }, creatorId: uuid, visibility: enumeration('PRIVATE', 'DISCOVERABLE'), status: enumeration('ACTIVE', 'COMPLETED', 'ARCHIVED'), startDate: nullable(timestamp), dueDate: nullable(timestamp), createdAt: timestamp, updatedAt: timestamp }),
    Discovery: object({ id: uuid, name: { type: 'string' }, description: { type: 'string', description: 'Public project description; never include confidential content.' }, visibility: enumeration('DISCOVERABLE'), status: enumeration('ACTIVE'), startDate: nullable(timestamp), dueDate: nullable(timestamp), createdAt: timestamp }),
    Member: object({ projectId: uuid, userId: uuid, role: enumeration('OWNER', 'LEAD', 'MEMBER'), joinedAt: timestamp, user: ref('User') }, ['projectId', 'userId', 'role', 'joinedAt']),
    Invitation: object({ id: uuid, projectId: uuid, invitedUserId: uuid, invitedById: uuid, status: enumeration('PENDING', 'ACCEPTED', 'DECLINED', 'REVOKED'), expiresAt: timestamp, createdAt: timestamp, respondedAt: nullable(timestamp), project: ref('ProjectLabel') }, ['id', 'projectId', 'invitedUserId', 'invitedById', 'status', 'expiresAt', 'createdAt', 'respondedAt']),
    JoinRequest: object({ id: uuid, projectId: uuid, userId: uuid, message: nullable({ type: 'string' }), status: enumeration('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'), reviewedById: nullable(uuid), reviewedAt: nullable(timestamp), createdAt: timestamp, project: ref('ProjectLabel') }, ['id', 'projectId', 'userId', 'message', 'status', 'reviewedById', 'reviewedAt', 'createdAt']),
    ProjectLabel: object({ id: uuid, name: { type: 'string' }, status: enumeration('ACTIVE', 'COMPLETED', 'ARCHIVED') }),
    Task: object({ id: uuid, projectId: uuid, parentTaskId: nullable(uuid), title: { type: 'string' }, description: { type: 'string' }, status: enumeration('TODO', 'IN_PROGRESS', 'IN_REVIEW', 'COMPLETED'), priority: enumeration('LOW', 'MEDIUM', 'HIGH'), assigneeId: nullable(uuid), createdById: uuid, dueDate: nullable(timestamp), createdAt: timestamp, updatedAt: timestamp, completedAt: nullable(timestamp) }),
    Departure: object({ removedUserId: uuid, clearedCompletedAssignments: { type: 'integer', minimum: 0 } }),
    Summary: object({ totalTasks: { type: 'integer' }, countsByStatus: object(Object.fromEntries(['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'COMPLETED'].map(key => [key, { type: 'integer' }]))), overdueUnfinishedTasks: { type: 'integer' }, completionPercentage: { type: 'number', minimum: 0, maximum: 100 }, unassignedOpenTasks: { type: 'integer' }, memberWorkload: { type: 'array', items: object({ userId: uuid, name: { type: 'string' }, openTasks: { type: 'integer' } }) }, countedAt: timestamp, subtaskCounting: { type: 'string' } }),
    Pagination: object({ page: { type: 'integer' }, pageSize: { type: 'integer' }, total: { type: 'integer' }, totalPages: { type: 'integer' } }),
    Error: object({ error: object({ code: { type: 'string' }, message: { type: 'string' }, details: { type: 'array', items: { type: 'object' } } }, ['code', 'message']) }),
  };
  for (const name of ['Project', 'Discovery', 'Member', 'Invitation', 'JoinRequest', 'Task', 'User']) schemas[`${name}List`] = list(ref(name));
  const examples: Record<string, object> = {
    Project: projectExample, Task: taskExample,
    Member: { projectId: projectExample.id, userId: projectExample.creatorId, role: 'OWNER', joinedAt: projectExample.createdAt },
    Invitation: { id: taskExample.id, projectId: projectExample.id, invitedUserId: '00000000-0000-4000-8000-000000000002', invitedById: projectExample.creatorId, status: 'PENDING', expiresAt: '2099-10-22T10:00:00Z', createdAt: projectExample.createdAt, respondedAt: null },
    JoinRequest: { id: taskExample.id, projectId: projectExample.id, userId: '00000000-0000-4000-8000-000000000002', message: 'I can help', status: 'PENDING', reviewedById: null, reviewedAt: null, createdAt: projectExample.createdAt },
    Departure: { removedUserId: '00000000-0000-4000-8000-000000000002', clearedCompletedAssignments: 0 },
    Summary: { totalTasks: 1, countsByStatus: { TODO: 1, IN_PROGRESS: 0, IN_REVIEW: 0, COMPLETED: 0 }, overdueUnfinishedTasks: 0, completionPercentage: 0, unassignedOpenTasks: 1, memberWorkload: [{ userId: projectExample.creatorId, name: 'Asha Rao', openTasks: 0 }], countedAt: projectExample.createdAt, subtaskCounting: 'Every task and subtask counts once; no automatic parent completion.' },
  };
  const paths: Record<string, Record<string, unknown>> = {};
  const errors = Object.fromEntries([400,401,403,404,409,413,500,503].map(code => [code, { description: ({ 400: 'Validation failure', 401: 'Missing/unknown development identity', 403: 'Permission denied', 404: 'Resource not found in project', 409: 'State conflict; refresh or reassign explicitly', 413: 'Body too large', 500: 'Unexpected server failure', 503: 'Identity adapter unavailable' } as Record<number,string>)[code], content: { 'application/json': { schema: ref('Error'), example: { error: { code: code === 409 ? 'UNFINISHED_ASSIGNMENTS' : 'REQUEST_FAILED', message: code === 409 ? 'Explicitly reassign or unassign all unfinished tasks before departure' : 'Request could not be completed' } } } } }]));
  for (const endpoint of endpoints) {
    const path = endpoint.path.replace(/:([A-Za-z]+)/g, '{$1}');
    const parameters: object[] = [...endpoint.path.matchAll(/:([A-Za-z]+)/g)].map(match => ({ in: 'path', name: match[1], required: true, schema: uuid }));
    if (endpoint.query) {
      const query = z.toJSONSchema(endpoint.query, { io: 'input' }) as { properties?: Record<string, unknown> };
      for (const [name, schema] of Object.entries(query.properties ?? {})) parameters.push({ in: 'query', name, schema, description: name === 'assigneeId' ? 'A member UUID or unassigned' : name === 'sort' ? 'Prefix with - for descending. Stable ID tie-breaker; null due dates follow PostgreSQL ordering.' : undefined });
    }
    const responseSchema = endpoint.query ? ref(endpoint.response) : envelope(ref(endpoint.response));
    const example = endpoint.query ? { data: endpoint.response === 'ProjectList' ? [projectExample] : endpoint.response === 'TaskList' ? [taskExample] : [], pagination: { page: 1, pageSize: 20, total: ['ProjectList', 'TaskList'].includes(endpoint.response) ? 1 : 0, totalPages: ['ProjectList', 'TaskList'].includes(endpoint.response) ? 1 : 0 } } : { data: examples[endpoint.response] };
    const bodySchema = endpoint.body ? z.toJSONSchema(endpoint.body, { io: 'input' }) : undefined;
    const bodyKeys = Object.keys((bodySchema as { properties?: object } | undefined)?.properties ?? {});
    const bodyExample = endpoint.example ?? (bodyKeys.includes('invitedUserId') ? { invitedUserId: '00000000-0000-4000-8000-000000000002' }
      : bodyKeys.includes('role') ? { role: 'LEAD' }
      : bodyKeys.includes('name') ? { name: 'Updated project name' }
      : bodyKeys.includes('title') ? { title: 'Updated task title' }
      : bodyKeys.includes('assigneeId') ? { assigneeId: '00000000-0000-4000-8000-000000000002' }
      : bodyKeys.includes('message') ? { message: 'I can help with the project' }
      : bodyKeys.includes('status') ? { status: endpoint.response === 'JoinRequest' ? 'APPROVED' : 'IN_PROGRESS' }
      : {});
    paths[path] ??= {};
    paths[path]![endpoint.method] = {
      summary: endpoint.summary, operationId: endpoint.method + endpoint.path.replace(/[^a-zA-Z]/g, '_'),
      tags: [endpoint.path.includes('tasks') ? 'Tasks' : endpoint.path.includes('invitations') ? 'Invitations' : endpoint.path.includes('join-requests') ? 'Join requests' : endpoint.path.includes('members') || endpoint.path.endsWith('leave') ? 'Members' : 'Projects'],
      parameters, ...(endpoint.body ? { requestBody: { required: bodyKeys.length > 0, content: { 'application/json': { schema: bodySchema, example: bodyExample } } } } : {}),
      responses: { [endpoint.status ?? 200]: { description: 'Success', content: { 'application/json': { schema: responseSchema, example } } }, ...errors },
    };
  }
  paths['/api/health'] = { get: { summary: 'Database readiness (public)', security: [], responses: { 200: { description: 'Ready', content: { 'application/json': { schema: envelope(object({ status: enumeration('ok') })) } } }, 503: errors[503] } } };
  paths['/api/dev/users'] = { get: { summary: 'Paginated fictional users; only registered when development identity is enabled', parameters: [{ in: 'query', name: 'page', schema: { type: 'integer', default: 1 } }, { in: 'query', name: 'pageSize', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } }, { in: 'query', name: 'sort', schema: enumeration('createdAt', '-createdAt'), description: 'Maps to name sorting because User has no createdAt' }], responses: { 200: { description: 'Users', content: { 'application/json': { schema: ref('UserList') } } }, ...errors } } };
  paths['/api/docs'] = { get: { summary: 'Interactive Swagger UI (public)', security: [], responses: { 200: { description: 'HTML documentation' } } } };
  paths['/api/openapi.json'] = { get: { summary: 'OpenAPI specification (public)', security: [], responses: { 200: { description: 'OpenAPI 3.1 JSON' } } } };
  return {
    openapi: '3.1.0', info: { title: 'Group 9 Project Management API', version: '1.0.0', description: 'Development identity is NOT authentication. Explicit NODE_ENV=development or test and DEV_IDENTITY_ENABLED=true are required. Never enable it for a public deployment. All dates are timezone-qualified ISO 8601 instants, stored as PostgreSQL timestamptz and returned in UTC. Lists are paginated (default 20, max 100). Subtasks count independently; no automatic parent roll-up. See README for the provisional permission matrix and membership-history policy.' },
    servers: [{ url: 'http://localhost:3000' }],
    security: [{ DevelopmentIdentity: [] }],
    components: { securitySchemes: { DevelopmentIdentity: { type: 'apiKey', in: 'header', name: 'X-Dev-User-Id', description: 'NOT authentication. Use a fictional seeded user UUID only in explicit development/test mode.' } }, schemas }, paths,
  };
}
