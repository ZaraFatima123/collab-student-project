import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config';
import { testDatabaseUrl } from './test-database';

test('development identity requires explicit permitted environment', () => {
  assert.equal(loadConfig({}).devIdentityEnabled, false);
  assert.throws(() => loadConfig({ DEV_IDENTITY_ENABLED: 'true' }), /production/);
  assert.throws(() => loadConfig({ NODE_ENV: 'production', DEV_IDENTITY_ENABLED: 'true' }), /production/);
  assert.throws(() => loadConfig({ NODE_ENV: 'staging', DEV_IDENTITY_ENABLED: 'true' }));
  assert.throws(() => loadConfig({ NODE_ENV: 'development', DEV_IDENTITY_ENABLED: 'yes' }));
  assert.equal(loadConfig({ NODE_ENV: 'development', DEV_IDENTITY_ENABLED: 'true' }).devIdentityEnabled, true);
  assert.equal(loadConfig({ NODE_ENV: 'test', DEV_IDENTITY_ENABLED: 'true' }).devIdentityEnabled, true);
});
test('test database guard rejects production, remote and shared databases', () => {
  assert.throws(() => testDatabaseUrl({}), /required/);
  assert.throws(() => testDatabaseUrl({ NODE_ENV: 'production' }), /production/);
  assert.throws(() => testDatabaseUrl({ TEST_DATABASE_URL: 'postgresql://u:p@localhost/group9' }), /_test/);
  assert.throws(() => testDatabaseUrl({ TEST_DATABASE_URL: 'postgresql://u:p@remote/group9_test' }), /local/);
  assert.throws(() => testDatabaseUrl({ TEST_DATABASE_URL: 'postgresql://u:p@localhost/group9_test', DATABASE_URL: 'postgresql://x:y@127.0.0.1:5432/group9_test?schema=other' }), /differ/);
});
