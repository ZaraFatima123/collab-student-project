import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, copyFile, rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { testDatabaseUrl } from './test-database';
import { seed, seedUsers } from '../prisma/seed';

test('upgrade from c1df042 backfills completed-task attribution without losing existing data', async () => {
  const schema = 'history_upgrade_' + randomUUID().replaceAll('-', '');
  const url = new URL(testDatabaseUrl());
  url.searchParams.set('schema', schema);
  const folder = await mkdtemp(resolve('.test-migrations-'));
  const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  const admin = new PrismaClient({ datasources: { db: { url: testDatabaseUrl() } } });
  function deploy(schemaPath: string) {
    execFileSync(process.execPath, [resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', schemaPath], { env: { ...process.env, DATABASE_URL: url.toString() }, stdio: 'pipe' });
  }
  try {
    // Reproduce the two original migrations in an isolated test-only schema.
    await copyFile('prisma/schema.prisma', resolve(folder, 'schema.prisma'));
    for (const name of ['20261015000100_initial', '20261015000200_integrity']) await cp(resolve('prisma/migrations', name), resolve(folder, 'migrations', name), { recursive: true });
    await copyFile('prisma/migrations/migration_lock.toml', resolve(folder, 'migrations/migration_lock.toml'));
    deploy(resolve(folder, 'schema.prisma'));
    await seed(db);
    const owner = seedUsers[0]!.id, contributor = seedUsers[1]!.id;
    const project = await db.project.create({ data: { name: 'Existing project', creatorId: owner, members: { create: [{ userId: owner, role: 'OWNER' }, { userId: contributor }] } } });
    const completedAt = new Date('2026-01-02T03:04:05Z');
    const task = await db.task.create({ data: { projectId: project.id, title: 'Previously completed', createdById: owner, assigneeId: contributor, status: 'COMPLETED', completedAt } });
    deploy(resolve('prisma/schema.prisma'));
    const upgraded = await db.task.findUniqueOrThrow({ where: { id: task.id }, include: { completions: true } });
    assert.equal(upgraded.assigneeId, contributor);
    assert.equal(upgraded.completions.length, 1);
    assert.equal(upgraded.completions[0]!.contributorId, contributor);
    assert.equal(upgraded.completions[0]!.recordedById, null); // legacy actor unknown
    assert.equal(upgraded.completions[0]!.completedAt.toISOString(), completedAt.toISOString());
    // Reapplying deploy must not duplicate backfill events.
    deploy(resolve('prisma/schema.prisma'));
    assert.equal(await db.taskCompletion.count(), 1);
    assert.equal(await db.project.count(), 1);
  } finally {
    await db.$disconnect();
    if (!/^history_upgrade_[a-f0-9]{32}$/.test(schema)) throw new Error('Unexpected test schema');
    try { await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); }
    finally { await admin.$disconnect(); }
    if (!resolve(folder).startsWith(resolve('.') + sep + '.test-migrations-')) throw new Error('Unexpected temporary migration directory');
    await rm(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
