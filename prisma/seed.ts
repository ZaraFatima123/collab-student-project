import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

export const seedUsers = [
  { id: '00000000-0000-4000-8000-000000000001', name: 'Asha Rao', email: 'asha@example.test' },
  { id: '00000000-0000-4000-8000-000000000002', name: 'Bilal Khan', email: 'bilal@example.test' },
  { id: '00000000-0000-4000-8000-000000000003', name: 'Cara Sen', email: 'cara@example.test' },
  { id: '00000000-0000-4000-8000-000000000004', name: 'Dev Patel', email: 'dev@example.test' },
];
export async function seed(db: PrismaClient) {
  await db.$transaction(seedUsers.map(user => db.user.upsert({ where: { id: user.id }, create: user, update: { name: user.name, email: user.email } })));
}
if (require.main === module) {
  if (!['development', 'test'].includes(process.env.NODE_ENV ?? '')) throw new Error('Seed fictional users only in explicit development/test mode');
  const db = new PrismaClient();
  seed(db).then(() => console.table(seedUsers)).catch(error => { console.error(error); process.exitCode = 1; }).finally(() => db.$disconnect());
}
