import EmbeddedPostgres from 'embedded-postgres';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { parse } from 'dotenv';

// Persistent DEVELOPMENT cluster. Never shares the test runner's directory,
// database or port, and never removes data or overwrites an existing .env.
const root = resolve('.local-postgres');
const data = resolve(root, 'data');
const configPath = resolve(root, 'config.json');
const action = process.argv[2] ?? 'status';
if (!['start', 'stop', 'status'].includes(action)) throw new Error('Usage: node scripts/local-db.mjs start|stop|status');
const platform = process.platform === 'win32' ? 'windows' : process.platform;
const { pg_ctl } = await import(`@embedded-postgres/${platform}-${process.arch}`);
const execute = promisify(execFile);
const exists = async path => access(path).then(() => true, () => false);

async function isRunning() {
  try {
    const result = await execute(pg_ctl, ['status', '-D', data], { windowsHide: true });
    return result.stdout;
  } catch (error) {
    if (![3, 4].includes(error.code)) throw error;
    // Windows may deny pg_ctl's process inspection across user accounts even
    // while the cluster accepts SQL connections. Check the actual cluster.
    if (!await exists(configPath)) return null;
    const config = JSON.parse(await readFile(configPath, 'utf8'));
    if (config.port !== 55432 || config.database !== 'group9_dev') throw new Error('Unexpected local PostgreSQL configuration');
    const probe = new EmbeddedPostgres({ databaseDir: data, ...config, persistent: true, onError: () => {} }).getPgClient('postgres', '127.0.0.1');
    try {
      await probe.connect();
      const result = await probe.query("SELECT current_setting('data_directory') AS directory");
      if (resolve(result.rows[0].directory).toLowerCase() !== data.toLowerCase()) throw new Error('Port 55432 belongs to a different PostgreSQL data directory');
      return `Persistent PostgreSQL is running at 127.0.0.1:${config.port}/${config.database} (verified by SQL).`;
    } catch (connectionError) {
      if (connectionError.code === 'ECONNREFUSED') return null;
      throw connectionError;
    } finally { await probe.end(); }
  }
}

if (action === 'status') {
  console.log(await isRunning() ?? 'Persistent local PostgreSQL is stopped (data is retained).');
} else if (action === 'stop') {
  if (await isRunning()) {
    await execute(pg_ctl, ['stop', '-D', data, '-m', 'fast', '-w', '-t', '20'], { windowsHide: true, timeout: 30000 });
  }
  console.log('Persistent local PostgreSQL stopped; all development data is retained.');
} else {
  await mkdir(root, { recursive: true });
  if (!await exists(configPath)) {
    if (await exists(resolve(data, 'PG_VERSION'))) throw new Error('Cluster exists without its config; refusing to replace credentials or reinitialize it.');
    await writeFile(configPath, JSON.stringify({ port: 55432, database: 'group9_dev', user: 'group9', password: randomBytes(24).toString('hex') }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  }
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  if (config.port !== 55432 || config.database !== 'group9_dev' || config.user !== 'group9' || !/^[a-f0-9]{48}$/.test(config.password)) throw new Error('Unexpected local PostgreSQL configuration');
  const databaseUrl = `postgresql://${config.user}:${config.password}@127.0.0.1:${config.port}/${config.database}?schema=public`;
  if (!await exists('.env')) {
    await writeFile('.env', `NODE_ENV=development\nDEV_IDENTITY_ENABLED=true\nPORT=3000\nFRONTEND_ORIGIN=http://localhost:5173\nDATABASE_URL=${databaseUrl}\n`, { flag: 'wx', mode: 0o600 });
    console.log('Created .env for persistent local development (no existing file was replaced).');
  } else {
    const existing = parse(await readFile('.env', 'utf8'));
    if (existing.DATABASE_URL !== databaseUrl) throw new Error('Existing .env was preserved. DATABASE_URL targets a different database; use that database or deliberately configure the persistent cluster using .local-postgres/config.json.');
    console.log('Preserved existing .env byte-for-byte.');
  }
  const pg = new EmbeddedPostgres({ databaseDir: data, port: config.port, user: config.user, password: config.password, persistent: true, initdbFlags: ['--encoding=UTF8', '--locale=C'], onLog: () => {} });
  if (!await isRunning()) {
    if (!await exists(resolve(data, 'PG_VERSION'))) await pg.initialise();
    await execute(pg_ctl, ['start', '-D', data, '-l', resolve(root, 'postgres.log'), '-o', `-p ${config.port} -h 127.0.0.1`, '-w', '-t', '20'], { windowsHide: true, timeout: 30000 });
  }
  const client = pg.getPgClient('postgres', '127.0.0.1');
  await client.connect();
  try {
    const result = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [config.database]);
    if (result.rowCount === 0) await client.query('CREATE DATABASE group9_dev');
  } finally { await client.end(); }
  console.log(`Persistent PostgreSQL ready at 127.0.0.1:${config.port}/${config.database}`);
  console.log('Next: npm run db:migrate && npm run db:seed && npm run dev');
}
