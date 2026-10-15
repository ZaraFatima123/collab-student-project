import { z } from 'zod';

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const nodeEnv = z.enum(['development', 'test', 'production']).default('production').parse(env.NODE_ENV);
  const devIdentityEnabled = z.enum(['true', 'false']).default('false').parse(env.DEV_IDENTITY_ENABLED) === 'true';
  if (devIdentityEnabled && nodeEnv !== 'development' && nodeEnv !== 'test') {
    throw new Error('Development identity cannot be enabled in production');
  }
  return {
    nodeEnv, devIdentityEnabled,
    port: z.coerce.number().int().min(1).max(65535).default(3000).parse(env.PORT),
    frontendOrigin: z.url().default('http://localhost:5173').parse(env.FRONTEND_ORIGIN),
  };
}
export type Config = ReturnType<typeof loadConfig>;
