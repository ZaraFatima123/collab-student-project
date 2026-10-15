import { RequestHandler } from 'express';
import { PrismaClient } from '@prisma/client';
import { Config } from '../config';
import { fail } from '../errors';
import { z } from 'zod';

export type CurrentUser = { id: string; name: string; email: string };
declare global {
  namespace Express { interface Request { currentUser: CurrentUser } }
}

// Replace this adapter with verified authentication; keep the currentUser contract.
export function developmentIdentity(db: PrismaClient, config: Config): RequestHandler {
  return async (req, _res, next) => {
    if (!config.devIdentityEnabled) fail(503, 'IDENTITY_UNAVAILABLE', 'Development identity is disabled; real authentication is not installed');
    const id = req.get('X-Dev-User-Id');
    if (!id) fail(401, 'DEV_IDENTITY_REQUIRED', 'Supply X-Dev-User-Id with a seeded user ID');
    if (!z.uuid().safeParse(id).success) fail(401, 'UNKNOWN_DEV_USER', 'Unknown development user');
    const user = await db.user.findUnique({ where: { id } });
    if (!user) fail(401, 'UNKNOWN_DEV_USER', 'Unknown development user');
    req.currentUser = user;
    next();
  };
}
