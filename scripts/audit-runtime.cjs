require('dotenv').config();
const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');
const { createApp } = require('../dist/src/app');
const { loadConfig } = require('../dist/src/config');
const db = new PrismaClient();
createApp(db, loadConfig());
(async () => {
  await db.$connect();
  await db.user.findFirst();
  const loaded = Object.keys(require.cache).map(path => path.replaceAll('\\', '/')).filter(path => /\/deepmerge-ts\/|\/@prisma\/config\/|\/prisma\/build\//.test(path));
  console.log('Prisma CLI/config/deepmerge modules loaded by the built application:', JSON.stringify(loaded));
  assert.deepEqual(loaded, []);
})().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => db.$disconnect());
