# Local verification after c1df042

Executed on 15 October 2026, Windows, Node.js 24.19.0, npm 11.17.0, PostgreSQL 17.6 and Prisma CLI/Client 6.19.3.

| Check | Actual result |
| --- | --- |
| Existing state | Started from `c1df042` with a clean working tree; no applicable AGENTS.md found |
| Docker/system PostgreSQL | CLI tools, standard installation directories and Windows services checked; neither available |
| `.env` preservation | No file initially existed; fallback exclusively created one. Subsequent starts and a stop/start cycle preserved its SHA-256 hash |
| Persistent development DB | `group9_dev` initialized under `.local-postgres/data`, listening only on `127.0.0.1:55432` |
| Prisma generation | `npm run db:generate` passed |
| Development migrations | All three migrations applied successfully with `npm run db:migrate` |
| Seed | `npm run db:seed` passed; four fictional users |
| Type checking | `npm run typecheck` passed after adding the migration-upgrade test |
| Build | `npm run build` passed |
| Documentation export | `npm run docs:export` passed |
| HTTP documentation | Swagger HTML, CSS, JavaScript bundle and OpenAPI JSON each returned 200 |
| HTTP readiness | `/api/health` returned 200 with `status: ok` |
| Main live workflow | `npm run demo` completed all nine HTTP requests with expected 201/200 responses; exact calls in `local-demo.http` |
| Main summary | Total 2, TODO 1, COMPLETED 1, 50% completion, 1 unassigned open task, no overdue tasks |
| Persistent data | Stopped and restarted only the development cluster, then retrieved the same project, task/subtask totals and B's completion attribution through the still-running backend |
| Live departure/history | `npm run demo:history` passed in a separate project: completed current assignment cleared, original contributor/recorder/time retained, former member received 403 |
| Regression suite | Final `npm run test:embedded` exited **0**: **26 passed, 0 failed, 0 skipped**, using separate `group9_test` at port 55439 |
| Existing-schema upgrade | Regression test applied the original two migrations in a separate test schema, inserted pre-upgrade data, applied the new migration, verified attribution/time backfill and re-deployed without duplicate history |
| Test cleanup | One intermediate run passed all assertions but encountered Windows EBUSY during folder removal. Bounded retries were added; final full runner and cleanup succeeded |
| Windows cross-account status | Persistent status/start commands also verified the actual database by SQL when pg_ctl could not inspect another account's process |
| Runtime import review | `node scripts/audit-runtime.cjs` created the built application, connected/querying PostgreSQL, and found no loaded Prisma CLI/config or deepmerge modules |
| Audit | Current npm audit still reports 3 high package entries from one deepmerge advisory; no forced upgrades or dependency changes |

The main live project is `60416386-a478-4997-a8aa-50eaa7d3083d`, parent task `5f3164de-d088-4519-a86d-b70af2a3d69b`, subtask `bfafbed8-95ec-427d-9725-c95228ce43d5`. Full responses are local and gitignored in `.local-postgres/demo-latest.json`.

The separate history demonstration project is `81e8b779-4ef8-4bea-a41e-e43643cd1b1b`; its completed task `d01e8c0c-12fa-4533-820b-b476dabe8741` still attributes contribution to B (`00000000-0000-4000-8000-000000000002`) after membership removal. Full responses are in `.local-postgres/history-demo.json`.

Remaining limits: no authentication; local processes are not automatic services; no full task-edit/assignment audit log; attribution erased before the new migration is unrecoverable; Docker Compose remains untested here. See [audit-review.md](audit-review.md) for risk assessment and compatible-fix options. No deployment, remote repository, paid service or billing change was made.
