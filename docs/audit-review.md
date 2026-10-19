# Review of the three npm audit findings

Reviewed on 15 October 2026. `npm audit --json` reports **3 high-severity package entries for one underlying advisory**, not three independent vulnerabilities:

| Package | Installed version | Why it is reported |
| --- | --- | --- |
| `deepmerge-ts` | 7.1.5 | Directly affected by GHSA-ggr8-5vv4-36mx / CVE-2026-40345 |
| `@prisma/config` | 6.19.3 | Pins the affected `deepmerge-ts` version |
| `prisma` | 6.19.3 | Depends on that configuration package |

The [upstream advisory](https://github.com/advisories/GHSA-ggr8-5vv4-36mx) describes stack exhaustion while merging specially constructed **cyclic JavaScript object graphs**. The patched dependency version is 8.0.0. Plain JSON does not create the cyclic references needed for this specific failure.

## Relevance to this backend

The vulnerable dependency is part of the Prisma CLI/configuration toolchain used for generating clients and applying migrations. The API services import the generated Prisma Client, not the Prisma CLI or configuration package, and do not call deepmerge on request bodies. Loading the built Express application and Prisma Client was checked for these modules. This supports the assessment that the documented HTTP request path does not exercise this advisory; it is not a claim that every possible future integration is safe.

The packages are nevertheless installed locally. Prisma Client declares an optional CLI peer dependency, so npm can retain/report the affected tooling graph even with `npm audit --omit=dev`. That flag is not proof of runtime exploitability, and it does not produce a clean report for this lockfile. Code that loads untrusted executable Prisma configuration or passes cyclic objects into this toolchain would need a separate review.

## Compatible fixes and choices

The registry check shows Prisma **6.19.3 is the newest published 6.19 patch**, and its configuration package still pins `deepmerge-ts` 7.1.5. There is no verified drop-in patch fix in that release line as of this review. The earlier Effect finding is already addressed by the existing Prisma 6.19.3 dependency on Effect 3.21.0.

Possible future actions:

- Adopt a matching Prisma CLI/Client 6 patch when upstream replaces the affected dependency, then regenerate, migrate and rerun the suite.
- Evaluate a scoped override to patched `deepmerge-ts` 8 in a separate branch. That is a **major transitive override**, not a demonstrated compatible patch; it needs CLI/configuration and migration compatibility checks before adoption.
- Keep CLI/migration tooling out of a future runtime artifact after generating the client. This narrows installed runtime dependencies but does not repair developer tooling. Verify the actual installed graph because of optional peers.

`npm audit fix --force` currently suggests Prisma 6.12.0, which is a **downgrade** outside this project's selected minor version. It was not applied. Neither a Prisma 7/8 migration nor a forced dependency override was performed. No dependencies changed during this continuation.

Recheck using:

```powershell
npm audit --json
npm audit --omit=dev --json
npm ls prisma @prisma/client @prisma/config deepmerge-ts
npm view prisma@6.19 version --json
npm view @prisma/config@6.19.3 dependencies --json
```
