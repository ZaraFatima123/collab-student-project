import { ErrorRequestHandler } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export function fail(status: number, code: string, message: string): never {
  throw new ApiError(status, code, message);
}
export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof ApiError) {
    res.status(error.status).json({ error: { code: error.code, message: error.message } });
  } else if (error instanceof ZodError) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: error.issues } });
  } else if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2003', 'P2010', 'P2034'].includes(error.code)) {
    res.status(409).json({ error: { code: 'CONFLICT', message: 'The change conflicts with existing data. Refresh and retry.' } });
  } else if (error?.type === 'entity.parse.failed' || error?.type === 'entity.too.large') {
    res.status(error.type === 'entity.too.large' ? 413 : 400).json({ error: { code: 'INVALID_BODY', message: 'Request must contain valid JSON smaller than 100 KB' } });
  } else {
    console.error('Unhandled request error:', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  }
};
