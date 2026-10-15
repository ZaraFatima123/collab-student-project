import express from 'express';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import { PrismaClient } from '@prisma/client';
import { Config } from './config';
import { developmentIdentity } from './middleware/identity';
import { errorHandler } from './errors';
import { endpoints, registerApi } from './api';
import { openApi } from './openapi';
import { listArgs, paginated, paging } from './validation';
import { snapshot } from './services/access';

export function createApp(db: PrismaClient, config: Config) {
  // Defense in depth for callers constructing Config directly.
  if (config.devIdentityEnabled && !['development', 'test'].includes(config.nodeEnv)) throw new Error('Development identity cannot be enabled in production');
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: config.frontendOrigin, allowedHeaders: ['Content-Type', 'X-Dev-User-Id'] }));
  app.use(express.json({ limit: '100kb' }));
  app.get('/api/health', async (_req, res) => {
    try { await db.$queryRaw`SELECT 1`; res.json({ data: { status: 'ok' } }); }
    catch { res.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Database is unavailable' } }); }
  });
  const definitions = endpoints(db);
  const spec = openApi(definitions);
  app.get('/api/openapi.json', (_req, res) => res.json(spec));
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(spec));
  app.use('/api', developmentIdentity(db, config));
  if (config.devIdentityEnabled) app.get('/api/dev/users', async (req, res) => {
    const q = paging.parse(req.query);
    res.json(await snapshot(db, async tx => paginated(await tx.user.findMany(listArgs(q, 'name')), await tx.user.count(), q)));
  });
  registerApi(app, definitions);
  app.use((_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }));
  app.use(errorHandler);
  return app;
}
