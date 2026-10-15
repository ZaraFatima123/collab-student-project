import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

export function testDatabaseUrl(env: NodeJS.ProcessEnv = process.env) {
  if (env.NODE_ENV === 'production') throw new Error('Never run database tests in production mode');
  const raw = env.TEST_DATABASE_URL;
  if (!raw) throw new Error('TEST_DATABASE_URL is required. Tests never fall back to DATABASE_URL.');
  const url = new URL(raw);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !decodeURIComponent(url.pathname).endsWith('_test')) throw new Error('Test database name must end in _test');
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Tests require a local, isolated PostgreSQL database');
  if (env.DATABASE_URL) {
    const development = new URL(env.DATABASE_URL);
    if (development.hostname.replace('localhost', '127.0.0.1') === url.hostname.replace('localhost', '127.0.0.1') && (development.port || '5432') === (url.port || '5432') && development.pathname === url.pathname) throw new Error('Test and development databases must differ');
  }
  return raw;
}
export function migrateTestDatabase(url: string) {
  execFileSync(process.execPath, [resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy'], { env: { ...process.env, DATABASE_URL: url }, stdio: 'inherit' });
}
