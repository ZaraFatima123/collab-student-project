# Verification record

This is the historical record for baseline commit `c1df042`. See [the local runbook](local-run.md) for the later persistent development setup, live demonstration and contribution-history preservation, and [the updated audit review](audit-review.md).

Executed on 15 October 2026 in this Windows workspace with Node.js 24.19.0, npm 11.17.0, Prisma CLI/Client 6.19.3 and embedded PostgreSQL 17.6.

| Check | Result |
| --- | --- |
| `npm install --registry=https://registry.npmjs.org` | Passed; exact direct dependencies and npm lockfile generated, then refreshed for Prisma 6.19.3 |
| `npm run db:generate` | Passed with Prisma 6.19.3 |
| `npm run docs:export` | Passed; generated `docs/openapi.json` from the route declarations and Zod schemas |
| `npm run typecheck` | Passed, including source, tests, seed and documentation-export script |
| `npm run build` | Passed |
| `npm run test:embedded` | Passed: **24 tests, 24 passed, 0 failed, 0 skipped** |
| SQL migrations | Both migrations successfully applied to a new isolated PostgreSQL test database during the final test run |
| Seed function | Executed against the isolated test database in setup and before each integration test |
| Embedded runner cleanup | Passed after replacing Windows taskkill-based shutdown with PostgreSQL `pg_ctl`; final command exited 0 and removed its temporary database directory |
| Dependency audit | Remaining **3 high-severity package entries**, all from one `deepmerge-ts` advisory through `@prisma/config` and `prisma`; details below |

The 24 tests consist of 2 configuration/database-safety tests and 22 real HTTP/PostgreSQL integration tests. The final suite completed in approximately 16 seconds, excluding temporary-cluster initialization. Coverage is described in README and the test names.

Docker Compose was supplied but **not executed** because Docker is not installed in this environment. The separately installed PostgreSQL setup and standalone development-server startup were not exercised here. Database-backed Supertest tests exercised the same Express application and services. PostgreSQL test data was temporary; no development or production database was changed. No remote repository or deployment was created.

## Dependency audit limitation

Prisma was updated from 6.19.0 to compatible patch 6.19.3 to remove the reported Effect dependency advisory. The installed Prisma CLI still pins `deepmerge-ts` 7.1.5. npm reports [GHSA-ggr8-5vv4-36mx](https://github.com/advisories/GHSA-ggr8-5vv4-36mx), involving stack exhaustion when merging recursive object graphs, on that package and its two dependent packages. The CLI is declared as development tooling, but Prisma Client's optional CLI peer means `npm audit --omit=dev` also reports these three entries in this installed tree. No clean audit is claimed. A forced major dependency override or downgrade was not applied. Revisit the compatible Prisma 6 patch/tooling dependencies before a production release.

## Provisional decisions

- Development identity is deliberately impersonation, never authentication, and requires an explicit permitted environment. The server binds only to loopback.
- Archiving is permanent. Completed projects can be reopened by OWNER/LEAD. Completion does not require all tasks to be complete.
- Each task/subtask counts independently; parent completion is never inferred from children.
- Unfinished assignments block departure. Completed assignment links are cleared and reported during departure; no assignment-history/audit model exists yet.
- Discovery includes the project description as public metadata, but excludes creators, membership and tasks.
- Per-project write serialization favors understandable, correct student-scale behavior over maximum write throughput. Summary aggregation currently loads minimal task rows into memory.
- Expired invitations retain PENDING in historical listings until replacement or membership resolution; expiry is always enforced when accepting.
