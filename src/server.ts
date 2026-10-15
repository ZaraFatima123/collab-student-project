import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { loadConfig } from './config';
import { createApp } from './app';

async function main() {
  const config = loadConfig();
  const db = new PrismaClient();
  await db.$connect();
  const server = createApp(db, config).listen(config.port, '127.0.0.1', () => console.log(`Group 9 API: http://localhost:${config.port}/api/docs`));
  let stopping = false;
  async function stop() {
    if (stopping) return;
    stopping = true;
    server.close(async () => { await db.$disconnect(); process.exit(0); });
    setTimeout(() => process.exit(1), 10000).unref();
  }
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
main().catch(error => { console.error('Startup failed:', error.message); process.exit(1); });
