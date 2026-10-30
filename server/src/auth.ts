import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { config, jwtSecret } from './config.js';
import { AppError } from './errors.js';
import { loadViewer, type Viewer } from './access.js';
import { logger, requestContext } from './logger.js';

declare module 'express-serve-static-core' {
  interface Request {
    viewer?: Viewer;
  }
}

export function issueToken(personId: string): string {
  return jwt.sign({}, jwtSecret, { subject: personId, expiresIn: config.JWT_TTL as jwt.SignOptions['expiresIn'], algorithm: 'HS256' });
}

/**
 * Every /api route after this middleware needs `Authorization: Bearer <token>`.
 * The user is re-loaded from the database on each request, so a deleted person or a team change
 * takes effect immediately instead of when the token expires.
 */
export const requireAuth: RequestHandler = async (req, _res, next) => {
  const header = req.header('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return next(new AppError(401, 'UNAUTHENTICATED', 'Sign in first'));
  let personId: string;
  try {
    personId = jwt.verify(token, jwtSecret, { algorithms: ['HS256'] }).sub as string;
  } catch (err) {
    logger.warn({ event: 'auth.invalid_token', reason: (err as Error).name }, 'invalid or expired token');
    return next(new AppError(401, 'UNAUTHENTICATED', 'Your session has expired. Sign in again.'));
  }
  const viewer = await loadViewer(personId);
  if (!viewer) return next(new AppError(401, 'UNAUTHENTICATED', 'This user no longer exists'));
  req.viewer = viewer;
  const ctx = requestContext.getStore();
  if (ctx) ctx.userId = viewer.id;
  next();
};

export function viewerOf(req: { viewer?: Viewer }): Viewer {
  if (!req.viewer) throw new AppError(401, 'UNAUTHENTICATED', 'Sign in first');
  return req.viewer;
}
