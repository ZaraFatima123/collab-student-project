import 'dotenv/config';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

if (process.env.NODE_ENV !== 'development' || process.env.DEV_IDENTITY_ENABLED !== 'true') throw new Error('Run the demo only in explicit local development mode.');
const base = `http://127.0.0.1:${Number(process.env.PORT ?? 3000)}/api`;
const A = '00000000-0000-4000-8000-000000000001'; // Asha Rao, OWNER
const B = '00000000-0000-4000-8000-000000000002'; // Bilal Khan, MEMBER
const requests = [];
async function call(label, method, path, user, body, expected = 200) {
  const headers = { 'X-Dev-User-Id': user, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) };
  const response = await fetch(base + path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const json = await response.json();
  requests.push({ label, method, url: base + path, headers, body, status: response.status, response: json });
  assert.equal(response.status, expected, `${label}: ${JSON.stringify(json)}`);
  console.log(`${response.status} ${label}`);
  return json.data;
}

const project = await call('A creates a discoverable project', 'POST', '/projects', A, { name: 'Group 9 persistent local demo', visibility: 'DISCOVERABLE', description: 'Fictional demonstration data stored only on this computer.' }, 201);
const path = `/projects/${project.id}`;
const join = await call('B requests to join', 'POST', `${path}/join-requests`, B, { message: 'I can implement the task screen.' }, 201);
await call('A approves membership', 'PATCH', `${path}/join-requests/${join.id}`, A, { status: 'APPROVED' });
const task = await call('A creates a task', 'POST', `${path}/tasks`, A, { title: 'Build task screen', priority: 'HIGH' }, 201);
const subtask = await call('A creates a subtask', 'POST', `${path}/tasks`, A, { title: 'Design task status controls', parentTaskId: task.id }, 201);
await call('A assigns the parent task to B', 'PATCH', `${path}/tasks/${task.id}/assignee`, A, { assigneeId: B });
await call('B starts the assigned task', 'PATCH', `${path}/tasks/${task.id}/status`, B, { status: 'IN_PROGRESS' });
const completed = await call('B completes the assigned task', 'PATCH', `${path}/tasks/${task.id}/status`, B, { status: 'COMPLETED' });
assert.equal(completed.completions[0].contributorId, B);
const summary = await call('A retrieves the summary', 'GET', `${path}/summary`, A);
assert.equal(summary.totalTasks, 2);
assert.equal(summary.countsByStatus.COMPLETED, 1);
assert.equal(summary.countsByStatus.TODO, 1);
assert.equal(summary.completionPercentage, 50);
assert.equal(summary.unassignedOpenTasks, 1);

const result = { base, users: { A, B }, projectId: project.id, requestId: join.id, taskId: task.id, subtaskId: subtask.id, summary, verifiedAt: new Date().toISOString(), requests };
await writeFile('.local-postgres/demo-latest.json', JSON.stringify(result, null, 2) + '\n');
const http = requests.map(r => `### ${r.label} (observed HTTP ${r.status})\n${r.method} ${r.url}\n${Object.entries(r.headers).map(([k,v]) => `${k}: ${v}`).join('\n')}\n${r.body === undefined ? '' : '\n' + JSON.stringify(r.body, null, 2) + '\n'}`).join('\n');
await writeFile('docs/local-demo.http', '# Exact requests from the successful local demonstration.\n# Replays create new resources: use npm run demo to capture fresh IDs for a complete workflow.\n\n' + http);
console.log(JSON.stringify({ projectId: project.id, taskId: task.id, subtaskId: subtask.id, summary }, null, 2));
console.log('Saved exact requests to docs/local-demo.http and full responses to .local-postgres/demo-latest.json.');
