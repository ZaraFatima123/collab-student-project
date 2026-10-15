import { writeFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { endpoints } from '../src/api';
import { openApi } from '../src/openapi';
const db = new PrismaClient();
writeFileSync('docs/openapi.json', JSON.stringify(openApi(endpoints(db)), null, 2) + '\n');
