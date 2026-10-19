# Run and demonstrate locally for free

Continuation of commit `c1df042`. No authentication, cloud database, deployment, paid API or billing change was added.

## Current local setup

Docker CLI, the usual Docker installation path, PostgreSQL CLI/system installation and PostgreSQL/Docker Windows services were checked and were unavailable. The fallback uses the already-installed pinned PostgreSQL 17.6 binaries, **not the test database**.

| Component | Location |
| --- | --- |
| API / Swagger | http://localhost:3000/api/docs/ |
| Health | http://127.0.0.1:3000/api/health |
| OpenAPI | http://127.0.0.1:3000/api/openapi.json |
| Persistent development database | `127.0.0.1:55432/group9_dev` |
| Development cluster files | `.local-postgres/data` |
| Local credentials (gitignored) | `.local-postgres/config.json` and `.env` |
| Backend logs | `.local-postgres/backend.stdout.log`, `.local-postgres/backend.stderr.log` |
| Separate disposable test database | `127.0.0.1:55439/group9_test` only during `test:embedded` |

There was **no `.env`** at the start of this continuation. The fallback created one using an exclusive create operation and a generated local password. Subsequent starts preserve its bytes and credentials. If a pre-existing `.env` targets a different database, the script refuses to replace it or redirect the application silently. No database cleanup command is included in the persistent runner.

The API was started as a hidden Windows background Node process, recorded in `.local-backend.json`. It remains running after the demonstration. The PostgreSQL cluster also runs in the background and retains data when stopped. Neither is installed as a Windows service or configured to start automatically after reboot.

## Start again after reboot

```powershell
npm ci                         # Only needed on a fresh checkout/dependency install.
npm run db:local:start          # Reuses existing cluster/data and preserves .env.
npm run db:generate
npm run db:migrate
npm run db:seed                 # Idempotent fictional-user seed.
npm run dev                    # Foreground server; Ctrl+C stops this process.
```

For a built server use `npm run build` then `npm start`. The server binds to loopback. Development identity requires explicit `NODE_ENV=development` and `DEV_IDENTITY_ENABLED=true`, already set in the generated `.env`. The header is impersonation for a local demo, **not authentication**.

To stop the background backend started during this session:

```powershell
powershell -NoProfile -File scripts/stop-local-backend.ps1
```

The stop script checks PID, process command and start time before stopping it. Start a foreground server afterward with `npm run dev`. Stop the development database separately with `npm run db:local:stop`; inspect it with `npm run db:local:status`. Stopping it retains all data. Avoid starting a second backend on port 3000.

## Demonstration

Run `npm run demo` against the running backend. It creates a **new** project on every run, preserves earlier projects, asserts expected responses, and writes full responses to `.local-postgres/demo-latest.json`. [local-demo.http](local-demo.http) contains the exact successful requests and generated resource IDs from the latest run. It can be read without any extension or paid tool. Replaying that file literally will reuse its old resource IDs; use `npm run demo` for a coherent fresh workflow.

Fictional identities:

| Actor | Name | `X-Dev-User-Id` |
| --- | --- | --- |
| A / project OWNER | Asha Rao | `00000000-0000-4000-8000-000000000001` |
| B / approved MEMBER | Bilal Khan | `00000000-0000-4000-8000-000000000002` |

The demo performs, over HTTP:

1. A creates a DISCOVERABLE project (`POST /api/projects`).
2. B requests to join (`POST /api/projects/{projectId}/join-requests`).
3. A approves (`PATCH .../join-requests/{requestId}`, `{"status":"APPROVED"}`).
4. A creates a parent task and a subtask using `parentTaskId` (`POST .../tasks`).
5. A assigns the parent to B (`PATCH .../tasks/{taskId}/assignee`, `{"assigneeId":"00000000-0000-4000-8000-000000000002"}`).
6. B changes status to IN_PROGRESS and then COMPLETED (`PATCH .../tasks/{taskId}/status`).
7. A retrieves the summary (`GET .../summary`).

The observed summary is **2 total tasks, 1 COMPLETED, 1 TODO, 50% completion, 1 unassigned open subtask and no overdue tasks**. Completing the parent does not complete the child. Both A and B have zero currently assigned open tasks. The completed parent's `completions` includes B as contributor and recorder.

To inspect existing demo data from PowerShell without creating more records:

```powershell
$demo = Get-Content .local-postgres/demo-latest.json -Raw | ConvertFrom-Json
$headers = @{ 'X-Dev-User-Id' = '00000000-0000-4000-8000-000000000001' }
Invoke-RestMethod -Headers $headers -Uri "$($demo.base)/projects/$($demo.projectId)/summary"
Invoke-RestMethod -Headers $headers -Uri "$($demo.base)/projects/$($demo.projectId)/tasks/$($demo.taskId)"
```

The README also supplies a full curl workflow, including subtask creation, and an independent invitation example.

## Contribution history

The original implementation cleared the sole completed-task assignee link on departure, losing contributor attribution. The new additive migration creates `TaskCompletion` records related to **User**, independently of current project membership. On each transition into COMPLETED, the transaction records the assignee as `contributorId`, the actor as `recordedById` and the completion time. Task read/list/update responses expose `completions`.

Departure still clears the current completed assignment to respect the existing membership FK, while history survives departure/removal, reassignment and reopening. Repeating COMPLETED does not duplicate events. Completing an unassigned task records a null contributor. Reopening and completing again adds a new historical event, but does not inflate task totals or progress calculations. Clients cannot edit history through request bodies.

Run `npm run demo:history` after the main demo to prove this through the running API using a separate project. It completes B's assigned work, removes B, verifies the OWNER still sees the original completion attribution, and verifies B now receives 403. Full responses are saved to `.local-postgres/history-demo.json`; the main demo project is unchanged.

Existing completed tasks are backfilled with their available assignee and completion time; the unknown legacy recorder remains null. **Attribution already erased before this migration cannot be recovered.** History records completion attribution rather than a full task-edit/assignment audit or verified authorship.

## Checks and limits

Current executed results are recorded in [local-verification.md](local-verification.md). The remaining npm findings, runtime-path assessment and compatible-fix options are detailed in [audit-review.md](audit-review.md). Docker Compose is still available but was not run on this machine. No dependency versions were changed for this continuation.
