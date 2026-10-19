import 'dotenv/config';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

if (process.env.NODE_ENV !== 'development' || process.env.DEV_IDENTITY_ENABLED !== 'true') throw new Error('Run only in local development mode.');
const { base, users: { A, B } } = JSON.parse(await readFile('.local-postgres/demo-latest.json', 'utf8'));
if (new URL(base).hostname !== '127.0.0.1') throw new Error('Only the loopback demo is permitted');
const transcript = [];
async function call(method, path, user, body, expected = 200) {
  const headers = { 'X-Dev-User-Id': user, ...(body ? { 'Content-Type': 'application/json' } : {}) };
  const response = await fetch(base + path, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
  const json = await response.json();
  transcript.push({ method, path, user, body, status: response.status, response: json });
  assert.equal(response.status, expected, JSON.stringify(json));
  return json.data;
}
// Separate project: the main demonstration project is preserved unchanged.
const project = await call('POST', '/projects', A, { name: 'Contribution history preservation demo', visibility: 'DISCOVERABLE' }, 201);
const path = `/projects/${project.id}`;
const join = await call('POST', `${path}/join-requests`, B, {}, 201);
await call('PATCH', `${path}/join-requests/${join.id}`, A, { status: 'APPROVED' });
const task = await call('POST', `${path}/tasks`, A, { title: 'Bilal completed this contribution', assigneeId: B }, 201);
const completed = await call('PATCH', `${path}/tasks/${task.id}/status`, B, { status: 'COMPLETED' });
const departure = await call('DELETE', `${path}/members/${B}`, A);
assert.equal(departure.clearedCompletedAssignments, 1);
const retained = await call('GET', `${path}/tasks/${task.id}`, A);
assert.equal(retained.assigneeId, null);
assert.deepEqual(retained.completions, completed.completions);
assert.equal(retained.completions[0].contributorId, B);
await call('GET', `${path}/tasks/${task.id}`, B, undefined, 403);
await writeFile('.local-postgres/history-demo.json', JSON.stringify({ projectId: project.id, taskId: task.id, departure, retained, transcript }, null, 2) + '\n');
console.log(JSON.stringify({ projectId: project.id, taskId: task.id, departure, retainedContributor: retained.completions[0].contributorId, recordedBy: retained.completions[0].recordedById, completedAt: retained.completions[0].completedAt, departedUserAccess: 403 }, null, 2));
