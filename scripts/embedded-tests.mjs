import EmbeddedPostgres from 'embedded-postgres';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';

// Unique workspace-local data directory; teardown never targets an external DB.
const databaseDir = await mkdtemp(resolve('.test-postgres-'));
const port = 55439;
const pg = new EmbeddedPostgres({ databaseDir, port, user: 'group9', password: 'test_only', persistent: true, initdbFlags: ['--encoding=UTF8', '--locale=C'], onLog: () => {} });
const platform = process.platform === 'win32' ? 'windows' : process.platform;
const { pg_ctl } = await import(`@embedded-postgres/${platform}-${process.arch}`);
const execute = promisify(execFile);
let started = false;
try {
  await pg.initialise();
  // pg_ctl provides graceful, bounded shutdown on Windows as well as Unix.
  await execute(pg_ctl, ['start', '-D', databaseDir, '-l', resolve(databaseDir, 'postgres.log'), '-o', `-p ${port} -h 127.0.0.1`, '-w', '-t', '20'], { windowsHide: true, timeout: 30000 });
  started = true;
  const client = pg.getPgClient('postgres', '127.0.0.1');
  await client.connect();
  try { await client.query('CREATE DATABASE group9_test'); }
  finally { await client.end(); }
  const env = { ...process.env, TEST_DATABASE_URL: `postgresql://group9:test_only@127.0.0.1:${port}/group9_test?schema=public` };
  const child = spawn(process.execPath, ['--import', 'tsx', '--test', '--test-concurrency=1', 'tests/config.test.ts', 'tests/integration.test.ts'], { env, stdio: 'inherit' });
  process.exitCode = await new Promise((resolveExit, reject) => { child.once('error', reject); child.once('exit', code => resolveExit(code ?? 1)); });
} finally {
  if (started) await execute(pg_ctl, ['stop', '-D', databaseDir, '-m', 'fast', '-w', '-t', '20'], { windowsHide: true, timeout: 30000 });
  // Verify the resolved temporary directory before recursive removal on Windows.
  const target = resolve(databaseDir);
  if (!target.startsWith(resolve('.') + '\\' + '.test-postgres-') && !target.startsWith(resolve('.') + '/' + '.test-postgres-')) throw new Error('Unexpected temporary database path');
  await rm(target, { recursive: true, force: true });
}
