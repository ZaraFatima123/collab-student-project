# Group 9 Project Management backend

A modular monolith for the Collaborative Student Project Management System. Express 5.1, TypeScript 5.9, PostgreSQL 17, Prisma 6.19 and Zod 4.1. Exact dependency versions and `package-lock.json` are included. Requires Node.js **22.12+** (Node 24 recommended).

This phase implements projects, membership, invitations, join requests, tasks/subtasks, assignment, progress and workload. No login, public user creation, AI, uploads, chat or external services.

## Install and start

```powershell
npm ci
if (!(Test-Path .env)) { Copy-Item .env.example .env }
docker compose up -d --wait db
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

On macOS/Linux, use `test -e .env || cp .env.example .env` to preserve existing configuration. If npm 11 reports blocked lifecycle scripts, approve the installed pinned Prisma, Prisma engines, esbuild and platform-specific embedded-postgres packages using your npm script-approval settings, then run `npm run db:generate`. The application itself does not need the embedded binaries when using Docker/system PostgreSQL.

**No Docker or system PostgreSQL?** Use `npm run db:local:start` before the generate/migrate/seed/start commands. This free persistent setup uses the already-installed PostgreSQL 17.6 binaries, stores development data under `.local-postgres/data`, and listens on `127.0.0.1:55432` with database `group9_dev`. It creates `.env` only if absent; an existing file is never overwritten. Use `npm run db:local:stop` to stop the database without deleting data, and `npm run db:local:status` to inspect it. This is separate from the disposable test runner at port 55439. See [the local runbook](docs/local-run.md) for the live demonstration, exact requests, stopping the current background backend and verification results.

The server binds to loopback `127.0.0.1`. Open **http://localhost:3000/api/docs** for Swagger UI; **http://localhost:3000/api/openapi.json** serves OpenAPI 3.1. A checked-in copy is [docs/openapi.json](docs/openapi.json). Regenerate it with `npm run docs:export` after API changes. Health/readiness: `GET /api/health` checks the database.

```powershell
npm run typecheck
npm run build
npm start
```

`npm start` also reads `.env`; building does not enable production identity. To run in production later, replace the identity adapter first. With development identity disabled, domain endpoints return `503 IDENTITY_UNAVAILABLE`. Health and documentation remain public.

## Existing PostgreSQL installation

Use PostgreSQL 17 and create a dedicated local role/database from `psql` as an administrator:

```sql
CREATE ROLE group9 LOGIN PASSWORD 'group9_local';
CREATE DATABASE group9 OWNER group9;
CREATE DATABASE group9_test OWNER group9;
```

Set `DATABASE_URL=postgresql://group9:group9_local@localhost:5432/group9?schema=public` in `.env`, then run generate, migrate and seed as above. URL-encode special characters in credentials. The application role needs ownership of its own schema for migrations, not superuser privileges. For a separately installed server, set `TEST_DATABASE_URL` to port 5432 instead of the Docker test port 5433. Never share application and test databases.

Migrations are committed SQL and applied with `prisma migrate deploy`; seeding is explicit and idempotent. New migrations can be created with Prisma 6 `migrate dev` on a developer-owned database. Custom partial indexes and CHECK constraints live in the integrity migration and must be preserved. No automatic schema reset occurs at application startup. Compose stores development data in a named volume; the test service uses temporary storage.

## Development identity is not authentication

Both `NODE_ENV=development` (or `test`) and `DEV_IDENTITY_ENABLED=true` are required. The default environment is production and the adapter defaults to disabled. Startup fails if the adapter is enabled in production or the environment value is unsupported.

Every domain request supplies `X-Dev-User-Id`. Missing, malformed or unknown IDs return `401` with a clear code. This header lets anyone impersonate a seeded user: use it only in local development, never as access protection for a public server. CORS allows only `FRONTEND_ORIGIN` (default `http://localhost:5173`) and the required headers; CORS itself is not authentication.

| User | Seed ID |
| --- | --- |
| Asha Rao (A) | `00000000-0000-4000-8000-000000000001` |
| Bilal Khan (B) | `00000000-0000-4000-8000-000000000002` |
| Cara Sen (C) | `00000000-0000-4000-8000-000000000003` |
| Dev Patel (D) | `00000000-0000-4000-8000-000000000004` |

All emails are fictional `example.test` addresses. `GET /api/dev/users` lists users with pagination and requires a valid development header. This route is registered only when the adapter is enabled. No user-creation API exists. Seeding refuses to run outside explicit development/test mode.

Real authentication connects at [src/middleware/identity.ts](src/middleware/identity.ts): replace the development adapter with a middleware that verifies credentials, resolves the corresponding database User, and sets `req.currentUser` with `{ id, name, email }`. Replace the adapter mounting in `src/app.ts`, remove the development user directory, and keep service authorization checks. Routes derive the actor from this object. Request bodies cannot supply creator/reviewer/acting user IDs. No passwords, tokens or login routes exist in this phase.

## Provisional permissions

All checks run on the backend. An invitation alone does not grant access.

| Action | OWNER | LEAD | MEMBER | Nonmember |
| --- | --- | --- | --- | --- |
| Create project | Yes | Yes | Yes | Any resolved development user |
| Read details, tasks, members, summary | Yes | Yes | Yes | No |
| Edit project; complete/reopen it | Yes | Yes | No | No |
| Archive project | Yes | No | No | No |
| Invite/revoke; list project invitations | Yes | Yes | No | No |
| Review/list project join requests | Yes | Yes | No | No |
| Change MEMBER/LEAD roles | Yes | No | No | No |
| Remove MEMBER | Yes | Yes | No | No |
| Remove LEAD | Yes | No | No | No |
| Remove/change OWNER | No | No | No | No |
| Create/edit/assign tasks | Yes | Yes | No | No |
| Change task status | Any task | Any task | Own assigned tasks | No |
| Leave with no unfinished assigned tasks | No | Yes | Yes | No |
| Discover limited public metadata | Yes | Yes | Yes | Any resolved development user |
| Request join | Already member: conflict | Already member: conflict | Already member: conflict | Active discoverable projects only |
| Accept/decline invitation | Only invited user | Only invited user | Only invited user | Only invited user |
| Cancel join request | Only applicant | Only applicant | Only applicant | Only applicant |

Archived projects remain readable but **every project mutation is blocked**, including invitation responses and join cancellation. Archiving is permanent in this phase. Completed projects reject task changes until OWNER/LEAD changes project status to ACTIVE. Membership and invitation administration remain permitted on completed projects; new join requests require ACTIVE status. Completing a project does not require all tasks to be completed.

Removal/leave conflicts if **any** assigned task is not COMPLETED, including subtasks. Managers must explicitly reassign or unassign such tasks first. Completed current assignments are cleared as part of departure to preserve the current-membership foreign key; the departure response reports `clearedCompletedAssignments`. Historical contribution attribution is retained in immutable-via-API `TaskCompletion` records tied to User, independently of membership. Each completion snapshots the assignee (`contributorId`), status-change actor (`recordedById`) and time. Task responses expose `completions`; reopening and reassignment do not erase them, and repeated COMPLETED requests do not duplicate an event. This is completion history, not a full assignment-change audit log. This membership cleanup is allowed on completed projects; archived projects remain immutable.

## API routes

All paths begin with `/api`. Domain responses use `{ "data": ... }`. Lists add `pagination: { page, pageSize, total, totalPages }`. Failures use `{ "error": { "code", "message", "details"? } }`. Creation returns 201; reads/updates/actions return 200; validation 400; missing/unknown identity 401; denied permission 403; absent/scoped resource 404; conflicting state 409; oversized JSON 413; unexpected failure 500; unavailable identity/database 503. No stack traces or database internals are returned.

| Method | Path | Purpose |
| --- | --- | --- |
| POST / GET | `/projects` | Create project / list my projects |
| GET | `/projects/discover` | Discover active public projects |
| GET / PATCH | `/projects/:projectId` | Read / edit or complete/reopen |
| POST | `/projects/:projectId/archive` | Archive permanently |
| GET | `/projects/:projectId/summary` | Progress and workload |
| GET | `/projects/:projectId/members` | List members |
| PATCH / DELETE | `/projects/:projectId/members/:userId` | Change role / remove |
| POST | `/projects/:projectId/leave` | Leave project |
| POST / GET | `/projects/:projectId/invitations` | Invite / list project invitations |
| GET | `/me/invitations` | Invitations addressed to me |
| POST | `/invitations/:invitationId/accept` | Accept |
| POST | `/invitations/:invitationId/decline` | Decline |
| POST | `/projects/:projectId/invitations/:invitationId/revoke` | Revoke |
| POST / GET | `/projects/:projectId/join-requests` | Apply / list requests |
| GET | `/me/join-requests` | My requests |
| PATCH | `/projects/:projectId/join-requests/:requestId` | Approve/reject |
| POST | `/projects/:projectId/join-requests/:requestId/cancel` | Cancel |
| POST / GET | `/projects/:projectId/tasks` | Create / list tasks |
| GET / PATCH | `/projects/:projectId/tasks/:taskId` | Read / edit details or parent |
| PATCH | `/projects/:projectId/tasks/:taskId/assignee` | Assign/reassign/unassign |
| PATCH | `/projects/:projectId/tasks/:taskId/status` | Change status |
| GET | `/dev/users` | Development user directory |
| GET | `/health`, `/docs`, `/openapi.json` | Readiness and documentation |

All lists accept `page` (1–100000) and `pageSize` (1–100, default 20). `sort=createdAt` or `sort=-createdAt` (default) uses a stable ID tie-breaker. Members map this key to `joinedAt`; development users map it to `name`. Task lists additionally support `sort=title`, `-title`, `dueDate`, `-dueDate`; null due dates sort last ascending and first descending. Task filters: `status=TODO|IN_PROGRESS|IN_REVIEW|COMPLETED`, `priority=LOW|MEDIUM|HIGH`, `assigneeId=<uuid>|unassigned`. Unknown body/query fields are rejected. Offset pagination describes a snapshot per request; items can move between pages across later requests as data changes.

Discovery exposes only ID, name, description, visibility, status, dates and creation time for DISCOVERABLE ACTIVE projects. The **description is public metadata**: authors should not put confidential details there. Discovery never includes creator IDs, membership lists, tasks or internal timestamps. My-project listing includes only memberships, even after completion/archive.

## Data and consistency

```mermaid
erDiagram
  User ||--o{ Project : creates
  User ||--o{ ProjectMember : joins
  Project ||--|{ ProjectMember : has
  Project ||--o{ ProjectInvitation : has
  User ||--o{ ProjectInvitation : receives_or_sends
  Project ||--o{ JoinRequest : has
  User ||--o{ JoinRequest : applies_or_reviews
  Project ||--o{ Task : contains
  ProjectMember o|--o{ Task : assigned
  User ||--o{ Task : creates
  Task o|--o{ Task : parent_of
  Task ||--o{ TaskCompletion : completion_history
  User o|--o{ TaskCompletion : contributor_or_recorder
```

UUID primary keys, foreign keys, indexes and timezone-aware timestamps are defined in `prisma/schema.prisma`. Composite foreign keys enforce that assignees are current project members and parents belong to the task's project. SQL CHECK constraints enforce project date ranges, no self-parent, and completedAt/status consistency. Partial unique indexes enforce one OWNER and one PENDING invitation/request per project/user pair. Longer task cycles are checked in the service while holding the project lock.

Every project mutation acquires its project's PostgreSQL row lock inside a Read Committed transaction **before** reading permissions/state. This serializes writes within a project across API processes, including approval vs acceptance, role changes, archive vs edits, parenting, and departure vs assignment. Different projects can be modified independently. Read endpoints use Repeatable Read transactions so list/count and summary calculations agree. The database must be written through these services for permissions and longer-cycle checks to hold; direct SQL administrators are outside API authorization.

Membership creation and pending-record resolution are atomic: a valid pending invitation becomes ACCEPTED; expired pending invitations become REVOKED; pending join requests become APPROVED with reviewer/time. For invitation acceptance, reviewedById is the invited user completing that membership action. Repeated/concurrent responses return 409 after the first success. Invitations expire after seven days by default. Expired PENDING records cannot be accepted; creation of a replacement revokes expired pending invitations before inserting the new one. Expiry is checked at response time, so a background worker is unnecessary. Invitation lists retain historical statuses and `expiresAt` so the frontend can label expired PENDING records.

Use ISO 8601 timestamps with `Z` or an explicit offset (for example `2026-11-01T09:00:00+05:30`). Date-only and timezone-less inputs are rejected. PostgreSQL stores instants as `timestamptz(3)`; API timestamps are UTC. Due dates are exact instants, not automatic local end-of-day deadlines. Nullable dates/assignee/parent can be cleared using JSON `null`. Project dueDate cannot precede startDate, including when only one date is patched.

The third migration backfills a completion event for each existing completed task, preserving its available assignee/time. The original status-change actor is unknown and remains null. Attribution already erased by a departure before this upgrade cannot be reconstructed. Unassigned completions have a null contributor. Completion history records the assignee at completion, not independently verified authorship, and does not alter progress totals or current-member workload.

Task status changes set completedAt on first completion, preserve it on repeated completion, and clear it when status leaves COMPLETED. All four statuses can transition to one another; there is no dependency workflow in this phase. Parents and subtasks progress independently. Every task and subtask counts **once** in summary totals. Open means anything except COMPLETED. Completion percentage is completed / total × 100, rounded to two decimals; an empty project is 0%. Overdue means open with dueDate earlier than countedAt. Workload includes every current member, including zero-work members, and `unassignedOpenTasks` is separate. The summary currently loads task status/assignee/date rows in memory, appropriate for student-scale projects; aggregation can move into SQL if datasets grow.

## Complete curl workflow

These commands use Bash (Git Bash/WSL/macOS/Linux) and `jq` to capture generated IDs. In Windows PowerShell use `curl.exe` instead of its historical `curl` alias, or run this block in Git Bash. The development server and seed must already be running.

```bash
BASE=http://localhost:3000/api
A=00000000-0000-4000-8000-000000000001
B=00000000-0000-4000-8000-000000000002

# A creates a discoverable project; the transaction makes A its OWNER.
PROJECT=$(curl -fsS "$BASE/projects" -H "X-Dev-User-Id: $A" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Group 9 capstone","visibility":"DISCOVERABLE"}' | jq -r '.data.id')

# B discovers it and requests membership.
curl -fsS "$BASE/projects/discover" -H "X-Dev-User-Id: $B"
JOIN=$(curl -fsS "$BASE/projects/$PROJECT/join-requests" \
  -H "X-Dev-User-Id: $B" -H 'Content-Type: application/json' \
  -d '{"message":"I can build the task UI"}' | jq -r '.data.id')

# A approves B's request.
curl -fsS -X PATCH "$BASE/projects/$PROJECT/join-requests/$JOIN" \
  -H "X-Dev-User-Id: $A" -H 'Content-Type: application/json' \
  -d '{"status":"APPROVED"}'

# A creates work, then explicitly assigns it to B.
TASK=$(curl -fsS "$BASE/projects/$PROJECT/tasks" \
  -H "X-Dev-User-Id: $A" -H 'Content-Type: application/json' \
  -d '{"title":"Build task list UI","priority":"HIGH"}' | jq -r '.data.id')
SUBTASK=$(curl -fsS "$BASE/projects/$PROJECT/tasks" \
  -H "X-Dev-User-Id: $A" -H 'Content-Type: application/json' \
  -d "{\"title\":\"Design status controls\",\"parentTaskId\":\"$TASK\"}" | jq -r '.data.id')
curl -fsS -X PATCH "$BASE/projects/$PROJECT/tasks/$TASK/assignee" \
  -H "X-Dev-User-Id: $A" -H 'Content-Type: application/json' \
  -d "{\"assigneeId\":\"$B\"}"

# B starts and finishes their assigned task.
curl -fsS -X PATCH "$BASE/projects/$PROJECT/tasks/$TASK/status" \
  -H "X-Dev-User-Id: $B" -H 'Content-Type: application/json' \
  -d '{"status":"IN_PROGRESS"}'
curl -fsS -X PATCH "$BASE/projects/$PROJECT/tasks/$TASK/status" \
  -H "X-Dev-User-Id: $B" -H 'Content-Type: application/json' \
  -d '{"status":"COMPLETED"}'

# A views progress: totalTasks=2, COMPLETED=1, completionPercentage=50.
curl -fsS "$BASE/projects/$PROJECT/summary" -H "X-Dev-User-Id: $A"
```

Separate invitation workflow, using a new private project and user C:

```bash
C=00000000-0000-4000-8000-000000000003
PRIVATE=$(curl -fsS "$BASE/projects" -H "X-Dev-User-Id: $A" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Private study project","visibility":"PRIVATE"}' | jq -r '.data.id')
INVITE=$(curl -fsS "$BASE/projects/$PRIVATE/invitations" \
  -H "X-Dev-User-Id: $A" -H 'Content-Type: application/json' \
  -d "{\"invitedUserId\":\"$C\"}" | jq -r '.data.id')
curl -fsS "$BASE/me/invitations" -H "X-Dev-User-Id: $C"
curl -fsS -X POST "$BASE/invitations/$INVITE/accept" \
  -H "X-Dev-User-Id: $C" -H 'Content-Type: application/json' -d '{}'
curl -fsS "$BASE/projects/$PRIVATE" -H "X-Dev-User-Id: $C"
```

## Tests

Use either a dedicated Docker/local PostgreSQL instance or the embedded runner. Tests **require** `TEST_DATABASE_URL`, a loopback server, and a database name ending in `_test`. They reject a URL targeting the same host/port/database as `DATABASE_URL`, regardless of credentials/schema. Tests migrate the test database, truncate its module tables between cases, reseed fictional users, and exercise the real Express API and PostgreSQL through Supertest. Never point the test configuration at a database with valuable data, even if its name ends in `_test`.

```powershell
docker compose --profile test up -d --wait test-db
npm test
```

`.env` provides the test URL from `.env.example`. Alternatively, set `TEST_DATABASE_URL` explicitly in the shell. `npm run test:integration` runs only database integration tests. No in-memory database mocks are used.

If Docker/PostgreSQL is unavailable:

```powershell
npm run test:embedded
```

This starts the pinned embedded PostgreSQL 17.6 binaries on loopback port **55439**, creates a unique temporary workspace directory and test database, runs migrations plus the entire suite, stops PostgreSQL and removes its temporary data. Port 55439 must be free. It does not install a system service or create an OS user. PostgreSQL binaries may require local execution permission; on Linux run as an ordinary user (PostgreSQL refuses root). The optional embedded runner is development tooling only.

Coverage includes atomic project/OWNER creation, strict input, development identity, discovery privacy, role escalation, invitation wrong-user/expiry/duplicate cases, concurrent acceptance/approval, nested resource scope, database FKs/CHECKs, cyclic subtasks (including concurrency), assignment/departure races, completed/archive restrictions, completion history across departure/reassignment/reopening, migration backfill from the original schema, pagination/filtering, and exact summary/workload calculations. See [the local runbook](docs/local-run.md) for current checks, [the baseline verification record](docs/verification.md) for the original commit, and [the dependency audit review](docs/audit-review.md) for the remaining findings.

## Code map and version references

- `src/api.ts`: route declarations, validation and thin controller adapter; same declarations generate OpenAPI paths.
- `src/services/`: business policies and transactional database operations.
- `src/middleware/identity.ts`: isolated currentUser adapter.
- `src/validation.ts`, `config.ts`, `errors.ts`: strict schemas, environment validation and consistent errors.
- `prisma/`: schema, reproducible SQL migrations and seed.
- `tests/`: real API/database integration tests and environment guards.

Configuration and APIs were checked against the official [Prisma 6 generator reference](https://www.prisma.io/docs/orm/v6/prisma-schema/overview/generators), [Prisma 6 CLI reference](https://www.prisma.io/docs/orm/v6/reference/prisma-cli-reference), [Express 5 async error handling](https://expressjs.com/en/5x/guide/error-handling/), [Zod 4 API](https://zod.dev/api), and [PostgreSQL 17 locking reference](https://www.postgresql.org/docs/17/explicit-locking.html). Prisma 6 uses schema datasource URLs and `prisma-client-js`; do not copy Prisma 7 configuration into this project. The optional test runner follows the [embedded-postgres package API](https://github.com/leinelissen/embedded-postgres).
